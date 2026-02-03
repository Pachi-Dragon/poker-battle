// web/src/app/page.tsx
import { auth } from "@/auth"
import { SignIn } from "@/components/login-button"

export default async function Home() {
    const session = await auth()

    return (
        <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-green-900">
            <h1 className="text-4xl font-bold text-white mb-8">Poker Battle Online</h1>

            {!session ? (
                <div className="bg-white p-8 rounded-2xl shadow-2xl text-center">
                    <p className="text-slate-600 mb-6">友達とポーカーを始めよう</p>
                    <SignIn />
                </div>
            ) : (
                <div className="bg-white p-8 rounded-2xl shadow-2xl text-center">
                    <p className="text-xl font-bold text-slate-800 mb-2">
                        おかえりなさい、{session.user?.name}さん！
                    </p>
                    <p className="text-slate-500 mb-4">{session.user?.email}</p>
                    <button className="bg-red-600 text-white px-4 py-2 rounded">
                        ゲームを開始する（準備中）
                    </button>
                </div>
            )}
        </main>
    )
}