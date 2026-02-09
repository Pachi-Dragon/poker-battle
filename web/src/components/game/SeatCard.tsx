import { SeatState } from "@/lib/game/types"
import { useEffect, useRef, useState } from "react"
import { CardBadge } from "./CardBadge"

interface SeatCardProps {
    seat: SeatState
    isHero: boolean
    isCurrentTurn: boolean
    isTopSeat: boolean
    canReserve: boolean
    showWinner?: boolean
    /** 相手のハンドを表で表示する（ショーダウン時のみ true） */
    showHoleCards?: boolean
    /** Fold決着後のチップ表示を数字のみで出す */
    chipsOnlyBadge?: boolean
    chipsOnlyAmount?: number
    hideCommitBadge?: boolean
    onReserve?: () => void
    onSelect?: () => void
}

export function SeatCard({
    seat,
    isHero,
    isCurrentTurn,
    isTopSeat,
    canReserve,
    showWinner = false,
    showHoleCards = true,
    chipsOnlyBadge = false,
    chipsOnlyAmount,
    hideCommitBadge = false,
    onReserve,
    onSelect,
}: SeatCardProps) {
    const cardDropAnimationMs = 420
    const occupied = Boolean(seat.player_id)
    const isDisconnected = occupied && seat.is_connected === false
    const [animatedHoleIndices, setAnimatedHoleIndices] = useState<number[]>([])
    const prevHoleCountRef = useRef<number>(seat.hole_cards?.length ?? 0)
    const chipPositionClass = isTopSeat
        ? "-bottom-1 translate-y-full"
        : "-bottom-1 translate-y-full"
    const normalizedLastAction = (seat.last_action ?? "")
        .toLowerCase()
        .replace("_", "-")
    const effectiveAction =
        seat.is_all_in || normalizedLastAction === "all-in"
            ? "all-in"
            : normalizedLastAction
    const actionToneClass = chipsOnlyBadge
        ? "bg-black text-white"
        : effectiveAction === "fold"
            ? "bg-sky-900/50 text-sky-100"
            : effectiveAction === "call" || effectiveAction === "check"
                ? "bg-emerald-900/60 text-emerald-100"
                : effectiveAction === "bet" ||
                    effectiveAction === "raise" ||
                    effectiveAction === "all-in"
                    ? "bg-red-900/60 text-red-200"
                    : "bg-black/70 text-white"
    const formatActionLabel = (action: string, amount: number) => {
        if (action === "fold") return "Fold"
        if (action === "check") return "Check"
        if (action === "post-sb") return amount > 0 ? `${amount}` : null
        if (action === "post-bb") return amount > 0 ? `${amount}` : null
        if (action === "call") return amount > 0 ? `Call ${amount}` : "Call"
        if (action === "bet") return amount > 0 ? `Bet ${amount}` : "Bet"
        if (action === "raise") return amount > 0 ? `Raise ${amount}` : "Raise"
        if (action === "all-in") return amount > 0 ? `All-in ${amount}` : "All-in"
        return amount > 0 ? `${amount}` : null
    }
    const actionAmount =
        seat.last_action_amount ?? (seat.street_commit ?? 0)
    const commitLabel = formatActionLabel(
        effectiveAction,
        actionAmount
    )
    const chipsOnlyValue = chipsOnlyAmount ?? seat.street_commit ?? 0
    const numericOnly =
        chipsOnlyBadge || (commitLabel !== null && /^\d+$/.test(commitLabel))
    const showCommitBadge = chipsOnlyBadge
        ? occupied && chipsOnlyValue > 0
        : !hideCommitBadge &&
        occupied &&
        (commitLabel !== null ||
            (seat.street_commit ?? 0) > 0 ||
            effectiveAction === "fold" ||
            effectiveAction === "check")
    const isClickable = occupied && Boolean(onSelect)

    useEffect(() => {
        const prevCount = prevHoleCountRef.current
        const nextCount = seat.hole_cards?.length ?? 0
        if (nextCount < prevCount) {
            setAnimatedHoleIndices([])
        } else if (nextCount > prevCount) {
            const indices = Array.from(
                { length: nextCount - prevCount },
                (_, offset) => prevCount + offset
            )
            setAnimatedHoleIndices(indices)
            const timeout = window.setTimeout(() => {
                setAnimatedHoleIndices([])
            }, cardDropAnimationMs)
            return () => window.clearTimeout(timeout)
        }
        prevHoleCountRef.current = nextCount
    }, [seat.hole_cards?.length])

    return (
        <div className="flex flex-col items-stretch gap-0.5">
            <div
                className={`relative rounded-lg border px-2 py-1.5 text-xs shadow ${occupied
                    ? isDisconnected
                        ? "bg-slate-800/90 text-white/60 border-white/10"
                        : "bg-slate-950"
                    : "bg-slate-950/20"
                    } ${occupied
                        ? isCurrentTurn
                            ? "border-yellow-400"
                            : "border-white/20"
                        : "border-white/30 border-dashed"
                    } ${isClickable ? "cursor-pointer hover:border-white/50" : ""}`}
                onClick={isClickable ? onSelect : undefined}
                onKeyDown={
                    isClickable
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                onSelect?.()
                            }
                        }
                        : undefined
                }
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
            >
                {showWinner && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                        <span className="inline-flex items-center justify-center rounded-full border border-lime-200 bg-lime-300/90 px-2.5 py-0.5 text-[11px] font-semibold text-slate-900 shadow">
                            Win
                        </span>
                    </div>
                )}
                {isDisconnected && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/45">
                        <span className="rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
                            接続中
                        </span>
                    </div>
                )}
                {!occupied && canReserve && (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation()
                            onReserve?.()
                        }}
                        className="absolute inset-2 flex items-center justify-center rounded-lg border border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                        aria-label="Reserve seat"
                    >
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/70 text-lg font-semibold">
                            +
                        </span>
                    </button>
                )}
                {showCommitBadge && (
                    <div
                        className={`absolute left-1/2 -translate-x-1/2 ${chipPositionClass}`}
                    >
                        <div
                            className={`inline-flex shrink-0 items-center justify-center rounded-full border border-white/20 py-0.5 text-xs font-semibold shadow ${numericOnly ? "w-[2.5rem] px-1.5" : "w-[5.5rem] px-2"
                                } ${actionToneClass}`}
                        >
                            <span>
                                {chipsOnlyBadge
                                    ? chipsOnlyValue
                                    : commitLabel ?? seat.street_commit}
                            </span>
                        </div>
                    </div>
                )}
                {occupied && seat.position === "BTN" && (
                    <span className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black shadow">
                        B
                    </span>
                )}
                <div className="flex w-full items-center justify-center">
                    <div className="flex w-full max-w-[calc(100%-0.5rem)] items-center justify-center gap-1">
                        {occupied && seat.hole_cards && seat.hole_cards.length > 0 ? (
                            showHoleCards ? (
                                seat.hole_cards.map((card, index) => (
                                    <CardBadge
                                        key={`${card}-${index}`}
                                        card={card}
                                        className={`flex min-w-0 shrink-0 ${animatedHoleIndices.includes(index)
                                            ? "board-card-drop"
                                            : ""
                                            }`}
                                    />
                                ))
                            ) : (
                                seat.hole_cards.map((_, index) => (
                                    <span
                                        key={`back-${index}`}
                                        className="inline-flex h-6 w-[38px] shrink-0 items-center justify-center rounded border border-white/80 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 px-2 py-1 shadow-inner"
                                        style={{
                                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.4)",
                                        }}
                                    >
                                        <span className="h-3 w-3 rounded-full border border-indigo-400/30 bg-indigo-950/80" />
                                    </span>
                                ))
                            )
                        ) : (
                            <>
                                <span className="inline-flex w-[38px] shrink-0 items-center justify-center rounded border border-white/20 px-2 py-1 text-xs text-white/30">
                                    &nbsp;
                                </span>
                                <span className="inline-flex w-[38px] shrink-0 items-center justify-center rounded border border-white/20 px-2 py-1 text-xs text-white/30">
                                    &nbsp;
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <div className="mt-1 text-white">
                    <div className="font-medium truncate text-center text-xs text-white/70 min-h-[1rem]">
                        {occupied ? seat.name : "\u00A0"}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between min-h-[0.625rem]">
                        <span
                            className={`inline-flex h-4 min-w-[1.75rem] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none ${occupied
                                ? "bg-orange-700/90 text-white"
                                : "bg-orange-700/20 text-transparent"
                                }`}
                        >
                            {occupied ? seat.position : "\u00A0"}
                        </span>
                        <span className="inline-flex h-4 items-center text-xs font-semibold leading-none text-white">
                            {occupied ? seat.stack : "\u00A0"}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
}

