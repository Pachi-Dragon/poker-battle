import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * run.app でアクセスされた場合、カスタムドメインへリダイレクトする。
 * 本番で CANONICAL_URL（例: https://dragonspoker-game.com）を設定すると有効になる。
 */
export function middleware(request: NextRequest) {
  const canonicalUrl = process.env.CANONICAL_URL;
  if (!canonicalUrl) return NextResponse.next();

  const host = request.headers.get("host") ?? "";
  const isRunApp = host.endsWith(".run.app");

  if (isRunApp) {
    const url = new URL(request.url);
    url.protocol = new URL(canonicalUrl).protocol;
    url.host = new URL(canonicalUrl).host;
    return NextResponse.redirect(url.toString(), 302);
  }

  return NextResponse.next();
}
