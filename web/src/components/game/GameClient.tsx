"use client"

import {
    ActionPayload,
    ActionRecord,
    EarningsSummary,
    GameMessage,
    JoinTablePayload,
    ReserveSeatPayload,
    TableState,
} from "@/lib/game/types"
import { fetchEarningsSummary } from "@/lib/game/earnings"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { ActionControls } from "./ActionControls"
import { ActionHistory } from "./ActionHistory"
import { BoardPot } from "./BoardPot"
import { EarningsModal } from "./EarningsModal"
import { SeatCard } from "./SeatCard"
import { getHandLabel } from "@/lib/game/handRank"

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
    const revealToGaugeDelayMs = 1000
    const actionControlsDelayMs = 400
    const heartbeatIntervalMs = 25000
    const socketRef = useRef<WebSocket | null>(null)
    const actionControlsRef = useRef<HTMLDivElement | null>(null)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
    const [isDisconnected, setIsDisconnected] = useState(false)
    const [reconnectToken, setReconnectToken] = useState(0)
    const [actionControlsHeight, setActionControlsHeight] = useState<number | null>(
        null
    )
    const [earningsTarget, setEarningsTarget] = useState<{
        email: string
        name?: string | null
    } | null>(null)
    const [earningsSummary, setEarningsSummary] = useState<EarningsSummary | null>(
        null
    )
    const [earningsLoading, setEarningsLoading] = useState(false)
    const [earningsError, setEarningsError] = useState<string | null>(null)
    const earningsCacheRef = useRef<Map<string, EarningsSummary>>(new Map())
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
    const [actionControlsEnabled, setActionControlsEnabled] = useState(true)
    const nextHandDelayMsLeftRef = useRef(0)
    const nextHandDelayLastTickRef = useRef<number | null>(null)
    const [revealOpponents, setRevealOpponents] = useState(false)
    const [revealByUser, setRevealByUser] = useState(false)
    const revealCompletedAtRef = useRef<number | null>(null)
    const nextHandStartTimeoutRef = useRef<number | null>(null)
    const gaugeScheduledHandRef = useRef<number | null>(null)
    const frozenBlindsRef = useRef<{ sb: number; bb: number } | null>(null)
    const lastProcessedActionIndexRef = useRef(0)
    const foldOverrideTimeoutsRef = useRef<Map<number, number>>(new Map())
    const prevStreetRef = useRef<TableState["street"] | null>(null)
    const prevHandNumberRef = useRef<number | null>(null)
    const heartbeatTimeoutRef = useRef<number | null>(null)
    const actionControlsDelayTimeoutRef = useRef<number | null>(null)
    const [seatActionOverrides, setSeatActionOverrides] = useState<
        Record<number, { mode: "chips" | "hide"; amount?: number }>
    >({})

    const scheduleHeartbeat = () => {
        if (heartbeatTimeoutRef.current) {
            window.clearTimeout(heartbeatTimeoutRef.current)
        }
        heartbeatTimeoutRef.current = window.setTimeout(() => {
            sendMessage({
                type: "heartbeat",
                payload: { player_id: player.player_id },
            })
        }, heartbeatIntervalMs)
    }

    const sendMessage = (message: { type: string; payload?: unknown }) => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify(message))
        scheduleHeartbeat()
    }

    const openEarningsForSeat = (seat: {
        player_id?: string | null
        name?: string | null
    }) => {
        if (!seat.player_id) return
        setEarningsTarget({ email: seat.player_id, name: seat.name })
    }

    const fetchTargetEarnings = (forceRefresh = false) => {
        if (!earningsTarget) return
        const cached = earningsCacheRef.current.get(earningsTarget.email)
        if (cached && !forceRefresh) {
            setEarningsSummary(cached)
            setEarningsError(null)
            setEarningsLoading(false)
            return
        }
        let cancelled = false
        setEarningsLoading(true)
        setEarningsError(null)
        setEarningsSummary(null)
        fetchEarningsSummary(apiUrl, earningsTarget.email)
            .then((summary) => {
                if (cancelled) return
                earningsCacheRef.current.set(earningsTarget.email, summary)
                setEarningsSummary(summary)
            })
            .catch((error) => {
                if (cancelled) return
                setEarningsError(error.message ?? "収支を取得できませんでした。")
            })
            .finally(() => {
                if (cancelled) return
                setEarningsLoading(false)
            })
        return () => {
            cancelled = true
        }
    }

    useEffect(() => {
        if (!earningsTarget) {
            setEarningsSummary(null)
            setEarningsError(null)
            setEarningsLoading(false)
            return
        }
        const cancel = fetchTargetEarnings(false)
        return () => {
            if (cancel) cancel()
        }
    }, [apiUrl, earningsTarget])

    const handleReconnect = () => {
        const socket = socketRef.current
        if (socket && socket.readyState !== WebSocket.CLOSED) {
            socket.close()
        }
        setReconnectToken((prev) => prev + 1)
    }

    const handleNextHandDelayToggle = () => {
        if (isWaitPaused) {
            // NEXT: move gauge to 0 immediately
            isWaitPausedRef.current = false
            setIsWaitPaused(false)
            nextHandDelayLastTickRef.current = Date.now()
            nextHandDelayMsLeftRef.current = 0
            setNextHandDelayMsLeft(0)
            return
        }
        // STOP
        isWaitPausedRef.current = true
        setIsWaitPaused(true)
    }

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
        sendMessage({
            type: "nextHandGaugeComplete",
            payload: { player_id: player.player_id },
        })
    }

    const clearActionControlsDelay = () => {
        if (actionControlsDelayTimeoutRef.current) {
            window.clearTimeout(actionControlsDelayTimeoutRef.current)
            actionControlsDelayTimeoutRef.current = null
        }
    }

    const scheduleActionControlsReveal = (delayMs: number) => {
        clearActionControlsDelay()
        setActionControlsEnabled(false)
        actionControlsDelayTimeoutRef.current = window.setTimeout(() => {
            actionControlsDelayTimeoutRef.current = null
            setActionControlsEnabled(true)
        }, delayMs)
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
        let didOpen = false

        socket.addEventListener("open", () => {
            if (socketRef.current !== socket) return
            didOpen = true
            setIsDisconnected(false)
            const message: GameMessage<JoinTablePayload> = {
                type: "joinTable",
                payload: player,
            }
            sendMessage(message)
        })

        socket.addEventListener("close", () => {
            if (socketRef.current !== socket) return
            if (!didOpen) return
            setIsDisconnected(true)
        })

        socket.addEventListener("error", () => {
            if (socketRef.current !== socket) return
            if (!didOpen) return
            setIsDisconnected(true)
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
                    const hasRevealUpdate = Boolean(
                        nextState.action_history?.some(
                            (action) => action.action?.toLowerCase() === "hand_reveal"
                        )
                    )
                    if (hasRevealUpdate) {
                        const display = buildDisplayState(nextState, tableStateRef.current)
                        displayStateDuringGaugeRef.current = display
                        setTableState(display)
                        return
                    }
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
                    if (["flop", "turn", "river"].includes(sanitizedNextState.street)) {
                        scheduleActionControlsReveal(
                            streetTransitionDelayMs + actionControlsDelayMs
                        )
                    } else {
                        clearActionControlsDelay()
                        setActionControlsEnabled(true)
                    }
                    const displayState = buildStateWithStreetActions(
                        {
                            ...prevState,
                            action_history: sanitizedNextState.action_history,
                            current_turn_seat: sanitizedNextState.current_turn_seat,
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
                clearActionControlsDelay()
                setActionControlsEnabled(true)
                setTableState(
                    buildDisplayState(sanitizedNextState, prevState)
                )
            }
        })

        return () => {
            if (heartbeatTimeoutRef.current) {
                window.clearTimeout(heartbeatTimeoutRef.current)
                heartbeatTimeoutRef.current = null
            }
            socket.close()
        }
    }, [apiUrl, player.player_id, player.name, reconnectToken])

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
        gaugeScheduledHandRef.current = null
        clearNextHandDelayTimers()
        setRevealByUser(false)
        if (pendingTimeLimitEnabled !== null) {
            setTimeLimitEnabled(pendingTimeLimitEnabled)
            setForceAllFold(false)
            setTimeLeftMs(timeLimitMs)
            setPendingTimeLimitEnabled(null)
        }
    }, [tableState?.hand_number, timeLimitMs, pendingTimeLimitEnabled])

    useEffect(() => {
        if (!tableState) return
        if (
            isNextHandDelayActiveRef.current &&
            !["settlement", "showdown"].includes(tableState.street)
        ) {
            clearNextHandDelayTimers()
        }
    }, [tableState?.street, tableState?.hand_number])

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
            clearNextHandDelayTimers()
            foldOverrideTimeoutsRef.current.forEach((timeout) =>
                window.clearTimeout(timeout)
            )
            foldOverrideTimeoutsRef.current.clear()
            frozenBlindsRef.current = null
            revealCompletedAtRef.current = null
            clearActionControlsDelay()
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
    const hasHandReveal = useMemo(
        () =>
            Boolean(
                tableState?.action_history?.some(
                    (action) => action.action?.toLowerCase() === "hand_reveal"
                )
            ),
        [tableState?.action_history]
    )
    const hasHandRevealFromOther = useMemo(
        () =>
            Boolean(
                tableState?.action_history?.some(
                    (action) =>
                        action.action?.toLowerCase() === "hand_reveal" &&
                        action.actor_id &&
                        action.actor_id !== player.player_id
                )
            ),
        [tableState?.action_history, player.player_id]
    )
    const isWaitingPlayer = Boolean(tableState && !heroSeat)
    const isHeroTurn = Boolean(
        tableState &&
        heroSeat &&
        tableState.current_turn_seat !== null &&
        tableState.current_turn_seat !== undefined &&
        tableState.current_turn_seat === heroSeat.seat_index
    )
    const isHeroTurnReady = isHeroTurn && actionControlsEnabled
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
                if (gaugeScheduledHandRef.current !== tableState.hand_number) {
                    gaugeScheduledHandRef.current = tableState.hand_number
                    scheduleNextHandDelay(pendingNextHandRef.current, revealToGaugeDelayMs)
                }
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
                    if (gaugeScheduledHandRef.current !== tableState.hand_number) {
                        gaugeScheduledHandRef.current = tableState.hand_number
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
                }
                return
            }
            revealCompletedAtRef.current = Date.now()
            setRevealOpponents(hasHandRevealFromOther)
            if (
                !isNextHandDelayActiveRef.current &&
                !nextHandStartTimeoutRef.current
            ) {
                if (gaugeScheduledHandRef.current !== tableState.hand_number) {
                    gaugeScheduledHandRef.current = tableState.hand_number
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
            }
            return
        }
        setRevealOpponents(false)
    }, [
        tableState?.hand_number,
        tableState?.street,
        hasShowdown,
        hasHandReveal,
        hasHandRevealFromOther,
        revealByUser,
    ])

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
            clearActionControlsDelay()
            setActionControlsEnabled(true)
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
        if (!timeLimitEnabled || !isHeroTurnReady) {
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
        isHeroTurnReady,
        timeLimitMs,
        tableState?.hand_number,
        tableState?.street,
        tableState?.current_turn_seat,
    ])

    const handleAction = (payload: ActionPayload) => {
        sendMessage({ type: "action", payload })
    }

    const handleLeave = () => {
        sendMessage({
            type: "leaveTable",
            payload: { player_id: player.player_id },
        })
        if (embeddedInHome && onBackToHome) {
            onBackToHome()
        } else {
            router.back()
        }
    }

    const handleReset = () => {
        sendMessage({ type: "resetTable" })
    }

    const handleReserveSeat = (seatIndex: number) => {
        const payload: ReserveSeatPayload = {
            player_id: player.player_id,
            name: player.name,
            seat_index: seatIndex,
        }
        sendMessage({ type: "reserveSeat", payload })
    }

    const handleStartHand = () => {
        sendMessage({ type: "startHand" })
    }

    const handleRevealHand = () => {
        setRevealByUser(true)
        sendMessage({
            type: "revealHand",
            payload: { player_id: player.player_id },
        })
    }

    const handleLeaveAfterHand = (nextValue: boolean) => {
        sendMessage({
            type: nextValue ? "leaveAfterHand" : "cancelLeaveAfterHand",
            payload: { player_id: player.player_id },
        })
    }

    // マット中央(50%,50%)を基準に6席を楕円上に配置（全席ボード寄り、横4席は外側）
    const seatPositionStyles: Array<{ left: string; top: string }> = [
        { left: "50%", top: "20%" },   // 上中央
        { left: "84%", top: "28%" },   // 右上
        { left: "84%", top: "72%" },   // 右下
        { left: "50%", top: "80%" },   // 下中央
        { left: "16%", top: "72%" },   // 左下
        { left: "16%", top: "28%" },   // 左上
    ]

    const getSeatPositionStyle = (seatIndex: number) => {
        const heroIndex = heroSeat?.seat_index ?? 0
        const posIndex = (seatIndex - heroIndex + 3 + 6) % 6
        return seatPositionStyles[posIndex]
    }

    const timeGaugePercent = timeLimitEnabled && isHeroTurn
        ? Math.max(0, Math.min(100, (timeLeftMs / timeLimitMs) * 100))
        : 0
    const timeLeftSeconds = Math.max(0, Math.ceil(timeLeftMs / 1000))
    const showActionTimer = Boolean(timeLimitEnabled && isHeroTurnReady)
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
    const winnerIds = useMemo(() => {
        if (!displayTableState) return new Set<string>()
        if (!["showdown", "settlement"].includes(displayTableState.street)) {
            return new Set<string>()
        }
        const payouts = displayTableState.action_history?.filter(
            (action) => action.action?.toLowerCase() === "payout" && action.actor_id
        )
        return new Set<string>(payouts?.map((action) => action.actor_id as string))
    }, [displayTableState])
    const winnerHandLabels = useMemo(() => {
        const labels = new Map<number, string>()
        if (!displayTableState) return labels
        if (!["showdown", "settlement"].includes(displayTableState.street)) {
            return labels
        }
        if (displayTableState.board.length < 5) return labels
        displayTableState.seats.forEach((seat) => {
            if (!seat.player_id) return
            if (!winnerIds.has(seat.player_id)) return
            if (!seat.hole_cards || seat.hole_cards.length < 2) return
            const label = getHandLabel(seat.hole_cards, displayTableState.board)
            if (label) {
                labels.set(seat.seat_index, label)
            }
        })
        return labels
    }, [displayTableState, winnerIds])
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
        false
    const timeLimitButtonLabel =
        pendingTimeLimitEnabled === null
            ? `アクション制限時間 ${timeLimitEnabled ? "オン" : "オフ"}`
            : `アクション制限時間 次ハンドから${pendingTimeLimitEnabled ? "オン" : "オフ"}`
    const canLeaveImmediately = Boolean(heroSeat && tableState?.street === "waiting")
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
                {isDisconnected && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
                        <div className="w-full max-w-xs rounded-2xl border border-white/20 bg-slate-950 p-5 text-center shadow-xl">
                            <div className="text-sm font-semibold text-white">
                                接続が切れました
                            </div>
                            <div className="mt-1 text-xs text-white/70">
                                再接続してください
                            </div>
                            <button
                                type="button"
                                className="mt-4 w-full rounded-full bg-amber-400/90 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
                                onClick={handleReconnect}
                            >
                                再接続
                            </button>
                        </div>
                    </div>
                )}
                <div className="relative mx-auto mt-2 w-full max-w-sm flex-1 sm:max-w-md">
                    {/* 高さ確保用（マット・席・ボードは absolute でこの上に重なる） */}
                    <div className="aspect-[4/5] w-full" aria-hidden="true" />
                    <div className="absolute inset-x-4 inset-y-[3.5rem] rounded-[32%] border border-emerald-400/30 bg-emerald-900/50 shadow-[0_0_40px_rgba(16,185,129,0.25)]" />
                    {/* 席はマットと同じコンテナで中央基準に配置 */}
                    <div className="absolute inset-0">
                        {displayTableState?.seats.map((seat) => {
                            const override = seatActionOverrides[seat.seat_index]
                            const heroIndex = heroSeat?.seat_index ?? 0
                            const posIndex =
                                (seat.seat_index - heroIndex + 3 + 6) % 6
                            const isTopSeat =
                                posIndex === 0 || posIndex === 1 || posIndex === 5
                            const pos = getSeatPositionStyle(seat.seat_index)
                            return (
                                <div
                                    key={seat.seat_index}
                                    className="absolute w-24 sm:w-28 -translate-x-1/2 -translate-y-1/2"
                                    style={{ left: pos.left, top: pos.top }}
                                >
                                    <SeatCard
                                        seat={seat}
                                        isHero={heroSeat?.seat_index === seat.seat_index}
                                        isCurrentTurn={
                                            displayTableState?.current_turn_seat === seat.seat_index
                                        }
                                        isTopSeat={isTopSeat}
                                        canReserve={isWaitingPlayer && !seat.player_id}
                                        showWinner={
                                            Boolean(
                                                seat.player_id && winnerIds.has(seat.player_id)
                                            )
                                        }
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
                                        onSelect={() => openEarningsForSeat(seat)}
                                    />
                                </div>
                            )
                        }) ?? (
                                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/60">
                                    Loading seats...
                                </div>
                            )}
                    </div>
                    {/* ボードはマットと同じコンテナ基準で中央に配置（端末差を防ぐ） */}
                    <div className="absolute left-1/2 top-1/2 w-[88%] max-w-[340px] -translate-x-1/2 -translate-y-1/2 min-w-[200px] pointer-events-none">
                        <div className="pointer-events-auto">
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

                <div className="relative pb-14 mt-2">
                    {(isNextHandDelayActive || showActionTimer) && (
                        <div className="absolute left-0 right-0 -top-10 z-10 flex flex-col items-center">
                            <div className="flex w-full max-w-sm items-center justify-center gap-2">
                                <div className="relative h-2.5 w-[40%] min-w-[120px] shrink-0 overflow-hidden rounded-full bg-white/60">
                                    <div
                                        className="h-full rounded-full bg-amber-300/60 transition-[width]"
                                        style={{
                                            width: `${isNextHandDelayActive
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
                        <div className="relative shrink-0 self-start">
                            <div ref={actionControlsRef}>
                                <ActionControls
                                    table={tableState}
                                    playerId={player.player_id}
                                    onAction={handleAction}
                                    forceAllFold={forceAllFold}
                                    interactionEnabled={actionControlsEnabled}
                                />
                            </div>
                            <div className="absolute right-0 top-0 -translate-y-full -mt-1 mb-1 flex flex-col gap-1">
                                {isNextHandDelayActive && (
                                    <button
                                        type="button"
                                        className={`min-w-[5rem] rounded-md px-3 py-1.5 text-xs font-semibold ${isWaitPaused
                                                ? "bg-white/20 text-white/80 hover:bg-white/30"
                                                : "bg-amber-400/90 text-slate-900 hover:bg-amber-300"
                                            }`}
                                        onClick={handleNextHandDelayToggle}
                                    >
                                        {isWaitPaused ? "NEXT" : "STOP"}
                                    </button>
                                )}
                                {tableState?.street === "settlement" &&
                                    !hasShowdown &&
                                    !revealByUser && (
                                    <button
                                        type="button"
                                        className="min-w-[7rem] rounded-md px-3 py-1.5 text-xs font-semibold bg-emerald-400/90 text-slate-900 hover:bg-emerald-300"
                                        onClick={handleRevealHand}
                                    >
                                        ハンドを公開する
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
            {earningsTarget && (
                <EarningsModal
                    title={`${earningsTarget.name ?? earningsTarget.email} の収支`}
                    summary={earningsSummary}
                    isLoading={earningsLoading}
                    error={earningsError}
                    onRefresh={() => fetchTargetEarnings(true)}
                    onClose={() => setEarningsTarget(null)}
                />
            )}
            {isMenuOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
                    onClick={() => setIsMenuOpen(false)}
                >
                    <div
                        className="relative w-full max-w-xs rounded-2xl border border-white/20 bg-slate-900/95 p-4 text-white shadow-xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-2xl text-white/70 hover:bg-white/10 hover:text-white"
                            onClick={() => setIsMenuOpen(false)}
                            aria-label="Close menu"
                        >
                            ×
                        </button>
                        <div className="flex flex-col gap-2 pt-4">
                            <button
                                type="button"
                                className={`rounded px-3 py-2 text-sm font-semibold ${(pendingTimeLimitEnabled ?? timeLimitEnabled)
                                        ? "bg-emerald-300 text-slate-900 hover:bg-emerald-200"
                                        : "bg-black/70 text-white/80 hover:bg-black/80"
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
                            {heroSeat ? (
                                <button
                                    type="button"
                                    className={`rounded px-3 py-2 text-sm font-semibold text-white/90 ${leaveAfterHand
                                            ? "bg-red-800/70 hover:bg-red-700/70"
                                            : "bg-black/70 text-white/80 hover:bg-black/80"
                                        }`}
                                    onClick={() => {
                                        if (canLeaveImmediately) {
                                            handleLeaveAfterHand(true)
                                            return
                                        }
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
                            ) : (
                                <button
                                    type="button"
                                    className="rounded bg-black/70 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-black/80"
                                    onClick={() => {
                                        handleLeave()
                                        setIsMenuOpen(false)
                                    }}
                                    disabled={!tableState}
                                >
                                    離席
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

