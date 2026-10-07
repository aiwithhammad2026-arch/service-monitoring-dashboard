"""Live API verification script executing the requested test interactions."""

from starlette.testclient import TestClient

from backend.main import create_app

DEMO_ADMIN_PASS = "Admin#2026!"
DEMO_VIEWER_PASS = "Viewer#2026!"
CSRF_HEADERS = {"X-Requested-With": "XMLHttpRequest"}


def run_verification() -> None:
    app = create_app(use_lifespan=False)

    print("=================================================================")
    print("STEP 1: Login as Viewer -> PUT Thresholds -> 403 Body")
    print("=================================================================")
    with TestClient(app) as viewer_client:
        login_res = viewer_client.post(
            "/auth/login",
            json={"username": "viewer", "password": DEMO_VIEWER_PASS},
            headers=CSRF_HEADERS,
        )
        print(f"Login Viewer Status: {login_res.status_code}")
        print(f"Login Viewer Body:   {login_res.text}")

        put_res = viewer_client.put(
            "/services/auth/thresholds",
            json={"max_error_pct": 5.0, "max_p95_ms": 800.0, "stale_after_s": 180},
            headers=CSRF_HEADERS,
        )
        print(f"PUT Thresholds Status: {put_res.status_code}")
        print(f"PUT Thresholds Body:   {put_res.text}")

    print("\n=================================================================")
    print("STEP 2: Login as Admin -> PUT Thresholds -> 200 Body")
    print("=================================================================")
    with TestClient(app) as admin_client:
        login_res = admin_client.post(
            "/auth/login",
            json={"username": "admin", "password": DEMO_ADMIN_PASS},
            headers=CSRF_HEADERS,
        )
        print(f"Login Admin Status: {login_res.status_code}")
        print(f"Login Admin Body:   {login_res.text}")

        put_res = admin_client.put(
            "/services/auth/thresholds",
            json={"max_error_pct": 7.0, "max_p95_ms": 900.0, "stale_after_s": 200},
            headers=CSRF_HEADERS,
        )
        print(f"PUT Thresholds Status: {put_res.status_code}")
        print(f"PUT Thresholds Body:   {put_res.text}")

        print("\n=================================================================")
        print("STEP 3: PUT with 150 -> 422 Body")
        print("=================================================================")
        invalid_res = admin_client.put(
            "/services/auth/thresholds",
            json={"max_error_pct": 150.0, "max_p95_ms": 900.0, "stale_after_s": 200},
            headers=CSRF_HEADERS,
        )
        print(f"PUT Thresholds (150%) Status: {invalid_res.status_code}")
        print(f"PUT Thresholds (150%) Body:   {invalid_res.text}")

        print("\n=================================================================")
        print("STEP 4: GET /export/incidents.csv Headers & Content Preview")
        print("=================================================================")
        csv_res = admin_client.get("/export/incidents.csv")
        print(f"GET /export/incidents.csv Status: {csv_res.status_code}")
        print("Response Headers:")
        for header, val in csv_res.headers.items():
            if header.lower() in ("content-type", "content-disposition"):
                print(f"  {header}: {val}")
        print("\nCSV Body Preview (first 3 lines):")
        lines = csv_res.text.strip().splitlines()
        for line in lines[:3]:
            print(f"  {line}")


if __name__ == "__main__":
    run_verification()
