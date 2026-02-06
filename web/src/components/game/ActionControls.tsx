"use client"

import { ActionPayload, ActionType, TableState } from "@/lib/game/types"
import { useMemo, useState } from "react"

interface ActionControlsProps {
    table: TableState | null
    playerId: string
    onAction: (payload: ActionPayload) => void
    onReady: () => void
    onLeave: () => void
    onReset: () => void
}

const actionButtons: { label: string; action: ActionType }[] = [
    { label: "Fold", action: "fold" },
    { label: "Check", action: "check" },
    { label: "Call", action: "call" },
    { label: "Bet", action: "bet" },
    { label: "Raise", action: "raise" },
    { label: "All-In", action: "all-in" },
]

function getButtonLabel(
    action: ActionType,
    label: string,
    opts: {
        isTurn: boolean
        toCall: number
        betSize: number
        canCall: boolean
        canBet: boolean
        canRaise: boolean
        canAllIn: boolean
    }
): string {
    if (!opts.isTurn) return label
    if (action === "call" && opts.canCall) return `Call ${opts.toCall}`
    if (action === "bet" && opts.canBet) return `Bet ${opts.betSize}`
    if (action === "raise" && opts.canRaise) return `Raise to ${opts.betSize}`
    if (action === "all-in" && opts.canAllIn) return `All-in ${opts.betSize}`
    return label
}

export function ActionControls({
    table,
    playerId,
    onAction,
    onReady,
    onLeave,
    onReset,

}: ActionControlsProps) {
    const [betSizeInput, setBetSizeInput] = useState("3")
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
    const canAllIn = Boolean(canBet || canRaise)
    const rawMin = table
        ? table.current_bet === 0
            ? table.big_blind
            : table.current_bet + table.min_raise
        : 3
    const sliderMax = table && seat ? seat.stack + seat.street_commit : 60
    const sliderMin = Math.min(rawMin, sliderMax)

    const isBetSizeValid = useMemo(() => {
        const num = Number(betSizeInput)
        return betSizeInput !== "" && !Number.isNaN(num)
    }, [betSizeInput])

    const effectiveBetSize = useMemo(() => {
        const num = Number(betSizeInput)
        if (betSizeInput === "" || Number.isNaN(num)) return sliderMin
        return Math.min(Math.max(num, 0), sliderMax)
    }, [betSizeInput, sliderMin, sliderMax])

    const clampAndSetBetSize = () => {
        const clamped = Math.min(Math.max(sliderMin, 0), sliderMax)
        const num = Number(betSizeInput)
        const value = isBetSizeValid ? Math.min(Math.max(num, sliderMin), sliderMax) : clamped
        setBetSizeInput(String(value))
        return value
    }

    const handleAmountAction = (action: ActionType) => {
        const clampedAmount = clampAndSetBetSize()
        const amount = action === "all-in" ? undefined : clampedAmount
        onAction({
            player_id: playerId,
            action,
            amount,
        })
    }

    return (
        <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white">
            <div className="mb-2 text-xs uppercase tracking-widest text-white/60">
                Actions
            </div>
            <div className="grid grid-cols-2 gap-2">
                {actionButtons.map((button) => {
                    const isAmountAction =
                        button.action === "bet" || button.action === "raise" || button.action === "all-in"
                    const disabledByAmount = isAmountAction && !isBetSizeValid
                    return (
                        <button
                            key={button.action}
                            type="button"
                            className="rounded bg-emerald-500/80 px-3 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-white/20"
                            onClick={() =>
                                isAmountAction
                                    ? handleAmountAction(button.action)
                                    : onAction({
                                        player_id: playerId,
                                        action: button.action,
                                        amount: undefined,
                                    })
                            }
                            disabled={
                                !table ||
                                !playerId ||
                                !isTurn ||
                                disabledByAmount ||
                                (button.action === "check" && !canCheck) ||
                                (button.action === "call" && !canCall) ||
                                (button.action === "bet" && !canBet) ||
                                (button.action === "raise" && !canRaise) ||
                                (button.action === "all-in" && !canAllIn)
                            }
                        >
                            {getButtonLabel(button.action, button.label, {
                                isTurn,
                                toCall,
                                betSize: button.action === "all-in" ? (seat?.stack ?? 0) + (seat?.street_commit ?? 0) : effectiveBetSize,
                                canCall,
                                canBet,
                                canRaise,
                                canAllIn,
                            })}
                        </button>
                    )
                })}
            </div>
            <div className="mt-4">
                <label className="text-xs text-white/60">
                    {table?.current_bet === 0 ? "Bet" : "Raise To"}: {effectiveBetSize}
                </label>
                <input
                    type="number"
                    min={sliderMin}
                    max={sliderMax}
                    value={betSizeInput}
                    onChange={(event) => setBetSizeInput(event.target.value)}
                    className="mt-2 w-full rounded border border-white/20 bg-black/30 px-3 py-2 text-sm text-white"
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
            <button
                type="button"
                className="mt-4 w-full rounded bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
                onClick={onReset}
                disabled={!table}
            >
                Reset
            </button>
            {table?.street === "waiting" && (
                <p className="mt-2 text-[10px] text-white/50">
                    Need 2 players. When both are ready, the hand will start.
                </p>
            )}
            {!isTurn && (
                <p className="mt-2 text-[10px] text-white/50">
                    Waiting for your turn.
                </p>
            )}
            <button
                type="button"
                className="mt-4 w-full rounded bg-red-600 px-3 py-2 text-sm font-semibold hover:bg-red-500"
                onClick={onLeave}
                disabled={!table}
            >
                Leave Table
            </button>
        </div>
    )
}

