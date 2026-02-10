// web/src/app/page.tsx
// 画面1: ログインボタンがある画面（未ログイン時のみ）
import { auth } from "@/auth"
import { SignIn } from "@/components/login-button"
import { redirect } from "next/navigation"

export default async function Home() {
    const session = await auth()
    if (session?.user) {
        redirect("/game")
    }

    return (
        <main className="flex flex-1 min-h-0 flex-col items-center justify-center p-24 bg-green-900">
            <h1 className="text-[clamp(0.9rem,5vw,1.5rem)] font-bold text-white mb-8 whitespace-nowrap overflow-hidden text-ellipsis max-w-[100vw]">
                Dragons Poker Online
            </h1>
            <div className="bg-white p-8 rounded-2xl shadow-2xl text-center">
                <p className="text-slate-600 mb-6">友達とポーカーを始めよう</p>
                <SignIn />
            </div>
        </main>
    )
}