"use client"

import { ActionPayload, ActionType, TableState } from "@/lib/game/types"
import { useEffect, useMemo, useRef, useState } from "react"

interface ActionControlsProps {
    table: TableState | null
    playerId: string
    onAction: (payload: ActionPayload) => void
    className?: string
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

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max)
}

export function ActionControls({
    table,
    playerId,
    onAction,
    className = "",
}: ActionControlsProps) {
    const [betSize, setBetSize] = useState(3)
    const [allFoldEnabled, setAllFoldEnabled] = useState(false)
    const [allFoldCheckedThisStreet, setAllFoldCheckedThisStreet] = useState(false)
    const lastAutoActionRef = useRef<string | null>(null)
    const prevStreetRef = useRef<TableState["street"] | null>(table?.street ?? null)
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

    const effectiveBetSize = useMemo(
        () => clamp(betSize, sliderMin, sliderMax),
        [betSize, sliderMin, sliderMax]
    )

    useEffect(() => {
        setBetSize((prev) => clamp(prev, sliderMin, sliderMax))
    }, [sliderMin, sliderMax])

    const adjustBet = (delta: number) => {
        setBetSize((prev) => clamp(prev + delta, sliderMin, sliderMax))
    }

    const setBetTo = (value: number) => {
        setBetSize(clamp(Math.round(value), sliderMin, sliderMax))
    }

    const handleAmountAction = (action: ActionType) => {
        const amount = action === "all-in" ? undefined : effectiveBetSize
        onAction({
            player_id: playerId,
            action,
            amount,
        })
    }

    const betRaiseButton = isTurn && getBetRaiseAllInButton({
        canBet,
        canRaise,
        canAllIn,
        betSize: effectiveBetSize,
        allInSize: (seat?.stack ?? 0) + (seat?.street_commit ?? 0),
    })

    const checkCallBtn = isTurn ? getCheckCallButton({ canCheck, canCall, toCall }) : null

    const betQuickPercents = [10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 250, 300]
    const raiseQuickMultipliers = [2, 2.5, 3, 3.5, 4, 5]

    useEffect(() => {
        const currentStreet = table?.street ?? null
        if (
            currentStreet &&
            prevStreetRef.current &&
            currentStreet !== prevStreetRef.current &&
            allFoldCheckedThisStreet
        ) {
            setAllFoldEnabled(false)
            setAllFoldCheckedThisStreet(false)
        }
        prevStreetRef.current = currentStreet
    }, [table?.street, allFoldCheckedThisStreet])

    useEffect(() => {
        if (!allFoldEnabled || !isTurn || !table) return
        const key = `${table.hand_number}-${table.street}-${toCall}-${table.current_bet}`
        if (lastAutoActionRef.current === key) return
        if (toCall === 0) {
            onAction({ player_id: playerId, action: "check", amount: undefined })
            setAllFoldCheckedThisStreet(true)
        } else {
            onAction({ player_id: playerId, action: "fold", amount: undefined })
        }
        lastAutoActionRef.current = key
    }, [allFoldEnabled, isTurn, table, toCall, playerId, onAction])

    return (
        <div className={`rounded-2xl border border-white/20 bg-white/10 px-4 pt-4 pb-2 text-white flex flex-col gap-2 ${className}`}>
            <div
                className={`flex items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md bg-white/10 px-2 h-[3.33rem] ${isTurn && (canBet || canRaise)
                    ? ""
                    : "invisible pointer-events-none"
                    }`}
            >
                {(canBet
                    ? betQuickPercents.map((percent) => ({
                        key: `${percent}`,
                        label: `${percent}%`,
                        onClick: () =>
                            setBetTo((table?.pot ?? 0) * (percent / 100)),
                    }))
                    : raiseQuickMultipliers.map((mult) => ({
                        key: `${mult}`,
                        label: `×${mult}`,
                        onClick: () =>
                            setBetTo((table?.current_bet ?? sliderMin) * mult),
                    }))
                ).map(({ key, label, onClick }) => (
                    <button
                        key={key}
                        type="button"
                        className="h-full min-w-[4rem] rounded bg-white/15 px-2 text-xs font-semibold text-white/80 hover:bg-white/25"
                        onClick={onClick}
                    >
                        {label}
                    </button>
                ))}
                <button
                    type="button"
                    className="h-full min-w-[4rem] rounded bg-white/15 px-2 text-xs font-semibold text-white/80 hover:bg-white/25"
                    onClick={() => setBetTo(sliderMax)}
                >
                    all-in
                </button>
            </div>
            <div className="flex gap-5 items-stretch min-h-[11rem]">
                {/* 左: Bet/Raise, Check/Call, Fold（幅固定・縦は枠いっぱい） */}
                <div className="flex flex-col gap-2 shrink-0 w-[8.25rem] min-w-[8.25rem] min-h-0">
                    {betRaiseButton ? (
                        <button
                            type="button"
                            className={`rounded px-3 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:bg-white/20 whitespace-nowrap w-full text-center flex-1 min-h-0 flex items-center justify-center ${getActionButtonClass("bet")}`}
                            onClick={() => handleAmountAction(betRaiseButton.action)}
                            disabled={!table || !playerId || !isTurn}
                        >
                            {betRaiseButton.label}
                        </button>
                    ) : (
                        <div className="rounded px-3 py-2 text-base font-semibold bg-white/10 text-white/50 cursor-not-allowed whitespace-nowrap w-full text-center flex-1 min-h-0 flex items-center justify-center">
                            —
                        </div>
                    )}
                    {checkCallBtn ? (
                        <button
                            type="button"
                            className="rounded px-3 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:bg-white/20 bg-emerald-500/80 hover:bg-emerald-500 whitespace-nowrap w-full text-center flex-1 min-h-0 flex items-center justify-center"
                            onClick={() => {
                                if (checkCallBtn)
                                    onAction({
                                        player_id: playerId,
                                        action: checkCallBtn.action,
                                        amount: undefined,
                                    })
                            }}
                            disabled={!table || !playerId || !isTurn}
                        >
                            {checkCallBtn.label}
                        </button>
                    ) : (
                        <div className="rounded px-3 py-2 text-base font-semibold bg-white/10 text-white/50 cursor-not-allowed whitespace-nowrap w-full text-center flex-1 min-h-0 flex items-center justify-center">
                            —
                        </div>
                    )}
                    <button
                        type="button"
                        className={`rounded px-3 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:bg-white/20 whitespace-nowrap w-full text-center flex-1 min-h-0 flex items-center justify-center ${!isTurn && allFoldEnabled
                            ? "bg-sky-300/60 hover:bg-sky-300/70"
                            : "bg-sky-500/80 hover:bg-sky-500"
                            }`}
                        onClick={() => {
                            if (isTurn) {
                                onAction({
                                    player_id: playerId,
                                    action: "fold",
                                    amount: undefined,
                                })
                                return
                            }
                            setAllFoldEnabled((prev) => !prev)
                        }}
                        disabled={!table || !playerId}
                    >
                        {isTurn
                            ? "Fold"
                            : allFoldEnabled
                                ? "All Fold ON"
                                : "All Fold OFF"}
                    </button>
                </div>
                {/* 自分のターン時のみ: 微調整ボタンとベットサイズバー */}
                {isTurn && (
                    <div className="flex-1 min-w-0 flex gap-2 items-stretch justify-end ml-2">
                        <div className="flex flex-col gap-2 shrink-0 justify-center">
                            {[
                                { label: "+5", delta: 5 },
                                { label: "+1", delta: 1 },
                                { label: "-1", delta: -1 },
                                { label: "-5", delta: -5 },
                            ].map(({ label, delta }) => (
                                <button
                                    key={label}
                                    type="button"
                                    className="w-7 h-6 rounded bg-white/20 hover:bg-white/30 text-xs font-medium disabled:opacity-50 disabled:pointer-events-none"
                                    onClick={() => adjustBet(delta)}
                                    disabled={!table || sliderMin >= sliderMax}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="w-8 shrink-0 flex items-center justify-center self-stretch min-h-0 overflow-visible">
                            <input
                                type="range"
                                min={sliderMin}
                                max={sliderMax}
                                value={effectiveBetSize}
                                onChange={(e) => setBetSize(Number(e.target.value))}
                                className="vertical-slider w-[11rem] h-5 appearance-none bg-transparent cursor-pointer disabled:opacity-50"
                                style={{
                                    transform: "rotate(-90deg)",
                                    transformOrigin: "center center",
                                }}
                                disabled={!table || sliderMin >= sliderMax}
                            />
                        </div>
                    </div>
                )}
            </div>
            {table?.street === "waiting" && (
                <p className="text-[10px] text-white/50">
                    2人以上参加で自動的にハンドが始まります。
                </p>
            )}
        </div>
    )
}

