"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
    ActionPayload,
    GameMessage,
    JoinTablePayload,
    TableState,
} from "@/lib/game/types"
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
    }, [apiUrl, player])

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

    return (
        <div className="grid min-h-screen grid-rows-[auto_1fr] bg-emerald-950 px-6 py-8 text-white">
            <header className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Poker Battle</h1>
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

            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                <div className="flex flex-col gap-6">
                    <div className="grid gap-4 md:grid-cols-3">
                        {tableState?.seats.map((seat) => (
                            <SeatCard
                                key={seat.seat_index}
                                seat={seat}
                                isHero={heroSeat?.seat_index === seat.seat_index}
                            />
                        )) ?? (
                            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/60">
                                Loading seats...
                            </div>
                        )}
                    </div>
                    {tableState && <BoardPot table={tableState} />}
                </div>

                <div className="flex flex-col gap-6">
                    <ActionHistory actions={tableState?.action_history ?? []} />
                    <ActionControls
                        table={tableState}
                        playerId={player.player_id}
                        onAction={handleAction}
                        onReady={handleReady}
                    />
                </div>
            </div>
        </div>
    )
}

