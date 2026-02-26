# poker-battle

## ローカルでのゲーム起動（開発）

API（FastAPI）と Web（Next.js）をそれぞれローカルで起動します。

### 前提
- Node.js（LTS 推奨）/ npm
- Python 3.12+

### 1) API を起動（FastAPI）

1. `api/.env` を作成（または編集）して、次の環境変数を設定します。
   - **`GOOGLE_CLIENT_ID`**: Google Cloud Console の OAuth 2.0 Client ID
   - **`AUTH_SECRET`**: Web（NextAuth）と同じ認証用シークレット（WebSocket 認証に必要）

2. 依存を入れて起動します（PowerShell 例）。

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -e .
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

3. ログイン許可（allowlist）
   - ローカルでは `api/data/allows.json` の `emails` にあるメールだけログインできます。
   - 全員許可にしたい場合は `emails` を空配列 `[]` にしてください。

### 2) Web を起動（Next.js）

1. `web/.env.local` を作成（または編集）して、Web 側の環境変数を設定します（値は各自のものを入れてください）。
   - **`NEXT_PUBLIC_API_URL`**: `http://localhost:8000`
   - **`AUTH_GOOGLE_ID`** / **`AUTH_GOOGLE_SECRET`**: Google OAuth の Client ID / Secret
   - **`AUTH_SECRET`**: Auth.js 用（`npx auth secret` で生成可）

2. 依存を入れて起動します。

```bash
cd web
npm install
npm run dev
```

3. ブラウザで `http://localhost:3000` を開きます。

### ローカルでの Google OAuth 設定メモ
- Google Cloud Console の OAuth 同意画面/認証情報で、少なくとも以下を追加してください。
  - **承認済みの JavaScript 生成元**: `http://localhost:3000`
  - **承認済みのリダイレクト URI**: `http://localhost:3000/api/auth/callback/google`
- `api/.env` の `GOOGLE_CLIENT_ID` と `web/.env.local` の `AUTH_GOOGLE_ID` は **同じ Client ID** にしてください（API 側で ID トークン検証に使います）。

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
- **AUTH_URL**: Auth.js（next-auth v5）用。本番ではフロントの公開 URL（例: `https://dragonspoker-game.com` または Cloud Run の Service URL）を指定すると、コールバックなどが安定します。
- **NEXT_PUBLIC_API_URL**: デフォルトで既存 API URL が Docker ビルドに使われます。別 URL にする場合は `--build-arg NEXT_PUBLIC_API_URL=https://...` を付けてビルド

デプロイ後、表示された Service URL でフロントにアクセスできます。

### カスタムドメイン（例: https://dragonspoker-game.com）で使う場合

1. **Cloud Run でドメインをマッピング**  
   GCP Console → Cloud Run → 対象サービス → 「ドメインのマッピング」で `dragonspoker-game.com` を追加。表示される DNS レコードをドメイン側に設定。

2. **Google OAuth の設定**  
   Google Cloud Console → API とサービス → 認証情報 → 該当 OAuth 2.0 クライアントで次を追加：
   - **承認済みの JavaScript 生成元**: `https://dragonspoker-game.com`
   - **承認済みのリダイレクト URI**: `https://dragonspoker-game.com/api/auth/callback/google`

3. **（推奨）フロントの環境変数**  
   Cloud Run のサービスに `AUTH_URL=https://dragonspoker-game.com` を設定すると、認証のコールバックが安定します（next-auth v5 では AUTH_URL を使用）。

4. **（推奨）API の CORS**  
   API の Cloud Run サービスに環境変数  
   `ALLOWED_ORIGINS=https://dragonspoker-game.com`  
   を設定すると、本番ではそのオリジンのみ許可されます（未設定時は `*` のまま）。

5. **run.app をカスタムドメインへリダイレクト（任意）**  
   GCP では「*.run.app の URL だけを無効にする」設定はありません。代わりにアプリ側で、`*.run.app` でアクセスされた場合にカスタムドメインへリダイレクトしています。Cloud Run の環境変数に **CANONICAL_URL=https://dragonspoker-game.com** を設定すると有効になります（未設定の場合はリダイレクトしません）。

## Cloud Run デプロイ（API）

API はリポジトリルートの `Dockerfile` でビルドします。**プロジェクトルート**（`poker-battle/`）で実行してください。

```bash
gcloud run deploy poker-battle-api \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLIENT_ID=あなたのGoogleクライアントID,AUTH_SECRET=NextAuthと同じ認証用シークレット"
```

- **GOOGLE_CLIENT_ID**: フロントと同じ Google Cloud Console の OAuth 2.0 クライアント ID（トークン検証に使用）
- **AUTH_SECRET**: フロント（NextAuth）と同じ認証用シークレット。WebSocket 接続時のトークン検証に必要
- **ALLOWED_ORIGINS**（任意）: CORS で許可するオリジン。例: `https://dragonspoker-game.com`（未設定時は `*`）
- **FIRESTORE_DATABASE**（任意）: Firestore のデータベース ID。未設定時は `dragonspoker-game`。
- **allowlist**: 認証許可メールはローカルでは `api/data/allows.json`、Cloud Run では Firestore の `allows/allowlist` ドキュメント（`emails` 配列）で管理

デプロイ後に表示される Service URL を、フロントの `NEXT_PUBLIC_API_URL`（ビルド時）に指定します。

---

## API を Cloud Run にデプロイする場合（Firestore）

API は Cloud Run 上では **Firestore** に成績（earnings）を保存します。API を Cloud Run で動かす場合は、GCP 側で以下が必要です。

1. **Firestore を有効化**  
   - GCP Console → Firestore → 「データベースを作成」  
   - **ネイティブモード** を選択し、リージョン（例: `asia-northeast1`）を指定して作成。

2. **Cloud Run のサービスアカウントに権限を付与**  
   API の Cloud Run サービスはデフォルトのサービスアカウント（例: `PROJECT_NUMBER-compute@developer.gserviceaccount.com`）で動きます。  
   - IAM → そのサービスアカウントに **Cloud Datastore ユーザー**（`roles/datastore.user`）を付与。  
   - または Firestore 用のロール（`roles/datastore.owner` など）を付与。

3. **データベース ID**  
   データベースをデフォルトの `(default)` ではなく別名（例: `dragonspoker-game`）で作成した場合、API はデフォルトで `dragonspoker-game` に接続します。別の ID にしたいときは Cloud Run の環境変数で `FIRESTORE_DATABASE=あなたのDB名` を指定してください。

4. **コレクション**  
   - 成績: `earnings` コレクションを使用します。ドキュメントは自動作成されるため、Firestore 側で事前にコレクションを作る必要はありません。  
   - allowlist: `allows` コレクションの `allowlist` ドキュメントに `emails` 配列を作成してください（手動で追加・更新）
