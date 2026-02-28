import { auth } from "@/auth"
import { JoinTableScreen } from "@/components/game/JoinTableScreen"
import { redirect } from "next/navigation"

export default async function GamePage() {
    const session = await auth()
    if (!session?.user) {
        redirect("/")
    }

    const email =
        session.user.email ?? session.user.name ?? `guest-${crypto.randomUUID()}`
    const defaultName = session.user.name ?? session.user.email ?? "Guest"

    return (
        <JoinTableScreen
            email={email}
            defaultName={defaultName}
        />
    )
}

