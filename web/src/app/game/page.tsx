import { auth } from "@/auth"
import { GameClient } from "@/components/game/GameClient"
import { redirect } from "next/navigation"

export default async function GamePage() {
    const session = await auth()
    if (!session?.user) {
        redirect("/")
    }

    const playerId = session.user.email ?? session.user.name ?? `guest-${crypto.randomUUID()}`
    // const playerId = `player-${crypto.randomUUID()}`
    const playerName = session.user.name ?? session.user.email ?? "Guest"

    return <GameClient player={{ player_id: playerId, name: playerName }} />
}

