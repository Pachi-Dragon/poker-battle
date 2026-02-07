import { TableState } from "@/lib/game/types"
import { useEffect, useRef, useState } from "react"
import { CardBadge } from "./CardBadge"

interface BoardPotProps {
    table: TableState
    canStart?: boolean
    onStart?: () => void
}

/** 現在のストリートのベットを除いたポット（フェーズ開始時点のポット） */
function potExcludingCurrentStreet(table: TableState): number {
    const streetTotal = table.seats.reduce((sum, s) => sum + (s.street_commit ?? 0), 0)
    return Math.max(0, table.pot - streetTotal)
}

function boardCountForStreet(street: TableState["street"]) {
    switch (street) {
        case "flop":
            return 3
        case "turn":
            return 4
        case "river":
        case "showdown":
        case "settlement":
            return 5
        default:
            return 0
    }
}

export function BoardPot({ table, canStart = false, onStart }: BoardPotProps) {
    const potAmount = potExcludingCurrentStreet(table)
    const hasShowdown = table.action_history.some(
        (action) => action.action?.toLowerCase() === "showdown"
    )
    const isFoldedEnd = table.street === "settlement" && !hasShowdown
    const lastFoldAction = isFoldedEnd
        ? [...table.action_history]
            .reverse()
            .find((action) => action.action?.toLowerCase() === "fold")
        : undefined
    const visibleCount =
        isFoldedEnd && lastFoldAction
            ? boardCountForStreet(lastFoldAction.street)
            : table.board.length
    const boardSlots = Array.from({ length: 5 }, (_, index) =>
        index < visibleCount ? table.board[index] : undefined
    )
    const showStart = table.street === "waiting"
    const prevBoardLengthRef = useRef(visibleCount)
    const [animatedIndices, setAnimatedIndices] = useState<number[]>([])

    useEffect(() => {
        const prevLength = prevBoardLengthRef.current
        const nextLength = visibleCount
        if (nextLength < prevLength) {
            setAnimatedIndices([])
        } else if (nextLength > prevLength) {
            const indices = Array.from(
                { length: nextLength - prevLength },
                (_, offset) => prevLength + offset
            )
            setAnimatedIndices(indices)
            const timeout = window.setTimeout(() => {
                setAnimatedIndices([])
            }, 320)
            return () => window.clearTimeout(timeout)
        }
        prevBoardLengthRef.current = nextLength
    }, [visibleCount])

    return (
        <div className="rounded-2xl border border-white/20 bg-slate-950 px-5 py-3 text-center text-white flex flex-col items-center justify-center gap-2 min-w-0 w-full">
            <div className="flex items-center justify-center gap-1.5 shrink-0">
                {boardSlots.map((card, index) =>
                    card ? (
                        <CardBadge
                            key={`${card}-${index}`}
                            card={card}
                            className={`text-base min-w-9 px-2.5 py-1.5 ${
                                animatedIndices.includes(index) ? "board-card-drop" : ""
                            }`}
                        />
                    ) : (
                        <span
                            key={`empty-${index}`}
                            className="inline-flex min-w-9 items-center justify-center rounded border border-dashed border-white/40 px-2.5 py-1.5 text-sm text-white/40"
                        >
                            &nbsp;
                        </span>
                    )
                )}
            </div>
            {showStart && (
                <button
                    type="button"
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                        canStart
                            ? "bg-amber-400/90 text-slate-900 hover:bg-amber-300"
                            : "bg-white/10 text-white/40 cursor-not-allowed"
                    }`}
                    onClick={onStart}
                    disabled={!canStart}
                >
                    ここを押すとスタート
                </button>
            )}
            <div className="flex items-baseline justify-center gap-1.5 shrink-0">
                <span className="text-[10px] uppercase tracking-wider text-white/60">Pot</span>
                <span className="text-base font-semibold">{potAmount}</span>
            </div>
        </div>
    )
}

