from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Dict, Iterable, List, TypedDict


class EarningsUpdate(TypedDict):
    email: str
    hands: int
    chips_delta: int
    hands_69_92: int
    chips_delta_69_92: int


DEFAULT_STATS = {
    "hands": 0,
    "chips_delta": 0,
    "hands_69_92": 0,
    "chips_delta_69_92": 0,
}


def _is_cloud_run() -> bool:
    return bool(os.getenv("K_SERVICE") or os.getenv("K_REVISION"))


@dataclass
class EarningsStore:
    local_path: str | None = None

    def __post_init__(self) -> None:
        self._lock = asyncio.Lock()
        self._use_firestore = _is_cloud_run()
        self._local_path = self.local_path or os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "data", "earnings.json")
        )
        self._firestore_client = None
        if self._use_firestore:
            from google.cloud import firestore

            self._firestore = firestore
            # デフォルトは "(default)"。別名で作成したDBは FIRESTORE_DATABASE で指定
            database_id = os.getenv("FIRESTORE_DATABASE", "dragonspoker-game")
            self._firestore_client = firestore.Client(database=database_id)

    async def get(self, email: str) -> Dict[str, int]:
        if self._use_firestore:
            return await asyncio.to_thread(self._get_firestore, email)
        async with self._lock:
            return await asyncio.to_thread(self._get_local, email)

    async def apply_updates(self, updates: Iterable[EarningsUpdate]) -> None:
        updates_list = [u for u in updates if u.get("email")]
        if not updates_list:
            return
        if self._use_firestore:
            await asyncio.to_thread(self._apply_updates_firestore, updates_list)
            return
        async with self._lock:
            await asyncio.to_thread(self._apply_updates_local, updates_list)

    def _get_local(self, email: str) -> Dict[str, int]:
        data = self._read_local_data()
        users = data.get("users", {})
        stats = users.get(email, {})
        return {
            "hands": int(stats.get("hands", 0)),
            "chips_delta": int(stats.get("chips_delta", 0)),
            "hands_69_92": int(stats.get("hands_69_92", 0)),
            "chips_delta_69_92": int(stats.get("chips_delta_69_92", 0)),
        }

    def _apply_updates_local(self, updates: List[EarningsUpdate]) -> None:
        data = self._read_local_data()
        users = data.setdefault("users", {})
        for update in updates:
            email = update["email"]
            stats = users.setdefault(email, dict(DEFAULT_STATS))
            stats["hands"] = int(stats.get("hands", 0)) + int(update["hands"])
            stats["chips_delta"] = int(stats.get("chips_delta", 0)) + int(
                update["chips_delta"]
            )
            stats["hands_69_92"] = int(stats.get("hands_69_92", 0)) + int(
                update["hands_69_92"]
            )
            stats["chips_delta_69_92"] = int(stats.get("chips_delta_69_92", 0)) + int(
                update["chips_delta_69_92"]
            )
        self._write_local_data(data)

    def _read_local_data(self) -> Dict:
        if not os.path.exists(self._local_path):
            return {"users": {}}
        try:
            with open(self._local_path, "r", encoding="utf-8") as handle:
                return json.load(handle) or {"users": {}}
        except (OSError, json.JSONDecodeError):
            return {"users": {}}

    def _write_local_data(self, data: Dict) -> None:
        os.makedirs(os.path.dirname(self._local_path), exist_ok=True)
        with open(self._local_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)

    def _get_firestore(self, email: str) -> Dict[str, int]:
        assert self._firestore_client is not None
        doc = (
            self._firestore_client.collection("earnings").document(email).get()
        )
        if not doc.exists:
            return dict(DEFAULT_STATS)
        data = doc.to_dict() or {}
        return {
            "hands": int(data.get("hands", 0)),
            "chips_delta": int(data.get("chips_delta", 0)),
            "hands_69_92": int(data.get("hands_69_92", 0)),
            "chips_delta_69_92": int(data.get("chips_delta_69_92", 0)),
        }

    def _apply_updates_firestore(self, updates: List[EarningsUpdate]) -> None:
        assert self._firestore_client is not None
        batch = self._firestore_client.batch()
        for update in updates:
            doc = self._firestore_client.collection("earnings").document(
                update["email"]
            )
            batch.set(
                doc,
                {
                    "hands": self._firestore.Increment(update["hands"]),
                    "chips_delta": self._firestore.Increment(update["chips_delta"]),
                    "hands_69_92": self._firestore.Increment(update["hands_69_92"]),
                    "chips_delta_69_92": self._firestore.Increment(
                        update["chips_delta_69_92"]
                    ),
                    "updated_at": self._firestore.SERVER_TIMESTAMP,
                },
                merge=True,
            )
        batch.commit()
