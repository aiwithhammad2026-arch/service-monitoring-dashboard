"""Security and static asset guard tests for the frontend."""

import pathlib
import re

from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]

# Build patterns from fragments so this file does not trigger its own pattern matching
PROHIBITED = [
    "inner" + "HTML",
    "outer" + "HTML",
    "insertAdjacent" + "HTML",
    "document" + r"\.write",
    "ev" + r"al\(",
    "ht" + "tp://",
    "ht" + "tps://",
    "cdn" + r"\.jsdelivr\.net",
    "cdnjs" + r"\.cloudflare\.com",
]


def scan_file(path: pathlib.Path) -> str | None:
    """Scan a single file for prohibited patterns."""
    content = path.read_text(encoding="utf-8")
    for pat in PROHIBITED:
        if re.search(pat, content):
            return pat
    return None


def test_no_prohibited_js_html_patterns() -> None:
    """Frontend files must never use prohibited DOM injection APIs or remote URLs."""
    js_html = (
        list((ROOT / "frontend").rglob("*.js"))
        + list((ROOT / "frontend").rglob("*.html"))
        + list(ROOT.glob("*.js"))
    )
    for f in js_html:
        if "vendor" in str(f):
            continue
        hit = scan_file(f)
        assert hit is None, f"Prohibited pattern {hit!r} found in {f}"


def test_static_serving_content_types_and_auth(client: TestClient) -> None:
    """Static assets should serve with proper MIME types and API routes require auth."""
    # / should return HTML
    r = client.get("/")
    assert r.headers["content-type"].startswith("text/html")
    # CSS
    r = client.get("/css/styles.css")
    assert r.headers["content-type"].startswith("text/css")
    # JS
    r = client.get("/js/app.js")
    assert r.headers["content-type"].startswith(("application/javascript", "text/javascript"))
    # health JSON (no auth needed)
    r = client.get("/health")
    assert r.headers["content-type"].startswith("application/json")
    # metrics overview requires auth – expect 401 without cookie
    r = client.get("/metrics/overview")
    assert r.status_code == 401
