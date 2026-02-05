import { TableState } from "@/lib/game/types"

interface BoardPotProps {
    table: TableState
}

export function BoardPot({ table }: BoardPotProps) {
    return (
        <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-center text-white">
            <div className="text-xs uppercase tracking-widest text-white/60">
                Board
            </div>
            <div className="mt-2 flex items-center justify-center gap-2">
                {table.board.length > 0 ? (
                    table.board.map((card) => (
                        <span
                            key={card}
                            className="rounded bg-black/30 px-2 py-1 text-sm"
                        >
                            {card}
                        </span>
                    ))
                ) : (
                    <span className="text-white/60">---</span>
                )}
            </div>
            <div className="mt-4 text-xs uppercase tracking-widest text-white/60">
                Pot
            </div>
            <div className="mt-1 text-lg font-semibold">{table.pot}</div>
            <div className="mt-2 text-[10px] text-white/50">
                Hand #{table.hand_number} ・ {table.street}
            </div>
        </div>
    )
}

