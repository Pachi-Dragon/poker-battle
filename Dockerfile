# ビルドステージ
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
# 依存関係をインストール
RUN uv sync --frozen --no-cache

# 実行ステージ
FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# src フォルダを丸ごとコピー
COPY src/ ./src/

# 起動コマンド（パスを指定）
CMD ["python", "src/poker-battle/main.py"]