from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IDMixin, TimestampMixin


class Vault(Base, IDMixin, TimestampMixin):
    __tablename__ = "vaults"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"), index=True, nullable=True)

    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    target_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    current_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0"))
    currency_code: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    category: Mapped[str] = mapped_column(String(80), nullable=True)
    image_url: Mapped[str] = mapped_column(String(1000), nullable=True)
    target_url: Mapped[str] = mapped_column(String(1000), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=True)
    due_date: Mapped[date] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)