from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Profile, Transaction, User, Vault
from ..schemas import TransactionOut, VaultActionRequest, VaultCreate, VaultOut, VaultUpdate
from .deps import get_current_user

router = APIRouter(prefix="/vaults", tags=["vaults"])


def _get_owned_vault(db: Session, user: User, vault_id: str) -> Vault:
    vault = db.get(Vault, vault_id)
    if not vault or vault.user_id != user.id or vault.deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vault not found")
    return vault


def _to_decimal(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _record_transaction(db: Session, user: User, vault: Vault, kind: str, amount: Decimal, payload: VaultActionRequest) -> Transaction:
    tx = Transaction(
        user_id=user.id,
        vault_id=vault.id,
        kind=kind,
        amount=amount,
        method=payload.method or "Vault Ledger",
        rail=payload.rail,
        reference=payload.reference,
        balance_after=vault.current_amount,
        goal_name=vault.title,
        note=payload.note,
        occurred_at=payload.occurred_at or datetime.now(timezone.utc),
    )
    db.add(tx)
    return tx


@router.get("", response_model=list[VaultOut])
def list_vaults(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(Vault)
        .filter(Vault.user_id == user.id, Vault.deleted.is_(False))
        .order_by(Vault.created_at.desc())
        .all()
    )


@router.post("", response_model=VaultOut, status_code=status.HTTP_201_CREATED)
def create_vault(payload: VaultCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.profile_id:
        profile = db.get(Profile, payload.profile_id)
        if not profile or profile.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid profile")
    vault = Vault(
        id=payload.id or None,
        user_id=user.id,
        profile_id=payload.profile_id,
        title=payload.title.strip(),
        description=payload.description,
        target_amount=_to_decimal(payload.target_amount),
        current_amount=_to_decimal(payload.current_amount),
        currency_code=payload.currency_code,
        status=payload.status,
        category=payload.category,
        image_url=payload.image_url,
        target_url=payload.target_url,
        start_date=payload.start_date,
        due_date=payload.due_date,
    )
    db.add(vault)
    db.commit()
    db.refresh(vault)

    if _to_decimal(payload.current_amount) > 0:
        _record_transaction(
            db,
            user,
            vault,
            "deposit",
            _to_decimal(payload.current_amount),
            VaultActionRequest(amount=payload.current_amount, method="Initial Balance"),
        )
        db.commit()
    return vault


@router.get("/{vault_id}", response_model=VaultOut)
def get_vault(vault_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _get_owned_vault(db, user, vault_id)


@router.patch("/{vault_id}", response_model=VaultOut)
def update_vault(vault_id: str, payload: VaultUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vault = _get_owned_vault(db, user, vault_id)
    changes = payload.model_dump(exclude_unset=True)
    if "target_amount" in changes:
        changes["target_amount"] = _to_decimal(changes["target_amount"])
    if "status" in changes:
        if changes["status"] == "completed":
            vault.completed_at = datetime.now(timezone.utc)
        elif changes["status"] != "completed":
            vault.completed_at = None

    for field, value in changes.items():
        setattr(vault, field, value)
    db.commit()
    db.refresh(vault)
    return vault


@router.delete("/{vault_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vault(vault_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vault = _get_owned_vault(db, user, vault_id)
    vault.deleted = True
    vault.status = "cancelled"
    db.commit()


@router.post("/{vault_id}/deposit", response_model=dict)
def deposit(vault_id: str, payload: VaultActionRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vault = _get_owned_vault(db, user, vault_id)
    amount = _to_decimal(payload.amount)
    vault.current_amount = (vault.current_amount or Decimal("0")) + amount

    if vault.status != "completed" and vault.current_amount >= (vault.target_amount or Decimal("0")):
        vault.status = "completed"
        vault.completed_at = datetime.now(timezone.utc)

    tx = _record_transaction(db, user, vault, "deposit", amount, payload)
    db.commit()
    db.refresh(vault)
    db.refresh(tx)
    return {"vault": VaultOut.model_validate(vault), "transaction": TransactionOut.model_validate(tx)}


@router.post("/{vault_id}/withdraw", response_model=dict)
def withdraw(vault_id: str, payload: VaultActionRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vault = _get_owned_vault(db, user, vault_id)
    amount = _to_decimal(payload.amount)
    if amount > vault.current_amount:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient balance in vault")
    vault.current_amount -= amount

    if vault.status == "completed" and vault.current_amount < (vault.target_amount or Decimal("0")):
        vault.status = "active"
        vault.completed_at = None

    tx = _record_transaction(db, user, vault, "withdrawal", amount, payload)
    db.commit()
    db.refresh(vault)
    db.refresh(tx)
    return {"vault": VaultOut.model_validate(vault), "transaction": TransactionOut.model_validate(tx)}