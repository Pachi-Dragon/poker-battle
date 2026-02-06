from __future__ import annotations

from typing import Dict, List, Optional, Set

from fastapi import WebSocket

from .models import ActionPayload, ActionRecord, ActionType, SeatState, Street, TableState


POSITIONS_6MAX = ["BTN", "SB", "BB", "UTG", "HJ", "CO"]


class GameTable:
    def __init__(
        self,
        table_id: str,
        small_blind: int = 1,
        big_blind: int = 3,
        max_players: int = 6,
        buy_in_bb: int = 100,
        cashout_threshold_bb: int = 200,
        cashout_amount_bb: int = 100,
    ) -> None:
        self.table_id = table_id
        self.small_blind = small_blind
        self.big_blind = big_blind
        self.max_players = max_players
        self.buy_in = buy_in_bb * big_blind
        self.cashout_threshold = cashout_threshold_bb * big_blind
        self.cashout_amount = cashout_amount_bb * big_blind
        self.seats: List[SeatState] = [
            SeatState(seat_index=index) for index in range(max_players)
        ]
        self.street = Street.waiting
        self.pot = 0
        self.board: List[str] = []
        self.action_history: List[ActionRecord] = []
        self.dealer_seat = 0
        self.current_turn_seat: Optional[int] = None
        self.hand_number = 0
        self.current_bet = 0
        self.min_raise = self.big_blind
        self.street_contribs: Dict[int, int] = {index: 0 for index in range(max_players)}
        self.folded_seats: Set[int] = set()
        self.all_in_seats: Set[int] = set()
        self.acted_seats: Set[int] = set()
        self.raise_blocked_seats: Set[int] = set()

    def _seat_positions(self) -> Dict[int, str]:
        positions = {}
        for offset in range(self.max_players):
            seat_index = (self.dealer_seat + offset) % self.max_players
            positions[seat_index] = POSITIONS_6MAX[offset]
        return positions

    def _occupied_seat_indices(self) -> List[int]:
        return [seat.seat_index for seat in self.seats if seat.player_id]

    def _active_seat_indices(self) -> List[int]:
        return [
            seat.seat_index
            for seat in self.seats
            if seat.player_id
            and seat.seat_index not in self.folded_seats
            and seat.seat_index not in self.all_in_seats
        ]

    def _in_hand_seat_indices(self) -> List[int]:
        return [
            seat.seat_index
            for seat in self.seats
            if seat.player_id and seat.seat_index not in self.folded_seats
        ]

    def _next_occupied_seat(self, start_index: int) -> Optional[int]:
        for offset in range(1, self.max_players + 1):
            seat_index = (start_index + offset) % self.max_players
            if self.seats[seat_index].player_id:
                return seat_index
        return None

    def _next_active_seat(self, start_index: int) -> Optional[int]:
        for offset in range(1, self.max_players + 1):
            seat_index = (start_index + offset) % self.max_players
            if (
                self.seats[seat_index].player_id
                and seat_index not in self.folded_seats
                and seat_index not in self.all_in_seats
            ):
                return seat_index
        return None

    def _reset_street_state(self) -> None:
        self.current_bet = 0
        self.min_raise = self.big_blind
        self.street_contribs = {index: 0 for index in range(self.max_players)}
        self.acted_seats = set()
        self.raise_blocked_seats = set()

    def _find_seat(self, player_id: str) -> Optional[SeatState]:
        for seat in self.seats:
            if seat.player_id == player_id:
                return seat
        return None

    def join_player(self, player_id: str, name: str) -> SeatState:
        if self._find_seat(player_id):
            return self._find_seat(player_id)  # type: ignore[return-value]

        for seat in self.seats:
            if seat.player_id is None:
                seat.player_id = player_id
                seat.name = name
                seat.stack = self.buy_in
                seat.is_ready = False
                seat.is_folded = False
                seat.is_all_in = False
                seat.street_commit = 0
                self.action_history.append(
                    ActionRecord(
                        actor_id=player_id,
                        actor_name=name,
                        action="join",
                        street=self.street,
                    )
                )
                return seat
        raise ValueError("Table is full")

    def leave_player(self, player_id: str) -> None:
        seat = self._find_seat(player_id)
        if not seat:
            return
        self.action_history.append(
            ActionRecord(
                actor_id=player_id,
                actor_name=seat.name,
                action="leave",
                street=self.street,
            )
        )
        seat.player_id = None
        seat.name = None
        seat.stack = 0
        seat.last_action = None
        seat.hole_cards = None
        seat.is_ready = False
        seat.is_folded = False
        seat.is_all_in = False
        seat.street_commit = 0

    def mark_ready(self, player_id: str) -> None:
        seat = self._find_seat(player_id)
        if seat:
            seat.is_ready = True

    def all_ready(self) -> bool:
        seated = [seat for seat in self.seats if seat.player_id]
        return bool(seated) and all(seat.is_ready for seat in seated)

    def start_new_hand(self) -> None:
        if len(self._occupied_seat_indices()) < 2:
            self.street = Street.waiting
            self.current_turn_seat = None
            return
        next_dealer = self._next_occupied_seat(self.dealer_seat)
        if next_dealer is not None:
            self.dealer_seat = next_dealer
        self.apply_auto_cashout()
        self.hand_number += 1
        self.street = Street.preflop
        self.pot = 0
        self.board = []
        self.action_history = []
        self.folded_seats = set()
        self.all_in_seats = set()
        self._reset_street_state()
        for seat in self.seats:
            seat.last_action = None
            seat.hole_cards = None
            seat.is_ready = False
            seat.is_folded = False
            seat.is_all_in = False
            seat.street_commit = 0
        self.action_history.append(
            ActionRecord(
                action="hand_start",
                street=self.street,
                detail=f"hand:{self.hand_number}",
            )
        )
        self._post_blinds()

    def reset(self) -> None:
        for seat in self.seats:
            seat.stack = self.buy_in
            seat.last_action = None
            seat.hole_cards = None
            seat.is_ready = False
            seat.is_folded = False
            seat.is_all_in = False
            seat.street_commit = 0
            seat.raise_blocked = False
        self.street = Street.waiting
        self.pot = 0
        self.board = []
        self.action_history = []
        self.folded_seats = set()
        self.all_in_seats = set()
        self._reset_street_state()

    def _post_blinds(self) -> None:
        sb_index = self._next_occupied_seat(self.dealer_seat)
        if sb_index is None:
            self.current_turn_seat = None
            return
        bb_index = self._next_occupied_seat(sb_index)
        if bb_index is None:
            self.current_turn_seat = None
            return

        self._post_blind(sb_index, self.small_blind, "post_sb")
        self._post_blind(bb_index, self.big_blind, "post_bb")

        self.current_bet = max(self.street_contribs.values())
        self.min_raise = self.big_blind
        self.current_turn_seat = self._next_active_seat(bb_index)

    def _post_blind(self, seat_index: int, amount: int, action: str) -> None:
        seat = self.seats[seat_index]
        actual = min(amount, seat.stack)
        seat.stack -= actual
        if seat.stack == 0:
            self.all_in_seats.add(seat_index)
            seat.is_all_in = True
        self.pot += actual
        self.street_contribs[seat_index] += actual
        seat.street_commit = self.street_contribs[seat_index]
        self.action_history.append(
            ActionRecord(
                actor_id=seat.player_id,
                actor_name=seat.name,
                action=action,
                amount=actual,
                street=self.street,
            )
        )

    def apply_auto_cashout(self) -> None:
        for seat in self.seats:
            if seat.player_id and seat.stack >= self.cashout_threshold:
                seat.stack -= self.cashout_amount
                self.action_history.append(
                    ActionRecord(
                        actor_id=seat.player_id,
                        actor_name=seat.name,
                        action="auto_cashout",
                        amount=self.cashout_amount,
                        street=self.street,
                        detail="stack_over_threshold",
                    )
                )

    def record_action(self, payload: ActionPayload) -> None:
        seat = self._find_seat(payload.player_id)
        if not seat:
            raise ValueError("Player not seated")
        if seat.seat_index != self.current_turn_seat:
            raise ValueError("Not your turn")
        if seat.seat_index in self.folded_seats:
            raise ValueError("Player folded")
        if seat.seat_index in self.all_in_seats:
            raise ValueError("Player all-in")

        player_commit = self.street_contribs.get(seat.seat_index, 0)
        to_call = max(0, self.current_bet - player_commit)
        amount = payload.amount or 0
        action = payload.action
        
        if action == ActionType.fold:
            self.folded_seats.add(seat.seat_index)
            seat.is_folded = True
            seat.last_action = "fold"
            self.acted_seats.add(seat.seat_index)
            self._record_action(seat, "fold")
        elif action == ActionType.check:
            if to_call != 0:
                raise ValueError("Cannot check when facing a bet")
            seat.last_action = "check"
            self.acted_seats.add(seat.seat_index)
            self._record_action(seat, "check")
        elif action == ActionType.call:
            if to_call == 0:
                raise ValueError("Nothing to call")
            # stackが少ない場合はstack分
            call_amount = min(to_call, seat.stack)
            if call_amount <= 0:
                raise ValueError("Insufficient stack")
            # 既にベット済みの分はstackから引かず、未払い分だけ引く
            seat.stack -= call_amount
            self.pot += call_amount
            # table上の表示(commit)は実際のto_call分を表示する
            self.street_contribs[seat.seat_index] = player_commit + call_amount
            seat.street_commit = self.current_bet  # 画面上は(current_bet)を表示
            if call_amount < to_call or seat.stack == 0:
                self.all_in_seats.add(seat.seat_index)
                seat.is_all_in = True
            seat.last_action = "call"
            self.acted_seats.add(seat.seat_index)
            self._record_action(seat, "call", self.street_contribs[seat.seat_index])
        elif action == ActionType.bet:
            if self.current_bet != 0:
                raise ValueError("Cannot bet when there is a bet already")
            if amount <= 0:
                raise ValueError("Bet amount required")
            bet_amount = min(amount, seat.stack)
            seat.stack -= bet_amount
            self.pot += bet_amount
            self.street_contribs[seat.seat_index] += bet_amount
            seat.street_commit = self.street_contribs[seat.seat_index]
            if seat.stack == 0:
                self.all_in_seats.add(seat.seat_index)
                seat.is_all_in = True
            self.current_bet = self.street_contribs[seat.seat_index]
            self.min_raise = max(self.big_blind, self.current_bet)
            self.raise_blocked_seats = set()
            self.acted_seats = {seat.seat_index}
            seat.last_action = "bet"
            self._record_action(seat, "bet", bet_amount)
        elif action == ActionType.raise_:
            if self.current_bet == 0:
                raise ValueError("Cannot raise without a bet")
            if seat.seat_index in self.raise_blocked_seats:
                raise ValueError("Raise not reopened")
            if amount <= self.current_bet:
                raise ValueError("Raise amount too small")
            new_total = amount
            add_amount = new_total - player_commit
            if add_amount > seat.stack:
                raise ValueError("Insufficient stack")
            previous_bet = self.current_bet
            required_total = previous_bet + self.min_raise
            prior_acted = set(self.acted_seats)
            if new_total < required_total and add_amount != seat.stack:
                raise ValueError("Raise below minimum")
            seat.stack -= add_amount
            self.pot += add_amount
            self.street_contribs[seat.seat_index] = new_total
            seat.street_commit = new_total
            if seat.stack == 0:
                self.all_in_seats.add(seat.seat_index)
                seat.is_all_in = True
            is_full_raise = new_total >= required_total
            self.current_bet = new_total
            if is_full_raise:
                self.min_raise = new_total - previous_bet
                self.raise_blocked_seats = set()
            else:
                self.raise_blocked_seats = prior_acted
            self.acted_seats = {seat.seat_index}
            seat.last_action = "raise"
            self._record_action(
                seat,
                "raise",
                self.street_contribs[seat.seat_index],
                detail="full" if is_full_raise else "short",
            )
        elif action == ActionType.all_in:
            if seat.stack == 0:
                raise ValueError("Player has no stack")
            all_in_amount = seat.stack + player_commit
            seat.stack = 0
            previous_bet = self.current_bet
            required_total = previous_bet + self.min_raise
            prior_acted = set(self.acted_seats)
            self.pot += all_in_amount - player_commit 
            self.street_contribs[seat.seat_index] = all_in_amount
            self.all_in_seats.add(seat.seat_index)
            self.current_bet = max(self.current_bet, all_in_amount)
            seat.is_all_in = True
            seat.street_commit = self.street_contribs[seat.seat_index]
            

            
            is_full_raise = all_in_amount >= required_total
            if is_full_raise:
                self.min_raise = all_in_amount - previous_bet
                self.raise_blocked_seats = set()
            else:
                self.raise_blocked_seats = prior_acted
            self.acted_seats = {seat.seat_index}
            seat.last_action = "all-in"
            self._record_action(
                seat,
                "all-in",
                all_in_amount,
                detail="full" if is_full_raise else "short",
            )
        else:
            raise ValueError("Unknown action")

        self._advance_turn_or_street()

    def _record_action(
        self, seat: SeatState, action: str, amount: Optional[int] = None, detail: Optional[str] = None
    ) -> None:
        self.action_history.append(
            ActionRecord(
                actor_id=seat.player_id,
                actor_name=seat.name,
                action=action,
                amount=amount,
                street=self.street,
                detail=detail,
            )
        )

    def _hand_over(self) -> bool:
        return len(self._in_hand_seat_indices()) <= 1

    def _street_complete(self) -> bool:
        active = self._active_seat_indices()
        if not active:
            return True
        if self.current_bet == 0:
            return all(seat_index in self.acted_seats for seat_index in active)
        for seat_index in self._in_hand_seat_indices():
            if seat_index in self.all_in_seats:
                continue
            if self.street_contribs.get(seat_index, 0) != self.current_bet:
                return False
        return True

    def _advance_turn_or_street(self) -> None:
        if self._hand_over():
            self.street = Street.settlement
            self.current_turn_seat = None
            self.action_history.append(
                ActionRecord(action="hand_end", street=self.street)
            )
            return
        if self._street_complete():
            self._advance_street()
            return
        next_seat = self._next_active_seat(self.current_turn_seat or 0)
        self.current_turn_seat = next_seat

    def _advance_street(self) -> None:
        if self.street == Street.preflop:
            self.street = Street.flop
        elif self.street == Street.flop:
            self.street = Street.turn
        elif self.street == Street.turn:
            self.street = Street.river
        elif self.street == Street.river:
            self.street = Street.showdown
            self.current_turn_seat = None
            self.action_history.append(
                ActionRecord(action="showdown", street=self.street)
            )
            return
        else:
            self.street = Street.showdown
            self.current_turn_seat = None
            return
        self._reset_street_state()
        self.action_history.append(
            ActionRecord(action=f"street_{self.street}", street=self.street)
        )
        self.current_turn_seat = self._next_active_seat(self.dealer_seat)  # first to act postflop

    def to_state(self) -> TableState:
        positions = self._seat_positions()
        seats = []
        for seat in self.seats:
            seats.append(
                SeatState(
                    seat_index=seat.seat_index,
                    player_id=seat.player_id,
                    name=seat.name,
                    stack=seat.stack,
                    position=positions.get(seat.seat_index),
                    last_action=seat.last_action,
                    hole_cards=seat.hole_cards,
                    is_ready=seat.is_ready,
                    is_folded=seat.seat_index in self.folded_seats,
                    is_all_in=seat.seat_index in self.all_in_seats,
                    street_commit=self.street_contribs.get(seat.seat_index, 0),
                    raise_blocked=seat.seat_index in self.raise_blocked_seats,
                )
            )
        return TableState(
            table_id=self.table_id,
            small_blind=self.small_blind,
            big_blind=self.big_blind,
            max_players=self.max_players,
            dealer_seat=self.dealer_seat,
            street=self.street,
            pot=self.pot,
            current_bet=self.current_bet,
            min_raise=self.min_raise,
            board=self.board,
            seats=seats,
            action_history=self.action_history,
            current_turn_seat=self.current_turn_seat,
            hand_number=self.hand_number,
        )


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.socket_players: Dict[WebSocket, str] = {}
        self.socket_tables: Dict[WebSocket, str] = {}

    async def connect(self, table_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.setdefault(table_id, set()).add(websocket)
        self.socket_tables[websocket] = table_id

    def set_player(self, websocket: WebSocket, player_id: str) -> None:
        self.socket_players[websocket] = player_id

    def get_player(self, websocket: WebSocket) -> Optional[str]:
        return self.socket_players.get(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        table_id = self.socket_tables.get(websocket)
        if table_id and table_id in self.active_connections:
            self.active_connections[table_id].discard(websocket)
        self.socket_players.pop(websocket, None)
        self.socket_tables.pop(websocket, None)

    async def broadcast(self, table_id: str, message: dict) -> None:
        for connection in list(self.active_connections.get(table_id, set())):
            try:
                await connection.send_json(message)
            except Exception:
                pass

    async def send(self, websocket: WebSocket, message: dict) -> None:
        await websocket.send_json(message)

