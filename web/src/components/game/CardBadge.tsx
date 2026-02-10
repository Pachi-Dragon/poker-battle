import { CSSProperties } from "react"

interface CardBadgeProps {
    card: string
    className?: string
    style?: CSSProperties
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

export function CardBadge({ card, className = "", style }: CardBadgeProps) {
    return (
        <span
            className={`relative isolate inline-flex h-7 w-[44px] shrink-0 items-center justify-center overflow-hidden rounded border border-white/80 px-2 py-1 text-sm font-semibold text-white ${getSuitColor(
                card
            )} ${className}`}
            style={style}
        >
            <span className="relative z-10">{card}</span>
        </span>
    )
}
