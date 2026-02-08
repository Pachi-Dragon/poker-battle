"use client"

import { JoinTablePayload } from "@/lib/game/types"
import { signOut } from "next-auth/react"
import { useState } from "react"
import { GameClient } from "./GameClient"

interface JoinTableScreenProps {
    playerId: string
    defaultName: string
    email?: string | null
}

/**
 * 画面2: おかえりなさい画面（プレイヤー名入力・メール・ログアウト・参加ボタン）
 * 画面3: ゲーム画面（参加後は GameClient・メール・ログアウトは非表示）
 * テーブル参加は独立画面にせず、おかえりなさい画面に統合。
 */
export function JoinTableScreen({
    playerId,
    defaultName,
    email,
}: JoinTableScreenProps) {
    const [name, setName] = useState(defaultName)
    const [player, setPlayer] = useState<JoinTablePayload | null>(null)

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const trimmed = name.trim() || defaultName
        setPlayer({ player_id: playerId, name: trimmed })
    }

    return (
        <div className="flex min-h-screen flex-col bg-emerald-950 text-white">
            {/* メイン: おかえりなさい（名前入力） or ゲームテーブル */}
            <main className="flex-1 min-h-0 flex flex-col">
                {player ? (
                    <GameClient
                        player={player}
                        embeddedInHome
                        onBackToHome={() => setPlayer(null)}
                    />
                ) : (
                    <div className="flex flex-1 flex-col items-center justify-center p-6">
                        <div className="w-full max-w-sm rounded-2xl border border-emerald-400/30 bg-emerald-900/50 p-8 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
                            <p className="text-emerald-200/80 text-sm text-center mb-6">
                                プレイヤー名を入力してテーブルに参加しましょう
                            </p>
                            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                                <div>
                                    <label
                                        htmlFor="player-name"
                                        className="block text-sm font-medium text-emerald-200 mb-2"
                                    >
                                        プレイヤー名
                                    </label>
                                    <input
                                        id="player-name"
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="名前を入力"
                                        maxLength={20}
                                        className="w-full rounded-lg border border-emerald-500/50 bg-emerald-950/80 px-4 py-3 text-white placeholder:text-emerald-400/50 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                                        autoFocus
                                    />
                                    {name.length > 0 && (
                                        <p className="mt-1 text-xs text-emerald-400/70">
                                            {name.length} / 20 文字
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="submit"
                                    className="w-full rounded-lg bg-emerald-500 px-4 py-3 font-semibold text-white hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-emerald-950 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    6maxに参加する
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </main>

            {/* フッター: メール・ログアウトはHOME（名前入力）のときのみ表示。ポーカー画面では非表示 */}
            {!player && (
                <footer className="shrink-0 border-t-2 border-white bg-emerald-950/95 px-4 py-3 mx-4 mb-4 rounded-lg">
                    <div className="mx-auto flex max-w-sm items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm text-white/90">
                            {email ?? "—"}
                        </p>
                        <button
                            type="button"
                            onClick={() => signOut({ callbackUrl: "/" })}
                            className="shrink-0 rounded-lg border border-white/40 bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30"
                        >
                            ログアウト
                        </button>
                    </div>
                </footer>
            )}
        </div>
    )
}
