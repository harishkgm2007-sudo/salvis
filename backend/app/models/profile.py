from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IDMixin, TimestampMixin


class Profile(Base, IDMixin, TimestampMixin):
    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    profile_name: Mapped[str] = mapped_column(String(120), nullable=False)
    profile_type: Mapped[str] = mapped_column(String(20), nullable=False, default="personal")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)