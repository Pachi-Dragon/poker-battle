import { getHandLabel } from "@/lib/game/handRank"
import { TableState } from "@/lib/game/types"
import { useEffect, useMemo, useRef, useState } from "react"
import { CardBadge } from "./CardBadge"

interface BoardPotProps {
    table: TableState
    canStart?: boolean
    onStart?: () => void
    /** 収支を保存するか（「収支を保存する」にチェックで true） */
    saveStats?: boolean
    onSaveStatsChange?: (value: boolean) => void
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
    saveStats = false,
    onSaveStatsChange,
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
    const payoutEntries = useMemo(() => {
        const payouts = table.action_history.filter(
            (action) => action.action?.toLowerCase() === "payout" && action.actor_id
        )
        if (!payouts.length) return []
        const payoutTotals = new Map<string, number>()
        payouts.forEach((action) => {
            const actorId = action.actor_id as string
            const amount = action.amount ?? 0
            payoutTotals.set(actorId, (payoutTotals.get(actorId) ?? 0) + amount)
        })
        const orderedActorIds: string[] = []
        payouts.forEach((action) => {
            const actorId = action.actor_id as string
            if (!orderedActorIds.includes(actorId)) {
                orderedActorIds.push(actorId)
            }
        })
        const showHandLabel = !isFoldedEnd
        return orderedActorIds
            .map((actorId) => {
                const seat = table.seats.find((item) => item.player_id === actorId)
                if (!seat) return null
                const amount = payoutTotals.get(actorId) ?? 0
                const label =
                    showHandLabel &&
                        seat.hole_cards &&
                        seat.hole_cards.length >= 2 &&
                        table.board.length >= 5
                        ? getHandLabel(seat.hole_cards, table.board)
                        : null
                return {
                    seatIndex: seat.seat_index,
                    name: seat.name ?? "",
                    amount,
                    label,
                }
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    }, [table.action_history, table.board, table.seats, isFoldedEnd])
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
        <div className="relative min-w-0 w-full">
            <div className="rounded-2xl border border-white/20 bg-slate-950 px-4 py-2 text-center text-white flex flex-col items-center justify-center gap-1.5 min-w-0 w-full relative">
                {blinds != null && (
                    <span className="absolute bottom-1 left-1 text-[9px] uppercase tracking-wider text-white/60">
                        SB-BB {blinds.sb}-{blinds.bb}
                    </span>
                )}
                <div className="flex items-center justify-center gap-1.5 shrink-0">
                    {boardSlots.map((card, index) => {
                        if (!card) {
                            return (
                                <span
                                    key={`empty-${index}`}
                                    className="inline-flex h-6 w-[38px] shrink-0 items-center justify-center rounded border border-dashed border-white/40 px-2 py-1 text-sm text-white/40"
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
                                className={`text-base min-w-[38px] ${shouldAnimate ? "board-card-drop" : ""
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
                    <div className="flex flex-col items-center gap-1.5">
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
                        {onSaveStatsChange && (
                            <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-white/80">
                                <input
                                    type="checkbox"
                                    checked={saveStats}
                                    onChange={(e) => onSaveStatsChange(e.target.checked)}
                                    className="h-3 w-3 rounded border-white/40 bg-slate-900 accent-amber-400"
                                />
                                収支を保存する
                            </label>
                        )}
                    </div>
                )}
                <div className="flex items-baseline justify-center gap-1.5 shrink-0">
                    <span className="text-[10px] uppercase tracking-wider text-white/60">Pot</span>
                    <span className="text-base font-semibold">{displayPotAmount}</span>
                </div>
            </div>
            {payoutEntries.length > 0 && (
                <div className="absolute left-1/2 top-full mt-1 flex -translate-x-1/2 flex-col items-center gap-1 text-xs">
                    {payoutEntries.map((entry) => (
                        <div key={entry.seatIndex} className="flex items-center gap-2">
                            <span className="text-white">{entry.name}</span>
                            <span className="text-lime-300 font-semibold">
                                +{entry.amount}
                            </span>
                            {entry.label && (
                                <span className="text-yellow-300">
                                    ({entry.label})
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

