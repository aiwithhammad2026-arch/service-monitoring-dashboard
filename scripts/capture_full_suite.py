"""Capture comprehensive screenshot suite in both Light and Dark mode using Playwright."""

import asyncio
import os

from playwright.async_api import Browser, async_playwright

ASSETS_DIR = os.path.abspath("assets")
os.makedirs(ASSETS_DIR, exist_ok=True)


async def capture_theme_suite(browser: Browser, mode: str) -> None:
    print(f"\n==================== RUNNING {mode.upper()} MODE ====================")
    context = await browser.new_context(
        viewport={"width": 1440, "height": 900},
        device_scale_factor=2,
    )
    theme_val = "dark" if mode == "dark" else "light"
    await context.add_init_script(f"""
        localStorage.setItem('md.theme', '{theme_val}');
        document.documentElement.setAttribute('data-theme', '{theme_val}');
    """)

    page = await context.new_page()

    async def snap(filename: str, delay: int = 1200) -> None:
        await page.wait_for_timeout(delay)
        filepath = os.path.join(ASSETS_DIR, filename)
        await page.screenshot(path=filepath)
        print(f"Captured: {filename}")

    # 1. Login Page (Empty)
    await page.goto("http://127.0.0.1:8000/", wait_until="networkidle")
    await page.evaluate(f"document.documentElement.setAttribute('data-theme', '{theme_val}');")
    await snap(f"{mode}-01-login.png", 1000)

    # 2. Login Page (Filled with Credentials)
    await page.fill("#login-username", "admin")
    await page.fill("#login-password", "Admin#2026!")
    await snap(f"{mode}-02-login-filled.png", 800)

    # 3. Perform Login
    await page.click("#login-submit-btn")
    await page.wait_for_selector("#pill-nav-group", state="visible")
    await page.wait_for_timeout(2000)

    # 4. Dashboard Overview - All Products
    await page.goto("http://127.0.0.1:8000/#/dashboard", wait_until="networkidle")
    await snap(f"{mode}-03-dashboard-overview-all.png", 2000)

    # 5. Dashboard - Website Product Tab
    await page.evaluate("""() => {
        const btns = Array.from(document.querySelectorAll('.tab-btn, .filter-chip, button'));
        const btn = btns.find(b => b.textContent.includes('Website'));
        if (btn) btn.click();
    }""")
    await snap(f"{mode}-04-dashboard-website.png", 1500)

    # 6. Dashboard - Mobile App Product Tab
    await page.evaluate("""() => {
        const btns = Array.from(document.querySelectorAll('.tab-btn, .filter-chip, button'));
        const btn = btns.find(b => b.textContent.includes('App'));
        if (btn) btn.click();
    }""")
    await snap(f"{mode}-05-dashboard-app.png", 1500)

    # 7. Dashboard - Admin Console Product Tab
    await page.evaluate("""() => {
        const btns = Array.from(document.querySelectorAll('.tab-btn, .filter-chip, button'));
        const btn = btns.find(b => b.textContent.includes('Admin Console'));
        if (btn) btn.click();
    }""")
    await snap(f"{mode}-06-dashboard-admin.png", 1500)

    # 8. Dashboard - 24h Time Range Selected
    await page.evaluate("""() => {
        const sel = document.querySelector('select');
        if (sel) {
            sel.value = '24h';
            sel.dispatchEvent(new Event('change', {bubbles: true}));
        }
    }""")
    await snap(f"{mode}-07-dashboard-range-24h.png", 1500)

    # 9. Services Catalog - All Services
    await page.click("#nav-services")
    await page.wait_for_timeout(1500)
    await snap(f"{mode}-08-services-catalog.png", 1500)

    # 10. Services Catalog - Filtered / Search
    await page.evaluate("""() => {
        const search = document.querySelector('input[type="search"]');
        if (search) {
            search.value = 'Payment';
            search.dispatchEvent(new Event('input', {bubbles: true}));
        }
    }""")
    await snap(f"{mode}-09-services-filtered.png", 1500)

    # 11. Service Detail - Payment Gateway Overview
    await page.goto("http://127.0.0.1:8000/#/services/payments", wait_until="networkidle")
    await snap(f"{mode}-10-service-detail-payments.png", 2500)

    # 12. Service Detail - Thresholds Editing
    await page.evaluate("""() => {
        const errInput = document.querySelector('input[name="max_error_pct"]') ||
                         document.querySelector('input[type="number"]');
        if (errInput) {
            errInput.value = '4.5';
            errInput.focus();
        }
    }""")
    await snap(f"{mode}-11-service-threshold-edit.png", 1200)

    # 13. Simulator Controls
    await page.click("#nav-simulator")
    await page.wait_for_timeout(1500)
    await snap(f"{mode}-12-simulator-controls.png", 1800)

    # 14. Simulator with Chaos Active (Failing & Slow modes)
    await page.evaluate("""() => {
        fetch('/sim/payments/mode', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({mode: 'failing'})
        });
        fetch('/sim/search/mode', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({mode: 'slow'})
        });
    }""")
    await page.wait_for_timeout(3000)
    await page.goto("http://127.0.0.1:8000/#/simulator", wait_until="networkidle")
    await snap(f"{mode}-13-simulator-chaos-active.png", 2000)

    # 15. Incidents Management - Active Incidents List
    await page.click("#nav-incidents")
    await page.wait_for_timeout(2000)
    await snap(f"{mode}-14-incidents-overview.png", 2000)

    # 16. Incident Detail / Timeline Modal
    await page.evaluate("""() => {
        const rowOrBtn = document.querySelector('table tbody tr') ||
                         document.querySelector('.card button');
        if (rowOrBtn) rowOrBtn.click();
    }""")
    await page.wait_for_timeout(1000)
    await snap(f"{mode}-15-incident-detail-timeline.png", 1500)

    await page.evaluate("""() => {
        const closeBtn = document.getElementById('modal-close-btn');
        if (closeBtn) closeBtn.click();
    }""")

    # 17. Security Audit Log
    await page.click("#nav-audit")
    await page.wait_for_timeout(2000)
    await snap(f"{mode}-16-audit-trail.png", 2000)

    # Reset chaos modes
    await page.evaluate("""() => {
        fetch('/sim/payments/mode', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({mode: 'normal'})
        });
        fetch('/sim/search/mode', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({mode: 'normal'})
        });
    }""")

    await context.close()


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            headless=True,
        )
        await capture_theme_suite(browser, "light")
        await capture_theme_suite(browser, "dark")
        await browser.close()
        print("\nAll Light and Dark mode screenshots captured successfully!")


if __name__ == "__main__":
    asyncio.run(main())
