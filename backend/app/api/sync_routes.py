from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import BankAccount, Profile, SyncDevice, Transaction, User, Vault
from ..schemas import BankAccountOut, ProfileOut, TransactionOut, VaultOut
from ..schemas.sync import ApplyCounts, SyncMergeRequest, SyncMergeResult, SyncSnapshot
from .deps import get_current_user

router = APIRouter(prefix="/sync", tags=["sync"])

RECORD_MODELS = {
    "vaults": Vault,
    "transactions": Transaction,
    "profiles": Profile,
    "bank_accounts": BankAccount,
}

# Fields a client may write for each entity (id and user_id are handled
# separately). Client-local fields like `timestamp` are translated below.
WRITABLE = {
    "vaults": {"profile_id", "title", "description", "target_amount", "current_amount", "currency_code", "status", "category", "image_url", "target_url", "start_date", "due_date", "completed_at", "deleted"},
    "transactions": {"vault_id", "kind", "amount", "method", "rail", "reference", "balance_after", "goal_name", "note", "occurred_at", "timestamp"},
    "profiles": {"profile_name", "profile_type", "is_active"},
    "bank_accounts": {"bank_name", "last4", "account_type", "is_primary"},
}


def _parse_dt(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize(rec: dict) -> dict:
    out = dict(rec)
    if "occurred_at" not in out and "timestamp" in out:
        out["occurred_at"] = out.pop("timestamp")
    return out


def _apply_records(db: Session, user: User, category: str, records: list) -> int:
    model = RECORD_MODELS[category]
    writable = WRITABLE[category]
    applied = 0
    for raw in records:
        if not isinstance(raw, dict):
            continue
        rec = _normalize(raw)
        rid = rec.get("id")
        if not rid:
            continue
        incoming_dt = _parse_dt(rec.get("updated_at") or rec.get("created_at"))
        if incoming_dt and incoming_dt.tzinfo is None:
            incoming_dt = incoming_dt.replace(tzinfo=timezone.utc)

        existing = db.get(model, rid)
        if existing is not None:
            if existing.user_id != user.id:
                continue
            if incoming_dt is not None and _as_aware(existing.updated_at) and incoming_dt < _as_aware(existing.updated_at):
                continue

        values = {"id": rid, "user_id": user.id}
        for field in writable:
            if field in rec and rec[field] is not None:
                values[field] = rec[field]

        if existing is None:
            if model is Transaction and "reference" in values:
                dup = db.query(Transaction).filter(Transaction.reference == values["reference"]).first()
                if dup and dup.id != rid:
                    continue
            db.add(model(**values))
        else:
            for field, value in values.items():
                setattr(existing, field, value)
        applied += 1
    db.commit()
    return applied


def _snapshot(db: Session, user: User) -> SyncSnapshot:
    return SyncSnapshot(
        server_time=datetime.now(timezone.utc),
        vaults=[VaultOut.model_validate(v) for v in db.query(Vault).filter(Vault.user_id == user.id, Vault.deleted.is_(False)).order_by(Vault.created_at.desc()).all()],
        transactions=[TransactionOut.model_validate(t) for t in db.query(Transaction).filter(Transaction.user_id == user.id).order_by(Transaction.occurred_at.desc()).all()],
        profiles=[ProfileOut.model_validate(p) for p in db.query(Profile).filter(Profile.user_id == user.id).all()],
        bank_accounts=[BankAccountOut.model_validate(b) for b in db.query(BankAccount).filter(BankAccount.user_id == user.id).all()],
    )


@router.get("/snapshot", response_model=SyncSnapshot)
def get_snapshot(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _snapshot(db, user)


@router.post("/merge", response_model=SyncMergeResult)
def merge(payload: SyncMergeRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    applied = ApplyCounts()
    applied.vaults = _apply_records(db, user, "vaults", payload.vaults)
    applied.transactions = _apply_records(db, user, "transactions", payload.transactions)
    applied.profiles = _apply_records(db, user, "profiles", payload.profiles)
    applied.bank_accounts = _apply_records(db, user, "bank_accounts", payload.bank_accounts)

    device = db.query(SyncDevice).filter(SyncDevice.user_id == user.id, SyncDevice.device_id == payload.device_id).first()
    if device:
        device.last_synced_at = datetime.now(timezone.utc)
    else:
        db.add(SyncDevice(user_id=user.id, device_id=payload.device_id, last_synced_at=datetime.now(timezone.utc)))
    db.commit()

    return SyncMergeResult(server_time=datetime.now(timezone.utc), applied=applied, data=_snapshot(db, user))