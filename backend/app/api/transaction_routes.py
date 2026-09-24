from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Transaction, User
from ..schemas import TransactionOut
from .deps import get_current_user

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("", response_model=list[TransactionOut])
def list_transactions(
    vault_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Transaction).filter(Transaction.user_id == user.id)
    if vault_id:
        query = query.filter(Transaction.vault_id == vault_id)
    return query.order_by(Transaction.occurred_at.desc()).offset(offset).limit(limit).all()