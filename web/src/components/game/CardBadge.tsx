interface CardBadgeProps {
    card: string
    className?: string
}

const suitColors: Record<string, string> = {
    "♠": "bg-black",
    "♥": "bg-red-700",
    "♦": "bg-sky-700",   // Fold と同じ色
    "♣": "bg-emerald-700", // Check と同じ色
}

function getSuitColor(card: string) {
    const suit = card.slice(-1)
    return suitColors[suit] ?? "bg-slate-600"
}

export function CardBadge({ card, className = "" }: CardBadgeProps) {
    return (
        <span
            className={`inline-flex min-w-10 items-center justify-center rounded border border-white/80 px-2.5 py-1.5 text-sm font-semibold text-white ${getSuitColor(
                card
            )} ${className}`}
        >
            {card}
        </span>
    )
}
