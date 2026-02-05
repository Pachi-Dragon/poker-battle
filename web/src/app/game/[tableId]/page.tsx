import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { GameClient } from "@/components/game/GameClient"

interface GamePageProps {
    params: { tableId: string }
}

export default async function GamePage({ params }: GamePageProps) {
    const session = await auth()
    if (!session?.user) {
        redirect("/")
    }

    const playerId =
        session.user.email ?? session.user.name ?? `guest-${crypto.randomUUID()}`
    const playerName = session.user.name ?? session.user.email ?? "Guest"

    return (
        <GameClient
            tableId={params.tableId}
            player={{ player_id: playerId, name: playerName }}
        />
    )
}

