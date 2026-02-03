// web/src/auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers: [
        Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }),
    ],
    callbacks: {
        // ログインが成功しようとした時に呼ばれる関数
        async signIn({ account }) {
            if (account?.provider === "google" && account.id_token) {
                try {
                    // FastAPIのログインエンドポイントを叩く
                    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/login/google`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            token: account.id_token, // Googleから届いたIDトークン
                        }),
                    });

                    if (response.ok) {
                        return true; // バックエンドも承認したので、ログイン成功！
                    } else {
                        console.error("Backend login failed");
                        return false; // バックエンドが拒否したので、ログイン失敗
                    }
                } catch (error) {
                    console.error("Error sending token to backend", error);
                    return false;
                }
            }
            return false;
        },
    },
})