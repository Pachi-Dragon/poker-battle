import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
    title: "Poker Battle",
    description: "Poker Battle Online",
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="ja">
            <body>{children}</body>
        </html>
    )
}
