"use client"

import {
    ActionPayload,
    ActionRecord,
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
    const nextHandDelayIntervalRef = useRef<number | null>(null)
    const pendingStateRef = useRef<TableState | null>(null)
    const pendingNextHandRef = useRef<TableState | null>(null)
    /** 5秒ゲージ中に表示する状態（settlement）。ゲージ中は次ハンドの内容を出さない */
    const displayStateDuringGaugeRef = useRef<TableState | null>(null)
    const isAnimatingRef = useRef(false)
    const lastAppliedHandRef = useRef<number | null>(null)
    const wasSeatedRef = useRef(false)
    const lastPotForHandRef = useRef<{ hand: number | null; pot: number }>({
        hand: null,
        pot: 0,
    })
    const lastFoldStreetRef = useRef<{
        hand: number | null
        street: TableState["street"] | null
    }>({ hand: null, street: null })
    const streetTransitionDelayMs = 650
    const nextHandDelayMs = 5000
    const foldRevealDelayMs = 1200
    const revealToGaugeDelayMs = 1000
    const socketRef = useRef<WebSocket | null>(null)
    const actionControlsRef = useRef<HTMLDivElement | null>(null)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
    const [actionControlsHeight, setActionControlsHeight] = useState<number | null>(
        null
    )
    const timeLimitSeconds = 30
    const timeLimitMs = timeLimitSeconds * 1000
    const [timeLimitEnabled, setTimeLimitEnabled] = useState(false)
    const [pendingTimeLimitEnabled, setPendingTimeLimitEnabled] = useState<
        boolean | null
    >(null)
    const [leaveAfterHand, setLeaveAfterHand] = useState(false)
    const [timeLeftMs, setTimeLeftMs] = useState(timeLimitMs)
    const [forceAllFold, setForceAllFold] = useState(false)
    const timerRef = useRef<number | null>(null)
    const [nextHandDelayMsLeft, setNextHandDelayMsLeft] = useState(0)
    const [isNextHandDelayActive, setIsNextHandDelayActive] = useState(false)
    const isNextHandDelayActiveRef = useRef(false)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isWaitPaused, setIsWaitPaused] = useState(false)
    const isWaitPausedRef = useRef(false)
    const nextHandDelayMsLeftRef = useRef(0)
    const nextHandDelayLastTickRef = useRef<number | null>(null)
    const [revealOpponents, setRevealOpponents] = useState(false)
    const foldRevealTimeoutRef = useRef<number | null>(null)
    const revealCompletedAtRef = useRef<number | null>(null)
    const nextHandStartTimeoutRef = useRef<number | null>(null)
    const frozenBlindsRef = useRef<{ sb: number; bb: number } | null>(null)
    const lastProcessedActionIndexRef = useRef(0)
    const foldOverrideTimeoutsRef = useRef<Map<number, number>>(new Map())
    const prevStreetRef = useRef<TableState["street"] | null>(null)
    const prevHandNumberRef = useRef<number | null>(null)
    const [seatActionOverrides, setSeatActionOverrides] = useState<
        Record<number, { mode: "chips" | "hide"; amount?: number }>
    >({})

    const buildStateWithStreetActions = (
        state: TableState,
        street: TableState["street"]
    ): TableState => {
        const lastActionBySeat = new Map<
            string,
            { action: string; amount?: number | null }
        >()
        state.action_history.forEach((action: ActionRecord) => {
            if (action.street !== street) return
            if (!action.actor_id) return
            lastActionBySeat.set(action.actor_id, {
                action: action.action,
                amount: action.amount,
            })
        })
        return {
            ...state,
            seats: state.seats.map((seat) => ({
                ...seat,
                last_action: seat.player_id
                    ? lastActionBySeat.get(seat.player_id)?.action ?? null
                    : null,
                last_action_amount: seat.player_id
                    ? lastActionBySeat.get(seat.player_id)?.amount ?? null
                    : null,
            })),
        }
    }

    const buildDisplayState = (
        nextState: TableState,
        prevState?: TableState | null
    ): TableState => {
        if (
            prevState &&
            (nextState.street === "showdown" || nextState.street === "settlement") &&
            prevState.hand_number === nextState.hand_number
        ) {
            const lastActionStreet =
                [...nextState.action_history]
                    .reverse()
                    .find(
                        (action) =>
                            Boolean(action.actor_id) &&
                            action.street !== "settlement" &&
                            action.street !== "showdown"
                    )?.street ??
                prevState.street
            return buildStateWithStreetActions(nextState, lastActionStreet)
        }
        return buildStateWithStreetActions(nextState, nextState.street)
    }

    const potExcludingCurrentStreet = (state: TableState): number => {
        const streetTotal = state.seats.reduce(
            (sum, seat) => sum + (seat.street_commit ?? 0),
            0
        )
        return Math.max(0, state.pot - streetTotal)
    }

    const clearNextHandDelayTimers = () => {
        if (nextHandDelayIntervalRef.current) {
            window.clearInterval(nextHandDelayIntervalRef.current)
            nextHandDelayIntervalRef.current = null
        }
        if (nextHandStartTimeoutRef.current) {
            window.clearTimeout(nextHandStartTimeoutRef.current)
            nextHandStartTimeoutRef.current = null
        }
        displayStateDuringGaugeRef.current = null
        isNextHandDelayActiveRef.current = false
        setIsNextHandDelayActive(false)
        setNextHandDelayMsLeft(0)
        nextHandDelayMsLeftRef.current = 0
        nextHandDelayLastTickRef.current = null
    }

    const sendNextHandGaugeComplete = () => {
        const socket = socketRef.current
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
                JSON.stringify({
                    type: "nextHandGaugeComplete",
                    payload: { player_id: player.player_id },
                })
            )
        }
    }

    const startNextHandDelay = (
        pending: TableState,
        delayMs: number,
        options?: { onGaugeComplete?: () => void }
    ) => {
        if (!frozenBlindsRef.current && tableStateRef.current) {
            frozenBlindsRef.current = {
                sb: tableStateRef.current.small_blind,
                bb: tableStateRef.current.big_blind,
            }
        }
        if (delayMs <= 0) {
            if (options?.onGaugeComplete) {
                options.onGaugeComplete()
            } else {
                setTableState(buildDisplayState(pending, tableStateRef.current))
            }
            return
        }
        pendingNextHandRef.current = pending
        setIsNextHandDelayActive(true)
        isNextHandDelayActiveRef.current = true
        setIsWaitPaused(false)
        isWaitPausedRef.current = false
        if (nextHandDelayIntervalRef.current) {
            window.clearInterval(nextHandDelayIntervalRef.current)
        }
        const startedAt = Date.now()
        setNextHandDelayMsLeft(delayMs)
        nextHandDelayMsLeftRef.current = delayMs
        nextHandDelayLastTickRef.current = startedAt
        nextHandDelayIntervalRef.current = window.setInterval(() => {
            if (!isNextHandDelayActiveRef.current) return
            if (isWaitPausedRef.current) {
                nextHandDelayLastTickRef.current = Date.now()
                return
            }
            const now = Date.now()
            const last = nextHandDelayLastTickRef.current ?? now
            const delta = now - last
            nextHandDelayLastTickRef.current = now
            const remaining = Math.max(0, nextHandDelayMsLeftRef.current - delta)
            if (remaining !== nextHandDelayMsLeftRef.current) {
                nextHandDelayMsLeftRef.current = remaining
                setNextHandDelayMsLeft(remaining)
            }
            if (remaining <= 0) {
                if (nextHandDelayIntervalRef.current) {
                    window.clearInterval(nextHandDelayIntervalRef.current)
                    nextHandDelayIntervalRef.current = null
                }
                isNextHandDelayActiveRef.current = false
                setIsNextHandDelayActive(false)
                displayStateDuringGaugeRef.current = null
                frozenBlindsRef.current = null
                if (options?.onGaugeComplete) {
                    options.onGaugeComplete()
                    const next = pendingNextHandRef.current
                    if (next) {
                        pendingNextHandRef.current = null
                        setTableState(buildDisplayState(next, tableStateRef.current))
                    }
                } else {
                    const next = pendingNextHandRef.current ?? pending
                    pendingNextHandRef.current = null
                    setTableState(buildDisplayState(next, tableStateRef.current))
                }
            }
        }, 100)
    }

    const scheduleNextHandDelay = (
        pending: TableState,
        delayBeforeGaugeMs: number,
        options?: { onGaugeComplete?: () => void }
    ) => {
        if (!frozenBlindsRef.current && tableStateRef.current) {
            frozenBlindsRef.current = {
                sb: tableStateRef.current.small_blind,
                bb: tableStateRef.current.big_blind,
            }
        }
        if (nextHandStartTimeoutRef.current) {
            window.clearTimeout(nextHandStartTimeoutRef.current)
            nextHandStartTimeoutRef.current = null
        }
        pendingNextHandRef.current = pending
        if (delayBeforeGaugeMs <= 0) {
            startNextHandDelay(pending, nextHandDelayMs, options)
            return
        }
        nextHandStartTimeoutRef.current = window.setTimeout(() => {
            nextHandStartTimeoutRef.current = null
            const next = pendingNextHandRef.current ?? pending
            startNextHandDelay(next, nextHandDelayMs, options)
        }, delayBeforeGaugeMs)
    }

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
                if (isNextHandDelayActiveRef.current) {
                    if (prevState.hand_number !== nextState.hand_number) {
                        pendingNextHandRef.current = nextState
                    }
                    return
                }
                if (isAnimatingRef.current) {
                    pendingStateRef.current = nextState
                    return
                }
                const isNewHand = prevState.hand_number !== nextState.hand_number
                const shouldDelayNextHand =
                    isNewHand &&
                    (prevState.street === "showdown" ||
                        prevState.street === "settlement")
                const sanitizedNextState = isNewHand
                    ? {
                          ...nextState,
                          seats: nextState.seats.map((seat) => ({
                              ...seat,
                              last_action: null,
                              last_action_amount: null,
                          })),
                      }
                    : nextState
                if (shouldDelayNextHand) {
                    // サーバーは全プレイヤーのゲージ完了後にのみ次のハンドを送る
                    // 受け取った時点で既に待機済みなので即座に表示
                    setTableState(
                        buildDisplayState(sanitizedNextState, tableStateRef.current)
                    )
                    return
                }
                if (isNewHand) {
                    setTableState(
                        buildDisplayState(sanitizedNextState, tableStateRef.current)
                    )
                    return
                }
                const shouldDelayStreetChange =
                    prevState.street !== sanitizedNextState.street
                if (shouldDelayStreetChange) {
                    isAnimatingRef.current = true
                    pendingStateRef.current = sanitizedNextState
                    const displayState = buildStateWithStreetActions(
                        {
                            ...prevState,
                            action_history: sanitizedNextState.action_history,
                        },
                        prevState.street
                    )
                    setTableState(displayState)
                    if (transitionTimeoutRef.current) {
                        window.clearTimeout(transitionTimeoutRef.current)
                    }
                    transitionTimeoutRef.current = window.setTimeout(() => {
                        isAnimatingRef.current = false
                        const pending = pendingStateRef.current ?? sanitizedNextState
                        pendingStateRef.current = null
                        setTableState(buildDisplayState(pending, prevState))
                    }, streetTransitionDelayMs)
                    return
                }
                setTableState(
                    buildDisplayState(sanitizedNextState, prevState)
                )
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
        if (!tableState) return
        const handNumber = tableState.hand_number ?? null
        if (handNumber === null) return
        const potAmount = potExcludingCurrentStreet(tableState)
        const previous = lastPotForHandRef.current
        if (previous.hand !== handNumber) {
            lastPotForHandRef.current = { hand: handNumber, pot: potAmount }
            return
        }
        if (potAmount > 0) {
            lastPotForHandRef.current.pot = potAmount
        }
    }, [tableState?.hand_number, tableState?.pot, tableState?.seats])

    useEffect(() => {
        if (!tableState) return
        const handNumber = tableState.hand_number ?? null
        if (handNumber === null) return
        if (lastFoldStreetRef.current.hand !== handNumber) {
            lastFoldStreetRef.current = { hand: handNumber, street: null }
        }
        const lastFold = [...tableState.action_history]
            .reverse()
            .find((action) => action.action?.toLowerCase() === "fold")
        if (lastFold?.street) {
            lastFoldStreetRef.current = { hand: handNumber, street: lastFold.street }
        }
    }, [tableState?.hand_number, tableState?.action_history])

    useEffect(() => {
        if (tableState?.hand_number === undefined) return
        if (lastAppliedHandRef.current === null) {
            lastAppliedHandRef.current = tableState.hand_number
            return
        }
        if (lastAppliedHandRef.current === tableState.hand_number) return
        lastAppliedHandRef.current = tableState.hand_number
        if (pendingTimeLimitEnabled !== null) {
            setTimeLimitEnabled(pendingTimeLimitEnabled)
            setForceAllFold(false)
            setTimeLeftMs(timeLimitMs)
            setPendingTimeLimitEnabled(null)
        }
    }, [tableState?.hand_number, timeLimitMs, pendingTimeLimitEnabled])

    useEffect(() => {
        isWaitPausedRef.current = isWaitPaused
        if (!isWaitPaused) {
            nextHandDelayLastTickRef.current = Date.now()
        }
    }, [isWaitPaused])

    useEffect(() => {
        nextHandDelayMsLeftRef.current = nextHandDelayMsLeft
    }, [nextHandDelayMsLeft])

    useEffect(() => {
        return () => {
            if (transitionTimeoutRef.current) {
                window.clearTimeout(transitionTimeoutRef.current)
            }
            if (foldRevealTimeoutRef.current) {
                window.clearTimeout(foldRevealTimeoutRef.current)
            }
            clearNextHandDelayTimers()
            foldOverrideTimeoutsRef.current.forEach((timeout) =>
                window.clearTimeout(timeout)
            )
            foldOverrideTimeoutsRef.current.clear()
            frozenBlindsRef.current = null
            revealCompletedAtRef.current = null
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
    const hasShowdown = useMemo(
        () =>
            Boolean(
                tableState?.action_history?.some(
                    (action) => action.action?.toLowerCase() === "showdown"
                )
            ),
        [tableState?.action_history]
    )
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
        if (!leaveAfterHand) return
        if (!heroSeat) {
            setLeaveAfterHand(false)
        }
    }, [leaveAfterHand, heroSeat])

    useEffect(() => {
        if (!tableState) return
        if (heroSeat) {
            wasSeatedRef.current = true
            return
        }
        if (!wasSeatedRef.current) return
        wasSeatedRef.current = false
        setLeaveAfterHand(false)
        if (embeddedInHome && onBackToHome) {
            onBackToHome()
        } else {
            router.push("/game")
        }
    }, [tableState, heroSeat, embeddedInHome, onBackToHome, router])

    useEffect(() => {
        if (
            tableState?.hand_number !== undefined &&
            tableState?.hand_number !== tableStateRef.current?.hand_number
        ) {
            revealCompletedAtRef.current = null
        }
        if (foldRevealTimeoutRef.current) {
            window.clearTimeout(foldRevealTimeoutRef.current)
            foldRevealTimeoutRef.current = null
        }
        if (!tableState) {
            setRevealOpponents(false)
            return
        }
        if (tableState.street === "showdown") {
            setRevealOpponents(true)
            revealCompletedAtRef.current = Date.now()
            if (
                pendingNextHandRef.current &&
                !isNextHandDelayActiveRef.current &&
                !nextHandStartTimeoutRef.current
            ) {
                scheduleNextHandDelay(pendingNextHandRef.current, revealToGaugeDelayMs)
            }
            return
        }
        if (tableState.street === "settlement") {
            if (hasShowdown) {
                setRevealOpponents(true)
                revealCompletedAtRef.current = Date.now()
                if (
                    !isNextHandDelayActiveRef.current &&
                    !nextHandStartTimeoutRef.current
                ) {
                    if (pendingNextHandRef.current) {
                        scheduleNextHandDelay(
                            pendingNextHandRef.current,
                            revealToGaugeDelayMs
                        )
                    } else {
                        scheduleNextHandDelay(tableState, revealToGaugeDelayMs, {
                            onGaugeComplete: sendNextHandGaugeComplete,
                        })
                    }
                }
                return
            }
            revealCompletedAtRef.current = Date.now()
            setRevealOpponents(false)
            if (
                !isNextHandDelayActiveRef.current &&
                !nextHandStartTimeoutRef.current
            ) {
                if (pendingNextHandRef.current) {
                    scheduleNextHandDelay(
                        pendingNextHandRef.current,
                        revealToGaugeDelayMs
                    )
                } else {
                    scheduleNextHandDelay(tableState, revealToGaugeDelayMs, {
                        onGaugeComplete: sendNextHandGaugeComplete,
                    })
                }
            }
            foldRevealTimeoutRef.current = window.setTimeout(() => {
                setRevealOpponents(true)
            }, foldRevealDelayMs)
            return
        }
        setRevealOpponents(false)
    }, [tableState?.hand_number, tableState?.street, hasShowdown, foldRevealDelayMs])

    useEffect(() => {
        if (!tableState) return
        const currentStreet = tableState.street
        const prevStreet = prevStreetRef.current
        const currentHand = tableState.hand_number
        const prevHand = prevHandNumberRef.current
        if ((prevStreet && currentStreet !== prevStreet) || (prevHand && currentHand !== prevHand)) {
            foldOverrideTimeoutsRef.current.forEach((timeout) =>
                window.clearTimeout(timeout)
            )
            foldOverrideTimeoutsRef.current.clear()
            setSeatActionOverrides({})
            lastProcessedActionIndexRef.current =
                tableState.action_history?.length ?? 0
        }
        prevStreetRef.current = currentStreet
        prevHandNumberRef.current = currentHand
    }, [tableState?.street, tableState?.hand_number])

    useEffect(() => {
        if (!tableState) return
        const actions = tableState.action_history ?? []
        if (actions.length < lastProcessedActionIndexRef.current) {
            lastProcessedActionIndexRef.current = 0
        }
        const newActions = actions.slice(lastProcessedActionIndexRef.current)
        lastProcessedActionIndexRef.current = actions.length
        newActions.forEach((action) => {
            if (action.action?.toLowerCase() !== "fold") return
            if (!action.actor_id) return
            if (tableState.street === "settlement" && !hasShowdown) return
            if (!["preflop", "flop", "turn", "river"].includes(action.street)) return
            const seat = tableState.seats.find(
                (item) => item.player_id === action.actor_id
            )
            if (!seat) return
            const seatIndex = seat.seat_index
            const existing = foldOverrideTimeoutsRef.current.get(seatIndex)
            if (existing) {
                window.clearTimeout(existing)
            }
            const timeout = window.setTimeout(() => {
                setSeatActionOverrides((prev) => {
                    const next = { ...prev }
                    if ((seat.street_commit ?? 0) > 0) {
                        next[seatIndex] = {
                            mode: "chips",
                            amount: seat.street_commit ?? 0,
                        }
                    } else {
                        next[seatIndex] = { mode: "hide" }
                    }
                    return next
                })
            }, revealToGaugeDelayMs)
            foldOverrideTimeoutsRef.current.set(seatIndex, timeout)
        })
    }, [tableState?.action_history, tableState?.street, tableState?.seats, hasShowdown])

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

    const handleLeaveAfterHand = (nextValue: boolean) => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(
            JSON.stringify({
                type: nextValue ? "leaveAfterHand" : "cancelLeaveAfterHand",
                payload: { player_id: player.player_id },
            })
        )
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

    const timeGaugePercent = timeLimitEnabled && isHeroTurn
        ? Math.max(0, Math.min(100, (timeLeftMs / timeLimitMs) * 100))
        : 0
    const timeLeftSeconds = Math.max(0, Math.ceil(timeLeftMs / 1000))
    const showActionTimer = Boolean(timeLimitEnabled && isHeroTurn)
    const nextHandDelayPercent = Math.max(
        0,
        Math.min(100, (nextHandDelayMsLeft / nextHandDelayMs) * 100)
    )
    const nextHandDelaySeconds = Math.max(0, Math.ceil(nextHandDelayMsLeft / 1000))
    const displayBlinds =
        (isNextHandDelayActive || nextHandStartTimeoutRef.current) &&
        frozenBlindsRef.current
            ? frozenBlindsRef.current
            : tableState
                ? { sb: tableState.small_blind, bb: tableState.big_blind }
                : null
    const displayTableState =
        isNextHandDelayActive && displayStateDuringGaugeRef.current
            ? displayStateDuringGaugeRef.current
            : tableState
    const isFoldedSettlement =
        displayTableState?.street === "settlement" && !hasShowdown
    const potOverride =
        displayTableState &&
        ["showdown", "settlement"].includes(displayTableState.street) &&
        lastPotForHandRef.current.hand === displayTableState.hand_number
            ? lastPotForHandRef.current.pot
            : undefined
    const foldVisibleStreet =
        isFoldedSettlement &&
        lastFoldStreetRef.current.hand === displayTableState?.hand_number
            ? lastFoldStreetRef.current.street
            : null
    const hideActionAmounts =
        isFoldedSettlement &&
        !isNextHandDelayActive &&
        !nextHandStartTimeoutRef.current
    const timeLimitButtonLabel =
        pendingTimeLimitEnabled === null
            ? `アクション制限時間 ${timeLimitEnabled ? "オン" : "オフ"}`
            : `アクション制限時間 次ハンドから${pendingTimeLimitEnabled ? "オン" : "オフ"}`
    const leaveButtonLabel = leaveAfterHand ? "離席（次ハンド）" : "離席"

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
                        className="rounded bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 shrink-0"
                        onClick={() => setIsMenuOpen(true)}
                        disabled={!tableState}
                    >
                        メニュー
                    </button>
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
                    <div className="absolute inset-x-4 inset-y-8 rounded-[32%] border border-emerald-400/30 bg-emerald-900/50 shadow-[0_0_40px_rgba(16,185,129,0.25)]" />
                    <div className="relative mx-auto aspect-[4/5] w-full pt-6">
                        {displayTableState?.seats.map((seat) => {
                            const override = seatActionOverrides[seat.seat_index]
                            const heroIndex = heroSeat?.seat_index ?? 0
                            const posIndex =
                                (seat.seat_index - heroIndex + 3 + 6) % 6
                            const isTopSeat =
                                posIndex === 0 || posIndex === 1 || posIndex === 5
                            return (
                            <div
                                key={seat.seat_index}
                                className={`absolute w-28 sm:w-32 ${getSeatPosition(seat.seat_index)}`}
                            >
                                <SeatCard
                                    seat={seat}
                                    isHero={heroSeat?.seat_index === seat.seat_index}
                                    isCurrentTurn={
                                        displayTableState?.current_turn_seat === seat.seat_index
                                    }
                                    isTopSeat={isTopSeat}
                                    canReserve={isWaitingPlayer && !seat.player_id}
                                    showHoleCards={
                                        heroSeat?.seat_index === seat.seat_index ||
                                        revealOpponents
                                    }
                                    chipsOnlyBadge={override?.mode === "chips"}
                                    chipsOnlyAmount={override?.amount}
                                    hideCommitBadge={
                                        override?.mode === "hide" || hideActionAmounts
                                    }
                                    onReserve={() => handleReserveSeat(seat.seat_index)}
                                />
                            </div>
                        )
                        }) ?? (
                                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/60">
                                    Loading seats...
                                </div>
                            )}
                        <div className="absolute left-1/2 top-[50%] w-[88%] max-w-[340px] -translate-x-1/2 -translate-y-1/2 min-w-[200px]">
                            {displayTableState && (
                                <BoardPot
                                    table={displayTableState}
                                    canStart={canStartHand}
                                    onStart={handleStartHand}
                                    blinds={displayBlinds}
                                    potOverride={potOverride}
                                    foldVisibleStreet={foldVisibleStreet}
                                />
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-3 relative">
                    {(isNextHandDelayActive || showActionTimer) && (
                        <div className="absolute left-0 right-0 -top-10 z-10 flex flex-col items-center">
                            <div className="flex w-full max-w-sm items-center justify-center gap-2">
                                <div className="relative h-2.5 w-[40%] min-w-[120px] shrink-0 overflow-hidden rounded-full bg-white/60">
                                <div
                                    className="h-full rounded-full bg-amber-300/60 transition-[width]"
                                    style={{
                                        width: `${
                                            isNextHandDelayActive
                                                ? nextHandDelayPercent
                                                : timeGaugePercent
                                        }%`,
                                    }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-black/80 leading-none">
                                    {isNextHandDelayActive
                                        ? nextHandDelaySeconds
                                        : timeLeftSeconds}
                                </div>
                            </div>
                                {isNextHandDelayActive && (
                                    <button
                                        type="button"
                                        className={`min-w-[6rem] shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${
                                            isWaitPaused
                                                ? "bg-white/20 text-white/80 hover:bg-white/30"
                                                : "bg-amber-400/90 text-slate-900 hover:bg-amber-300"
                                        }`}
                                        onClick={() => setIsWaitPaused((prev) => !prev)}
                                    >
                                        {isWaitPaused ? "待ってない" : "待った"}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] gap-3 items-stretch">
                        <ActionHistory
                            actions={tableState?.action_history ?? []}
                            className="min-w-0 min-h-0"
                            maxHeight={actionControlsHeight}
                            hideAmounts={hideActionAmounts}
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
                </div>
            </main>
            {isMenuOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
                    <div className="relative w-full max-w-xs rounded-2xl border border-white/20 bg-slate-900/95 p-4 text-white shadow-xl">
                        <button
                            type="button"
                            className="absolute right-3 top-3 text-white/70 hover:text-white"
                            onClick={() => setIsMenuOpen(false)}
                            aria-label="Close menu"
                        >
                            ×
                        </button>
                        <div className="flex flex-col gap-2 pt-4">
                            <button
                                type="button"
                                className="rounded bg-slate-700/80 px-3 py-2 text-sm font-semibold text-white/90 hover:bg-slate-600/80"
                                onClick={() => {
                                    handleReset()
                                    setIsMenuOpen(false)
                                }}
                                disabled={!tableState}
                            >
                                リセット
                            </button>
                            <button
                                type="button"
                                className={`rounded px-3 py-2 text-sm font-semibold ${
                                    timeLimitEnabled
                                        ? "bg-amber-400/90 text-slate-900 hover:bg-amber-300"
                                        : "bg-white/10 text-white/80 hover:bg-white/20"
                                }`}
                                onClick={() => {
                                    const currentTarget =
                                        pendingTimeLimitEnabled ?? timeLimitEnabled
                                    const nextTarget = !currentTarget
                                    if (nextTarget === timeLimitEnabled) {
                                        setPendingTimeLimitEnabled(null)
                                    } else {
                                        setPendingTimeLimitEnabled(nextTarget)
                                    }
                                }}
                            >
                                {timeLimitButtonLabel}
                            </button>
                            <button
                                type="button"
                                className="rounded bg-red-800/70 px-3 py-2 text-sm font-semibold text-white/90 hover:bg-red-700/70"
                                onClick={() => {
                                    setLeaveAfterHand((prev) => {
                                        const nextValue = !prev
                                        handleLeaveAfterHand(nextValue)
                                        return nextValue
                                    })
                                }}
                                disabled={!tableState}
                            >
                                {leaveButtonLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

