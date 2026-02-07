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
}

export function SeatCard({
    seat,
    isHero,
    isCurrentTurn,
    isTopSeat,
    chipToX,
    chipToY,
}: SeatCardProps) {
    const occupied = Boolean(seat.player_id)
    const [settlingAmount, setSettlingAmount] = useState<number | null>(null)
    const prevCommitRef = useRef<number>(seat.street_commit ?? 0)
    const chipPositionClass = isTopSeat
        ? "-bottom-3 translate-y-full"
        : "-top-3 -translate-y-full"
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
    return (
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
            <div className="flex items-center justify-center gap-1.5">
                {occupied && seat.hole_cards && seat.hole_cards.length > 0 ? (
                    seat.hole_cards.map((card) => (
                        <CardBadge key={card} card={card} />
                    ))
                ) : (
                    <>
                        <span className="inline-flex min-w-10 items-center justify-center rounded border border-white/20 px-2.5 py-1.5 text-xs text-white/30">
                            &nbsp;
                        </span>
                        <span className="inline-flex min-w-10 items-center justify-center rounded border border-white/20 px-2.5 py-1.5 text-xs text-white/30">
                            &nbsp;
                        </span>
                    </>
                )}
            </div>
            <div className="mt-2 text-white">
                <div className="font-semibold truncate text-center text-[15px] text-white/70 min-h-[1.25rem]">
                    {occupied ? seat.name : "\u00A0"}
                </div>
                <div className="mt-1 flex items-center justify-between min-h-[0.75rem]">
                    <span
                        className={`inline-flex h-5 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm font-semibold leading-none ${
                            occupied ? "bg-orange-700/90 text-white" : "bg-orange-700/20 text-transparent"
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
    )
}

