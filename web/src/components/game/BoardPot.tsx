import { TableState } from "@/lib/game/types"
import { CardBadge } from "./CardBadge"

interface BoardPotProps {
    table: TableState
}

/** 現在のストリートのベットを除いたポット（フェーズ開始時点のポット） */
function potExcludingCurrentStreet(table: TableState): number {
    const streetTotal = table.seats.reduce((sum, s) => sum + (s.street_commit ?? 0), 0)
    return Math.max(0, table.pot - streetTotal)
}

export function BoardPot({ table }: BoardPotProps) {
    const potAmount = potExcludingCurrentStreet(table)

    return (
        <div className="rounded-2xl border border-white/20 bg-slate-950 px-5 py-3 text-center text-white flex flex-col items-center justify-center gap-2 min-w-0 w-full">
            <div className="flex items-center justify-center gap-1.5 shrink-0">
                {table.board.length > 0 ? (
                    table.board.map((card) => (
                        <CardBadge
                            key={card}
                            card={card}
                            className="text-base min-w-9 px-2.5 py-1.5"
                        />
                    ))
                ) : (
                    <span className="text-white/60 text-sm">---</span>
                )}
            </div>
            <div className="flex items-baseline justify-center gap-1.5 shrink-0">
                <span className="text-[10px] uppercase tracking-wider text-white/60">Pot</span>
                <span className="text-base font-semibold">{potAmount}</span>
            </div>
        </div>
    )
}

