from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class Street(str, Enum):
    waiting = "waiting"
    preflop = "preflop"
    flop = "flop"
    turn = "turn"
    river = "river"
    showdown = "showdown"
    settlement = "settlement"


class ActionType(str, Enum):
    fold = "fold"
    check = "check"
    call = "call"
    bet = "bet"
    raise_ = "raise"
    all_in = "all-in"


class PlayerInfo(BaseModel):
    player_id: str
    name: str


class SeatState(BaseModel):
    seat_index: int
    player_id: Optional[str] = None
    name: Optional[str] = None
    stack: int = 0
    # Stack snapshot at the start of the current hand (before forced blinds/bets).
    # Used for "manual topup" eligibility checks.
    hand_start_stack: Optional[int] = None
    position: Optional[str] = None
    last_action: Optional[str] = None
    hole_cards: Optional[List[str]] = None
    is_connected: bool = True
    is_ready: bool = False
    is_folded: bool = False
    is_all_in: bool = False
    street_commit: int = 0
    raise_blocked: bool = False


class ActionRecord(BaseModel):
    actor_id: Optional[str] = None
    actor_name: Optional[str] = None
    action: str
    amount: Optional[int] = None
    street: Street
    detail: Optional[str] = None


class TableState(BaseModel):
    table_id: str
    small_blind: int
    big_blind: int
    max_players: int
    dealer_seat: int
    street: Street
    pot: int
    # Pot breakdown excluding the current street's in-progress contributions.
    # Format: [main_pot, side_pot_1, side_pot_2, ...]
    pot_breakdown_excl_current_street: List[int] = Field(default_factory=list)
    current_bet: int
    min_raise: int
    board: List[str] = Field(default_factory=list)
    seats: List[SeatState] = Field(default_factory=list)
    action_history: List[ActionRecord] = Field(default_factory=list)
    current_turn_seat: Optional[int] = None
    hand_number: int = 0
    save_earnings: bool = False


class JoinTablePayload(BaseModel):
    player_id: str
    name: str


class ActionPayload(BaseModel):
    player_id: str
    action: ActionType
    amount: Optional[int] = None


class ReserveSeatPayload(BaseModel):
    player_id: str
    name: str
    seat_index: int


class RevealHandPayload(BaseModel):
    player_id: str

