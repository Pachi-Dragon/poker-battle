# ビルドステージ
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY api/pyproject.toml api/uv.lock ./
# 依存関係をインストール
RUN uv sync --frozen --no-cache

# 実行ステージ
FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"

# api/src フォルダを丸ごとコピー
COPY api/src/ ./src/

# 起動コマンド（Cloud RunのPORTに対応）
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8080}"]