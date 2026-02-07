"use client"

import {
    ActionPayload,
    GameMessage,
    JoinTablePayload,
    ReserveSeatPayload,
    TableState,
} from "@/lib/game/types"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { ActionControls } from "./ActionControls"
import { ActionHistory } from "./ActionHistory"
import { BoardPot } from "./BoardPot"
import { SeatCard } from "./SeatCard"

interface GameClientProps {
    player: JoinTablePayload
    /** HOME画面に埋め込まれている場合（タイトルはHOME側で表示） */
    embeddedInHome?: boolean
    /** テーブルを抜けてHOMEの名前入力に戻る（embeddedInHome 時のみ使用） */
    onBackToHome?: () => void
}

export function GameClient({
    player,
    embeddedInHome,
    onBackToHome,
}: GameClientProps) {
    const router = useRouter()
    const [tableState, setTableState] = useState<TableState | null>(null)
    const tableStateRef = useRef<TableState | null>(null)
    const transitionTimeoutRef = useRef<number | null>(null)
    const revealTimeoutRef = useRef<number | null>(null)
    const pendingStateRef = useRef<TableState | null>(null)
    const isAnimatingRef = useRef(false)
    const chipRevealDelayMs = 300
    const chipAnimationMs = 650
    const socketRef = useRef<WebSocket | null>(null)
    const actionControlsRef = useRef<HTMLDivElement | null>(null)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
    const [actionControlsHeight, setActionControlsHeight] = useState<number | null>(
        null
    )
    const timeLimitSeconds = 30
    const timeLimitMs = timeLimitSeconds * 1000
    const [timeLimitEnabled, setTimeLimitEnabled] = useState(false)
    const [timeLeftMs, setTimeLeftMs] = useState(timeLimitMs)
    const [forceAllFold, setForceAllFold] = useState(false)
    const timerRef = useRef<number | null>(null)
    const isHandInProgress = Boolean(
        tableState &&
            ["preflop", "flop", "turn", "river", "showdown"].includes(tableState.street)
    )

    useEffect(() => {
        const stored = window.localStorage.getItem("pokerTimeLimitEnabled")
        if (stored !== null) {
            setTimeLimitEnabled(stored === "1")
        }
    }, [])

    useEffect(() => {
        window.localStorage.setItem("pokerTimeLimitEnabled", timeLimitEnabled ? "1" : "0")
    }, [timeLimitEnabled])

    useEffect(() => {
        const wsUrl = apiUrl.replace(/^http/, "ws") + "/ws/game"
        const socket = new WebSocket(wsUrl)
        socketRef.current = socket

        socket.addEventListener("open", () => {
            const message: GameMessage<JoinTablePayload> = {
                type: "joinTable",
                payload: player,
            }
            socket.send(JSON.stringify(message))
        })

        socket.addEventListener("message", (event) => {
            const message: GameMessage<TableState> = JSON.parse(event.data)
            if (message.type === "tableState" || message.type === "handState") {
                const nextState = message.payload ?? null
                if (!nextState) {
                    setTableState(null)
                    return
                }
                const prevState = tableStateRef.current
                if (!prevState) {
                    setTableState(nextState)
                    return
                }
                if (isAnimatingRef.current) {
                    pendingStateRef.current = nextState
                    return
                }
                const lastAction =
                    nextState.action_history[nextState.action_history.length - 1]
                        ?.action ?? ""
                const prevCommitTotal = prevState.seats.reduce(
                    (sum, seat) => sum + (seat.street_commit ?? 0),
                    0
                )
                const shouldAnimateToPot =
                    prevState.street !== nextState.street &&
                    prevCommitTotal > 0 &&
                    lastAction.toLowerCase() === "call"
                if (shouldAnimateToPot) {
                    const transitionState: TableState = {
                        ...prevState,
                        pot: nextState.pot,
                        current_bet: nextState.current_bet,
                        seats: prevState.seats.map((seat) => ({
                            ...seat,
                            street_commit: 0,
                        })),
                    }
                    isAnimatingRef.current = true
                    pendingStateRef.current = nextState
                    setTableState(prevState)
                    if (transitionTimeoutRef.current) {
                        window.clearTimeout(transitionTimeoutRef.current)
                    }
                    if (revealTimeoutRef.current) {
                        window.clearTimeout(revealTimeoutRef.current)
                    }
                    revealTimeoutRef.current = window.setTimeout(() => {
                        setTableState(transitionState)
                    }, chipRevealDelayMs)
                    transitionTimeoutRef.current = window.setTimeout(() => {
                        isAnimatingRef.current = false
                        const pending = pendingStateRef.current
                        pendingStateRef.current = null
                        setTableState(pending ?? nextState)
                    }, chipRevealDelayMs + chipAnimationMs)
                    return
                }
                setTableState(nextState)
            }
        })

        return () => {
            socket.close()
        }
    }, [apiUrl, player.player_id, player.name])

    useEffect(() => {
        tableStateRef.current = tableState
    }, [tableState])

    useEffect(() => {
        return () => {
            if (transitionTimeoutRef.current) {
                window.clearTimeout(transitionTimeoutRef.current)
            }
            if (revealTimeoutRef.current) {
                window.clearTimeout(revealTimeoutRef.current)
            }
        }
    }, [])

    useEffect(() => {
        const element = actionControlsRef.current
        if (!element) return
        const updateHeight = () => {
            setActionControlsHeight(element.getBoundingClientRect().height)
        }
        updateHeight()
        const observer = new ResizeObserver(() => updateHeight())
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    const heroSeat = useMemo(() => {
        if (!tableState) return null
        return tableState.seats.find((seat) => seat.player_id === player.player_id)
    }, [tableState, player.player_id])
    const isWaitingPlayer = Boolean(tableState && !heroSeat)
    const isHeroTurn = Boolean(
        tableState &&
            heroSeat &&
            tableState.current_turn_seat !== null &&
            tableState.current_turn_seat !== undefined &&
            tableState.current_turn_seat === heroSeat.seat_index
    )
    const canStartHand = Boolean(
        tableState &&
            tableState.street === "waiting" &&
            tableState.seats.filter((seat) => seat.player_id).length >= 2
    )

    useEffect(() => {
        if (timerRef.current) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
        }
        if (!timeLimitEnabled || !isHeroTurn) {
            setTimeLeftMs(timeLimitMs)
            setForceAllFold(false)
            return
        }
        const startedAt = Date.now()
        setTimeLeftMs(timeLimitMs)
        setForceAllFold(false)
        timerRef.current = window.setInterval(() => {
            const elapsed = Date.now() - startedAt
            const remaining = Math.max(0, timeLimitMs - elapsed)
            setTimeLeftMs(remaining)
            if (remaining <= 0) {
                setForceAllFold(true)
                if (timerRef.current) {
                    window.clearInterval(timerRef.current)
                    timerRef.current = null
                }
            }
        }, 200)
        return () => {
            if (timerRef.current) {
                window.clearInterval(timerRef.current)
                timerRef.current = null
            }
        }
    }, [
        timeLimitEnabled,
        isHeroTurn,
        timeLimitMs,
        tableState?.hand_number,
        tableState?.street,
        tableState?.current_turn_seat,
    ])

    const handleAction = (payload: ActionPayload) => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({ type: "action", payload }))
    }

    const handleLeave = () => {
        const socket = socketRef.current
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
                JSON.stringify({
                    type: "leaveTable",
                    payload: { player_id: player.player_id },
                })
            )
        }
        if (embeddedInHome && onBackToHome) {
            onBackToHome()
        } else {
            router.back()
        }
    }

    const handleReset = () => {
        const socket = socketRef.current
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "resetTable" }))
        }
    }

    const handleReserveSeat = (seatIndex: number) => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        const payload: ReserveSeatPayload = {
            player_id: player.player_id,
            name: player.name,
            seat_index: seatIndex,
        }
        socket.send(JSON.stringify({ type: "reserveSeat", payload }))
    }

    const handleStartHand = () => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({ type: "startHand" }))
    }

    const seatPositions = [
        "top-1 left-1/2 -translate-x-1/2",
        "top-[18%] right-2 -translate-y-1/2",
        "bottom-[18%] right-2 translate-y-1/2",
        "bottom-1 left-1/2 -translate-x-1/2",
        "bottom-[18%] left-2 translate-y-1/2",
        "top-[18%] left-2 -translate-y-1/2",
    ]

    const getSeatPosition = (seatIndex: number) => {
        const heroIndex = heroSeat?.seat_index ?? 0
        const posIndex = (seatIndex - heroIndex + 3 + 6) % 6
        return seatPositions[posIndex]
    }

    const chipVectors = [
        { x: "0rem", y: "6rem" },
        { x: "-6rem", y: "5rem" },
        { x: "-6rem", y: "-5rem" },
        { x: "0rem", y: "-6rem" },
        { x: "6rem", y: "-5rem" },
        { x: "6rem", y: "5rem" },
    ]
    const timeGaugePercent = timeLimitEnabled && isHeroTurn
        ? Math.max(0, Math.min(100, (timeLeftMs / timeLimitMs) * 100))
        : 100
    const timeLeftSeconds = Math.max(0, Math.ceil(timeLeftMs / 1000))

    return (
        <div
            className={
                embeddedInHome
                    ? "flex flex-1 min-h-0 flex-col text-white"
                    : "min-h-screen bg-emerald-950 text-white"
            }
        >
            <header className="flex flex-col gap-1 px-4 pb-3 pt-0 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        type="button"
                        className="rounded bg-red-800/70 px-2.5 py-1.5 text-xs font-semibold text-white/90 hover:bg-red-700/70 shrink-0"
                        onClick={handleLeave}
                        disabled={!tableState}
                    >
                        離席
                    </button>
                    <button
                        type="button"
                        className="rounded bg-slate-700/80 px-2.5 py-1.5 text-xs font-semibold text-white/90 hover:bg-slate-600/80 shrink-0"
                        onClick={handleReset}
                        disabled={!tableState}
                    >
                        リセット
                    </button>
                    <button
                        type="button"
                        className={`rounded px-2.5 py-1.5 text-xs font-semibold shrink-0 ${
                            timeLimitEnabled
                                ? "bg-amber-400/90 text-slate-900 hover:bg-amber-300"
                                : "bg-white/10 text-white/70 hover:bg-white/20"
                        }`}
                        onClick={() => {
                            setTimeLimitEnabled((prev) => !prev)
                            setForceAllFold(false)
                            setTimeLeftMs(timeLimitMs)
                        }}
                        disabled={!tableState || isHandInProgress}
                    >
                        時間制限 {timeLimitEnabled ? "あり" : "なし"}
                    </button>
                </div>
                <div className="flex items-center justify-between">
                    <div className="rounded-full bg-white/10 px-3 py-1.5 text-[10px] text-white/70 shrink-0 ml-2">
                        {tableState
                            ? `SB/BB ${tableState.small_blind}/${tableState.big_blind}`
                            : "Connecting..."}
                    </div>
                </div>
            </header>

            <main
                className={
                    embeddedInHome
                        ? "flex flex-1 min-h-0 flex-col px-4 pb-4 overflow-auto"
                        : "flex min-h-[calc(100vh-64px)] flex-col px-4 pb-4"
                }
            >
                <div className="relative mx-auto mt-2 w-full max-w-sm flex-1 sm:max-w-md">
                    <div className="absolute inset-6 rounded-[32%] border border-emerald-400/30 bg-emerald-900/50 shadow-[0_0_40px_rgba(16,185,129,0.25)]" />
                    <div className="relative mx-auto aspect-[4/5] w-full">
                        {tableState?.seats.map((seat) => {
                            const heroIndex = heroSeat?.seat_index ?? 0
                            const posIndex =
                                (seat.seat_index - heroIndex + 3 + 6) % 6
                            const isTopSeat =
                                posIndex === 0 || posIndex === 1 || posIndex === 5
                            const chipVector = chipVectors[posIndex]
                            return (
                            <div
                                key={seat.seat_index}
                                className={`absolute w-28 sm:w-32 ${getSeatPosition(seat.seat_index)}`}
                            >
                                <SeatCard
                                    seat={seat}
                                    isHero={heroSeat?.seat_index === seat.seat_index}
                                    isCurrentTurn={
                                        tableState?.current_turn_seat === seat.seat_index
                                    }
                                    isTopSeat={isTopSeat}
                                    chipToX={chipVector.x}
                                    chipToY={chipVector.y}
                                    canReserve={isWaitingPlayer && !seat.player_id}
                                    showHoleCards={
                                        heroSeat?.seat_index === seat.seat_index ||
                                        tableState?.street === "showdown" ||
                                        tableState?.street === "settlement"
                                    }
                                    showTimer={
                                        timeLimitEnabled &&
                                        isHeroTurn &&
                                        tableState?.current_turn_seat === seat.seat_index
                                    }
                                    timeGaugePercent={timeGaugePercent}
                                    timeLeftSeconds={timeLeftSeconds}
                                    onReserve={() => handleReserveSeat(seat.seat_index)}
                                />
                            </div>
                        )
                        }) ?? (
                                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/60">
                                    Loading seats...
                                </div>
                            )}
                        <div className="absolute left-1/2 top-[52%] w-[88%] max-w-[340px] -translate-x-1/2 -translate-y-1/2 min-w-[200px]">
                            {tableState && (
                                <BoardPot
                                    table={tableState}
                                    canStart={canStartHand}
                                    onStart={handleStartHand}
                                />
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-3 grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] gap-3 items-stretch">
                    <ActionHistory
                        actions={tableState?.action_history ?? []}
                        className="min-w-0 min-h-0"
                        maxHeight={actionControlsHeight}
                    />
                    <div ref={actionControlsRef} className="shrink-0 self-start">
                        <ActionControls
                            table={tableState}
                            playerId={player.player_id}
                            onAction={handleAction}
                            forceAllFold={forceAllFold}
                        />
                    </div>
                </div>
            </main>
        </div>
    )
}

