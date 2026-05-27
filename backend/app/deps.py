from __future__ import annotations

from typing import Callable, Optional

from fastapi import Cookie, Depends, Header, HTTPException

from app.db import connect
from app.security import decode_access_token


def _row_to_user(row):
    if not row:
        return None
    d = dict(row)
    return {
        "id": d["id"],
        "email": d["email"],
        "name": d["name"],
        "role": d["role"],
        "is_active": bool(d["is_active"]),
    }


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    access_token: Optional[str] = Cookie(default=None),
):
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    elif access_token:
        token = access_token.strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authorization token required")
    try:
        payload = decode_access_token(token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    conn = connect()
    row = conn.execute("SELECT * FROM users WHERE id=?", (payload.get("sub"),)).fetchone()
    conn.close()
    user = _row_to_user(row)
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="User is inactive or missing")
    return user


def require_roles(*roles: str) -> Callable:
    allowed = set(roles)

    def checker(current_user=Depends(get_current_user)):
        if current_user["role"] == "admin" or current_user["role"] in allowed:
            return current_user
        raise HTTPException(status_code=403, detail="Insufficient role")

    return checker


def can_read_user(current_user: dict, user_id: str) -> bool:
    return current_user["role"] in {"admin", "teacher", "researcher"} or current_user["id"] == user_id
