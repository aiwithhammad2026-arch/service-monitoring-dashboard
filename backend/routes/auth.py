"""Authentication API endpoints: login, logout, and identity inspection."""

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from backend import audit
from backend.auth import (
    COOKIE_NAME,
    DUMMY_BCRYPT_HASH,
    create_session_token,
    decode_session_token,
    get_client_ip,
    get_current_user,
    login_rate_limiter,
    verify_password,
)
from backend.config import settings
from backend.db import get_db
from backend.errors import RateLimitExceededError, UnauthorizedError

router = APIRouter()


class LoginRequest(BaseModel):
    """User login request payload with strict length boundaries."""

    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


@router.post("/login")
async def login(req: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    """Authenticate account credentials and establish signed session cookie."""
    client_ip = get_client_ip(request)

    # 1. Rate limit verification (5 failed attempts per username, IP per 5 minutes)
    if login_rate_limiter.is_rate_limited(req.username, client_ip):
        raise RateLimitExceededError(
            "Too many failed login attempts. Please try again later.",
            code="RATE_LIMIT_EXCEEDED",
        )

    # 2. Database lookup
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash, role FROM accounts WHERE username = ?;",
            (req.username.strip(),),
        ).fetchone()

        # Non-existent username: execute dummy hash verification to prevent timing attack
        if not row:
            verify_password(req.password, DUMMY_BCRYPT_HASH)
            login_rate_limiter.record_failed_attempt(req.username, client_ip)
            audit.write(
                conn,
                actor=req.username.strip(),
                action="login_failed",
                target_type="account",
                target_id="",
                new={"reason": "invalid_credentials"},
                ip=client_ip,
            )
            raise UnauthorizedError("Invalid credentials", code="INVALID_CREDENTIALS")

        # Existing account: verify password
        if not verify_password(req.password, row["password_hash"]):
            login_rate_limiter.record_failed_attempt(req.username, client_ip)
            audit.write(
                conn,
                actor=req.username.strip(),
                action="login_failed",
                target_type="account",
                target_id=str(row["id"]),
                new={"reason": "invalid_credentials"},
                ip=client_ip,
            )
            raise UnauthorizedError("Invalid credentials", code="INVALID_CREDENTIALS")

        # 3. Successful authentication: clear rate limiter counter
        login_rate_limiter.clear(req.username, client_ip)

        # Generate signed session token with user ID only
        token = create_session_token(row["id"])

        # Write audit log record
        audit.write(
            conn,
            actor=row["username"],
            action="login_success",
            target_type="account",
            target_id=str(row["id"]),
            new={"role": row["role"]},
            ip=client_ip,
        )

        # Set secure HttpOnly session cookie
        response.set_cookie(
            key=COOKIE_NAME,
            value=token,
            httponly=True,
            samesite="lax",
            secure=settings.secure_cookies,
            max_age=settings.session_max_age_s,
            path="/",
        )

        return {
            "status": "ok",
            "user": {
                "id": row["id"],
                "username": row["username"],
                "role": row["role"],
            },
        }


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, Any]:
    """Terminate the active session and remove session cookie."""
    client_ip = get_client_ip(request)
    token = request.cookies.get(COOKIE_NAME)

    actor_username = "anonymous"
    actor_id = ""

    if token:
        try:
            user_id = decode_session_token(token)
            with get_db() as conn:
                row = conn.execute(
                    "SELECT id, username FROM accounts WHERE id = ?;",
                    (user_id,),
                ).fetchone()
                if row:
                    actor_username = row["username"]
                    actor_id = str(row["id"])
                    audit.write(
                        conn,
                        actor=actor_username,
                        action="logout",
                        target_type="account",
                        target_id=actor_id,
                        ip=client_ip,
                    )
        except Exception:
            pass

    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"status": "ok", "message": "Logged out successfully"}


@router.get("/me")
async def get_me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Return the currently authenticated user's profile and active role."""
    return {
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
        }
    }
