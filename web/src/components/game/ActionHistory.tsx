import { ActionRecord } from "@/lib/game/types"

interface ActionHistoryProps {
    actions: ActionRecord[]
    className?: string
    maxHeight?: number | null
    hideAmounts?: boolean
}

const actionLabels: Record<string, string> = {
    refund: "返却",
}

const detailLabels: Record<string, string> = {
    uncalled: "未コール分",
}

function formatActionLabel(action: ActionRecord) {
    const raw = action.action ?? ""
    return actionLabels[raw] ?? raw
}

function formatDetailLabel(detail?: string | null) {
    if (!detail) return ""
    return detailLabels[detail] ?? detail
}

export function ActionHistory({
    actions,
    className = "",
    maxHeight,
    hideAmounts = false,
}: ActionHistoryProps) {
    const visibleActions = actions.filter(
        (action) => (action.action ?? "").toLowerCase() !== "hand_reveal"
    )
    return (
        <div
            className={`min-h-0 overflow-y-auto rounded-2xl border border-white/20 bg-white/10 p-4 text-xs text-white ${className}`}
            style={
                maxHeight
                    ? { height: `${maxHeight}px`, maxHeight: `${maxHeight}px` }
                    : undefined
            }
        >
            <div className="mb-2 text-xs uppercase tracking-widest text-white/60">
                Action History
            </div>
            {visibleActions.length === 0 ? (
                <p className="text-white/50">No actions yet.</p>
            ) : (
                <ul className="space-y-1">
                    {visibleActions.map((action, index) => (
                        <li key={`${action.actor_id ?? "system"}-${index}`}>
                            <span className="font-semibold">
                                {action.actor_name ?? "System"}
                            </span>{" "}
                            {formatActionLabel(action)}
                            {!hideAmounts && action.amount ? ` ${action.amount}` : ""}
                            {action.detail ? ` (${formatDetailLabel(action.detail)})` : ""}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

