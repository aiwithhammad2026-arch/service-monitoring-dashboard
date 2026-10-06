"""Shared pytest fixtures."""

from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import create_app
from backend.seed import seed


@pytest.fixture
def app_with_db(tmp_path: Path):
    """Configure settings with isolated seeded database and fast test bcrypt rounds."""
    db_file = tmp_path / "test_app.db"
    orig_db = settings.db_path
    orig_rounds = settings.bcrypt_rounds

    settings.db_path = db_file
    settings.bcrypt_rounds = 4  # Lower rounds only in tests for execution speed

    seed(db_file)
    app = create_app(use_lifespan=False)  # Disable simulator in tests

    yield app

    settings.db_path = orig_db
    settings.bcrypt_rounds = orig_rounds


@pytest.fixture
def client(app_with_db) -> Generator[TestClient, None, None]:
    """Test client fixture configured with seeded database."""
    with TestClient(app_with_db) as test_client:
        yield test_client
