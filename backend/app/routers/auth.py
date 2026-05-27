from __future__ import annotations

import datetime
import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response

from app.db import connect
from app.deps import get_current_user, require_roles
from app.models import AuthResponse, LoginRequest, RegisterRequest, UserPublic
from app.security import create_access_token, hash_password, verify_password


router = APIRouter(tags=["auth"])
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _public(row) -> UserPublic:
    d = dict(row)
    return UserPublic(
        id=d["id"],
        email=d["email"],
        name=d["name"],
        role=d["role"],
        is_active=bool(d["is_active"]),
    )


AUTH_COOKIE_NAME = "access_token"


def _cookie_secure() -> bool:
    return os.getenv("AUTH_COOKIE_SECURE", "").lower() in {"1", "true", "yes", "on"} or os.getenv("APP_ENV", "").lower() in {"prod", "production"}


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        max_age=int(os.getenv("ACCESS_TOKEN_TTL_S", str(60 * 60 * 12))),
        path="/",
    )


def _auth_response(row, response: Response = None) -> AuthResponse:
    user = _public(row)
    token = create_access_token(user_id=user.id, email=user.email, role=user.role, name=user.name)
    if response is not None:
        _set_auth_cookie(response, token)
    return AuthResponse(access_token=token, user=user)


@router.post("/auth/login", response_model=AuthResponse)
def login(req: LoginRequest, response: Response = None):
    email = req.email.strip().lower()
    conn = connect()
    row = conn.execute("SELECT * FROM users WHERE lower(email)=lower(?)", (email,)).fetchone()
    conn.close()
    if not row or not bool(row["is_active"]) or not verify_password(req.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _auth_response(row, response)


@router.post("/auth/register", response_model=AuthResponse)
def register(req: RegisterRequest, response: Response = None):
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email")
    if req.role != "student":
        raise HTTPException(status_code=403, detail="Public registration is limited to student role")

    conn = connect()
    found = conn.execute("SELECT id FROM users WHERE lower(email)=lower(?)", (email,)).fetchone()
    if found:
        conn.close()
        raise HTTPException(status_code=409, detail="Email already registered")

    uid = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + "Z"
    conn.execute(
        """
        INSERT INTO users (id,email,name,role,password_hash,is_active,created_at)
        VALUES (?,?,?,?,?,?,?)
        """,
        (uid, email, req.name.strip(), "student", hash_password(req.password), 1, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return _auth_response(row, response)


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/auth/me", response_model=UserPublic)
def me(current_user=Depends(get_current_user)):
    return current_user


@router.get("/users", response_model=list[UserPublic])
def list_users(current_user=Depends(require_roles("teacher", "researcher", "admin"))):
    conn = connect()
    if current_user["role"] == "teacher":
        rows = conn.execute("SELECT * FROM users WHERE role='student' ORDER BY created_at DESC").fetchall()
    else:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
    conn.close()
    return [_public(r) for r in rows]


@router.post("/users", response_model=UserPublic)
def create_user(req: RegisterRequest, current_user=Depends(require_roles("admin"))):
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email")
    conn = connect()
    found = conn.execute("SELECT id FROM users WHERE lower(email)=lower(?)", (email,)).fetchone()
    if found:
        conn.close()
        raise HTTPException(status_code=409, detail="Email already registered")
    uid = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + "Z"
    conn.execute(
        """
        INSERT INTO users (id,email,name,role,password_hash,is_active,created_at)
        VALUES (?,?,?,?,?,?,?)
        """,
        (uid, email, req.name.strip(), req.role, hash_password(req.password), 1, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return _public(row)
