import type { EarningsSummary } from "./types"

export const fetchEarningsSummary = async (
    apiUrl: string,
    email: string
): Promise<EarningsSummary> => {
    const response = await fetch(
        `${apiUrl}/earnings?email=${encodeURIComponent(email)}`,
        { cache: "no-store" }
    )
    if (!response.ok) {
        throw new Error(`Failed to load earnings (${response.status})`)
    }
    return response.json()
}
