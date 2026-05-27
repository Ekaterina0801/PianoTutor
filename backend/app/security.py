from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any, Dict


JWT_SECRET = os.getenv("JWT_SECRET", "dev-change-me-piano-tutor")
JWT_ISSUER = "piano-tutor-api"
JWT_ALG = "HS256"
TOKEN_TTL_S = int(os.getenv("ACCESS_TOKEN_TTL_S", str(60 * 60 * 12)))
HASH_ITERATIONS = int(os.getenv("PASSWORD_HASH_ITERATIONS", "210000"))
WEAK_JWT_SECRETS = {
    "",
    "change-me",
    "change-me-in-production",
    "dev-change-me-piano-tutor",
}


def validate_security_config(app_env: str | None = None, jwt_secret: str | None = None) -> None:
    env = (app_env or os.getenv("APP_ENV") or os.getenv("ENV") or "development").strip().lower()
    secret = jwt_secret if jwt_secret is not None else JWT_SECRET
    if env not in {"production", "prod"}:
        return
    if secret in WEAK_JWT_SECRETS or len(secret) < 32:
        raise RuntimeError("JWT_SECRET must be set to a strong value in production")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + pad).encode("ascii"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, HASH_ITERATIONS)
    return f"pbkdf2_sha256${HASH_ITERATIONS}${_b64url(salt)}${_b64url(dk)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, it_s, salt_s, hash_s = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(it_s)
        salt = _b64url_decode(salt_s)
        expected = _b64url_decode(hash_s)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_access_token(*, user_id: str, email: str, role: str, name: str) -> str:
    now = int(time.time())
    header = {"typ": "JWT", "alg": JWT_ALG}
    payload: Dict[str, Any] = {
        "iss": JWT_ISSUER,
        "sub": user_id,
        "email": email,
        "role": role,
        "name": name,
        "iat": now,
        "exp": now + TOKEN_TTL_S,
    }
    signing_input = ".".join([
        _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ])
    sig = hmac.new(JWT_SECRET.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url(sig)}"


def decode_access_token(token: str) -> Dict[str, Any]:
    try:
        header_s, payload_s, sig_s = token.split(".", 2)
        signing_input = f"{header_s}.{payload_s}"
        expected = hmac.new(JWT_SECRET.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_decode(sig_s), expected):
            raise ValueError("bad signature")
        header = json.loads(_b64url_decode(header_s))
        if header.get("alg") != JWT_ALG:
            raise ValueError("bad alg")
        payload = json.loads(_b64url_decode(payload_s))
        if payload.get("iss") != JWT_ISSUER:
            raise ValueError("bad issuer")
        if int(payload.get("exp", 0)) < int(time.time()):
            raise ValueError("expired")
        return payload
    except Exception as exc:
        raise ValueError("invalid token") from exc
