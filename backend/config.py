"""Application configuration for Service Monitoring Dashboard."""

import logging
import os
from pathlib import Path
from typing import ClassVar

from dotenv import load_dotenv

# Load .env if present
load_dotenv()

logger = logging.getLogger("backend.config")

DEFAULT_SECRET_KEY = "insecure-dev-secret-key-change-in-production"


class Settings:
    """Environment-driven settings with documented developer defaults."""

    DEFAULT_SECRET: ClassVar[str] = DEFAULT_SECRET_KEY

    def __init__(self) -> None:
        self.db_path: Path = Path(os.getenv("MD_DB_PATH", "monitoring.db"))
        self.secret_key: str = os.getenv("MD_SECRET_KEY", DEFAULT_SECRET_KEY)
        self.sim_seed: int = int(os.getenv("MD_SIM_SEED", "42"))
        self.sim_tick: float = float(os.getenv("MD_SIM_TICK", "5.0"))
        self.secure_cookies: bool = (
            os.getenv("MD_SECURE_COOKIES", "false").lower() in ("true", "1", "yes")
        )
        self.stale_after_s: int = int(os.getenv("MD_STALE_AFTER_S", "180"))
        self.active_user_window_m: int = int(os.getenv("MD_ACTIVE_USER_WINDOW_M", "15"))
        self.bcrypt_rounds: int = int(os.getenv("MD_BCRYPT_ROUNDS", "12"))
        self.session_max_age_s: int = int(os.getenv("MD_SESSION_MAX_AGE_S", "86400"))
        self.rate_limit_max_attempts: int = int(os.getenv("MD_RATE_LIMIT_MAX_ATTEMPTS", "5"))
        self.rate_limit_window_s: int = int(os.getenv("MD_RATE_LIMIT_WINDOW_S", "300"))

        # Security check: warn on default secret
        if self.secret_key == DEFAULT_SECRET_KEY:
            logger.warning(
                "SECURITY WARNING: Using default insecure secret key! "
                "Set MD_SECRET_KEY in production."
            )


# Global settings singleton
settings = Settings()
