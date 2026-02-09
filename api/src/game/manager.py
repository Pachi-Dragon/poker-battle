from __future__ import annotations

import random
from itertools import combinations
from typing import Dict, List, Optional, Set, Tuple

from fastapi import WebSocket

from .models import ActionPayload, ActionRecord, ActionType, SeatState, Street, TableState


POSITIONS_6MAX = ["BTN", "SB", "BB", "UTG", "HJ", "CO"]

RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"]
SUITS = ["♠", "♥", "♦", "♣"]
RANK_VALUE = {rank: 14 - index for index, rank in enumerate(RANKS)}
RANK_ORDER = {rank: index for index, rank in enumerate(RANKS)}
SUIT_ORDER = {suit: index for index, suit in enumerate(SUITS)}


def _parse_card(card: str) -> Tuple[int, str]:
    rank = card[:-1]
    suit = card[-1]
    return RANK_VALUE[rank], suit


def _hand_rank_five(cards: List[str]) -> Tuple[int, List[int]]:
    ranks = []
    suits = []
    for card in cards:
        rank_value, suit = _parse_card(card)
        ranks.append(rank_value)
        suits.append(suit)
    rank_counts: Dict[int, int] = {}
    for rank_value in ranks:
        rank_counts[rank_value] = rank_counts.get(rank_value, 0) + 1
    counts = sorted(rank_counts.items(), key=lambda item: (-item[1], -item[0]))
    is_flush = len(set(suits)) == 1
    unique_ranks = sorted(set(ranks), reverse=True)
    is_wheel = unique_ranks == [14, 5, 4, 3, 2]
    is_straight = False
    straight_high = 0
    if len(unique_ranks) == 5:
        if is_wheel:
            is_straight = True
            straight_high = 5
        elif unique_ranks[0] - unique_ranks[-1] == 4:
            is_straight = True
            straight_high = unique_ranks[0]

    if is_straight and is_flush:
        return 8, [straight_high]
    if counts[0][1] == 4:
        four_rank = counts[0][0]
        kicker = counts[1][0]
        return 7, [four_rank, kicker]
    if counts[0][1] == 3 and counts[1][1] == 2:
        return 6, [counts[0][0], counts[1][0]]
    if is_flush:
        return 5, sorted(ranks, reverse=True)
    if is_straight:
        return 4, [straight_high]
    if counts[0][1] == 3:
        trips = counts[0][0]
        kickers = [rank for rank in sorted(ranks, reverse=True) if rank != trips]
        return 3, [trips] + kickers
    if counts[0][1] == 2 and counts[1][1] == 2:
        pair_high = max(counts[0][0], counts[1][0])
        pair_low = min(counts[0][0], counts[1][0])
        kicker = [
            rank
            for rank in sorted(ranks, reverse=True)
            if rank not in [pair_high, pair_low]
        ][0]
        return 2, [pair_high, pair_low, kicker]
    if counts[0][1] == 2:
        pair_rank = counts[0][0]
        kickers = [rank for rank in sorted(ranks, reverse=True) if rank != pair_rank]
        return 1, [pair_rank] + kickers
    return 0, sorted(ranks, reverse=True)


def _best_hand_rank(cards: List[str]) -> Tuple[int, List[int]]:
    best = (-1, [])
    for combo in combinations(cards, 5):
        rank = _hand_rank_five(list(combo))
        if rank > best:
            best = rank
    return best


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
        self.auto_topup_amount = 300
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
        self.hand_contribs: Dict[int, int] = {index: 0 for index in range(max_players)}
        self.folded_seats: Set[int] = set()
        self.all_in_seats: Set[int] = set()
        self.acted_seats: Set[int] = set()
        self.raise_blocked_seats: Set[int] = set()
        self.pending_leave_seats: Set[int] = set()
        self.leave_after_hand_seats: Set[int] = set()
        self.pending_join_seats: Set[int] = set()
        self.auto_play_seats: Set[int] = set()
        self.big_blind_seat: Optional[int] = None
        self.pending_payouts: Dict[int, int] = {}
        self.save_earnings = False

    def _seat_positions(self) -> Dict[int, str]:
        occupied = self._occupied_seat_indices()
        if len(occupied) == 2 and self.dealer_seat in occupied:
            positions = {self.dealer_seat: "BTN"}
            other_seat = occupied[0] if occupied[1] == self.dealer_seat else occupied[1]
            positions[other_seat] = "BB"
            return positions
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
            and seat.seat_index not in self.pending_join_seats
            and seat.seat_index not in self.folded_seats
            and not self._is_all_in_like(seat.seat_index)
        ]

    def _in_hand_seat_indices(self) -> List[int]:
        return [
            seat.seat_index
            for seat in self.seats
            if seat.player_id
            and seat.seat_index not in self.pending_join_seats
            and seat.seat_index not in self.folded_seats
        ]

    def _is_all_in_like(self, seat_index: int) -> bool:
        seat = self.seats[seat_index]
        return (
            seat_index in self.all_in_seats
            or seat.is_all_in
            or seat.stack == 0
        )

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
                and not self._is_all_in_like(seat_index)
            ):
                return seat_index
        return None

    def _reset_street_state(self) -> None:
        self.current_bet = 0
        self.min_raise = self.big_blind
        self.street_contribs = {index: 0 for index in range(self.max_players)}
        self.acted_seats = set()
        self.raise_blocked_seats = set()

    def _reset_hand_state(self) -> None:
        self.pot = 0
        self.board = []
        self.action_history = []
        self.folded_seats = set()
        self.all_in_seats = set()
        self.hand_contribs = {index: 0 for index in range(self.max_players)}
        self.big_blind_seat = None
        self._reset_street_state()

    def _clear_seat(self, seat: SeatState) -> None:
        self.auto_play_seats.discard(seat.seat_index)
        seat.player_id = None
        seat.name = None
        seat.stack = 0
        seat.last_action = None
        seat.hole_cards = None
        seat.is_ready = False
        seat.is_folded = False
        seat.is_all_in = False
        seat.street_commit = 0

    def apply_pending_payouts(self) -> None:
        if not self.pending_payouts:
            return
        for seat_index, amount in list(self.pending_payouts.items()):
            if amount <= 0:
                continue
            seat = self.seats[seat_index]
            if seat.player_id:
                seat.stack += amount
        self.pending_payouts.clear()
        for seat in self.seats:
            if seat.player_id and seat.stack == 0:
                seat.stack += self.auto_topup_amount
                self.action_history.append(
                    ActionRecord(
                        actor_id=seat.player_id,
                        actor_name=seat.name,
                        action="auto_topup",
                        amount=self.auto_topup_amount,
                        street=self.street,
                        detail="stack_empty",
                    )
                )

    def build_earnings_updates(self) -> List[Dict[str, int | str]]:
        updates: List[Dict[str, int | str]] = []
        for seat in self.seats:
            if not seat.player_id or not seat.hole_cards or len(seat.hole_cards) != 2:
                continue
            payout = self.pending_payouts.get(seat.seat_index, 0)
            contrib = self.hand_contribs.get(seat.seat_index, 0)
            delta = payout - contrib
            is_special = self._is_69_92_hand(seat.hole_cards)
            updates.append(
                {
                    "email": seat.player_id,
                    "hands": 1,
                    "chips_delta": delta,
                    "hands_69_92": 1 if is_special else 0,
                    "chips_delta_69_92": delta if is_special else 0,
                }
            )
        return updates

    @staticmethod
    def _is_69_92_hand(cards: List[str]) -> bool:
        if len(cards) != 2:
            return False
        ranks = {card[:-1] for card in cards}
        return ranks in ({"6", "9"}, {"9", "2"})

    def _finalize_pending_leaves(self) -> None:
        if not self.pending_leave_seats:
            return
        for seat_index in list(self.pending_leave_seats):
            seat = self.seats[seat_index]
            if seat.player_id:
                self._clear_seat(seat)
            self.pending_leave_seats.discard(seat_index)

    def _finalize_leave_after_hand(self) -> None:
        if not self.leave_after_hand_seats:
            return
        for seat_index in list(self.leave_after_hand_seats):
            seat = self.seats[seat_index]
            if seat.player_id:
                self._clear_seat(seat)
            self.leave_after_hand_seats.discard(seat_index)

    def _clear_pending_joins(self) -> None:
        if not self.pending_join_seats:
            return
        for seat_index in list(self.pending_join_seats):
            self.pending_join_seats.discard(seat_index)

    def find_seat(self, player_id: str) -> Optional[SeatState]:
        return self._find_seat(player_id)

    def _all_pending_leaves(self) -> bool:
        occupied = self._occupied_seat_indices()
        return bool(occupied) and all(
            seat_index in self.pending_leave_seats for seat_index in occupied
        )

    def _auto_play_pending_leaves(self) -> None:
        if not self._all_pending_leaves():
            return
        safety = 0
        while self.street in (Street.preflop, Street.flop, Street.turn, Street.river):
            if safety > 200:
                break
            if self._hand_over():
                self._advance_turn_or_street()
                break
            if self.current_turn_seat is None:
                self.current_turn_seat = self._next_active_seat(self.dealer_seat)
                if self.current_turn_seat is None:
                    self._advance_turn_or_street()
                    safety += 1
                    continue
            seat_index = self.current_turn_seat
            if seat_index in self.folded_seats or seat_index in self.all_in_seats:
                next_seat = self._next_active_seat(seat_index)
                if next_seat is None:
                    self._advance_turn_or_street()
                else:
                    self.current_turn_seat = next_seat
                safety += 1
                continue
            seat = self.seats[seat_index]
            if not seat.player_id:
                self.current_turn_seat = self._next_active_seat(seat_index)
                safety += 1
                continue
            player_commit = self.street_contribs.get(seat_index, 0)
            to_call = max(0, self.current_bet - player_commit)
            action = ActionType.check if to_call == 0 else ActionType.fold
            self.record_action(ActionPayload(player_id=seat.player_id, action=action))
            safety += 1

    def _build_deck(self) -> List[str]:
        deck = [f"{rank}{suit}" for suit in SUITS for rank in RANKS]
        random.shuffle(deck)
        return deck

    def _sort_hole_cards(self, cards: List[str]) -> List[str]:
        if len(cards) == 2:
            ranks = [card[:-1] for card in cards]
            if set(ranks) == {"6", "9"}:
                sixes = [card for card in cards if card[:-1] == "6"]
                nines = [card for card in cards if card[:-1] == "9"]
                return sixes + nines

        def sort_key(card: str) -> Tuple[int, int]:
            rank = card[:-1]
            suit = card[-1]
            return RANK_ORDER[rank], SUIT_ORDER[suit]

        return sorted(cards, key=sort_key)

    def _deal_hole_cards(self, deck: List[str]) -> None:
        for seat_index in self._occupied_seat_indices():
            cards = [deck.pop(), deck.pop()]
            self.seats[seat_index].hole_cards = self._sort_hole_cards(cards)

    def _deal_board(self, deck: List[str]) -> None:
        self.board = [deck.pop() for _ in range(5)]

    def _visible_board(self) -> List[str]:
        if self.street == Street.flop:
            return self.board[:3]
        if self.street == Street.turn:
            return self.board[:4]
        if self.street in (Street.river, Street.showdown, Street.settlement):
            return self.board[:5]
        return []

    def _dealer_order(self) -> List[int]:
        order = []
        for offset in range(self.max_players):
            seat_index = (self.dealer_seat + offset) % self.max_players
            order.append(seat_index)
        return order

    def _build_side_pots(self) -> List[Tuple[int, List[int]]]:
        contributions = {
            seat_index: amount
            for seat_index, amount in self.hand_contribs.items()
            if amount > 0
        }
        if not contributions:
            return []
        sorted_levels = sorted(set(contributions.values()))
        remaining = set(contributions.keys())
        pots: List[Tuple[int, List[int]]] = []
        previous = 0
        in_hand = set(self._in_hand_seat_indices())
        for level in sorted_levels:
            if not remaining:
                break
            pot_amount = (level - previous) * len(remaining)
            eligible = [seat for seat in remaining if seat in in_hand]
            pots.append((pot_amount, eligible))
            previous = level
            remaining = {seat for seat in remaining if contributions[seat] > level}
        return pots

    def _settle_pots(self) -> None:
        in_hand = self._in_hand_seat_indices()
        if len(in_hand) == 1:
            winner = in_hand[0]
            self.pending_payouts[winner] = self.pending_payouts.get(winner, 0) + self.pot
            self.action_history.append(
                ActionRecord(
                    actor_id=self.seats[winner].player_id,
                    actor_name=self.seats[winner].name,
                    action="payout",
                    amount=self.pot,
                    street=self.street,
                    detail="uncontested",
                )
            )
            self.pot = 0
            self.street = Street.settlement
            return

        ranks: Dict[int, Tuple[int, List[int]]] = {}
        for seat_index in in_hand:
            seat = self.seats[seat_index]
            if seat.hole_cards:
                ranks[seat_index] = _best_hand_rank(seat.hole_cards + self.board)
        positions = self._seat_positions()
        position_priority = {
            "SB": 0,
            "BB": 1,
            "UTG": 2,
            "HJ": 3,
            "CO": 4,
            "BTN": 5,
        }
        for amount, eligible in self._build_side_pots():
            if amount <= 0 or not eligible:
                continue
            best_rank = max(ranks[seat] for seat in eligible)
            winners = [seat for seat in eligible if ranks[seat] == best_rank]
            split = amount // len(winners)
            remainder = amount % len(winners)
            winners_sorted = sorted(
                winners,
                key=lambda seat: position_priority.get(positions.get(seat), 0),
            )
            for seat_index in winners_sorted:
                payout = split + (1 if remainder > 0 else 0)
                if remainder > 0:
                    remainder -= 1
                self.pending_payouts[seat_index] = (
                    self.pending_payouts.get(seat_index, 0) + payout
                )
                self.action_history.append(
                    ActionRecord(
                        actor_id=self.seats[seat_index].player_id,
                        actor_name=self.seats[seat_index].name,
                        action="payout",
                        amount=payout,
                        street=self.street,
                        detail="side_pot",
                    )
                )
        self.pot = 0
        self.street = Street.settlement

    def _find_seat(self, player_id: str) -> Optional[SeatState]:
        for seat in self.seats:
            if seat.player_id == player_id:
                return seat
        return None

    def join_player(self, player_id: str, name: str) -> SeatState:
        existing = self._find_seat(player_id)
        if existing:
            if existing.seat_index in self.pending_leave_seats:
                self.pending_leave_seats.discard(existing.seat_index)
            if existing.seat_index in self.leave_after_hand_seats:
                self.leave_after_hand_seats.discard(existing.seat_index)
            if name and existing.name != name:
                existing.name = name
            return existing  # type: ignore[return-value]

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

    def reserve_seat(self, player_id: str, name: str, seat_index: int) -> SeatState:
        if seat_index < 0 or seat_index >= self.max_players:
            raise ValueError("Invalid seat index")
        existing = self._find_seat(player_id)
        if existing and existing.seat_index != seat_index:
            raise ValueError("Player already seated")
        seat = self.seats[seat_index]
        if seat.player_id and seat.player_id != player_id:
            raise ValueError("Seat already occupied")
        if seat.player_id is None:
            seat.player_id = player_id
            seat.name = name
            seat.stack = self.buy_in
            seat.is_ready = False
            seat.is_folded = False
            seat.is_all_in = False
            seat.street_commit = 0
            seat.last_action = None
            seat.hole_cards = None
            self.action_history.append(
                ActionRecord(
                    actor_id=player_id,
                    actor_name=name,
                    action="reserve",
                    street=self.street,
                )
            )
        if self.street in (Street.preflop, Street.flop, Street.turn, Street.river):
            self.pending_join_seats.add(seat_index)
        return seat

    def leave_player(self, player_id: str) -> None:
        seat = self._find_seat(player_id)
        if not seat:
            return
        self.auto_play_seats.discard(seat.seat_index)
        in_active_hand = (
            seat.seat_index not in self.folded_seats
            and seat.seat_index not in self.pending_join_seats
            and seat.player_id
            and self.street
            in (Street.preflop, Street.flop, Street.turn, Street.river)
        )
        was_current_turn = self.current_turn_seat == seat.seat_index
        if in_active_hand:
            self.folded_seats.add(seat.seat_index)
            seat.is_folded = True
            seat.last_action = "fold"
            self._record_action(seat, "fold", detail="leave")
        self.action_history.append(
            ActionRecord(
                actor_id=player_id,
                actor_name=seat.name,
                action="leave",
                street=self.street,
            )
        )
        if in_active_hand:
            self.pending_leave_seats.add(seat.seat_index)
        else:
            self._clear_seat(seat)
        if in_active_hand:
            if was_current_turn or self._hand_over() or self._street_complete():
                self._advance_turn_or_street()
        self._auto_play_pending_leaves()

    def mark_leave_after_hand(self, player_id: str) -> None:
        seat = self._find_seat(player_id)
        if not seat:
            return
        if self.street == Street.waiting:
            self._clear_seat(seat)
            return
        self.leave_after_hand_seats.add(seat.seat_index)

    def cancel_leave_after_hand(self, player_id: str) -> None:
        seat = self._find_seat(player_id)
        if not seat:
            return
        if seat.seat_index in self.leave_after_hand_seats:
            self.leave_after_hand_seats.discard(seat.seat_index)

    def mark_ready(self, player_id: str) -> None:
        seat = self._find_seat(player_id)
        if seat:
            seat.is_ready = True

    def all_ready(self) -> bool:
        seated = [seat for seat in self.seats if seat.player_id]
        return bool(seated) and all(seat.is_ready for seat in seated)

    def start_new_hand(self) -> None:
        if self.auto_play_seats:
            for seat_index in list(self.auto_play_seats):
                seat = self.seats[seat_index]
                if seat.player_id:
                    self._clear_seat(seat)
        if len(self._occupied_seat_indices()) < 2:
            self.street = Street.waiting
            self.current_turn_seat = None
            self._reset_hand_state()
            for seat in self.seats:
                seat.last_action = None
                seat.hole_cards = None
                seat.is_ready = False
                seat.is_folded = False
                seat.is_all_in = False
                seat.street_commit = 0
            return
        next_dealer = self._next_occupied_seat(self.dealer_seat)
        if next_dealer is not None:
            self.dealer_seat = next_dealer
        self.apply_auto_cashout()
        self.hand_number += 1
        self.street = Street.preflop
        self._clear_pending_joins()
        self._reset_hand_state()
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
        deck = self._build_deck()
        self._deal_hole_cards(deck)
        self._deal_board(deck)
        self._post_blinds()
        self.apply_auto_play()

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
        self.auto_play_seats = set()
        self.street = Street.waiting
        self._reset_hand_state()
        self.pending_leave_seats = set()
        self.leave_after_hand_seats = set()
        self.pending_join_seats = set()
        self.pending_payouts = {}

    def _post_blinds(self) -> None:
        self.big_blind_seat = None
        occupied = self._occupied_seat_indices()
        if len(occupied) == 2:
            sb_index = self.dealer_seat
            if sb_index not in occupied:
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
            self.big_blind_seat = bb_index
            self.current_bet = max(self.street_contribs.values())
            self.min_raise = self.big_blind
            self.current_turn_seat = self._next_active_seat(bb_index)
            return
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
        self.big_blind_seat = bb_index

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
        self.hand_contribs[seat_index] += actual
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
        return

    def record_action(self, payload: ActionPayload, *, skip_auto_play: bool = False) -> None:
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
            self.hand_contribs[seat.seat_index] += call_amount
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
            self.hand_contribs[seat.seat_index] += bet_amount
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
            self.hand_contribs[seat.seat_index] += add_amount
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
            self.hand_contribs[seat.seat_index] += all_in_amount - player_commit
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
        if not skip_auto_play:
            self.apply_auto_play()

    def set_auto_play(self, player_id: str, enabled: bool) -> None:
        seat = self._find_seat(player_id)
        if not seat:
            return
        if enabled:
            self.auto_play_seats.add(seat.seat_index)
        else:
            self.auto_play_seats.discard(seat.seat_index)

    def apply_auto_play(self) -> None:
        safety = 0
        while True:
            if self.street not in (
                Street.preflop,
                Street.flop,
                Street.turn,
                Street.river,
            ):
                return
            if self.current_turn_seat is None:
                return
            if self.current_turn_seat not in self.auto_play_seats:
                return
            if safety > self.max_players * 4:
                return
            seat_index = self.current_turn_seat
            if seat_index in self.folded_seats or seat_index in self.all_in_seats:
                self._advance_turn_or_street()
                safety += 1
                continue
            seat = self.seats[seat_index]
            if not seat.player_id:
                self._advance_turn_or_street()
                safety += 1
                continue
            player_commit = self.street_contribs.get(seat_index, 0)
            to_call = max(0, self.current_bet - player_commit)
            action = ActionType.check if to_call == 0 else ActionType.fold
            self.record_action(
                ActionPayload(player_id=seat.player_id, action=action),
                skip_auto_play=True,
            )
            safety += 1

    def record_hand_reveal(self, player_id: str) -> bool:
        seat = self._find_seat(player_id)
        if not seat:
            return False
        if self.street != Street.settlement:
            return False
        if any(action.action == "showdown" for action in self.action_history):
            return False
        if any(
            action.action == "hand_reveal" and action.actor_id == player_id
            for action in self.action_history
        ):
            return False
        if not seat.hole_cards:
            return False
        self._record_action(seat, "hand_reveal")
        return True

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

    def should_auto_runout(self) -> bool:
        if self.street not in (Street.preflop, Street.flop, Street.turn, Street.river):
            return False
        if self._hand_over():
            return False
        if not self._street_complete():
            return False
        in_hand = self._in_hand_seat_indices()
        if not in_hand:
            return False
        active = [seat for seat in in_hand if not self._is_all_in_like(seat)]
        all_in_like = [seat for seat in in_hand if self._is_all_in_like(seat)]
        if not all_in_like:
            return False
        return len(active) <= 1

    def advance_auto_runout(self) -> bool:
        if not self.should_auto_runout():
            return False
        self._advance_street(auto_runout=True)
        return True

    def _street_complete(self) -> bool:
        active = self._active_seat_indices()
        if not active:
            return True
        if len(active) == 1:
            seat_index = active[0]
            player_commit = self.street_contribs.get(seat_index, 0)
            if self.current_bet == 0 or player_commit == self.current_bet:
                return True
        if self.current_bet == 0:
            return all(seat_index in self.acted_seats for seat_index in active)
        if (
            self.street == Street.preflop
            and self.current_bet == self.big_blind
            and self.big_blind_seat is not None
            and self.big_blind_seat in self._in_hand_seat_indices()
            and self.big_blind_seat not in self.all_in_seats
            and self.big_blind_seat not in self.acted_seats
        ):
            return False
        for seat_index in self._in_hand_seat_indices():
            if seat_index in self.all_in_seats:
                continue
            if self.street_contribs.get(seat_index, 0) != self.current_bet:
                return False
        return True

    def _refund_uncalled_bet(self) -> None:
        if self.current_bet == 0:
            return
        contributions = {
            seat_index: self.street_contribs.get(seat_index, 0)
            for seat_index in range(self.max_players)
            if self.seats[seat_index].player_id
        }
        if not contributions:
            return
        max_amount = max(contributions.values())
        if max_amount <= 0:
            return
        max_seats = [seat for seat, amount in contributions.items() if amount == max_amount]
        if len(max_seats) != 1:
            return
        second_max = max(
            (amount for amount in contributions.values() if amount != max_amount),
            default=0,
        )
        refund = max_amount - second_max
        if refund <= 0:
            return
        seat_index = max_seats[0]
        seat = self.seats[seat_index]
        seat.stack += refund
        self.pot -= refund
        self.hand_contribs[seat_index] = max(
            0, self.hand_contribs.get(seat_index, 0) - refund
        )
        self.street_contribs[seat_index] = max(
            0, self.street_contribs.get(seat_index, 0) - refund
        )
        seat.street_commit = self.street_contribs[seat_index]
        self.current_bet = max(self.street_contribs.values(), default=0)
        self.action_history.append(
            ActionRecord(
                actor_id=seat.player_id,
                actor_name=seat.name,
                action="refund",
                amount=refund,
                street=self.street,
                detail="uncalled",
            )
        )

    def _advance_turn_or_street(self) -> None:
        if self._hand_over():
            self._refund_uncalled_bet()
            self.street = Street.settlement
            self.current_turn_seat = None
            self.action_history.append(
                ActionRecord(action="hand_end", street=self.street)
            )
            self._settle_pots()
            return
        if self._street_complete():
            self._refund_uncalled_bet()
            if self.should_auto_runout():
                self._advance_street(auto_runout=True)
            else:
                self._advance_street()
            return
        next_seat = self._next_active_seat(self.current_turn_seat or 0)
        self.current_turn_seat = next_seat

    def _advance_street(self, *, auto_runout: bool = False) -> None:
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
            self._settle_pots()
            return
        else:
            self.street = Street.showdown
            self.current_turn_seat = None
            return
        self._reset_street_state()
        self.action_history.append(
            ActionRecord(action=f"street_{self.street}", street=self.street)
        )
        if auto_runout:
            self.current_turn_seat = None
        else:
            self.current_turn_seat = self._next_active_seat(
                self.dealer_seat
            )  # first to act postflop

    def to_state(self, connected_player_ids: Optional[Set[str]] = None) -> TableState:
        positions = self._seat_positions()
        seats = []
        connected = connected_player_ids or set()
        for seat in self.seats:
            is_connected = True
            if seat.player_id and connected_player_ids is not None:
                is_connected = seat.player_id in connected
            seats.append(
                SeatState(
                    seat_index=seat.seat_index,
                    player_id=seat.player_id,
                    name=seat.name,
                    stack=seat.stack,
                    position=positions.get(seat.seat_index),
                    last_action=seat.last_action,
                    hole_cards=seat.hole_cards,
                    is_connected=is_connected,
                    is_ready=seat.is_ready,
                    is_folded=seat.seat_index in self.folded_seats,
                    is_all_in=self._is_all_in_like(seat.seat_index),
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
            board=self._visible_board(),
            seats=seats,
            action_history=self.action_history,
            current_turn_seat=self.current_turn_seat,
            hand_number=self.hand_number,
            save_earnings=self.save_earnings,
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

    def has_player(self, player_id: str) -> bool:
        return player_id in self.socket_players.values()

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

