import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Next.js(フロントエンド)からのアクセスを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 開発時は"*"でOK。本番はURLを指定
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Poker API is running"}

if __name__ == "__main__":
    import uvicorn
    # Cloud Runは環境変数 PORT を指定してくる。なければ 8000 を使う
    port = int(os.environ.get("PORT", 8000))
    # 0.0.0.0 で待機しないとコンテナ外からアクセスできない
    uvicorn.run(app, host="0.0.0.0", port=port)
