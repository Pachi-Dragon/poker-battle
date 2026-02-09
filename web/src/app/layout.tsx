import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
    title: "Dragons Poker Online",
    description: "Dragons Poker Online",
    applicationName: "Dragons Poker Online",
    manifest: "/manifest.json",
    appleWebApp: {
        capable: true,
        title: "Dragons Poker Online",
        statusBarStyle: "default",
    },
    formatDetection: {
        telephone: false,
    },
    icons: {
        icon: [
            { url: "/favicon.ico" },
            { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
        apple: [
            { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
    },
}

export const viewport: Viewport = {
    themeColor: "#0b0f1a",
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="ja">
            <head>
                <link rel="manifest" href="/manifest.json" />
                <meta name="theme-color" content="#0b0f1a" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="default" />
                <meta name="apple-mobile-web-app-title" content="Dragons Poker Online" />
                <meta name="format-detection" content="telephone=no" />
                <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
            </head>
            <body>{children}</body>
        </html>
    )
}
