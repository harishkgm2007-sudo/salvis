from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import BankAccount, User
from ..schemas import BankAccountOut
from .deps import get_current_user

router = APIRouter(prefix="/bank-accounts", tags=["bank-accounts"])


class BankCreate(BaseModel):
    bank_name: str = "Partner Bank"
    last4: str = "0000"
    account_type: str = "Savings Account"


@router.get("", response_model=list[BankAccountOut])
def list_banks(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(BankAccount).filter(BankAccount.user_id == user.id).order_by(BankAccount.created_at.asc()).all()


@router.post("", response_model=BankAccountOut, status_code=status.HTTP_201_CREATED)
def create_bank(payload: BankCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = db.query(BankAccount).filter(BankAccount.user_id == user.id).count()
    bank = BankAccount(
        user_id=user.id,
        bank_name=payload.bank_name.strip(),
        last4=payload.last4.strip() or "0000",
        account_type=payload.account_type.strip() or "Savings Account",
        is_primary=count == 0,
    )
    db.add(bank)
    db.commit()
    db.refresh(bank)
    return bank


@router.patch("/{bank_id}", response_model=BankAccountOut)
def update_bank(bank_id: str, payload: BankCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    bank = db.get(BankAccount, bank_id)
    if not bank or bank.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank account not found")
    bank.bank_name = payload.bank_name.strip()
    bank.account_type = payload.account_type.strip()
    if payload.last4.strip():
        bank.last4 = payload.last4.strip()
    db.commit()
    db.refresh(bank)
    return bank