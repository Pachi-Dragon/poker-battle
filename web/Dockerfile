# ビルドステージ（NEXT_PUBLIC_* はビルド時に埋め込まれる）
FROM node:20-alpine AS builder

ARG NEXT_PUBLIC_API_URL=https://poker-battle-api-235354613249.asia-northeast1.run.app
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 実行ステージ（standalone 出力のみコピー）
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "server.js"]
