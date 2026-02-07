import { SeatState } from "@/lib/game/types"
import { CardBadge } from "./CardBadge"

interface SeatCardProps {
    seat: SeatState
    isHero: boolean
}

export function SeatCard({ seat, isHero }: SeatCardProps) {
    const occupied = Boolean(seat.player_id)
    return (
        <div
            className={`rounded-xl border px-3 py-2 text-xs shadow ${
                isHero ? "border-amber-300 bg-amber-50" : "border-white/20 bg-white/10"
            }`}
        >
            <div className="flex items-center justify-between text-white">
                <span className="font-semibold">
                    {occupied ? seat.name : "Empty"}
                </span>
                <span className="text-[10px] opacity-70">{seat.position}</span>
            </div>
            <div className="mt-1 text-white/80">
                {occupied ? seat.stack : "-"}
            </div>
            {occupied && (
                <div className="mt-1 text-white/60">
                    {seat.is_ready ? "Ready" : "Not ready"}
                </div>
            )}
            <div className="mt-1 text-white/70">
                {seat.last_action ?? "-"}
            </div>
            <div className="mt-2 flex items-center gap-1">
                {occupied && seat.hole_cards && seat.hole_cards.length > 0 ? (
                    seat.hole_cards.map((card) => (
                        <CardBadge key={card} card={card} />
                    ))
                ) : (
                    <span className="text-white/60">---</span>
                )}
            </div>
        </div>
    )
}

