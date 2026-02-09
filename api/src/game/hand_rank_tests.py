from __future__ import annotations

import os
import sys
from typing import List, Tuple

_HERE = os.path.dirname(__file__)
_SRC_ROOT = os.path.dirname(_HERE)
if _SRC_ROOT not in sys.path:
    sys.path.append(_SRC_ROOT)

from game.manager import _best_hand_rank, _hand_rank_five  # noqa: E402


def _rank_five(cards: List[str]) -> Tuple[int, List[int]]:
    return _hand_rank_five(cards)


def _rank_best(cards: List[str]) -> Tuple[int, List[int]]:
    return _best_hand_rank(cards)


def _assert_equal(actual: Tuple[int, List[int]], expected: Tuple[int, List[int]]) -> None:
    if actual != expected:
        raise AssertionError(f"expected {expected}, got {actual}")


def run() -> None:
    _assert_equal(
        _rank_five(["A♠", "K♠", "Q♠", "J♠", "10♠"]),
        (8, [14]),
    )
    _assert_equal(
        _rank_five(["A♠", "2♠", "3♠", "4♠", "5♠"]),
        (8, [5]),
    )
    _assert_equal(
        _rank_five(["A♠", "A♥", "A♦", "A♣", "2♠"]),
        (7, [14, 2]),
    )
    _assert_equal(
        _rank_five(["K♠", "K♥", "K♦", "2♣", "2♦"]),
        (6, [13, 2]),
    )
    _assert_equal(
        _rank_five(["A♠", "J♠", "9♠", "6♠", "3♠"]),
        (5, [14, 11, 9, 6, 3]),
    )
    _assert_equal(
        _rank_five(["9♠", "8♥", "7♦", "6♣", "5♠"]),
        (4, [9]),
    )
    _assert_equal(
        _rank_five(["Q♠", "Q♥", "Q♦", "9♣", "2♠"]),
        (3, [12, 9, 2]),
    )
    _assert_equal(
        _rank_five(["A♠", "A♥", "9♦", "9♣", "3♠"]),
        (2, [14, 9, 3]),
    )
    _assert_equal(
        _rank_five(["J♠", "J♥", "10♦", "7♣", "3♠"]),
        (1, [11, 10, 7, 3]),
    )
    _assert_equal(
        _rank_five(["A♠", "J♥", "9♦", "6♣", "3♠"]),
        (0, [14, 11, 9, 6, 3]),
    )
    _assert_equal(
        _rank_best(["A♠", "2♠", "3♦", "4♣", "5♥", "K♠", "Q♣"]),
        (4, [5]),
    )
    _assert_equal(
        _rank_best(["A♠", "K♠", "Q♦", "J♣", "10♥", "2♠", "3♣"]),
        (4, [14]),
    )
    _assert_equal(
        _rank_best(["A♠", "A♥", "A♦", "K♣", "K♦", "2♠", "3♣"]),
        (6, [14, 13]),
    )


if __name__ == "__main__":
    run()
    print("hand_rank_tests: ok")
