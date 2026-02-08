import { TableState } from "@/lib/game/types"
import { useEffect, useMemo, useRef, useState } from "react"
import { CardBadge } from "./CardBadge"

interface BoardPotProps {
    table: TableState
    canStart?: boolean
    onStart?: () => void
    /** SB/BB表示用（左隅に SB-BB 1-3 形式で表示） */
    blinds?: { sb: number; bb: number } | null
    /** 表示用ポットを強制する（リセット抑止など） */
    potOverride?: number
    /** Fold決着時の見えるボードストリートを強制する */
    foldVisibleStreet?: TableState["street"] | null
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

export function BoardPot({
    table,
    canStart = false,
    onStart,
    blinds,
    potOverride,
    foldVisibleStreet,
}: BoardPotProps) {
    const boardCardAnimationMs = 420
    const boardCardStaggerMs = 120
    const potAmount = potExcludingCurrentStreet(table)
    const displayPotAmount = potOverride ?? potAmount
    const hasShowdown = table.action_history.some(
        (action) => action.action?.toLowerCase() === "showdown"
    )
    const isFoldedEnd = table.street === "settlement" && !hasShowdown
    const lastFoldAction = isFoldedEnd
        ? [...table.action_history]
            .reverse()
            .find((action) => action.action?.toLowerCase() === "fold")
        : undefined
    const forcedFoldCount =
        isFoldedEnd && foldVisibleStreet ? boardCountForStreet(foldVisibleStreet) : null
    const visibleCount =
        forcedFoldCount !== null
            ? forcedFoldCount
            : isFoldedEnd && lastFoldAction
                ? boardCountForStreet(lastFoldAction.street)
                : table.board.length
    const boardSlots = useMemo(
        () =>
            Array.from({ length: 5 }, (_, index) =>
                index < visibleCount ? table.board[index] : undefined
            ),
        [table.board, visibleCount]
    )
    const showStart = table.street === "waiting"
    const prevBoardRef = useRef<(string | undefined)[]>([])
    const prevHandNumberRef = useRef(table.hand_number)
    const [animatedIndices, setAnimatedIndices] = useState<number[]>([])

    useEffect(() => {
        if (table.hand_number !== prevHandNumberRef.current) {
            prevBoardRef.current = []
            prevHandNumberRef.current = table.hand_number
        }
        const prevBoard = prevBoardRef.current
        const nextBoard = boardSlots
        const newIndices = nextBoard
            .map((card, index) => {
                const prevCard = prevBoard[index]
                if (card && card !== prevCard) {
                    return index
                }
                return null
            })
            .filter((value): value is number => value !== null)
        let timeout: number | null = null
        const shouldUpdate =
            newIndices.length !== animatedIndices.length ||
            newIndices.some((value, index) => value !== animatedIndices[index])
        if (newIndices.length > 0) {
            if (shouldUpdate) {
                setAnimatedIndices(newIndices)
            }
            const timeoutMs =
                boardCardAnimationMs + boardCardStaggerMs * (newIndices.length - 1)
            timeout = window.setTimeout(() => {
                setAnimatedIndices((prev) => (prev.length ? [] : prev))
            }, timeoutMs)
        } else if (animatedIndices.length) {
            setAnimatedIndices([])
        }
        prevBoardRef.current = nextBoard
        return () => {
            if (timeout) {
                window.clearTimeout(timeout)
            }
        }
    }, [
        animatedIndices,
        boardCardAnimationMs,
        boardCardStaggerMs,
        boardSlots,
        table.hand_number,
    ])

    return (
        <div className="rounded-2xl border border-white/20 bg-slate-950 px-5 py-3 text-center text-white flex flex-col items-center justify-center gap-2 min-w-0 w-full relative">
            {blinds != null && (
                <span className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider text-white/60">
                    SB-BB {blinds.sb}-{blinds.bb}
                </span>
            )}
            <div className="flex items-center justify-center gap-1.5 shrink-0">
                {boardSlots.map((card, index) => {
                    if (!card) {
                        return (
                            <span
                                key={`empty-${index}`}
                                className="inline-flex w-[45px] shrink-0 items-center justify-center rounded border border-dashed border-white/40 px-2.5 py-1.5 text-sm text-white/40"
                            >
                                &nbsp;
                            </span>
                        )
                    }
                    const animationOrder = animatedIndices.indexOf(index)
                    const shouldAnimate = animationOrder >= 0
                    return (
                        <CardBadge
                            key={`${card}-${index}`}
                            card={card}
                            className={`text-base min-w-9 px-2.5 py-1.5 ${shouldAnimate ? "board-card-drop" : ""
                                }`}
                            style={
                                shouldAnimate
                                    ? {
                                        ["--board-card-drop-duration" as any]:
                                            `${boardCardAnimationMs}ms`,
                                        ["--board-card-drop-delay" as any]:
                                            `${animationOrder * boardCardStaggerMs}ms`,
                                    }
                                    : undefined
                            }
                        />
                    )
                })}
            </div>
            {showStart && (
                <button
                    type="button"
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${canStart
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
                <span className="text-base font-semibold">{displayPotAmount}</span>
            </div>
        </div>
    )
}

