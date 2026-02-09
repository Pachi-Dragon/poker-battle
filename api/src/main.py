import asyncio
import os
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google.oauth2 import id_token
from google.auth.transport import requests
from dotenv import load_dotenv

from .earnings.store import EarningsStore
from .game.manager import ConnectionManager, GameTable
from .game.models import (
    ActionPayload,
    JoinTablePayload,
    ReserveSeatPayload,
    RevealHandPayload,
    Street,
)

# .envファイルを読み込む
load_dotenv()

app = FastAPI()
manager = ConnectionManager()
table = GameTable(table_id="default")
earnings_store = EarningsStore()
HAND_DELAY_SECONDS = 1.0
RUNOUT_DELAY_SECONDS = 1.6
LEAVE_GRACE_SECONDS = 30.0
GAUGE_COMPLETE_TIMEOUT_SECONDS = 30.0
pending_leave_tasks: dict[str, asyncio.Task] = {}
pending_disconnect_tasks: dict[str, asyncio.Task] = {}
settlement_gauge_ready: set[str] = set()
settlement_gauge_timeout_task: asyncio.Task | None = None

# Next.js(フロントエンド)からのアクセスを許可
# ALLOWED_ORIGINS 未設定時は "*"（開発用）。本番は "https://dragonspoker-game.com" など指定
_allowed_origins = os.getenv("ALLOWED_ORIGINS", "*")
allow_origins = ["*"] if _allowed_origins == "*" else [o.strip() for o in _allowed_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Google Cloud Consoleで取得したクライアントIDを環境変数から読み込む
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

# フロントエンドから送られてくるデータの型定義
class AuthRequest(BaseModel):
    token: str

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Poker API is running"}


@app.get("/earnings")
async def get_earnings(email: str):
    if not email:
        raise HTTPException(status_code=400, detail="email is required")
    return await earnings_store.get(email)

# Googleログイン用のエンドポイントを追加
@app.post("/login/google")
async def google_login(auth_data: AuthRequest):
    try:
        # Google IDトークンの検証
        id_info = id_token.verify_oauth2_token(
            auth_data.token, 
            requests.Request(), 
            GOOGLE_CLIENT_ID
        )

        # 検証成功：ユーザー情報を取得
        user_id = id_info['sub']  # Googleユーザー固有のID
        email = id_info.get('email')
        name = id_info.get('name')

        # ここで本来はデータベースへの保存等を行います
        return {
            "status": "ok",
            "user": {
                "id": user_id,
                "email": email,
                "name": name
            }
        }

    except ValueError:
        # トークンが不正な場合
        raise HTTPException(status_code=401, detail="Invalid Google Token")


@app.websocket("/ws/game")
async def websocket_game(websocket: WebSocket):
    table_id = table.table_id
    await manager.connect(table_id, websocket)
    def connected_player_ids() -> set[str]:
        connections = manager.active_connections.get(table_id, set())
        return {
            pid
            for ws in connections
            if (pid := manager.get_player(ws)) is not None
        }

    def table_state_payload() -> dict:
        return table.to_state(connected_player_ids()).model_dump()

    await manager.send(
        websocket,
        {"type": "tableState", "payload": table_state_payload()},
    )

    async def cancel_pending_leave(player_id: str) -> None:
        task = pending_leave_tasks.pop(player_id, None)
        if task:
            task.cancel()

    async def cancel_pending_disconnect(player_id: str) -> None:
        task = pending_disconnect_tasks.pop(player_id, None)
        if task:
            task.cancel()

    async def schedule_leave(player_id: str) -> None:
        await cancel_pending_leave(player_id)

        async def delayed_leave() -> None:
            await asyncio.sleep(LEAVE_GRACE_SECONDS)
            if manager.has_player(player_id):
                return
            table.leave_player(player_id)
            await manager.broadcast(
                table_id,
                {"type": "tableState", "payload": table_state_payload()},
            )

        pending_leave_tasks[player_id] = asyncio.create_task(delayed_leave())

    async def schedule_disconnect(player_id: str) -> None:
        await cancel_pending_disconnect(player_id)

        async def delayed_disconnect() -> None:
            await asyncio.sleep(LEAVE_GRACE_SECONDS)
            if manager.has_player(player_id):
                return
            table.set_auto_play(player_id, True)
            table.apply_auto_play()
            await manager.broadcast(
                table_id,
                {"type": "tableState", "payload": table_state_payload()},
            )

        pending_disconnect_tasks[player_id] = asyncio.create_task(delayed_disconnect())

    async def start_hand_with_delay() -> None:
        await asyncio.sleep(HAND_DELAY_SECONDS)
        table.start_new_hand()
        await manager.broadcast(
            table_id,
            {"type": "handState", "payload": table_state_payload()},
        )

    async def wait_for_all_gauges_then_start_hand() -> None:
        global settlement_gauge_ready, settlement_gauge_timeout_task
        settlement_gauge_ready = set()
        settlement_gauge_timeout_task = None

    async def check_gauge_complete_and_start() -> None:
        global settlement_gauge_ready, settlement_gauge_timeout_task
        required = connected_player_ids()
        if required and settlement_gauge_ready >= required:
            if settlement_gauge_timeout_task:
                settlement_gauge_timeout_task.cancel()
                settlement_gauge_timeout_task = None
            settlement_gauge_ready.clear()
            try:
                updates = table.build_earnings_updates()
                await earnings_store.apply_updates(updates)
            except Exception as exc:
                print(f"earnings update failed: {exc}")
            table.apply_pending_payouts()
            table._finalize_pending_leaves()
            table._finalize_leave_after_hand()
            table.start_new_hand()
            await manager.broadcast(
                table_id,
                {"type": "handState", "payload": table_state_payload()},
            )

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            payload = message.get("payload") or {}

            if message_type == "joinTable":
                data = JoinTablePayload(**payload)
                manager.set_player(websocket, data.player_id)
                await cancel_pending_leave(data.player_id)
                await cancel_pending_disconnect(data.player_id)
                table.set_auto_play(data.player_id, False)
                existing = table.find_seat(data.player_id)
                if existing:
                    table.join_player(data.player_id, data.name)
                elif table.street in (Street.preflop, Street.flop, Street.turn, Street.river):
                    # hand in progress: wait for seat reservation
                    pass
                else:
                    # 参加時に自動着席せず、席選択に移る
                    pass
                await manager.broadcast(
                    table_id, {"type": "tableState", "payload": table_state_payload()}
                )
            elif message_type == "leaveTable":
                player_id = payload.get("player_id") or manager.get_player(websocket)
                if player_id:
                    await schedule_leave(player_id)
            elif message_type == "leaveAfterHand":
                player_id = payload.get("player_id") or manager.get_player(websocket)
                if player_id:
                    table.mark_leave_after_hand(player_id)
                    await manager.broadcast(
                        table_id,
                        {"type": "tableState", "payload": table_state_payload()},
                    )
            elif message_type == "cancelLeaveAfterHand":
                player_id = payload.get("player_id") or manager.get_player(websocket)
                if player_id:
                    table.cancel_leave_after_hand(player_id)
                    await manager.broadcast(
                        table_id,
                        {"type": "tableState", "payload": table_state_payload()},
                    )
            elif message_type == "action":
                data = ActionPayload(**payload)
                table.record_action(data)
                await manager.broadcast(
                    table_id,
                    {"type": "actionApplied", "payload": data.model_dump()},
                )
                await manager.broadcast(
                    table_id,
                    {"type": "tableState", "payload": table_state_payload()},
                )
                while table.should_auto_runout():
                    await asyncio.sleep(RUNOUT_DELAY_SECONDS)
                    if not table.advance_auto_runout():
                        break
                    await manager.broadcast(
                        table_id,
                        {"type": "tableState", "payload": table_state_payload()},
                    )
                # ハンド終了（settlement）後は全プレイヤーのゲージが0になるまで待ってから次のハンドを開始
                if (
                    table.street == Street.settlement
                    and len([s for s in table.seats if s.player_id]) >= 2
                ):
                    await wait_for_all_gauges_then_start_hand()
            elif message_type == "nextHandGaugeComplete":
                player_id = payload.get("player_id") or manager.get_player(websocket)
                if player_id and table.street == Street.settlement:
                    settlement_gauge_ready.add(player_id)
                    await check_gauge_complete_and_start()
            elif message_type == "revealHand":
                player_id = payload.get("player_id") or manager.get_player(websocket)
                if player_id:
                    data = RevealHandPayload(player_id=player_id)
                    if table.record_hand_reveal(data.player_id):
                        await manager.broadcast(
                            table_id,
                            {"type": "tableState", "payload": table_state_payload()},
                        )
            elif message_type == "syncState":
                await manager.send(
                    websocket,
                    {"type": "tableState", "payload": table_state_payload()},
                )
            elif message_type == "heartbeat":
                # Cloud Run keep-alive: no-op
                pass
            elif message_type == "reserveSeat":
                data = ReserveSeatPayload(**payload)
                table.reserve_seat(data.player_id, data.name, data.seat_index)
                await manager.broadcast(
                    table_id, {"type": "tableState", "payload": table_state_payload()}
                )
            elif message_type == "resetTable":
                table.reset()
                await manager.broadcast(
                    table_id, {"type": "tableState", "payload": table_state_payload()}
                )
            elif message_type == "startHand":
                if (
                    table.street == Street.waiting
                    and len([s for s in table.seats if s.player_id]) >= 2
                ):
                    await start_hand_with_delay()
            else:
                await manager.send(
                    websocket,
                    {"type": "error", "payload": {"message": "Unknown message type"}},
                )
    except WebSocketDisconnect:
        player_id = manager.get_player(websocket)
        if player_id:
            await schedule_disconnect(player_id)
        manager.disconnect(websocket)
        await manager.broadcast(
            table_id,
            {"type": "tableState", "payload": table_state_payload()},
        )
    except Exception as exc:
        await manager.send(
            websocket, {"type": "error", "payload": {"message": str(exc)}}
        )
        manager.disconnect(websocket)

if __name__ == "__main__":
    import uvicorn
    # Cloud Run環境ではPORT環境変数が指定されるため、それに対応
    port = int(os.environ.get("PORT", 8000))
    # 開発時は reload=True をつけるとコード修正が即反映されます
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=True)