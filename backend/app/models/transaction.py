from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IDMixin, TimestampMixin, utcnow


class Transaction(Base, IDMixin, TimestampMixin):
    __tablename__ = "transactions"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    vault_id: Mapped[str] = mapped_column(ForeignKey("vaults.id", ondelete="SET NULL"), index=True, nullable=True)

    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # deposit | withdrawal | transfer | adjustment
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    method: Mapped[str] = mapped_column(String(60), nullable=False, default="Vault Ledger")
    rail: Mapped[str] = mapped_column(String(60), nullable=True)
    reference: Mapped[str] = mapped_column(String(40), nullable=True, index=True)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=True)
    goal_name: Mapped[str] = mapped_column(String(160), nullable=True)
    note: Mapped[str] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)