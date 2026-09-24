from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1)


class GoogleLoginRequest(BaseModel):
    id_token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(ORMModel):
    id: str
    email: str
    salvis_id: str | None = None
    name: str
    nickname: str | None = None
    avatar: str | None = None
    phone: str | None = None
    country: str | None = None
    currency_code: str = "USD"
    currency_symbol: str = "$"
    locale: str = "en-US"
    is_security_onboarded: bool = True
    created_at: datetime


class ProfileOut(ORMModel):
    id: str
    user_id: str
    profile_name: str
    profile_type: str = "personal"
    is_active: bool = False
    created_at: datetime
    updated_at: datetime


class BankAccountOut(ORMModel):
    id: str
    user_id: str
    bank_name: str
    last4: str
    account_type: str
    is_primary: bool = False
    created_at: datetime
    updated_at: datetime


class VaultCreate(BaseModel):
    id: str | None = None
    profile_id: str | None = None
    title: str = Field(min_length=1, max_length=160)
    description: str | None = None
    target_amount: float = Field(gt=0)
    current_amount: float = 0
    currency_code: str = "USD"
    status: str = "active"
    category: str | None = None
    image_url: str | None = None
    target_url: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    updated_at: datetime | None = None


class VaultUpdate(BaseModel):
    profile_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    target_amount: float | None = Field(default=None, gt=0)
    currency_code: str | None = None
    status: str | None = None
    category: str | None = None
    image_url: str | None = None
    target_url: str | None = None
    start_date: date | None = None
    due_date: date | None = None


class VaultOut(ORMModel):
    id: str
    user_id: str
    profile_id: str | None = None
    title: str
    description: str | None = None
    target_amount: float
    current_amount: float
    currency_code: str
    status: str
    category: str | None = None
    image_url: str | None = None
    target_url: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class VaultActionRequest(BaseModel):
    amount: float = Field(gt=0)
    method: str = "Vault Ledger"
    rail: str | None = None
    reference: str | None = None
    note: str | None = None
    occurred_at: datetime | None = None


class TransactionOut(ORMModel):
    id: str
    user_id: str
    vault_id: str | None = None
    kind: str
    amount: float
    method: str
    rail: str | None = None
    reference: str | None = None
    balance_after: float | None = None
    goal_name: str | None = None
    note: str | None = None
    occurred_at: datetime
    created_at: datetime
    updated_at: datetime