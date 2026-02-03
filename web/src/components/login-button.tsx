// web/src/components/login-button.tsx
import { signIn } from "@/auth"

export function SignIn() {
    return (
        <form
            action={async () => {
                "use server"
                await signIn("google")
            }}
        >
            <button className="bg-slate-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-slate-700 transition-all">
                Googleでログインしてプレイ
            </button>
        </form>
    )
}