import { ActionRecord } from "@/lib/game/types"

interface ActionHistoryProps {
    actions: ActionRecord[]
    className?: string
    maxHeight?: number | null
    hideAmounts?: boolean
}

const actionLabels: Record<string, string> = {
    refund: "返却",
    post_sb: "SB",
    post_bb: "BB",
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

function streetHeaderLabelFromAction(rawAction: string): string | null {
    const lower = (rawAction ?? "").toLowerCase()
    if (lower === "hand_start") return "PREFLOP"
    if (!lower.startsWith("street_")) return null
    const token = lower.slice("street_".length)
    if (token.includes("preflop")) return "PREFLOP"
    if (token.includes("flop")) return "FLOP"
    if (token.includes("turn")) return "TURN"
    if (token.includes("river")) return "RIVER"
    return null
}

export function ActionHistory({
    actions,
    className = "",
    maxHeight,
    hideAmounts = false,
}: ActionHistoryProps) {
    const visibleActions = actions.filter((action) => {
        const act = (action.action ?? "").toLowerCase()
        return act !== "hand_reveal"
    })

    const items: Array<
        | { kind: "streetHeader"; label: string }
        | { kind: "resultHeader"; label: string }
        | {
              kind: "action"
              actorName: string
              text: string
              detail?: string
          }
    > = []

    let hasResultHeader = false

    for (const action of visibleActions) {
        const rawAction = action.action ?? ""
        const lower = rawAction.toLowerCase()
        const normalized = lower.replace(/_/g, "-")

        // Street headers
        const streetHeader = streetHeaderLabelFromAction(rawAction)
        if (streetHeader) {
            // "System hand_start" is not shown; instead render PREFLOP header here.
            items.push({ kind: "streetHeader", label: streetHeader })
            continue
        }

        // Result header
        if (!hasResultHeader && (normalized === "showdown" || normalized === "hand-end")) {
            // Replace "System showdown"/"System hand_end" with a blank line and "# RESULT".
            items.push({ kind: "resultHeader", label: "# RESULT" })
            hasResultHeader = true
            continue
        }

        const actorName = action.actor_name ?? "System"

        // Custom formatting rules
        if (lower === "payout") {
            const amount = action.amount ?? null
            const text = hideAmounts
                ? "+"
                : amount !== null
                  ? `+${amount}`
                  : "+"
            // For payout, do not show detail (e.g. side_pot/uncontested) per spec.
            items.push({ kind: "action", actorName, text })
            continue
        }

        const label = formatActionLabel(action)
        const amountText =
            !hideAmounts && action.amount ? ` ${action.amount}` : ""
        const detailText = action.detail
            ? formatDetailLabel(action.detail)
            : ""

        items.push({
            kind: "action",
            actorName,
            text: `${label}${amountText}`.trim(),
            detail: detailText || undefined,
        })
    }

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
            {items.length === 0 ? (
                <p className="text-white/50">No actions yet.</p>
            ) : (
                <ul className="space-y-1">
                    {items.map((item, index) => {
                        if (item.kind === "streetHeader") {
                            return (
                                <li
                                    key={`street-${index}`}
                                    className="pt-1 text-amber-300 font-extrabold"
                                >
                                    {item.label}
                                </li>
                            )
                        }
                        if (item.kind === "resultHeader") {
                            return (
                                <li
                                    key={`result-${index}`}
                                    className="pt-3 font-extrabold text-white/80"
                                >
                                    {item.label}
                                </li>
                            )
                        }
                        return (
                            <li key={`action-${index}`}>
                                <span className="font-semibold">
                                    {item.actorName}
                                </span>{" "}
                                {item.text}
                                {item.detail ? ` (${item.detail})` : ""}
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

