const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"]
const RANK_VALUE: Record<string, number> = Object.fromEntries(
    RANKS.map((rank, index) => [rank, 14 - index])
)

const parseCard = (card: string) => {
    const rank = card.slice(0, -1)
    const suit = card.slice(-1)
    return { value: RANK_VALUE[rank], suit }
}

type HandRank = {
    rank: number
    values: number[]
}

const handRankFive = (cards: string[]): HandRank => {
    const ranks: number[] = []
    const suits: string[] = []
    cards.forEach((card) => {
        const parsed = parseCard(card)
        ranks.push(parsed.value)
        suits.push(parsed.suit)
    })
    const rankCounts: Record<number, number> = {}
    ranks.forEach((value) => {
        rankCounts[value] = (rankCounts[value] ?? 0) + 1
    })
    const counts = Object.entries(rankCounts)
        .map(([rank, count]) => [Number(rank), count] as const)
        .sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))
    const isFlush = new Set(suits).size === 1
    const uniqueRanks = Array.from(new Set(ranks)).sort((a, b) => b - a)
    const isWheel = uniqueRanks.length === 5 &&
        uniqueRanks[0] === 14 &&
        uniqueRanks[1] === 5 &&
        uniqueRanks[2] === 4 &&
        uniqueRanks[3] === 3 &&
        uniqueRanks[4] === 2
    let isStraight = false
    let straightHigh = 0
    if (uniqueRanks.length === 5) {
        if (isWheel) {
            isStraight = true
            straightHigh = 5
        } else if (uniqueRanks[0] - uniqueRanks[4] === 4) {
            isStraight = true
            straightHigh = uniqueRanks[0]
        }
    }
    if (isStraight && isFlush) {
        return { rank: 8, values: [straightHigh] }
    }
    if (counts[0][1] === 4) {
        return { rank: 7, values: [counts[0][0], counts[1][0]] }
    }
    if (counts[0][1] === 3 && counts[1][1] === 2) {
        return { rank: 6, values: [counts[0][0], counts[1][0]] }
    }
    if (isFlush) {
        return { rank: 5, values: [...ranks].sort((a, b) => b - a) }
    }
    if (isStraight) {
        return { rank: 4, values: [straightHigh] }
    }
    if (counts[0][1] === 3) {
        const trips = counts[0][0]
        const kickers = [...ranks].sort((a, b) => b - a).filter((rank) => rank !== trips)
        return { rank: 3, values: [trips, ...kickers] }
    }
    if (counts[0][1] === 2 && counts[1][1] === 2) {
        const pairHigh = Math.max(counts[0][0], counts[1][0])
        const pairLow = Math.min(counts[0][0], counts[1][0])
        const kicker = [...ranks]
            .sort((a, b) => b - a)
            .find((rank) => rank !== pairHigh && rank !== pairLow) ?? 0
        return { rank: 2, values: [pairHigh, pairLow, kicker] }
    }
    if (counts[0][1] === 2) {
        const pairRank = counts[0][0]
        const kickers = [...ranks].sort((a, b) => b - a).filter((rank) => rank !== pairRank)
        return { rank: 1, values: [pairRank, ...kickers] }
    }
    return { rank: 0, values: [...ranks].sort((a, b) => b - a) }
}

const compareHandRank = (a: HandRank, b: HandRank) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    const maxLen = Math.max(a.values.length, b.values.length)
    for (let index = 0; index < maxLen; index += 1) {
        const left = a.values[index] ?? 0
        const right = b.values[index] ?? 0
        if (left !== right) return left - right
    }
    return 0
}

const bestHandRank = (cards: string[]): HandRank => {
    let best: HandRank = { rank: -1, values: [] }
    for (let i = 0; i < cards.length - 4; i += 1) {
        for (let j = i + 1; j < cards.length - 3; j += 1) {
            for (let k = j + 1; k < cards.length - 2; k += 1) {
                for (let l = k + 1; l < cards.length - 1; l += 1) {
                    for (let m = l + 1; m < cards.length; m += 1) {
                        const rank = handRankFive([
                            cards[i],
                            cards[j],
                            cards[k],
                            cards[l],
                            cards[m],
                        ])
                        if (compareHandRank(rank, best) > 0) {
                            best = rank
                        }
                    }
                }
            }
        }
    }
    return best
}

const maxHoleValue = (holeCards: string[]) => {
    if (holeCards.length === 0) return null
    return Math.max(...holeCards.map((card) => parseCard(card).value))
}

const formatNumber = (value: number | null) => {
    if (value === null) return ""
    if (value === 14) return "A"
    if (value === 13) return "K"
    if (value === 12) return "Q"
    if (value === 11) return "J"
    if (value === 10) return "T"
    return String(value)
}

export const getHandLabel = (holeCards: string[], board: string[]) => {
    const cards = [...holeCards, ...board]
    if (cards.length < 5) return null
    const best = bestHandRank(cards)
    if (best.rank === 8) {
        return best.values[0] === 14 ? "ロイヤルフラッシュ" : "ストレートフラッシュ"
    }
    if (best.rank === 7) {
        return `${formatNumber(best.values[0])}のフォーカード`
    }
    if (best.rank === 6) {
        return "フルハウス"
    }
    if (best.rank === 5) {
        return "フラッシュ"
    }
    if (best.rank === 4) {
        return "ストレート"
    }
    if (best.rank === 3) {
        return `${formatNumber(best.values[0])}のスリーカード`
    }
    if (best.rank === 2) {
        return `${formatNumber(best.values[0])}のツーペア`
    }
    if (best.rank === 1) {
        return `${formatNumber(best.values[0])}のワンペア`
    }
    const high = maxHoleValue(holeCards)
    return `${formatNumber(high)}ハイ`
}
