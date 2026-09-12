"""Commission service — configurable platform commission.

Precedence (most specific wins):
    PROVIDER  →  SERVICE  →  CATEGORY  →  GLOBAL  →  hardcoded default
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorDatabase
from . import constants as C
from .types import CommissionScope


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CommissionService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db

    async def resolve(
        self,
        *,
        provider_id: Optional[str] = None,
        service_id: Optional[str] = None,
        category_id: Optional[str] = None,
    ) -> tuple[float, int]:
        """Return (percent, fixed_paise) for the most specific active config, else defaults."""
        query_order: list[tuple[str, Optional[str]]] = [
            (CommissionScope.PROVIDER.value, provider_id),
            (CommissionScope.SERVICE.value, service_id),
            (CommissionScope.CATEGORY.value, category_id),
        ]
        for scope, sid in query_order:
            if not sid:
                continue
            cfg = await self.db.commission_config.find_one(
                {"scope": scope, "scope_id": sid, "is_active": True}, {"_id": 0}
            )
            if cfg:
                return float(cfg.get("percent") or 0), int(cfg.get("fixed_paise") or 0)
        cfg = await self.db.commission_config.find_one(
            {"scope": CommissionScope.GLOBAL.value, "is_active": True}, {"_id": 0}
        )
        if cfg:
            return float(cfg.get("percent") or 0), int(cfg.get("fixed_paise") or 0)
        return float(C.DEFAULT_COMMISSION_PERCENT), 0

    async def calculate(
        self,
        *,
        gross_paise: int,
        provider_id: Optional[str] = None,
        service_id: Optional[str] = None,
        category_id: Optional[str] = None,
    ) -> tuple[float, int, int]:
        """Return (percent, commission_paise, provider_earning_paise) using integer math."""
        if gross_paise < 0:
            gross_paise = 0
        pct, fixed = await self.resolve(
            provider_id=provider_id, service_id=service_id, category_id=category_id
        )
        # percentage portion, floor rounding — platform is conservative
        pct_part = (gross_paise * int(pct * 100)) // 10000  # supports 2 decimal % precision
        commission = pct_part + int(fixed)
        commission = min(commission, gross_paise)
        earning = gross_paise - commission
        return pct, commission, earning

    async def upsert(
        self,
        *,
        scope: str,
        scope_id: Optional[str],
        percent: Optional[float],
        fixed_paise: Optional[int],
        is_active: bool = True,
    ) -> dict:
        now = _now()
        key = {"scope": scope, "scope_id": scope_id}
        existing = await self.db.commission_config.find_one(key)
        doc = {
            **key,
            "percent": float(percent) if percent is not None else None,
            "fixed_paise": int(fixed_paise) if fixed_paise is not None else None,
            "is_active": is_active,
            "updated_at": now,
        }
        if existing:
            await self.db.commission_config.update_one({"_id": existing["_id"]}, {"$set": doc})
            merged = {**existing, **doc, "id": existing["id"]}
            merged.pop("_id", None)
            return merged
        import uuid
        doc.update({"id": str(uuid.uuid4()), "created_at": now})
        await self.db.commission_config.insert_one(doc)
        doc.pop("_id", None)
        return doc

    async def list_all(self) -> list[dict]:
        return await self.db.commission_config.find({}, {"_id": 0}).sort("scope", 1).to_list(500)
