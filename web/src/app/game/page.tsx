import { auth } from "@/auth"
import { JoinTableScreen } from "@/components/game/JoinTableScreen"
import { redirect } from "next/navigation"

export default async function GamePage() {
    const session = await auth()
    if (!session?.user) {
        redirect("/")
    }

    const playerId =
        session.user.email ?? session.user.name ?? `guest-${crypto.randomUUID()}`
    const defaultName = session.user.name ?? session.user.email ?? "Guest"
    const email = session.user.email ?? null

    return (
        <JoinTableScreen
            playerId={playerId}
            defaultName={defaultName}
            email={email}
        />
    )
}

