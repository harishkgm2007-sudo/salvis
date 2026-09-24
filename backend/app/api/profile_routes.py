from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Profile, User
from ..schemas import ProfileOut
from .deps import get_current_user

router = APIRouter(prefix="/profiles", tags=["profiles"])

VALID_TYPES = {"personal", "family", "joint", "custom"}


class ProfileCreate(BaseModel):
    profile_name: str
    profile_type: str = "personal"


class ProfileUpdate(BaseModel):
    profile_name: str | None = None
    profile_type: str | None = None
    is_active: bool | None = None


@router.get("", response_model=list[ProfileOut])
def list_profiles(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Profile).filter(Profile.user_id == user.id).order_by(Profile.created_at.asc()).all()


@router.post("", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
def create_profile(payload: ProfileCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.profile_type not in VALID_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid profile type")
    count = db.query(Profile).filter(Profile.user_id == user.id).count()
    profile = Profile(
        user_id=user.id,
        profile_name=payload.profile_name.strip(),
        profile_type=payload.profile_type,
        is_active=count == 0,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.patch("/{profile_id}", response_model=ProfileOut)
def update_profile(profile_id: str, payload: ProfileUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    if payload.profile_name is not None:
        profile.profile_name = payload.profile_name.strip()
    if payload.profile_type is not None:
        if payload.profile_type not in VALID_TYPES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid profile type")
        profile.profile_type = payload.profile_type
    if payload.is_active is True:
        db.query(Profile).filter(Profile.user_id == user.id).update({Profile.is_active: False})
        profile.is_active = True

    db.commit()
    db.refresh(profile)
    return profile