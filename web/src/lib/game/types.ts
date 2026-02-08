export type Street =
    | "waiting"
    | "preflop"
    | "flop"
    | "turn"
    | "river"
    | "showdown"
    | "settlement"

export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in"

export interface SeatState {
    seat_index: number
    player_id?: string | null
    name?: string | null
    stack: number
    position?: string | null
    last_action?: string | null
    last_action_amount?: number | null
    hole_cards?: string[] | null
    is_ready: boolean
    is_folded: boolean
    is_all_in: boolean
    street_commit: number
    raise_blocked: boolean
}

export interface ActionRecord {
    actor_id?: string | null
    actor_name?: string | null
    action: string
    amount?: number | null
    street: Street
    detail?: string | null
}

export interface TableState {
    table_id: string
    small_blind: number
    big_blind: number
    max_players: number
    dealer_seat: number
    street: Street
    pot: number
    current_bet: number
    min_raise: number
    board: string[]
    seats: SeatState[]
    action_history: ActionRecord[]
    current_turn_seat?: number | null
    hand_number: number
}

export interface JoinTablePayload {
    player_id: string
    name: string
}

export interface ActionPayload {
    player_id: string
    action: ActionType
    amount?: number
}

export interface ReserveSeatPayload {
    player_id: string
    name: string
    seat_index: number
}

export interface GameMessage<T = unknown> {
    type: string
    payload?: T
}

