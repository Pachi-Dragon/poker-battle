import asyncio
import os
from urllib.parse import parse_qs

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
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
# WebSocket認証用（NextAuthのAUTH_SECRETと同一の値を使用）
AUTH_SECRET = os.getenv("AUTH_SECRET")

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


def _verify_ws_token(token: str | None) -> str | None:
    """WebSocket用トークンを検証し、認証済みemailを返す。無効ならNone。"""
    if not token or not AUTH_SECRET:
        return None
    try:
        payload = jwt.decode(
            token,
            AUTH_SECRET,
            algorithms=["HS256"],
            options={"require": ["sub", "exp"]},
        )
        email = payload.get("sub")
        return email if isinstance(email, str) and email else None
    except JWTError:
        return None


@app.websocket("/ws/game")
async def websocket_game(websocket: WebSocket):
    # 接続前にクエリパラメータからトークンを取得して検証
    raw_query = websocket.scope.get("query_string") or b""
    query_string = raw_query.decode("utf-8") if isinstance(raw_query, bytes) else raw_query
    params = parse_qs(query_string)
    token = (params.get("token") or [None])[0]

    auth_user = _verify_ws_token(token)
    if not auth_user:
        # accept してから close しないとクライアントに close code が届かない
        await websocket.accept()
        await websocket.close(code=4001)  # 4001: 認証失敗
        return

    table_id = table.table_id
    await manager.connect(table_id, websocket)
    manager.set_auth_user(websocket, auth_user)

    def connected_player_ids() -> set[str]:
        connections = manager.active_connections.get(table_id, set())
        return {
            pid
            for ws in connections
            if (pid := manager.get_player(ws)) is not None
        }

    def table_state_payload_for(viewer_player_id: str | None) -> dict:
        return table.to_state_for(viewer_player_id, connected_player_ids()).model_dump()

    async def broadcast_table_state() -> None:
        connections = list(manager.active_connections.get(table_id, set()))
        for ws in connections:
            pid = manager.get_player(ws)
            await manager.send(ws, {"type": "tableState", "payload": table_state_payload_for(pid)})

    await manager.send(
        websocket,
        {"type": "tableState", "payload": table_state_payload_for(manager.get_player(websocket))},
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
            await broadcast_table_state()

        pending_leave_tasks[player_id] = asyncio.create_task(delayed_leave())

    async def schedule_disconnect(player_id: str) -> None:
        await cancel_pending_disconnect(player_id)

        async def delayed_disconnect() -> None:
            await asyncio.sleep(LEAVE_GRACE_SECONDS)
            if manager.has_player(player_id):
                return
            table.set_auto_play(player_id, True)
            table.apply_auto_play()
            await broadcast_table_state()

        pending_disconnect_tasks[player_id] = asyncio.create_task(delayed_disconnect())

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
        required = connected_player_ids()
        if required and settlement_gauge_ready >= required:
            await start_next_hand_from_settlement(table.hand_number)

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            payload = message.get("payload") or {}

            # 認証済みユーザーのみ操作可能。player_idは常にauth_userを使用（なりすまし防止）
            auth_user = manager.get_auth_user(websocket)
            if not auth_user:
                await manager.send(
                    websocket,
                    {"type": "error", "payload": {"message": "Authentication required"}},
                )
                continue

            if message_type == "joinTable":
                data = JoinTablePayload(**payload)
                # player_idは認証ユーザーと一致する必要がある
                if data.player_id.lower() != auth_user.lower():
                    await manager.send(
                        websocket,
                        {"type": "error", "payload": {"message": "player_id must match authenticated user"}},
                    )
                    continue
                player_id = auth_user
                manager.set_player(websocket, player_id)
                await cancel_pending_leave(player_id)
                await cancel_pending_disconnect(player_id)
                table.set_auto_play(player_id, False)
                existing = table.find_seat(player_id)
                if existing:
                    table.join_player(player_id, data.name)
                elif table.street in (Street.preflop, Street.flop, Street.turn, Street.river):
                    # hand in progress: wait for seat reservation
                    pass
                else:
                    # 参加時に自動着席せず、席選択に移る
                    pass
                await broadcast_table_state()
            elif message_type == "leaveTable":
                if auth_user:
                    await schedule_leave(auth_user)
            elif message_type == "leaveNow":
                # 即時離席（待機/未着席UIから参加画面に戻る用途）
                if auth_user:
                    await cancel_pending_leave(auth_user)
                    await cancel_pending_disconnect(auth_user)
                    table.leave_player(auth_user)
                    await broadcast_table_state()
            elif message_type == "leaveAfterHand":
                if auth_user:
                    table.mark_leave_after_hand(auth_user)
                    await broadcast_table_state()
            elif message_type == "cancelLeaveAfterHand":
                if auth_user:
                    table.cancel_leave_after_hand(auth_user)
                    await broadcast_table_state()
            elif message_type == "action":
                data = ActionPayload(**payload)
                if data.player_id.lower() != auth_user.lower():
                    await manager.send(
                        websocket,
                        {"type": "error", "payload": {"message": "player_id must match authenticated user"}},
                    )
                    continue
                # 認証ユーザーで上書き（クライアント送信を信頼しない）
                data = ActionPayload(player_id=auth_user, action=data.action, amount=data.amount)
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
                    and len([s for s in table.seats if s.player_id]) >= 2
                ):
                    await wait_for_all_gauges_then_start_hand()
            elif message_type == "nextHandGaugeComplete":
                if auth_user and table.street == Street.settlement:
                    settlement_gauge_ready.add(auth_user)
                    await check_gauge_complete_and_start()
            elif message_type == "revealHand":
                if auth_user:
                    if table.record_hand_reveal(auth_user):
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
                if data.player_id.lower() != auth_user.lower():
                    await manager.send(
                        websocket,
                        {"type": "error", "payload": {"message": "player_id must match authenticated user"}},
                    )
                    continue
                table.reserve_seat(auth_user, data.name, data.seat_index)
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
                if auth_user:
                    try:
                        table.request_manual_topup(auth_user)
                    except ValueError:
                        pass  # 条件を満たさない場合は無視
                    await broadcast_table_state()
            elif message_type == "startHand":
                if (
                    table.street == Street.waiting
                    and len([s for s in table.seats if s.player_id]) >= 2
                ):
                    table.save_earnings = payload.get("save_stats", False)
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