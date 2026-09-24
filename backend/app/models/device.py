from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IDMixin, TimestampMixin, utcnow


class SyncDevice(Base, IDMixin, TimestampMixin):
    __tablename__ = "sync_devices"
    __table_args__ = (UniqueConstraint("user_id", "device_id", name="uq_user_device"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    device_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)