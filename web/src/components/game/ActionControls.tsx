"use client"

import { ActionPayload, ActionType, TableState } from "@/lib/game/types"
import { useEffect, useMemo, useRef, useState } from "react"

interface ActionControlsProps {
    table: TableState | null
    playerId: string
    onAction: (payload: ActionPayload) => void
    className?: string
    forceAllFold?: boolean
    interactionEnabled?: boolean
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
    callAmount: number
}): { label: string; action: ActionType } | null {
    if (opts.canCheck) return { label: "Check", action: "check" }
    if (opts.canCall) return { label: `Call ${opts.callAmount}`, action: "call" }
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
    forceAllFold = false,
    interactionEnabled = true,
}: ActionControlsProps) {
    const [betSize, setBetSize] = useState(3)
    const [amountOverlayOpen, setAmountOverlayOpen] = useState(false)
    const [allFoldEnabled, setAllFoldEnabled] = useState(false)
    const [allFoldCheckedThisStreet, setAllFoldCheckedThisStreet] = useState(false)
    const forcedByTimerRef = useRef(false)
    const lastAutoActionRef = useRef<string | null>(null)
    const prevStreetRef = useRef<TableState["street"] | null>(table?.street ?? null)
    const isTurn = useMemo(() => {
        if (!table) return false
        const seat = table.seats.find((item) => item.player_id === playerId)
        if (!seat || table.current_turn_seat === null || table.current_turn_seat === undefined)
            return false
        return seat.seat_index === table.current_turn_seat
    }, [table, playerId])
    const isTurnReady = isTurn && interactionEnabled
    const seat = useMemo(() => {
        if (!table) return null
        return table.seats.find((item) => item.player_id === playerId) ?? null
    }, [table, playerId])
    const toCall = useMemo(() => {
        if (!table || !seat) return 0
        return Math.max(0, table.current_bet - seat.street_commit)
    }, [table, seat])
    const canCheck = Boolean(table && seat && toCall === 0)
    const callAmount = Math.max(0, Math.min(toCall, seat?.stack ?? 0))
    const canCall = Boolean(table && seat && toCall > 0 && callAmount > 0)
    const hasNonAllInOpponent = Boolean(
        table &&
        seat &&
        table.seats.some(
            (other) =>
                other.player_id &&
                other.seat_index !== seat.seat_index &&
                !other.is_folded &&
                !other.is_all_in
        )
    )
    const canBet = Boolean(table && seat && table.current_bet === 0)
    const canRaise = Boolean(
        table &&
        seat &&
        table.current_bet > 0 &&
        !seat.raise_blocked &&
        seat.stack + seat.street_commit > table.current_bet &&
        hasNonAllInOpponent
    )
    const canAllIn = Boolean(canBet || canRaise)
    const rawMin = table
        ? table.current_bet === 0
            ? table.big_blind
            : table.current_bet + table.min_raise
        : 3
    const sliderMax = table && seat ? seat.stack + seat.street_commit : 60
    const sliderMin = Math.min(rawMin, sliderMax)
    const foldBlocked = Boolean(isTurn && table && toCall === 0)
    const showAllFoldToggle = Boolean(
        table &&
        seat &&
        !seat.is_folded &&
        !isTurn &&
        table.current_turn_seat !== null &&
        ["preflop", "flop", "turn", "river"].includes(table.street) &&
        interactionEnabled
    )

    const effectiveBetSize = useMemo(
        () => clamp(betSize, sliderMin, sliderMax),
        [betSize, sliderMin, sliderMax]
    )

    useEffect(() => {
        setBetSize(sliderMin)
    }, [sliderMin])

    const adjustBet = (delta: number) => {
        setBetSize((prev) => clamp(prev + delta, sliderMin, sliderMax))
    }

    const setBetTo = (value: number) => {
        setBetSize(clamp(Math.round(value), sliderMin, sliderMax))
    }

    const handleAmountAction = (action: ActionType) => {
        const amount = action === "all-in" ? undefined : effectiveBetSize
        setAmountOverlayOpen(false)
        onAction({
            player_id: playerId,
            action,
            amount,
        })
    }

    const betRaiseButton = isTurnReady && getBetRaiseAllInButton({
        canBet,
        canRaise,
        canAllIn,
        betSize: effectiveBetSize,
        allInSize: (seat?.stack ?? 0) + (seat?.street_commit ?? 0),
    })

    const checkCallBtn = isTurnReady
        ? getCheckCallButton({ canCheck, canCall, toCall, callAmount })
        : null

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
        if (forceAllFold) {
            forcedByTimerRef.current = true
            setAllFoldEnabled(true)
            return
        }
        if (forcedByTimerRef.current) {
            setAllFoldEnabled(false)
            forcedByTimerRef.current = false
        }
    }, [forceAllFold])

    useEffect(() => {
        if (!allFoldEnabled || !isTurnReady || !table) return
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

    useEffect(() => {
        if (!isTurnReady) {
            setAmountOverlayOpen(false)
        }
    }, [isTurnReady])

    return (
        <div className={`rounded-2xl border border-white/20 bg-white/10 px-3 pt-2.5 pb-1.5 text-white flex flex-col gap-1.5 ${className}`}>
            <div
                className={`flex items-center gap-1.5 overflow-x-auto whitespace-nowrap rounded-md bg-white/10 px-1.5 h-[2.5rem] ${isTurnReady && (canBet || canRaise)
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
            <div className="flex gap-3 items-stretch min-h-[7.5rem]">
                {/* 左: Bet/Raise+矢印, Check/Call, Fold（枠いっぱい幅） */}
                <div className="grid grid-rows-3 gap-1.5 flex-1 min-w-0 min-h-0">
                    {/* Raise と矢印上ボタン（△の上にスライダーパネルが出現）・Call/Foldと同じ行高さ */}
                    {betRaiseButton ? (
                        <div className="relative flex gap-1.5 h-full min-h-0">
                            <button
                                type="button"
                                className={`rounded px-2.5 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/20 whitespace-nowrap flex-1 min-w-0 text-center h-full flex items-center justify-center ${getActionButtonClass("bet")}`}
                                onClick={() => handleAmountAction(betRaiseButton.action)}
                                disabled={!table || !playerId || !isTurn}
                            >
                                {betRaiseButton.label}
                            </button>
                            <button
                                type="button"
                                className="rounded px-2 py-1.5 text-sm font-semibold bg-white/20 hover:bg-white/30 shrink-0 h-full flex items-center justify-center disabled:opacity-50 disabled:pointer-events-none w-10"
                                onClick={() => setAmountOverlayOpen((v) => !v)}
                                disabled={!table || sliderMin >= sliderMax}
                                aria-label="ベット額を調整"
                                aria-expanded={amountOverlayOpen}
                            >
                                <span className="text-lg leading-none" aria-hidden>▲</span>
                            </button>
                            {/* 三角形の直上にスライダー＋±ボタンを表示 */}
                            {amountOverlayOpen && (
                                <div
                                    className="absolute right-0 bottom-full mb-1 z-50 rounded-xl border border-white/20 bg-slate-900 px-4 py-4 shadow-xl flex gap-4 items-stretch"
                                    role="dialog"
                                    aria-label="ベット額を調整"
                                >
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
                                                className="w-12 h-10 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-semibold disabled:opacity-50 disabled:pointer-events-none"
                                                onClick={() => adjustBet(delta)}
                                                disabled={!table || sliderMin >= sliderMax}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-1">
                                        <div className="h-40 w-6 flex items-center justify-center shrink-0">
                                            <input
                                                type="range"
                                                min={sliderMin}
                                                max={sliderMax}
                                                value={effectiveBetSize}
                                                onChange={(e) => setBetSize(Number(e.target.value))}
                                                className="vertical-slider w-40 h-6 appearance-none bg-transparent cursor-pointer disabled:opacity-50"
                                                style={{
                                                    transform: "rotate(-90deg)",
                                                    transformOrigin: "center center",
                                                }}
                                                disabled={!table || sliderMin >= sliderMax}
                                            />
                                        </div>
                                        <span className="text-sm font-semibold text-white tabular-nums">
                                            {effectiveBetSize}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex gap-1.5 h-full min-h-0">
                            <div className="rounded px-2.5 py-1.5 text-sm font-semibold bg-white/10 text-white/50 cursor-not-allowed whitespace-nowrap flex-1 min-w-0 text-center h-full flex items-center justify-center">
                                —
                            </div>
                            <div className="rounded px-2 py-1.5 shrink-0 w-10 h-full flex items-center justify-center bg-white/5 border border-white/10" aria-hidden>
                                <span className="text-white/30 text-lg leading-none">▲</span>
                            </div>
                        </div>
                    )}
                    {checkCallBtn ? (
                        <button
                            type="button"
                            className="rounded px-2.5 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/20 bg-emerald-500/80 hover:bg-emerald-500 whitespace-nowrap w-full text-center h-full min-h-0 flex items-center justify-center"
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
                        <div className="rounded px-2.5 py-1.5 text-sm font-semibold bg-white/10 text-white/50 cursor-not-allowed whitespace-nowrap w-full text-center h-full min-h-0 flex items-center justify-center">
                            —
                        </div>
                    )}
                    {isTurnReady ? (
                        <button
                            type="button"
                            className={`rounded px-2.5 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/20 whitespace-nowrap w-full text-center h-full min-h-0 flex items-center justify-center ${foldBlocked
                                ? "bg-sky-300/50 text-white/70"
                                : "bg-sky-500/80 hover:bg-sky-500"
                                }`}
                            onClick={() => {
                                if (foldBlocked) return
                                onAction({
                                    player_id: playerId,
                                    action: "fold",
                                    amount: undefined,
                                })
                            }}
                            disabled={!table || !playerId || foldBlocked || forceAllFold}
                        >
                            Fold
                        </button>
                    ) : showAllFoldToggle ? (
                        <button
                            type="button"
                            className={`rounded px-2.5 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/20 whitespace-nowrap w-full text-center h-full min-h-0 flex items-center justify-center ${allFoldEnabled
                                ? "bg-sky-300/60 text-white/90 hover:bg-sky-300/70"
                                : "bg-sky-300/30 text-white/80 hover:bg-sky-300/40"
                                }`}
                            onClick={() => {
                                if (forceAllFold) return
                                setAllFoldEnabled((prev) => !prev)
                            }}
                            disabled={!table || !playerId || forceAllFold}
                        >
                            {allFoldEnabled ? "All Fold ON" : "All Fold OFF"}
                        </button>
                    ) : (
                        <div className="rounded px-2.5 py-1.5 text-sm font-semibold bg-white/10 text-white/50 cursor-not-allowed whitespace-nowrap w-full text-center h-full min-h-0 flex items-center justify-center">
                            —
                        </div>
                    )}
                </div>
            </div>
            {table?.street === "waiting" && (
                <p className="text-[10px] text-white/50">
                    2人以上参加で中央のボタンから開始できます。
                </p>
            )}
        </div>
    )
}

