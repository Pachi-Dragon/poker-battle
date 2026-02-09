import type { EarningsSummary } from "@/lib/game/types"

interface EarningsPanelProps {
    title: string
    summary?: EarningsSummary | null
    isLoading?: boolean
    error?: string | null
    onRefresh?: () => void
    refreshLabel?: string
    className?: string
}

const formatSigned = (value: number) =>
    value > 0 ? `+${value}` : `${value}`

const signedToneClass = (value: number) =>
    value > 0 ? "text-lime-300" : value < 0 ? "text-red-300" : "text-white"

const per100 = (total: number, hands: number) =>
    hands > 0 ? Math.round((total / hands) * 100) : 0

export function EarningsPanel({
    title,
    summary,
    isLoading = false,
    error,
    onRefresh,
    refreshLabel = "更新",
    className,
}: EarningsPanelProps) {
    return (
        <div
            className={`rounded-xl border border-white/20 bg-white/10 p-4 text-white ${className ?? ""}`}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white/90">{title}</div>
                {onRefresh && (
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
                        disabled={isLoading}
                    >
                        {refreshLabel}
                    </button>
                )}
            </div>
            {isLoading ? (
                <div className="mt-2 text-xs text-white/60">読み込み中...</div>
            ) : error ? (
                <div className="mt-2 text-xs text-amber-200">{error}</div>
            ) : (
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                        <div className="text-white/60">ハンド数</div>
                        <div className="mt-1 text-sm font-semibold">
                            {summary?.hands ?? 0}
                        </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                        <div className="text-white/60">チップ増減</div>
                        <div
                            className={`mt-1 text-sm font-semibold ${signedToneClass(
                                summary?.chips_delta ?? 0
                            )}`}
                        >
                            {formatSigned(summary?.chips_delta ?? 0)}
                        </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                        <div className="text-white/60">収支/100 hand</div>
                        <div
                            className={`mt-1 text-sm font-semibold ${signedToneClass(
                                per100(
                                    summary?.chips_delta ?? 0,
                                    summary?.hands ?? 0
                                )
                            )}`}
                        >
                            {formatSigned(
                                per100(
                                    summary?.chips_delta ?? 0,
                                    summary?.hands ?? 0
                                )
                            )}
                        </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                        <div className="text-white/60">69/92配布数</div>
                        <div className="mt-1 text-sm font-semibold">
                            {summary?.hands_69_92 ?? 0}
                        </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                        <div className="text-white/60">69/92チップ</div>
                        <div
                            className={`mt-1 text-sm font-semibold ${signedToneClass(
                                summary?.chips_delta_69_92 ?? 0
                            )}`}
                        >
                            {formatSigned(summary?.chips_delta_69_92 ?? 0)}
                        </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                        <div className="text-white/60">
                            69or92収支/100 hand
                        </div>
                        <div
                            className={`mt-1 text-sm font-semibold ${signedToneClass(
                                per100(
                                    summary?.chips_delta_69_92 ?? 0,
                                    summary?.hands_69_92 ?? 0
                                )
                            )}`}
                        >
                            {formatSigned(
                                per100(
                                    summary?.chips_delta_69_92 ?? 0,
                                    summary?.hands_69_92 ?? 0
                                )
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
