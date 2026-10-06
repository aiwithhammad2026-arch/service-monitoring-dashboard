"""Shared pytest fixtures."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """Test client fixture for backend testing."""
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
