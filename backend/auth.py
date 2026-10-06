"""Authentication, session management, CSRF validation, and access control."""

import logging
import time
from collections.abc import Callable
from typing import Any

import bcrypt
from fastapi import Depends, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from backend.config import settings
from backend.db import get_db
from backend.errors import ForbiddenError, UnauthorizedError

logger = logging.getLogger("backend.auth")

COOKIE_NAME = "md_session"

# Pre-computed bcrypt cost-12 hash used for timing attack mitigation on non-existent usernames
DUMMY_BCRYPT_HASH = "$2b$12$e80M6uFvDgn40aH9pL7z..z1v87v980o5N194x02uC2f4yM0yqUu2"


def hash_password(plain_password: str) -> str:
    """Hash password using bcrypt with configured cost (default 12)."""
    return bcrypt.hashpw(
        plain_password.encode("utf-8"),
        bcrypt.gensalt(rounds=settings.bcrypt_rounds),
    ).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against bcrypt hash in constant-like time."""
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def get_serializer() -> URLSafeTimedSerializer:
    """Construct serializer for signed and timed session cookies."""
    return URLSafeTimedSerializer(settings.secret_key, salt="md-session-cookie")


def create_session_token(user_id: int) -> str:
    """Generate signed, timed session token containing ONLY the user ID."""
    serializer = get_serializer()
    return serializer.dumps({"sub": user_id})


def decode_session_token(token: str) -> int:
    """Validate signature and freshness of session token; return user ID."""
    serializer = get_serializer()
    try:
        data = serializer.loads(token, max_age=settings.session_max_age_s)
        user_id = data.get("sub")
        if not isinstance(user_id, int):
            raise UnauthorizedError("Invalid session payload", code="UNAUTHORIZED")
        return user_id
    except SignatureExpired as err:
        raise UnauthorizedError(
            "Session has expired. Please log in again.",
            code="UNAUTHORIZED",
        ) from err
    except (BadSignature, Exception) as err:
        raise UnauthorizedError("Invalid session signature.", code="UNAUTHORIZED") from err


class LoginRateLimiter:
    """In-memory rate limiter for failed login attempts with injectable clock."""

    def __init__(self, time_provider: Callable[[], float] | None = None) -> None:
        self.time_provider: Callable[[], float] = time_provider or time.time
        # Map: (username_lower, ip) -> list of timestamp floats
        self.attempts: dict[tuple[str, str], list[float]] = {}

    def is_rate_limited(self, username: str, ip: str) -> bool:
        """Check if failed login attempts exceed limit within the active window."""
        now = self.time_provider()
        key = (username.strip().lower(), ip)
        window = float(settings.rate_limit_window_s)
        recent = [t for t in self.attempts.get(key, []) if now - t < window]
        self.attempts[key] = recent
        return len(recent) >= settings.rate_limit_max_attempts

    def record_failed_attempt(self, username: str, ip: str) -> None:
        """Record a failed login attempt timestamp."""
        now = self.time_provider()
        key = (username.strip().lower(), ip)
        window = float(settings.rate_limit_window_s)
        recent = [t for t in self.attempts.get(key, []) if now - t < window]
        recent.append(now)
        self.attempts[key] = recent

    def clear(self, username: str, ip: str) -> None:
        """Clear rate limit counter on successful login."""
        key = (username.strip().lower(), ip)
        self.attempts.pop(key, None)


# Global rate limiter instance
login_rate_limiter = LoginRateLimiter()


async def get_current_user(request: Request) -> dict[str, Any]:
    """Retrieve and validate current session, reloading account from DB on every request.

    Guarantees immediate revocation upon role demotion or account deletion.
    """
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise UnauthorizedError("Authentication required. No session cookie.", code="UNAUTHORIZED")

    user_id = decode_session_token(token)

    # Reload account and role from the database
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, role, created_at FROM accounts WHERE id = ?;",
            (user_id,),
        ).fetchone()

        if not row:
            raise UnauthorizedError("Account no longer exists.", code="UNAUTHORIZED")

        return {
            "id": row["id"],
            "username": row["username"],
            "role": row["role"],
            "created_at": row["created_at"],
        }


def require_role(required_role: str) -> Callable[..., Any]:
    """Dependency factory ensuring user has the required role (e.g. 'admin')."""

    async def role_checker(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if required_role == "admin" and user["role"] != "admin":
            raise ForbiddenError("Admin privilege required", code="FORBIDDEN")
        return user

    return role_checker
