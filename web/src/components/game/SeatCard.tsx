import { SeatState } from "@/lib/game/types"
import { CSSProperties, useEffect, useRef, useState } from "react"
import { CardBadge } from "./CardBadge"

interface SeatCardProps {
    seat: SeatState
    isHero: boolean
    isCurrentTurn: boolean
    isTopSeat: boolean
    chipToX: string
    chipToY: string
    canReserve: boolean
    /** 相手のハンドを表で表示する（ショーダウン時のみ true） */
    showHoleCards?: boolean
    showTimer?: boolean
    timeGaugePercent?: number
    timeLeftSeconds?: number
    onReserve?: () => void
}

export function SeatCard({
    seat,
    isHero,
    isCurrentTurn,
    isTopSeat,
    chipToX,
    chipToY,
    canReserve,
    showHoleCards = true,
    showTimer = false,
    timeGaugePercent = 100,
    timeLeftSeconds = 0,
    onReserve,
}: SeatCardProps) {
    const occupied = Boolean(seat.player_id)
    const [settlingAmount, setSettlingAmount] = useState<number | null>(null)
    const [animatedHoleIndices, setAnimatedHoleIndices] = useState<number[]>([])
    const prevCommitRef = useRef<number>(seat.street_commit ?? 0)
    const prevHoleCountRef = useRef<number>(seat.hole_cards?.length ?? 0)
    const chipPositionClass = isTopSeat
        ? "-bottom-1 translate-y-full"
        : "-top-1 -translate-y-full"
    const chipToStyle = {
        ["--chip-to-x" as any]: chipToX,
        ["--chip-to-y" as any]: chipToY,
    } as CSSProperties

    useEffect(() => {
        const prevCommit = prevCommitRef.current
        const currentCommit = seat.street_commit ?? 0
        if (prevCommit > 0 && currentCommit === 0) {
            setSettlingAmount(prevCommit)
        }
        prevCommitRef.current = currentCommit
    }, [seat.street_commit])

    useEffect(() => {
        if (settlingAmount === null) return
        const timeout = window.setTimeout(() => setSettlingAmount(null), 650)
        return () => window.clearTimeout(timeout)
    }, [settlingAmount])

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
            }, 320)
            return () => window.clearTimeout(timeout)
        }
        prevHoleCountRef.current = nextCount
    }, [seat.hole_cards?.length])

    return (
        <div className="flex flex-col items-stretch gap-1">
            <div
                className={`relative rounded-xl border px-4 py-3 text-sm shadow ${
                    occupied ? "bg-slate-950" : "bg-slate-950/20"
                } ${
                    occupied
                        ? isCurrentTurn
                            ? "border-yellow-400"
                            : "border-white/20"
                        : "border-white/30 border-dashed"
                }`}
            >
                {!occupied && canReserve && (
                    <button
                        type="button"
                        onClick={onReserve}
                        className="absolute inset-2 flex items-center justify-center rounded-lg border border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                        aria-label="Reserve seat"
                    >
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/70 text-lg font-semibold">
                            +
                        </span>
                    </button>
                )}
                {occupied && seat.street_commit > 0 && (
                    <div
                        className={`absolute left-1/2 -translate-x-1/2 ${chipPositionClass}`}
                    >
                        <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/70 px-2.5 py-1 text-sm font-semibold text-white shadow">
                            <span className="inline-flex h-3 w-3 rounded-full bg-yellow-200 shadow-inner" />
                            <span>{seat.street_commit}</span>
                        </div>
                    </div>
                )}
                {occupied && settlingAmount !== null && (
                    <div
                        className={`absolute left-1/2 -translate-x-1/2 ${chipPositionClass} pointer-events-none`}
                    >
                        <div
                            className="chip-to-pot inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/70 px-2.5 py-1 text-sm font-semibold text-white shadow"
                            style={chipToStyle}
                        >
                            <span className="inline-flex h-3 w-3 rounded-full bg-yellow-200 shadow-inner" />
                            <span>{settlingAmount}</span>
                        </div>
                    </div>
                )}
                {occupied && seat.position === "BTN" && (
                    <span className="absolute -right-3 -top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-[13px] font-bold text-black shadow">
                        B
                    </span>
                )}
                <div className="flex w-full items-center justify-center">
                    <div className="flex w-full max-w-[calc(100%-0.5rem)] items-center justify-center gap-1.5">
                        {occupied && seat.hole_cards && seat.hole_cards.length > 0 ? (
                            showHoleCards ? (
                                seat.hole_cards.map((card, index) => (
                                    <CardBadge
                                        key={`${card}-${index}`}
                                        card={card}
                                        className={`flex min-w-0 flex-1 ${
                                            animatedHoleIndices.includes(index)
                                                ? "board-card-drop"
                                                : ""
                                        }`}
                                    />
                                ))
                            ) : (
                                seat.hole_cards.map((_, index) => (
                                    <span
                                        key={`back-${index}`}
                                        className="inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded border border-white/80 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 px-2.5 py-1.5 shadow-inner"
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
                                <span className="inline-flex min-w-0 flex-1 items-center justify-center rounded border border-white/20 px-2.5 py-1.5 text-xs text-white/30">
                                    &nbsp;
                                </span>
                                <span className="inline-flex min-w-0 flex-1 items-center justify-center rounded border border-white/20 px-2.5 py-1.5 text-xs text-white/30">
                                    &nbsp;
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <div className="mt-2 text-white">
                    <div className="font-semibold truncate text-center text-[15px] text-white/70 min-h-[1.25rem]">
                        {occupied ? seat.name : "\u00A0"}
                    </div>
                    <div className="mt-1 flex items-center justify-between min-h-[0.75rem]">
                        <span
                            className={`inline-flex h-5 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm font-semibold leading-none ${
                                occupied
                                    ? "bg-orange-700/90 text-white"
                                    : "bg-orange-700/20 text-transparent"
                            }`}
                        >
                            {occupied ? seat.position : "\u00A0"}
                        </span>
                        <span className="inline-flex h-5 items-center text-base font-semibold leading-none text-white">
                            {occupied ? seat.stack : "\u00A0"}
                        </span>
                    </div>
                </div>
            </div>
            {showTimer && (
                <div className="px-1">
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-amber-400 transition-[width] duration-200"
                            style={{ width: `${timeGaugePercent}%` }}
                        />
                    </div>
                    <div className="mt-0.5 text-center text-[10px] text-white/70">
                        {timeLeftSeconds}秒
                    </div>
                </div>
            )}
        </div>
    )
}

