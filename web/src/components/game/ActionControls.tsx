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

function getActionButtonClass(action: ActionType) {
    if (action === "fold") {
        return "bg-sky-500/80 hover:bg-sky-500"
    }
    if (action === "check" || action === "call") {
        return "bg-emerald-500/80 hover:bg-emerald-500"
    }
    return "bg-red-500/80 hover:bg-red-500"
}

function getCheckCallButton(opts: {
    canCheck: boolean
    canCall: boolean
    toCall: number
}): { label: string; action: ActionType } | null {
    if (opts.canCheck) return { label: "Check", action: "check" }
    if (opts.canCall) return { label: `Call ${opts.toCall}`, action: "call" }
    return null
}

function getBetRaiseAllInButton(opts: {
    canBet: boolean
    canRaise: boolean
    canAllIn: boolean
    betSize: number
    allInSize: number
}): { label: string; action: ActionType } | null {
    if (!opts.canAllIn) return null
    if (opts.betSize >= opts.allInSize)
        return { label: `All-in ${opts.allInSize}`, action: "all-in" }
    if (opts.canBet) return { label: `Bet ${opts.betSize}`, action: "bet" }
    if (opts.canRaise) return { label: `Raise ${opts.betSize}`, action: "raise" }
    return { label: `All-in ${opts.allInSize}`, action: "all-in" }
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
                <button
                    type="button"
                    className={`rounded px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/20 ${getActionButtonClass("fold")}`}
                    onClick={() =>
                        onAction({
                            player_id: playerId,
                            action: "fold",
                            amount: undefined,
                        })
                    }
                    disabled={!table || !playerId || !isTurn}
                >
                    Fold
                </button>
                {isTurn && getCheckCallButton({ canCheck, canCall, toCall }) && (
                    <button
                        type="button"
                        className={`rounded px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/20 ${getActionButtonClass("check")}`}
                        onClick={() => {
                            const btn = getCheckCallButton({ canCheck, canCall, toCall })
                            if (btn)
                                onAction({
                                    player_id: playerId,
                                    action: btn.action,
                                    amount: undefined,
                                })
                        }}
                        disabled={!table || !playerId || !isTurn}
                    >
                        {getCheckCallButton({ canCheck, canCall, toCall })?.label}
                    </button>
                )}
                {isTurn && getBetRaiseAllInButton({
                    canBet,
                    canRaise,
                    canAllIn,
                    betSize: effectiveBetSize,
                    allInSize: (seat?.stack ?? 0) + (seat?.street_commit ?? 0),
                }) && (
                    <button
                        type="button"
                        className={`rounded px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/20 ${getActionButtonClass("bet")}`}
                        onClick={() => {
                            const btn = getBetRaiseAllInButton({
                                canBet,
                                canRaise,
                                canAllIn,
                                betSize: effectiveBetSize,
                                allInSize: (seat?.stack ?? 0) + (seat?.street_commit ?? 0),
                            })
                            if (btn) handleAmountAction(btn.action)
                        }}
                        disabled={
                            !table ||
                            !playerId ||
                            !isTurn ||
                            !isBetSizeValid
                        }
                    >
                        {getBetRaiseAllInButton({
                            canBet,
                            canRaise,
                            canAllIn,
                            betSize: effectiveBetSize,
                            allInSize: (seat?.stack ?? 0) + (seat?.street_commit ?? 0),
                        })?.label}
                    </button>
                )}
            </div>
            <div className="mt-4">
                <label className="text-xs text-white/60">
                    {table?.current_bet === 0 ? "Bet" : "Raise"}: {effectiveBetSize}
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

