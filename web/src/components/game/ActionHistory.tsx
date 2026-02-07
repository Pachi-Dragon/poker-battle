import { ActionRecord } from "@/lib/game/types"

interface ActionHistoryProps {
    actions: ActionRecord[]
    className?: string
}

export function ActionHistory({ actions, className = "" }: ActionHistoryProps) {
    return (
        <div
            className={`h-full min-h-0 overflow-y-auto rounded-2xl border border-white/20 bg-white/10 p-4 text-xs text-white ${className}`}
        >
            <div className="mb-2 text-xs uppercase tracking-widest text-white/60">
                Action History
            </div>
            {actions.length === 0 ? (
                <p className="text-white/50">No actions yet.</p>
            ) : (
                <ul className="space-y-1">
                    {actions.map((action, index) => (
                        <li key={`${action.actor_id ?? "system"}-${index}`}>
                            <span className="font-semibold">
                                {action.actor_name ?? "System"}
                            </span>{" "}
                            {action.action}
                            {action.amount ? ` ${action.amount}` : ""}
                            {action.detail ? ` (${action.detail})` : ""}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

