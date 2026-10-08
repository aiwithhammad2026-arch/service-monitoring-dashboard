"""Capture high-resolution screenshots of the dashboard using Playwright."""

import asyncio
import os

from playwright.async_api import async_playwright

ASSETS_DIR = os.path.abspath("assets")
os.makedirs(ASSETS_DIR, exist_ok=True)


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            headless=True,
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2,
        )
        page = await context.new_page()

        print("1. Navigating to root / login page...")
        await page.goto("http://127.0.0.1:8000/", wait_until="networkidle")
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(ASSETS_DIR, "01-login.png"))
        print("Captured: 01-login.png")

        print("2. Logging in as admin...")
        await page.fill("#login-username", "admin")
        await page.fill("#login-password", "Admin#2026!")
        await page.click("#login-submit-btn")

        await page.wait_for_selector("#pill-nav-group", state="visible")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=os.path.join(ASSETS_DIR, "02-dashboard-overview.png"))
        print("Captured: 02-dashboard-overview.png")

        print("3. Navigating to Services...")
        await page.click("#nav-services")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(ASSETS_DIR, "03-services-catalog.png"))
        print("Captured: 03-services-catalog.png")

        print("4. Navigating to Service Detail (payments)...")
        await page.goto("http://127.0.0.1:8000/#/services/payments", wait_until="networkidle")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=os.path.join(ASSETS_DIR, "04-service-detail.png"))
        print("Captured: 04-service-detail.png")

        print("5. Navigating to Simulator view...")
        await page.click("#nav-simulator")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(ASSETS_DIR, "07-chaos-simulator.png"))
        print("Captured: 07-chaos-simulator.png")

        print("6. Simulating chaos on payments to generate incident...")
        await page.evaluate("""() => {
            fetch('/sim/payments/mode', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({mode: 'failing'})
            });
        }""")
        await page.wait_for_timeout(3000)

        print("7. Navigating to Incidents view...")
        await page.click("#nav-incidents")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(ASSETS_DIR, "05-incident-management.png"))
        print("Captured: 05-incident-management.png")

        print("8. Navigating to Audit Log...")
        await page.click("#nav-audit")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(ASSETS_DIR, "06-audit-trail.png"))
        print("Captured: 06-audit-trail.png")

        print("9. Switching to Dark Theme and capturing Overview...")
        await page.click("#theme-toggle-btn")
        await page.click("#nav-dashboard")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(ASSETS_DIR, "08-dark-dashboard.png"))
        print("Captured: 08-dark-dashboard.png")

        # Reset payments mode back to normal
        await page.evaluate("""() => {
            fetch('/sim/payments/mode', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({mode: 'normal'})
            });
        }""")

        await browser.close()
        print("All screenshots successfully captured!")


if __name__ == "__main__":
    asyncio.run(main())
