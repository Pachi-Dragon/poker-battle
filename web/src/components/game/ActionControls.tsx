"use client"

import { useEffect, useMemo, useState } from "react"
import { ActionPayload, ActionType, TableState } from "@/lib/game/types"

interface ActionControlsProps {
    table: TableState | null
    playerId: string
    onAction: (payload: ActionPayload) => void
    onReady: () => void
}

const actionButtons: { label: string; action: ActionType }[] = [
    { label: "Fold", action: "fold" },
    { label: "Check", action: "check" },
    { label: "Call", action: "call" },
    { label: "Bet", action: "bet" },
    { label: "Raise", action: "raise" },
]

export function ActionControls({
    table,
    playerId,
    onAction,
    onReady,
}: ActionControlsProps) {
    const [betSize, setBetSize] = useState(3)
    const isTurn = useMemo(() => {
        if (!table) return false
        const seat = table.seats.find((item) => item.player_id === playerId)
        if (!seat || table.current_turn_seat === null || table.current_turn_seat === undefined)
            return false
        return seat.seat_index === table.current_turn_seat
    }, [table, playerId])
    const seat = useMemo(() => {
        if (!table) return null
        return table.seats.find((item) => item.player_id === playerId) ?? null
    }, [table, playerId])
    const toCall = useMemo(() => {
        if (!table || !seat) return 0
        return Math.max(0, table.current_bet - seat.street_commit)
    }, [table, seat])
    const canCheck = Boolean(table && seat && toCall === 0)
    const canCall = Boolean(table && seat && toCall > 0)
    const canBet = Boolean(table && seat && table.current_bet === 0)
    const canRaise = Boolean(
        table &&
            seat &&
            table.current_bet > 0 &&
            !seat.raise_blocked &&
            seat.stack + seat.street_commit > table.current_bet
    )
    const rawMin = table
        ? table.current_bet === 0
            ? table.big_blind
            : table.current_bet + table.min_raise
        : 3
    const sliderMax = table && seat ? seat.stack + seat.street_commit : 60
    const sliderMin = Math.min(rawMin, sliderMax)

    useEffect(() => {
        if (!table || !seat) return
        const nextValue = Math.min(Math.max(betSize, sliderMin), sliderMax)
        if (nextValue !== betSize) {
            setBetSize(nextValue)
        }
    }, [table, seat, sliderMin, sliderMax, betSize])

    return (
        <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white">
            <div className="mb-2 text-xs uppercase tracking-widest text-white/60">
                Actions
            </div>
            <div className="grid grid-cols-2 gap-2">
                {actionButtons.map((button) => (
                    <button
                        key={button.action}
                        type="button"
                        className="rounded bg-emerald-500/80 px-3 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-white/20"
                        onClick={() =>
                            onAction({
                                player_id: playerId,
                                action: button.action,
                                amount:
                                    button.action === "bet" || button.action === "raise"
                                        ? betSize
                                        : undefined,
                            })
                        }
                        disabled={
                            !table ||
                            !playerId ||
                            !isTurn ||
                            (button.action === "check" && !canCheck) ||
                            (button.action === "call" && !canCall) ||
                            (button.action === "bet" && !canBet) ||
                            (button.action === "raise" && !canRaise)
                        }
                    >
                        {button.action === "call" && canCall
                            ? `Call ${toCall}`
                            : button.label}
                    </button>
                ))}
            </div>
            <div className="mt-4">
                <label className="text-xs text-white/60">
                    {table?.current_bet === 0 ? "Bet" : "Raise To"}: {betSize}
                </label>
                <input
                    type="range"
                    min={sliderMin}
                    max={sliderMax}
                    value={betSize}
                    onChange={(event) => setBetSize(Number(event.target.value))}
                    className="mt-2 w-full"
                />
                {table && (
                    <div className="mt-2 text-[10px] text-white/50">
                        Current Bet: {table.current_bet} ・ Min Raise: {table.min_raise}
                    </div>
                )}
            </div>
            <button
                type="button"
                className="mt-4 w-full rounded bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
                onClick={onReady}
                disabled={!table}
            >
                Ready / Start Hand
            </button>
            {!isTurn && (
                <p className="mt-2 text-[10px] text-white/50">
                    Waiting for your turn.
                </p>
            )}
        </div>
    )
}

