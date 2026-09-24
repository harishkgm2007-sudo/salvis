from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IDMixin, TimestampMixin


class BankAccount(Base, IDMixin, TimestampMixin):
    __tablename__ = "bank_accounts"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    bank_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Partner Bank")
    last4: Mapped[str] = mapped_column(String(8), nullable=False, default="0000")
    account_type: Mapped[str] = mapped_column(String(60), nullable=False, default="Savings Account")
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)