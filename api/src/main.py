import os
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google.oauth2 import id_token
from google.auth.transport import requests
from dotenv import load_dotenv

from .game.manager import ConnectionManager, GameTable
from .game.models import ActionPayload, JoinTablePayload

# .envファイルを読み込む
load_dotenv()

app = FastAPI()
manager = ConnectionManager()
table = GameTable(table_id="default")

# Next.js(フロントエンド)からのアクセスを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 開発時は"*"でOK。本番はURLを指定
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
    await manager.send(
        websocket,
        {"type": "tableState", "payload": table.to_state().model_dump()},
    )
    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            payload = message.get("payload") or {}

            if message_type == "joinTable":
                data = JoinTablePayload(**payload)
                table.join_player(data.player_id, data.name)
                manager.set_player(websocket, data.player_id)
                await manager.broadcast(
                    table_id, {"type": "tableState", "payload": table.to_state().model_dump()}
                )
            elif message_type == "leaveTable":
                player_id = payload.get("player_id") or manager.get_player(websocket)
                if player_id:
                    table.leave_player(player_id)
                    await manager.broadcast(
                        table_id,
                        {"type": "tableState", "payload": table.to_state().model_dump()},
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
                    {"type": "tableState", "payload": table.to_state().model_dump()},
                )
            elif message_type == "ready":
                player_id = payload.get("player_id") or manager.get_player(websocket)
                if player_id:
                    table.mark_ready(player_id)
                if table.all_ready():
                    table.start_new_hand()
                    await manager.broadcast(
                        table_id,
                        {"type": "handState", "payload": table.to_state().model_dump()},
                    )
                await manager.broadcast(
                    table_id,
                    {"type": "tableState", "payload": table.to_state().model_dump()},
                )
            elif message_type == "syncState":
                await manager.send(
                    websocket,
                    {"type": "tableState", "payload": table.to_state().model_dump()},
                )
            else:
                await manager.send(
                    websocket,
                    {"type": "error", "payload": {"message": "Unknown message type"}},
                )
    except WebSocketDisconnect:
        player_id = manager.get_player(websocket)
        if player_id:
            table.leave_player(player_id)
            await manager.broadcast(
                table_id,
                {"type": "tableState", "payload": table.to_state().model_dump()},
            )
        manager.disconnect(websocket)
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