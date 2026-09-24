from datetime import datetime

from pydantic import BaseModel

from . import BankAccountOut, ProfileOut, TransactionOut, VaultOut


class SyncSnapshot(BaseModel):
    server_time: datetime
    vaults: list[VaultOut] = []
    transactions: list[TransactionOut] = []
    profiles: list[ProfileOut] = []
    bank_accounts: list[BankAccountOut] = []


class SyncMergeRequest(BaseModel):
    device_id: str
    vaults: list[dict] = []
    transactions: list[dict] = []
    profiles: list[dict] = []
    bank_accounts: list[dict] = []
    as_of: datetime | None = None


class ApplyCounts(BaseModel):
    vaults: int = 0
    transactions: int = 0
    profiles: int = 0
    bank_accounts: int = 0


class SyncMergeResult(BaseModel):
    server_time: datetime
    applied: ApplyCounts
    data: SyncSnapshot