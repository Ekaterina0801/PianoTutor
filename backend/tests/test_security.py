import pytest

from app.security import create_access_token, decode_access_token, hash_password, validate_security_config, verify_password


def test_password_hash_roundtrip():
    encoded = hash_password("demo1234")
    assert verify_password("demo1234", encoded)
    assert not verify_password("bad", encoded)


def test_token_roundtrip():
    token = create_access_token(user_id="u1", email="a@b.test", role="researcher", name="A")
    payload = decode_access_token(token)
    assert payload["sub"] == "u1"
    assert payload["role"] == "researcher"


def test_production_rejects_weak_jwt_secret():
    with pytest.raises(RuntimeError):
        validate_security_config(app_env="production", jwt_secret="change-me")


def test_production_accepts_strong_jwt_secret():
    validate_security_config(app_env="production", jwt_secret="x" * 48)
