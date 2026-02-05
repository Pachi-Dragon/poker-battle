import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { GameClient } from "@/components/game/GameClient"

export default async function GamePage() {
    const session = await auth()
    if (!session?.user) {
        redirect("/")
    }

    const playerId =
        session.user.email ?? session.user.name ?? `guest-${crypto.randomUUID()}`
    const playerName = session.user.name ?? session.user.email ?? "Guest"

    return <GameClient player={{ player_id: playerId, name: playerName }} />
}

