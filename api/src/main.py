import asyncio
import os
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google.oauth2 import id_token
from google.auth.transport import requests
from dotenv import load_dotenv

from .allowlist import AllowListStore
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
allowlist_store = AllowListStore()
HAND_DELAY_SECONDS = 1.0
RUNOUT_DELAY_SECONDS = 2.6
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

        allowed_emails = await allowlist_store.get_allowed_emails()
        if allowed_emails and (not email or email.lower() not in allowed_emails):
            raise HTTPException(status_code=403, detail="Email not allowed")

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
    def connected_emails() -> set[str]:
        connections = manager.active_connections.get(table_id, set())
        return {
            pid
            for ws in connections
            if (pid := manager.get_player(ws)) is not None
        }

    def table_state_payload_for(viewer_email: str | None) -> dict:
        return table.to_state_for(viewer_email, connected_emails()).model_dump()

    async def broadcast_table_state() -> None:
        connections = list(manager.active_connections.get(table_id, set()))
        for ws in connections:
            pid = manager.get_player(ws)
            await manager.send(ws, {"type": "tableState", "payload": table_state_payload_for(pid)})

    await manager.send(
        websocket,
        {"type": "tableState", "payload": table_state_payload_for(manager.get_player(websocket))},
    )

    async def cancel_pending_leave(email: str) -> None:
        task = pending_leave_tasks.pop(email, None)
        if task:
            task.cancel()

    async def cancel_pending_disconnect(email: str) -> None:
        task = pending_disconnect_tasks.pop(email, None)
        if task:
            task.cancel()

    async def schedule_leave(email: str) -> None:
        await cancel_pending_leave(email)

        async def delayed_leave() -> None:
            await asyncio.sleep(LEAVE_GRACE_SECONDS)
            if manager.has_player(email):
                return
            table.leave_player(email)
            await broadcast_table_state()

        pending_leave_tasks[email] = asyncio.create_task(delayed_leave())

    async def schedule_disconnect(email: str) -> None:
        await cancel_pending_disconnect(email)

        async def delayed_disconnect() -> None:
            await asyncio.sleep(LEAVE_GRACE_SECONDS)
            if manager.has_player(email):
                return
            table.set_auto_play(email, True)
            table.apply_auto_play()
            await broadcast_table_state()

        pending_disconnect_tasks[email] = asyncio.create_task(delayed_disconnect())

    async def start_hand_with_delay() -> None:
        await asyncio.sleep(HAND_DELAY_SECONDS)
        table.start_new_hand()
        connections = list(manager.active_connections.get(table_id, set()))
        for ws in connections:
            pid = manager.get_player(ws)
            await manager.send(ws, {"type": "handState", "payload": table_state_payload_for(pid)})

    async def wait_for_all_gauges_then_start_hand() -> None:
        global settlement_gauge_ready, settlement_gauge_timeout_task
        settlement_gauge_ready = set()
        # No timeout: keep waiting until all connected players send `nextHandGaugeComplete`.
        # (If a previous hand had a scheduled task, ensure it's cleared.)
        if settlement_gauge_timeout_task:
            settlement_gauge_timeout_task.cancel()
            settlement_gauge_timeout_task = None

    async def start_next_hand_from_settlement(expected_hand_number: int) -> None:
        """
        Finalize settlement and start a new hand.

        Guarded by (street == settlement && hand_number matches) so it can be safely called
        from both gauge-complete and timeout paths without double-starting.
        """
        global settlement_gauge_ready, settlement_gauge_timeout_task
        if table.street != Street.settlement or table.hand_number != expected_hand_number:
            return
        if settlement_gauge_timeout_task:
            settlement_gauge_timeout_task.cancel()
            settlement_gauge_timeout_task = None
        settlement_gauge_ready.clear()
        try:
            if table.save_earnings:
                updates = table.build_earnings_updates()
                await earnings_store.apply_updates(updates)
        except Exception as exc:
            print(f"earnings update failed: {exc}")
        table.apply_pending_payouts()
        table._finalize_pending_leaves()
        table._finalize_leave_after_hand()
        table.start_new_hand()
        connections = list(manager.active_connections.get(table_id, set()))
        for ws in connections:
            pid = manager.get_player(ws)
            await manager.send(
                ws, {"type": "handState", "payload": table_state_payload_for(pid)}
            )

    async def check_gauge_complete_and_start() -> None:
        global settlement_gauge_ready, settlement_gauge_timeout_task
        required = connected_emails()
        if required and settlement_gauge_ready >= required:
            await start_next_hand_from_settlement(table.hand_number)

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            payload = message.get("payload") or {}

            if message_type == "joinTable":
                data = JoinTablePayload(**payload)
                manager.set_player(websocket, data.email)
                await cancel_pending_leave(data.email)
                await cancel_pending_disconnect(data.email)
                table.set_auto_play(data.email, False)
                existing = table.find_seat(data.email)
                if existing:
                    table.join_player(data.email, data.name)
                elif table.street in (Street.preflop, Street.flop, Street.turn, Street.river):
                    # hand in progress: wait for seat reservation
                    pass
                else:
                    # 参加時に自動着席せず、席選択に移る
                    pass
                await broadcast_table_state()
            elif message_type == "leaveTable":
                email = payload.get("email") or manager.get_player(websocket)
                if email:
                    await schedule_leave(email)
            elif message_type == "leaveNow":
                # 即時離席（待機/未着席UIから参加画面に戻る用途）
                email = payload.get("email") or manager.get_player(websocket)
                if email:
                    await cancel_pending_leave(email)
                    await cancel_pending_disconnect(email)
                    table.leave_player(email)
                    await broadcast_table_state()
            elif message_type == "leaveAfterHand":
                email = payload.get("email") or manager.get_player(websocket)
                if email:
                    table.mark_leave_after_hand(email)
                    await broadcast_table_state()
            elif message_type == "cancelLeaveAfterHand":
                email = payload.get("email") or manager.get_player(websocket)
                if email:
                    table.cancel_leave_after_hand(email)
                    await broadcast_table_state()
            elif message_type == "action":
                data = ActionPayload(**payload)
                table.record_action(data)
                await manager.broadcast(
                    table_id,
                    {"type": "actionApplied", "payload": data.model_dump()},
                )
                await broadcast_table_state()
                while table.should_auto_runout():
                    await asyncio.sleep(RUNOUT_DELAY_SECONDS)
                    if not table.advance_auto_runout():
                        break
                    await broadcast_table_state()
                # ハンド終了（settlement）後は全プレイヤーのゲージが0になるまで待ってから次のハンドを開始
                if (
                    table.street == Street.settlement
                    and len([s for s in table.seats if s.email]) >= 2
                ):
                    await wait_for_all_gauges_then_start_hand()
            elif message_type == "nextHandGaugeComplete":
                email = payload.get("email") or manager.get_player(websocket)
                if email and table.street == Street.settlement:
                    settlement_gauge_ready.add(email)
                    await check_gauge_complete_and_start()
            elif message_type == "revealHand":
                email = payload.get("email") or manager.get_player(websocket)
                if email:
                    data = RevealHandPayload(email=email)
                    if table.record_hand_reveal(data.email):
                        await broadcast_table_state()
            elif message_type == "syncState":
                await manager.send(
                    websocket,
                    {"type": "tableState", "payload": table_state_payload_for(manager.get_player(websocket))},
                )
            elif message_type == "heartbeat":
                # Cloud Run keep-alive: no-op
                pass
            elif message_type == "reserveSeat":
                data = ReserveSeatPayload(**payload)
                table.reserve_seat(data.email, data.name, data.seat_index)
                await broadcast_table_state()
            elif message_type == "resetTable":
                table.reset()
                await broadcast_table_state()
            elif message_type == "setSaveStats":
                if table.street == Street.waiting and "save_stats" in payload:
                    table.save_earnings = bool(payload["save_stats"])
                    await broadcast_table_state()
            elif message_type == "requestManualTopup":
                # Next hand: +300 chips (only when stack <= 100). Earnings unaffected.
                email = payload.get("email") or manager.get_player(websocket)
                if email:
                    table.request_manual_topup(email)
                    # No visible change until next hand, but we still broadcast so the UI can
                    # stay in sync if needed.
                    await broadcast_table_state()
            elif message_type == "startHand":
                if (
                    table.street == Street.waiting
                    and len([s for s in table.seats if s.email]) >= 2
                ):
                    table.save_earnings = payload.get("save_stats", False)
                    await start_hand_with_delay()
            else:
                await manager.send(
                    websocket,
                    {"type": "error", "payload": {"message": "Unknown message type"}},
                )
    except WebSocketDisconnect:
        email = manager.get_player(websocket)
        if email:
            await schedule_disconnect(email)
        manager.disconnect(websocket)
        await broadcast_table_state()
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