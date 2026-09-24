from decimal import Decimal

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IDMixin, TimestampMixin


class User(Base, IDMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    salvis_id: Mapped[str] = mapped_column(String(32), nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="Salvis User")
    nickname: Mapped[str] = mapped_column(String(80), nullable=True)
    avatar: Mapped[str] = mapped_column(String(500), nullable=True)
    phone: Mapped[str] = mapped_column(String(40), nullable=True)
    country: Mapped[str] = mapped_column(String(80), nullable=True)
    currency_code: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    currency_symbol: Mapped[str] = mapped_column(String(12), nullable=False, default="$")
    locale: Mapped[str] = mapped_column(String(16), nullable=False, default="en-US")
    google_sub: Mapped[str] = mapped_column(String(64), nullable=True, index=True)
    is_security_onboarded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)