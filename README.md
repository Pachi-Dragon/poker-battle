# poker-battle

## Cloud Run デプロイ（フロントエンド）

`web/` を Cloud Run にデプロイする例（リージョン・プロジェクトは適宜変更）。

```bash
cd web
gcloud run deploy poker-battle-web \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars "AUTH_GOOGLE_ID=あなたのクライアントID,AUTH_GOOGLE_SECRET=あなたのシークレット,AUTH_SECRET=認証用シークレット"
```

- **AUTH_GOOGLE_ID** / **AUTH_GOOGLE_SECRET**: Google Cloud Console の OAuth 2.0 クライアントの値
- **AUTH_SECRET**: Auth.js 用（`npx auth secret` で生成可）
- **NEXT_PUBLIC_API_URL**: デフォルトで既存 API URL が Docker ビルドに使われます。別 URL にする場合は `--build-arg NEXT_PUBLIC_API_URL=https://...` を付けてビルド

デプロイ後、表示された Service URL でフロントにアクセスできます。
