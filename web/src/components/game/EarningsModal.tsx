import type { EarningsSummary } from "@/lib/game/types"
import { EarningsPanel } from "./EarningsPanel"

interface EarningsModalProps {
    title: string
    summary?: EarningsSummary | null
    isLoading?: boolean
    error?: string | null
    onClose: () => void
    onRefresh?: () => void
}

export function EarningsModal({
    title,
    summary,
    isLoading = false,
    error,
    onClose,
    onRefresh,
}: EarningsModalProps) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-sm rounded-2xl border border-white/20 bg-slate-950 p-4 shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">{title}</div>
                    <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={onClose}
                        aria-label="Close earnings"
                    >
                        ×
                    </button>
                </div>
                <div className="mt-3">
                    <EarningsPanel
                        title="収支"
                        summary={summary}
                        isLoading={isLoading}
                        error={error}
                        onRefresh={onRefresh}
                        refreshLabel="更新"
                    />
                </div>
            </div>
        </div>
    )
}
