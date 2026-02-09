from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any, Iterable, List


def _is_cloud_run() -> bool:
    return bool(os.getenv("K_SERVICE") or os.getenv("K_REVISION"))


def _extract_emails(payload: Any) -> List[str]:
    if isinstance(payload, list):
        return [str(item) for item in payload]
    if isinstance(payload, dict):
        emails = payload.get("emails", [])
        if isinstance(emails, list):
            return [str(item) for item in emails]
    return []


@dataclass
class AllowListStore:
    local_path: str | None = None

    def __post_init__(self) -> None:
        self._use_firestore = _is_cloud_run()
        self._local_path = self.local_path or os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "data", "allows.json")
        )
        self._firestore_client = None
        if self._use_firestore:
            from google.cloud import firestore

            # デフォルトは "(default)"。別名で作成したDBは FIRESTORE_DATABASE で指定
            database_id = os.getenv("FIRESTORE_DATABASE", "dragonspoker-game")
            self._firestore_client = firestore.Client(database=database_id)

    async def get_allowed_emails(self) -> set[str]:
        if self._use_firestore:
            emails = await asyncio.to_thread(self._get_firestore_emails)
        else:
            emails = await asyncio.to_thread(self._get_local_emails)
        return {email.strip().lower() for email in emails if email and email.strip()}

    def _get_local_emails(self) -> List[str]:
        if not os.path.exists(self._local_path):
            return []
        try:
            with open(self._local_path, "r", encoding="utf-8") as handle:
                return _extract_emails(json.load(handle))
        except (OSError, json.JSONDecodeError):
            return []

    def _get_firestore_emails(self) -> List[str]:
        assert self._firestore_client is not None
        doc = self._firestore_client.collection("allows").document("allowlist").get()
        if not doc.exists:
            return []
        return _extract_emails(doc.to_dict() or {})
