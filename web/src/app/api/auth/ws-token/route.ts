import { auth } from "@/auth"
import { SignJWT } from "jose"
import { NextResponse } from "next/server"

const TOKEN_EXPIRY_SECONDS = 300 // 5 minutes

export async function GET() {
    const session = await auth()
    const email = session?.user?.email

    if (!email) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        )
    }

    const secret = process.env.AUTH_SECRET
    if (!secret) {
        console.error("AUTH_SECRET is not configured")
        return NextResponse.json(
            { error: "Server configuration error" },
            { status: 500 }
        )
    }

    const token = await new SignJWT({ sub: email })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${TOKEN_EXPIRY_SECONDS}s`)
        .sign(new TextEncoder().encode(secret))

    return NextResponse.json({ token })
}
