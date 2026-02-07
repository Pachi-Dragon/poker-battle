"use client"

import {
    ActionPayload,
    GameMessage,
    JoinTablePayload,
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
                    {!embeddedInHome && (
                        <h1 className="text-[clamp(0.7rem,3.5vw,0.9rem)] font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis">
                            Dragons Poker Online
                        </h1>
                    )}
                </div>
                <div className="flex items-center justify-between">
                    <p className="text-xs text-white/60 truncate min-w-0">
                        Table: default ・ You: {player.name}
                    </p>
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

                <div className="mt-3 grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] gap-3">
                    <ActionHistory
                        actions={tableState?.action_history ?? []}
                        className="h-full min-w-0"
                    />
                    <ActionControls
                        table={tableState}
                        playerId={player.player_id}
                        onAction={handleAction}
                    />
                </div>
            </main>
        </div>
    )
}

