"""Tests for the /health endpoint and static file serving."""

from fastapi.testclient import TestClient


def test_health_check_returns_200_and_ok_status(client: TestClient) -> None:
    """GET /health must return HTTP 200 with JSON payload containing status='ok'."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["version"] == "0.1.0"
    assert "timestamp" in data
    assert "environment" in data


def test_frontend_static_serving(client: TestClient) -> None:
    """GET / must return the frontend HTML document."""
    response = client.get("/")
    assert response.status_code == 200
    assert "Service Monitoring Dashboard" in response.text
    assert "<!DOCTYPE html>" in response.text
