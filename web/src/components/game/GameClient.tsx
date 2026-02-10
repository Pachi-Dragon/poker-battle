"use client"

/* eslint-disable react-hooks/set-state-in-effect */

import { fetchEarningsSummary } from "@/lib/game/earnings"
import { getHandLabel } from "@/lib/game/handRank"
import {
    ActionPayload,
    ActionRecord,
    EarningsSummary,
    GameMessage,
    JoinTablePayload,
    ReserveSeatPayload,
    TableState,
} from "@/lib/game/types"
import { useRouter } from "next/navigation"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ActionControls } from "./ActionControls"
import { ActionHistory } from "./ActionHistory"
import { BoardPot } from "./BoardPot"
import { EarningsModal } from "./EarningsModal"
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
    const [displayStateDuringGauge, setDisplayStateDuringGauge] =
        useState<TableState | null>(null)
    const isAnimatingRef = useRef(false)
    const lastAppliedHandRef = useRef<number | null>(null)
    const wasSeatedRef = useRef(false)
    const streetTransitionDelayMs = 650
    const nextHandDelayMs = 5000
    const revealToGaugeDelayMs = 1500
    const revealHandDelayMs = 1200
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
    const [isNextHandDelayPending, setIsNextHandDelayPending] = useState(false)
    const [isNextHandAwaiting, setIsNextHandAwaiting] = useState(false)
    /** 離席予約時に、ゲージ表示だけ0に固定する（内部タイマーには触れない） */
    const [forceNextHandGaugeZero, setForceNextHandGaugeZero] = useState(false)
    const isNextHandDelayActiveRef = useRef(false)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [showMenuRandom, setShowMenuRandom] = useState(false)
    const [menuRandomValue, setMenuRandomValue] = useState<number | null>(null)
    const [manualTopupPending, setManualTopupPending] = useState(false)
    const wasHeroTurnRef = useRef(false)
    const [isWaitPaused, setIsWaitPaused] = useState(false)
    const isWaitPausedRef = useRef(false)
    const [actionControlsEnabled, setActionControlsEnabled] = useState(true)
    const nextHandDelayMsLeftRef = useRef(0)
    const nextHandDelayLastTickRef = useRef<number | null>(null)
    const [revealOpponents, setRevealOpponents] = useState(false)
    const [revealByUser, setRevealByUser] = useState(false)
    const revealCompletedAtRef = useRef<number | null>(null)
    const revealOpponentsTimeoutRef = useRef<number | null>(null)
    const nextHandStartTimeoutRef = useRef<number | null>(null)
    const gaugeScheduledHandRef = useRef<number | null>(null)
    const frozenBlindsRef = useRef<{ sb: number; bb: number } | null>(null)
    const [frozenBlinds, setFrozenBlinds] = useState<{ sb: number; bb: number } | null>(
        null
    )
    const prevStreetRef = useRef<TableState["street"] | null>(null)
    const prevHandNumberRef = useRef<number | null>(null)
    const heartbeatTimeoutRef = useRef<number | null>(null)
    const actionControlsDelayTimeoutRef = useRef<number | null>(null)
    const [saveStats, setSaveStats] = useState(false)
    /** settlement + hasShowdown 時の表示フェーズ: hands = ハンド公開のみ, win = 勝者・ゲージ・ボタン表示 */
    const [settlementDisplayPhase, setSettlementDisplayPhase] = useState<
        "hands" | "win" | null
    >(null)
    const settlementPhaseTimeoutRef = useRef<number | null>(null)
    /** 自動ランアウトを検知したハンド番号（ショーダウン直後の公開ディレイ中も公開を維持するため） */
    const [autoRunoutHandNumber, setAutoRunoutHandNumber] = useState<number | null>(
        null
    )

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
        street: TableState["street"],
        prevState?: TableState | null
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
        const prevByIndex = new Map<number, { last_action?: string | null; last_action_amount?: number | null }>()
        prevState?.seats?.forEach((s) => {
            prevByIndex.set(s.seat_index, {
                last_action: s.last_action,
                last_action_amount: s.last_action_amount,
            })
        })
        const autoRunoutLike = Boolean(
            (state.current_turn_seat === null || state.current_turn_seat === undefined) &&
            ["preflop", "flop", "turn", "river"].includes(state.street) &&
            state.seats.some((s) => s.player_id && !s.is_folded && s.is_all_in) &&
            state.seats.filter((s) => s.player_id && !s.is_folded).length >= 2
        )
        return {
            ...state,
            seats: state.seats.map((seat) => ({
                ...seat,
                last_action: (() => {
                    if (!seat.player_id) return null
                    const fromThisStreet = lastActionBySeat.get(seat.player_id)?.action ?? null
                    if (fromThisStreet) return fromThisStreet
                    // 自動ランアウト中は、オールイン金額だけ前ストリートから引き継ぐ
                    if (!autoRunoutLike) return null
                    const prev = prevByIndex.get(seat.seat_index)
                    const prevAct = (prev?.last_action ?? "").toLowerCase().replace(/_/g, "-")
                    if (prevAct !== "all-in") return null
                    return "all-in"
                })(),
                last_action_amount: (() => {
                    if (!seat.player_id) return null
                    const fromThisStreet = lastActionBySeat.get(seat.player_id)?.amount ?? null
                    if (fromThisStreet !== null && fromThisStreet !== undefined) return fromThisStreet
                    if (!autoRunoutLike) return null
                    const prev = prevByIndex.get(seat.seat_index)
                    const prevAct = (prev?.last_action ?? "").toLowerCase().replace(/_/g, "-")
                    if (prevAct !== "all-in") return null
                    const amt = prev?.last_action_amount
                    return (amt !== null && amt !== undefined && amt > 0) ? amt : null
                })(),
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
            // Showdown時の「最後のアクション表示」はリバーのみ参照する。
            // 自動ランアウト（プリ/フロ/ターンで全員all-in等）だとリバーでアクションが無いので、
            // 過去ストリートのアクションを表示しない（= null にする）のが期待挙動。
            return buildStateWithStreetActions(nextState, "river")
        }
        return buildStateWithStreetActions(nextState, nextState.street, prevState)
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
        setDisplayStateDuringGauge(null)
        isNextHandDelayActiveRef.current = false
        setIsNextHandDelayActive(false)
        setIsNextHandDelayPending(false)
        setIsNextHandAwaiting(false)
        setNextHandDelayMsLeft(0)
        nextHandDelayMsLeftRef.current = 0
        setForceNextHandGaugeZero(false)
        nextHandDelayLastTickRef.current = null
        setIsWaitPaused(false)
        isWaitPausedRef.current = false
        frozenBlindsRef.current = null
        setFrozenBlinds(null)
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
            const next = {
                sb: tableStateRef.current.small_blind,
                bb: tableStateRef.current.big_blind,
            }
            frozenBlindsRef.current = next
            setFrozenBlinds(next)
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
        setIsNextHandDelayPending(false)
        setIsNextHandDelayActive(true)
        isNextHandDelayActiveRef.current = true
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
                setDisplayStateDuringGauge(null)
                frozenBlindsRef.current = null
                setFrozenBlinds(null)
                if (options?.onGaugeComplete) {
                    setIsNextHandAwaiting(true)
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
            const next = {
                sb: tableStateRef.current.small_blind,
                bb: tableStateRef.current.big_blind,
            }
            frozenBlindsRef.current = next
            setFrozenBlinds(next)
        }
        if (nextHandStartTimeoutRef.current) {
            window.clearTimeout(nextHandStartTimeoutRef.current)
            nextHandStartTimeoutRef.current = null
        }
        pendingNextHandRef.current = pending
        if (delayBeforeGaugeMs <= 0) {
            setIsNextHandDelayPending(false)
            startNextHandDelay(pending, nextHandDelayMs, options)
            return
        }
        setIsNextHandDelayPending(true)
        setIsWaitPaused(false)
        isWaitPausedRef.current = false
        setNextHandDelayMsLeft(nextHandDelayMs)
        nextHandDelayMsLeftRef.current = nextHandDelayMs
        nextHandDelayLastTickRef.current = null
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
        const stored = window.localStorage.getItem("pokerShowMenuRandom")
        if (stored !== null) {
            setShowMenuRandom(stored === "1")
        }
    }, [])

    useEffect(() => {
        window.localStorage.setItem("pokerShowMenuRandom", showMenuRandom ? "1" : "0")
    }, [showMenuRandom])

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
                if (typeof nextState.save_earnings === "boolean") {
                    setSaveStats(nextState.save_earnings)
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
                        setDisplayStateDuringGauge(display)
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
                    // When the server resets to `waiting` (e.g. players left and only 1 remains),
                    // apply immediately. Delaying while mixing prev-board with cleared history can
                    // briefly show a full runout / incorrect pot.
                    if (sanitizedNextState.street === "waiting") {
                        clearActionControlsDelay()
                        setActionControlsEnabled(true)
                        setTableState(buildDisplayState(sanitizedNextState, prevState))
                        return
                    }
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
        if (tableState?.hand_number === undefined) return
        if (lastAppliedHandRef.current === null) {
            lastAppliedHandRef.current = tableState.hand_number
            return
        }
        if (lastAppliedHandRef.current === tableState.hand_number) return
        lastAppliedHandRef.current = tableState.hand_number
        setManualTopupPending(false)
        setForceNextHandGaugeZero(false)
        gaugeScheduledHandRef.current = null
        clearNextHandDelayTimers()
        setIsNextHandAwaiting(false)
        setRevealByUser(false)
        setSettlementDisplayPhase(null)
        setAutoRunoutHandNumber(null)
        if (settlementPhaseTimeoutRef.current) {
            window.clearTimeout(settlementPhaseTimeoutRef.current)
            settlementPhaseTimeoutRef.current = null
        }
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
        if (!["settlement", "showdown"].includes(tableState.street)) {
            setIsNextHandAwaiting(false)
            setSettlementDisplayPhase(null)
            if (settlementPhaseTimeoutRef.current) {
                window.clearTimeout(settlementPhaseTimeoutRef.current)
                settlementPhaseTimeoutRef.current = null
            }
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
            if (settlementPhaseTimeoutRef.current) {
                window.clearTimeout(settlementPhaseTimeoutRef.current)
                settlementPhaseTimeoutRef.current = null
            }
            frozenBlindsRef.current = null
            setFrozenBlinds(null)
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
    const revealedHandPlayerIds = useMemo(() => {
        const ids = new Set<string>()
        tableState?.action_history?.forEach((action) => {
            if ((action.action ?? "").toLowerCase() !== "hand_reveal") return
            if (!action.actor_id) return
            ids.add(action.actor_id)
        })
        return ids
    }, [tableState?.action_history])

    useEffect(() => {
        if (
            !tableState ||
            tableState.street !== "settlement" ||
            !hasShowdown ||
            settlementDisplayPhase !== null
        ) {
            return
        }
        const isAutoRunoutHand = Boolean(
            autoRunoutHandNumber !== null &&
            tableState.hand_number === autoRunoutHandNumber
        )
        if (isAutoRunoutHand) {
            // 自動ランアウトはショーダウン演出のディレイ不要：即 win フェーズへ
            setSettlementDisplayPhase("win")
            const state = tableStateRef.current
            if (
                state &&
                state.street === "settlement" &&
                !isNextHandDelayActiveRef.current &&
                !nextHandStartTimeoutRef.current
            ) {
                if (gaugeScheduledHandRef.current !== state.hand_number) {
                    gaugeScheduledHandRef.current = state.hand_number
                    scheduleNextHandDelay(state, revealToGaugeDelayMs, {
                        onGaugeComplete: sendNextHandGaugeComplete,
                    })
                }
            }
            return
        }
        setSettlementDisplayPhase("hands")
        if (settlementPhaseTimeoutRef.current) {
            window.clearTimeout(settlementPhaseTimeoutRef.current)
        }
        settlementPhaseTimeoutRef.current = window.setTimeout(() => {
            settlementPhaseTimeoutRef.current = null
            setSettlementDisplayPhase("win")
            const state = tableStateRef.current
            if (
                state &&
                state.street === "settlement" &&
                !isNextHandDelayActiveRef.current &&
                !nextHandStartTimeoutRef.current
            ) {
                if (gaugeScheduledHandRef.current !== state.hand_number) {
                    gaugeScheduledHandRef.current = state.hand_number
                    scheduleNextHandDelay(state, revealToGaugeDelayMs, {
                        onGaugeComplete: sendNextHandGaugeComplete,
                    })
                }
            }
        }, revealHandDelayMs)
        return
    }, [
        tableState?.street,
        tableState?.hand_number,
        hasShowdown,
        settlementDisplayPhase,
        autoRunoutHandNumber,
        revealHandDelayMs,
        revealToGaugeDelayMs,
    ])

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

    useLayoutEffect(() => {
        if (revealOpponentsTimeoutRef.current) {
            window.clearTimeout(revealOpponentsTimeoutRef.current)
            revealOpponentsTimeoutRef.current = null
        }
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
            const isAutoRunoutHand = Boolean(
                autoRunoutHandNumber !== null &&
                tableState.hand_number === autoRunoutHandNumber
            )
            setRevealOpponents(false)
            revealCompletedAtRef.current = Date.now()
            if (isAutoRunoutHand) {
                // 自動ランアウトは公開ディレイ不要：即公開
                setRevealOpponents(true)
            } else {
                revealOpponentsTimeoutRef.current = window.setTimeout(() => {
                    revealOpponentsTimeoutRef.current = null
                    setRevealOpponents(true)
                }, revealHandDelayMs)
            }
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
                if (settlementDisplayPhase === "hands") {
                    setRevealOpponents(false)
                    revealCompletedAtRef.current = Date.now()
                    revealOpponentsTimeoutRef.current = window.setTimeout(() => {
                        revealOpponentsTimeoutRef.current = null
                        setRevealOpponents(true)
                    }, 100)
                }
                return
            }
            revealCompletedAtRef.current = Date.now()
            // hand_reveal は「公開した席だけ」を表にする（showHoleCards 側で制御）
            setRevealOpponents(false)
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
        revealByUser,
        revealHandDelayMs,
        settlementDisplayPhase,
        autoRunoutHandNumber,
    ])

    useEffect(() => {
        if (!tableState) return
        const currentStreet = tableState.street
        const prevStreet = prevStreetRef.current
        const currentHand = tableState.hand_number
        const prevHand = prevHandNumberRef.current
        if ((prevStreet && currentStreet !== prevStreet) || (prevHand && currentHand !== prevHand)) {
            clearActionControlsDelay()
            setActionControlsEnabled(true)
        }
        prevStreetRef.current = currentStreet
        prevHandNumberRef.current = currentHand
    }, [tableState?.street, tableState?.hand_number])

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

    const handleLeaveNowToJoin = () => {
        // 未着席/待機中はゲーム状況を待たずに参加画面へ戻す
        sendMessage({
            type: "leaveNow",
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
        sendMessage({ type: "startHand", payload: { save_stats: saveStats } })
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

    // マット中央を基準に6席を楕円上に配置（ボードから少しだけ離す）
    const seatPositionStyles: Array<{ left: string; top: string }> = [
        { left: "50%", top: "14%" },   // 上中央（ヘッダーに隠れないよう下げる）
        { left: "85%", top: "20%" },   // 右上（ボードから少し離す）
        { left: "85%", top: "72%" },   // 右下（下に）
        { left: "50%", top: "80%" },   // 下中央（下に）
        { left: "15%", top: "72%" },   // 左下（下に）
        { left: "15%", top: "20%" },   // 左上（ボードから少し離す）
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
    const inSettlementWithShowdown =
        tableState?.street === "settlement" && hasShowdown
    const showNextHandGauge =
        isNextHandDelayActive ||
        isNextHandDelayPending ||
        (inSettlementWithShowdown && settlementDisplayPhase === "win")
    const showBetweenHandsControls = showNextHandGauge || isNextHandAwaiting
    // STOP/NEXT は「このハンドに参加しているプレイヤー」だけに出す
    // - 未着席: heroSeat が無い
    // - 次ハンドから参加（pending join）: hole_cards がまだ配られていない
    const isHeroParticipatingInCurrentHand = Boolean(
        heroSeat?.hole_cards && heroSeat.hole_cards.length >= 2
    )
    const showStopNext = showNextHandGauge && isHeroParticipatingInCurrentHand
    const showImmediateLeave = Boolean(
        // 未着席
        !heroSeat ||
        // 着席済みだがテーブル開始前（waiting）
        tableState?.street === "waiting"
    )
    const leaveSlot = showImmediateLeave
        ? "leave"
        : !showBetweenHandsControls
            ? "normal"
            : leaveAfterHand
                ? "leave-done"
                : "leave"
    const callSlot =
        tableState?.street !== "settlement" || hasShowdown
            ? "normal"
            : revealByUser
                ? "reveal-done"
                : heroSeat?.hole_cards && heroSeat.hole_cards.length >= 2
                    ? "reveal"
                    : "normal"
    const raiseSlot = showStopNext ? "stop-next" : "normal"
    const displayTableState =
        isNextHandDelayActive && displayStateDuringGauge
            ? displayStateDuringGauge
            : tableState
    const turnHighlightEnabled = Boolean(
        displayTableState &&
        ["preflop", "flop", "turn", "river"].includes(displayTableState.street) &&
        actionControlsEnabled
    )
    const inShowdownStreet = Boolean(
        displayTableState &&
        ["showdown", "settlement"].includes(displayTableState.street)
    )
    const inAutoRunout = Boolean(
        displayTableState &&
        ["preflop", "flop", "turn", "river"].includes(displayTableState.street) &&
        (displayTableState.current_turn_seat === null ||
            displayTableState.current_turn_seat === undefined) &&
        displayTableState.seats.some((s) => s.player_id && !s.is_folded && s.is_all_in) &&
        displayTableState.seats.filter((s) => s.player_id && !s.is_folded).length >= 2
    )
    // 自動ランアウトが始まったハンドでは、席の「アクション表示（チップバッジ）」は復活させない。
    // ただしプリフロップでオールインした直後（preflop表示中）は出しておき、フロップ以降で非表示。
    const hideSeatActionBadges = Boolean(
        displayTableState &&
        displayTableState.street !== "preflop" &&
        (Boolean(inAutoRunout) ||
            (autoRunoutHandNumber !== null &&
                displayTableState.hand_number === autoRunoutHandNumber))
    )
    const autoRunoutHandActive = Boolean(
        inAutoRunout ||
        (displayTableState &&
            autoRunoutHandNumber !== null &&
            displayTableState.hand_number === autoRunoutHandNumber)
    )

    useEffect(() => {
        if (!displayTableState) return
        if (!inAutoRunout) return
        if (autoRunoutHandNumber === displayTableState.hand_number) return
        setAutoRunoutHandNumber(displayTableState.hand_number)
    }, [inAutoRunout, displayTableState, autoRunoutHandNumber])
    const hasPayoutInHistory = Boolean(
        displayTableState?.action_history?.some(
            (a) => a.action?.toLowerCase() === "payout"
        )
    )
    const isTransitionShowingPreSettlement =
        Boolean(displayTableState) &&
        !["showdown", "settlement"].includes(displayTableState!.street) &&
        hasPayoutInHistory
    const suppressShowdownDetails =
        isTransitionShowingPreSettlement ||
        (inShowdownStreet &&
            (settlementDisplayPhase === "hands" ||
                (!showNextHandGauge && !isNextHandAwaiting)))
    const effectiveNextHandDelayMsLeft = forceNextHandGaugeZero ? 0 : nextHandDelayMsLeft
    const nextHandDelayPercent = Math.max(
        0,
        Math.min(100, (effectiveNextHandDelayMsLeft / nextHandDelayMs) * 100)
    )
    const nextHandDelaySeconds = Math.max(
        0,
        Math.ceil(effectiveNextHandDelayMsLeft / 1000)
    )
    const displayBlinds =
        (showNextHandGauge || isNextHandDelayPending) && frozenBlinds
            ? frozenBlinds
            : tableState
                ? { sb: tableState.small_blind, bb: tableState.big_blind }
                : null
    const showHandResultOverlays = useMemo(() => {
        if (!displayTableState) return false
        if (suppressShowdownDetails) return false
        if (!["showdown", "settlement"].includes(displayTableState.street)) return false
        return Boolean(
            displayTableState.action_history?.some(
                (a) => a.action?.toLowerCase() === "payout"
            )
        )
    }, [displayTableState, suppressShowdownDetails])

    const payoutTotalsByPlayerId = useMemo(() => {
        const totals = new Map<string, number>()
        if (!displayTableState) return totals
        if (!showHandResultOverlays) return totals
        displayTableState.action_history?.forEach((action) => {
            const act = (action.action ?? "").toLowerCase()
            if (act !== "payout") return
            if (!action.actor_id) return
            const amount = action.amount ?? 0
            totals.set(action.actor_id, (totals.get(action.actor_id) ?? 0) + amount)
        })
        return totals
    }, [displayTableState, showHandResultOverlays])

    const potWinnerPlayerIds = useMemo(() => {
        const ids = new Set<string>()
        if (!displayTableState) return ids
        // 表示開始は「5秒ゲージ出現時」
        if (!showNextHandGauge) return ids
        displayTableState.action_history?.forEach((action) => {
            const act = (action.action ?? "").toLowerCase()
            if (act !== "payout") return
            if (!action.actor_id) return
            const amount = action.amount ?? 0
            if (amount <= 0) return
            ids.add(action.actor_id)
        })
        return ids
    }, [displayTableState, showNextHandGauge])

    const handContribTotalsByPlayerId = useMemo(() => {
        const totals = new Map<string, number>()
        if (!displayTableState) return totals
        if (!showHandResultOverlays) return totals
        // server-side hand_contribs を action_history から復元する（表示用）
        const streetCommit = new Map<string, number>() // per-street total commit
        const seatedPlayerIds = displayTableState.seats
            .map((s) => s.player_id)
            .filter((id): id is string => Boolean(id))

        // server の _refund_uncalled_bet を UI 用に再現（action_history には記録されない）
        const applyRefundUncalledBet = () => {
            if (!seatedPlayerIds.length) return
            const amounts = seatedPlayerIds.map((pid) => streetCommit.get(pid) ?? 0)
            const maxAmount = Math.max(0, ...amounts)
            if (maxAmount <= 0) return
            const maxPlayers = seatedPlayerIds.filter(
                (pid) => (streetCommit.get(pid) ?? 0) === maxAmount
            )
            if (maxPlayers.length !== 1) return
            const secondMax = Math.max(
                0,
                ...amounts.filter((v) => v !== maxAmount)
            )
            const refund = maxAmount - secondMax
            if (refund <= 0) return
            const pid = maxPlayers[0]
            totals.set(pid, Math.max(0, (totals.get(pid) ?? 0) - refund))
            streetCommit.set(pid, Math.max(0, (streetCommit.get(pid) ?? 0) - refund))
        }

        const actions = displayTableState.action_history ?? []
        actions.forEach((record) => {
            const raw = (record.action ?? "").toLowerCase()
            const act = raw.replace(/_/g, "-")
            // Refund occurs when a street ends / hand ends, before payouts.
            if (act.startsWith("street-")) {
                applyRefundUncalledBet()
                streetCommit.clear()
                return
            }
            if (act === "hand-end" || act === "showdown") {
                applyRefundUncalledBet()
                return
            }
            if (act === "payout") {
                applyRefundUncalledBet()
                return
            }
            if (act === "hand-start" || act === "auto-topup" || act === "manual-topup") return

            if (!record.actor_id) return
            const actorId = record.actor_id
            const amount = record.amount ?? 0
            if (amount <= 0) return
            // No money moved
            if (act === "fold" || act === "check") return

            const add = (delta: number) => {
                if (delta <= 0) return
                totals.set(actorId, (totals.get(actorId) ?? 0) + delta)
            }

            if (act === "post-sb" || act === "post-bb" || act === "bet") {
                add(amount)
                streetCommit.set(actorId, (streetCommit.get(actorId) ?? 0) + amount)
                return
            }
            if (act === "call" || act === "raise" || act === "all-in") {
                const prev = streetCommit.get(actorId) ?? 0
                const next = amount
                const delta = Math.max(0, next - prev)
                add(delta)
                streetCommit.set(actorId, next)
                return
            }
            // Unknown actions are ignored (safe default for display)
        })
        // Safety: if no marker existed (rare), still apply once.
        applyRefundUncalledBet()
        return totals
    }, [displayTableState, showHandResultOverlays])

    const seatResultsByIndex = useMemo(() => {
        const results = new Map<number, { delta: number; label?: string | null }>()
        if (!displayTableState) return results
        if (!showHandResultOverlays) return results
        const canShowLabel = Boolean(hasShowdown && displayTableState.board.length >= 5)
        displayTableState.seats.forEach((seat) => {
            if (!seat.player_id) return
            // ハンドがない席（未配布/参加してない）は何も表示しない
            if (!seat.hole_cards || seat.hole_cards.length < 2) return
            const payout = payoutTotalsByPlayerId.get(seat.player_id) ?? 0
            const contrib = handContribTotalsByPlayerId.get(seat.player_id) ?? 0
            const delta = payout - contrib
            const label =
                canShowLabel && !seat.is_folded
                    ? getHandLabel(seat.hole_cards, displayTableState.board)
                    : null
            results.set(seat.seat_index, { delta, label })
        })
        return results
    }, [
        displayTableState,
        showHandResultOverlays,
        hasShowdown,
        payoutTotalsByPlayerId,
        handContribTotalsByPlayerId,
    ])
    const isFoldedSettlement =
        displayTableState?.street === "settlement" && !hasShowdown
    const foldVisibleStreet =
        isFoldedSettlement && displayTableState
            ? [...displayTableState.action_history]
                .reverse()
                .find((action) => action.action?.toLowerCase() === "fold")?.street ?? null
            : null
    const hideActionAmounts =
        false
    const timeLimitButtonLabel =
        pendingTimeLimitEnabled === null
            ? `アクション制限時間 ${timeLimitEnabled ? "オン" : "オフ"}`
            : `アクション制限時間 次ハンドから${pendingTimeLimitEnabled ? "オン" : "オフ"}`
    const canLeaveImmediately = Boolean(heroSeat && tableState?.street === "waiting")
    const leaveButtonLabel = leaveAfterHand ? "離席（次ハンド）" : "離席"
    const heroHandStartStack = heroSeat?.hand_start_stack ?? null
    const canRequestManualTopup = Boolean(
        heroSeat && ((heroHandStartStack ?? heroSeat.stack) <= 100)
    )
    const manualTopupLabel = manualTopupPending
        ? "チップ追加 予約済み（次ハンド +300）"
        : "チップ追加（次ハンド +300）"

    const nextMenuRandom = () => Math.floor(Math.random() * 100) + 1

    useEffect(() => {
        // オンにした直後は即表示できるように初期値を入れる
        if (showMenuRandom && menuRandomValue === null) {
            setMenuRandomValue(nextMenuRandom())
        }
    }, [showMenuRandom, menuRandomValue])

    useEffect(() => {
        // 自分のアクション番が来た瞬間に乱数を更新
        const wasHeroTurn = wasHeroTurnRef.current
        wasHeroTurnRef.current = isHeroTurn
        if (!showMenuRandom) return
        if (!wasHeroTurn && isHeroTurn) {
            setMenuRandomValue(nextMenuRandom())
        }
    }, [isHeroTurn, showMenuRandom])

    return (
        <div
            className={
                embeddedInHome
                    ? "flex flex-1 min-h-0 flex-col text-white relative z-0"
                    : "min-h-[100dvh] bg-emerald-950 text-white relative z-0"
            }
        >
            <header className="flex flex-col gap-0 px-4 py-1 shrink-0 relative z-0">
                <div className="relative z-30 flex items-center gap-2 min-w-0">
                    <button
                        type="button"
                        className="rounded bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 shrink-0"
                        onClick={() => setIsMenuOpen(true)}
                        disabled={!tableState}
                    >
                        メニュー
                    </button>
                    {showMenuRandom && isHeroTurn && (
                        <div className="text-xs font-semibold tabular-nums text-white/80 rounded bg-white/10 px-2 py-1.5 shrink-0">
                            {menuRandomValue ?? "—"}
                        </div>
                    )}
                </div>
            </header>

            <main
                className={
                    embeddedInHome
                        ? "flex flex-1 min-h-0 flex-col px-4 pb-4 overflow-hidden sm:overflow-auto relative z-0"
                        : "flex h-[calc(100dvh-48px)] min-h-0 flex-col px-4 pb-4 overflow-hidden relative z-0"
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
                <div className="relative z-[15] mx-auto pt-2 w-full max-w-sm flex-none sm:max-w-md">
                    {/* 高さ確保用（マット・席・ボードは absolute でこの上に重なる／縦長スマホでは最大高さで制限） */}
                    <div className="aspect-[4/5] w-full max-h-[58dvh]" aria-hidden="true" />
                    <div className="absolute inset-x-4 top-0 bottom-[1.5rem] rounded-[32%] border border-emerald-400/30 bg-emerald-900/50 shadow-[0_0_40px_rgba(16,185,129,0.25)]" />
                    {/* 席はマットと同じコンテナで中央基準に配置 */}
                    <div className="absolute inset-0">
                        {displayTableState?.seats.map((seat) => {
                            const heroIndex = heroSeat?.seat_index ?? 0
                            const posIndex =
                                (seat.seat_index - heroIndex + 3 + 6) % 6
                            const isTopSeat =
                                posIndex === 0 || posIndex === 1 || posIndex === 5
                            const pos = getSeatPositionStyle(seat.seat_index)
                            const isRevealed = Boolean(
                                seat.player_id && revealedHandPlayerIds.has(seat.player_id)
                            )
                            return (
                                <div
                                    key={seat.seat_index}
                                    className="absolute w-28 sm:w-32 -translate-x-1/2 -translate-y-1/2"
                                    style={{ left: pos.left, top: pos.top }}
                                >
                                    <SeatCard
                                        seat={seat}
                                        isHero={heroSeat?.seat_index === seat.seat_index}
                                        isCurrentTurn={
                                            Boolean(
                                                turnHighlightEnabled &&
                                                displayTableState?.current_turn_seat ===
                                                seat.seat_index
                                            )
                                        }
                                        isPotWinner={Boolean(
                                            seat.player_id && potWinnerPlayerIds.has(seat.player_id)
                                        )}
                                        isTopSeat={isTopSeat}
                                        canReserve={isWaitingPlayer && !seat.player_id}
                                        showHoleCards={
                                            heroSeat?.seat_index === seat.seat_index ||
                                            (inShowdownStreet &&
                                                revealOpponents &&
                                                !seat.is_folded) ||
                                            (autoRunoutHandActive && !seat.is_folded) ||
                                            (displayTableState?.street === "settlement" &&
                                                !hasShowdown &&
                                                isRevealed)
                                        }
                                        hideCommitBadge={hideSeatActionBadges || hideActionAmounts}
                                        result={seatResultsByIndex.get(seat.seat_index) ?? null}
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
                    {/* ボードはマットと同じコンテナ基準で中央やや上に配置（マット上方向け） */}
                    <div className="absolute left-1/2 top-[46%] w-[88%] max-w-[340px] -translate-x-1/2 -translate-y-1/2 min-w-[200px] pointer-events-none">
                        <div className="pointer-events-auto">
                            {displayTableState && (
                                <BoardPot
                                    table={displayTableState}
                                    canStart={canStartHand && Boolean(heroSeat)}
                                    onStart={handleStartHand}
                                    hideStartControls={!heroSeat}
                                    saveStats={saveStats}
                                    onSaveStatsChange={(value) => {
                                        setSaveStats(value)
                                        sendMessage({
                                            type: "setSaveStats",
                                            payload: { save_stats: value },
                                        })
                                    }}
                                    blinds={displayBlinds}
                                    foldVisibleStreet={foldVisibleStreet}
                                />
                            )}
                        </div>
                    </div>
                </div>

                <div className="relative pb-4 mt-2 flex flex-col flex-1 min-h-0">
                    {/* 5秒/30秒ゲージは枠を押し下げない（オーバーレイ表示） */}
                    {(showNextHandGauge || showActionTimer) && (
                        <div className="pointer-events-none absolute left-1/2 -top-4 z-[80] w-full max-w-[480px] -translate-x-1/2 flex justify-center">
                            <div className="relative h-2.5 w-[30%] min-w-[100px] max-w-[160px] shrink-0 overflow-hidden rounded-full bg-white/60 shadow-[0_6px_18px_rgba(0,0,0,0.35)]">
                                <div
                                    className="h-full rounded-full bg-amber-300/60 transition-[width]"
                                    style={{
                                        width: `${showNextHandGauge
                                            ? nextHandDelayPercent
                                            : timeGaugePercent
                                            }%`,
                                    }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-black/80 leading-none">
                                    {showNextHandGauge
                                        ? nextHandDelaySeconds
                                        : timeLeftSeconds}
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="mx-auto w-full max-w-[480px] min-h-0 flex-1 flex flex-col overflow-x-hidden overflow-y-visible">
                        <div className="grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] gap-3 items-stretch flex-1 min-h-0 overflow-x-hidden overflow-y-visible">
                            <div className="relative min-w-0 min-h-0 flex flex-col">
                                <ActionHistory
                                    actions={tableState?.action_history ?? []}
                                    className="min-w-0 min-h-0 flex-1 overflow-auto"
                                    maxHeight={actionControlsHeight}
                                    hideAmounts={hideActionAmounts}
                                />
                            </div>
                            <div className="relative z-[30] shrink-0 self-stretch min-h-0 flex flex-col overflow-visible">
                                <div ref={actionControlsRef} className="flex-1 min-h-0 flex flex-col">
                                    <ActionControls
                                        table={tableState}
                                        playerId={player.player_id}
                                        onAction={handleAction}
                                        forceAllFold={forceAllFold}
                                        interactionEnabled={actionControlsEnabled}
                                        leaveSlot={leaveSlot}
                                        onLeaveAfterHand={() => {
                                            if (showImmediateLeave) {
                                                handleLeaveNowToJoin()
                                                return
                                            }
                                            // 5秒ゲージ中にSTOP済みなら、離席＝NEXT扱いで進める（ゲージを0にして進行再開）
                                            if (showNextHandGauge && isWaitPaused) {
                                                handleNextHandDelayToggle()
                                            }
                                            setLeaveAfterHand(true)
                                            setForceNextHandGaugeZero(true)
                                            handleLeaveAfterHand(true)
                                        }}
                                        callSlot={callSlot}
                                        onRevealHand={handleRevealHand}
                                        raiseSlot={raiseSlot}
                                        isWaitPaused={isWaitPaused}
                                        onNextHandDelayToggle={handleNextHandDelayToggle}
                                    />
                                </div>
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
                            {tableState && tableState.street !== "waiting" && (
                                <div className="text-xs text-white/70">
                                    収支保存: {saveStats ? "オン" : "オフ"}
                                </div>
                            )}
                            <button
                                type="button"
                                className={`rounded px-3 py-2 text-sm font-semibold ${showMenuRandom
                                    ? "bg-emerald-300 text-slate-900 hover:bg-emerald-200"
                                    : "bg-black/70 text-white/80 hover:bg-black/80"
                                    }`}
                                onClick={() => setShowMenuRandom((prev) => !prev)}
                                disabled={!tableState}
                            >
                                乱数表示 {showMenuRandom ? "オン" : "オフ"}
                            </button>
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
                            <button
                                type="button"
                                className={`rounded px-3 py-2 text-sm font-semibold ${canRequestManualTopup && !manualTopupPending
                                    ? "bg-amber-400/90 text-slate-900 hover:bg-amber-300"
                                    : "bg-white/10 text-white/40 cursor-not-allowed"
                                    }`}
                                onClick={() => {
                                    if (!canRequestManualTopup || manualTopupPending) return
                                    sendMessage({
                                        type: "requestManualTopup",
                                        payload: { player_id: player.player_id },
                                    })
                                    setManualTopupPending(true)
                                }}
                                disabled={!canRequestManualTopup || manualTopupPending || !tableState}
                                title={
                                    manualTopupPending
                                        ? "予約済みです"
                                        : canRequestManualTopup
                                            ? "次のハンド開始時に+300されます（収支には影響しません）"
                                            : "スタックが100以下のときのみ押せます"
                                }
                            >
                                {manualTopupLabel}
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

