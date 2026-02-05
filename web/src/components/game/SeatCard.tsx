import { SeatState } from "@/lib/game/types"

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
                Stack: {occupied ? seat.stack : "-"}
            </div>
            <div className="mt-1 text-white/70">
                {seat.is_folded
                    ? "Status: Folded"
                    : seat.is_all_in
                      ? "Status: All-in"
                      : "Status: Active"}
            </div>
            <div className="mt-1 text-white/70">
                {seat.last_action ? `Action: ${seat.last_action}` : "Action: -"}
            </div>
        </div>
    )
}

