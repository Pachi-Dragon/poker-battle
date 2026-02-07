interface CardBadgeProps {
    card: string
    className?: string
}

const suitColors: Record<string, string> = {
    "♠": "bg-black",
    "♥": "bg-red-500",
    "♦": "bg-sky-400",
    "♣": "bg-emerald-400",
}

function getSuitColor(card: string) {
    const suit = card.slice(-1)
    return suitColors[suit] ?? "bg-slate-600"
}

export function CardBadge({ card, className = "" }: CardBadgeProps) {
    return (
        <span
            className={`inline-flex min-w-8 items-center justify-center rounded px-2 py-1 text-xs font-semibold text-white ${getSuitColor(
                card
            )} ${className}`}
        >
            {card}
        </span>
    )
}
