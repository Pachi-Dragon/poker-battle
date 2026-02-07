"use client"

import {
    ActionPayload,
    GameMessage,
    JoinTablePayload,
    TableState,
} from "@/lib/game/types"
import { useEffect, useMemo, useRef, useState } from "react"
import { ActionControls } from "./ActionControls"
import { ActionHistory } from "./ActionHistory"
import { BoardPot } from "./BoardPot"
import { SeatCard } from "./SeatCard"

interface GameClientProps {
    player: JoinTablePayload
}

export function GameClient({ player }: GameClientProps) {
    const [tableState, setTableState] = useState<TableState | null>(null)
    const socketRef = useRef<WebSocket | null>(null)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

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
                setTableState(message.payload ?? null)
            }
        })

        return () => {
            socket.close()
        }
    }, [apiUrl, player.player_id, player.name])

    const heroSeat = useMemo(() => {
        if (!tableState) return null
        return tableState.seats.find((seat) => seat.player_id === player.player_id)
    }, [tableState, player.player_id])

    const handleAction = (payload: ActionPayload) => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({ type: "action", payload }))
    }

    const handleReady = () => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(
            JSON.stringify({ type: "ready", payload: { player_id: player.player_id } })
        )
    }

    const handleLeave = () => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(
            JSON.stringify({
                type: "leaveTable",
                payload: { player_id: player.player_id },
            })
        )
    }

    const handleReset = () => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(
            JSON.stringify({
                type: "reset",
                payload: {},
            })
        )
    }

    const seatPositions = [
        "top-0 left-1/2 -translate-x-1/2",
        "top-1/4 right-0 -translate-y-1/2",
        "bottom-1/4 right-0 translate-y-1/2",
        "bottom-0 left-1/2 -translate-x-1/2",
        "bottom-1/4 left-0 translate-y-1/2",
        "top-1/4 left-0 -translate-y-1/2",
    ]

    const getSeatPosition = (seatIndex: number) => {
        const heroIndex = heroSeat?.seat_index ?? 0
        const posIndex = (seatIndex - heroIndex + 3 + 6) % 6
        return seatPositions[posIndex]
    }

    return (
        <div className="min-h-screen bg-emerald-950 text-white">
            <header className="flex items-center justify-between px-4 pb-3 pt-4">
                <div>
                    <p className="text-sm text-white/60">
                        Table: default ・ You: {player.name}
                    </p>
                </div>
                <div className="rounded-full bg-white/10 px-4 py-2 text-xs text-white/70">
                    {tableState
                        ? `SB/BB ${tableState.small_blind}/${tableState.big_blind}`
                        : "Connecting..."}
                </div>
            </header>

            <main className="flex min-h-[calc(100vh-64px)] flex-col px-4 pb-4">
                <div className="relative mx-auto mt-2 w-full max-w-sm flex-1 sm:max-w-md">
                    <div className="absolute inset-6 rounded-[32%] border border-emerald-400/30 bg-emerald-900/50 shadow-[0_0_40px_rgba(16,185,129,0.25)]" />
                    <div className="relative mx-auto aspect-square w-full">
                        {tableState?.seats.map((seat) => (
                            <div
                                key={seat.seat_index}
                                className={`absolute w-24 sm:w-28 ${getSeatPosition(seat.seat_index)}`}
                            >
                                <SeatCard
                                    seat={seat}
                                    isHero={heroSeat?.seat_index === seat.seat_index}
                                />
                            </div>
                        )) ?? (
                            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/60">
                                Loading seats...
                            </div>
                        )}
                        <div className="absolute left-1/2 top-1/2 w-40 -translate-x-1/2 -translate-y-1/2 sm:w-48">
                            {tableState && <BoardPot table={tableState} />}
                        </div>
                    </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                    <ActionHistory
                        actions={tableState?.action_history ?? []}
                        className="h-40 sm:h-48"
                    />
                    <ActionControls
                        table={tableState}
                        playerId={player.player_id}
                        onAction={handleAction}
                        onReady={handleReady}
                        onLeave={handleLeave}
                        onReset={handleReset}
                    />
                </div>
            </main>
        </div>
    )
}

