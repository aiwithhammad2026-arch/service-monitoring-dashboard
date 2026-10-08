# Manual UI Verification Checklist (375px & 1440px)
*not verified by me*

- [ ] Login works for `admin` (`Admin#2026!`) and `viewer` (`Viewer#2026!`)
- [ ] Viewer sees no Admin navigation links (Simulator, Audit)
- [ ] Product and time filters dynamically update KPI cards and charts
- [ ] All 10 service detail pages load metrics and history charts
- [ ] Info popovers (ⓘ) open via keyboard navigation (Enter/Space)
- [ ] Theme toggle (Dark/Light) persists across page reloads
- [ ] Stale banner/badge appears when service reporting is paused
- [ ] Error state with Retry button appears when backend is stopped and recovers on restart
- [ ] CSV exports download for metrics and incidents
- [ ] `uv run pytest -q` passes 100% in local terminal
- [ ] Pill nav active state (solid pill on active item, muted on inactive)
- [ ] Sheet radius at 375px (16px/compact) and 1440px (28-32px floating sheet)
- [ ] Hatched bars render (diagonal-hatch fill on request bars)
- [ ] Dot-matrix tiles render (columns of dots for throughput and users)
- [ ] Insight tile text readable with contrast scrim (>= 4.5:1 WCAG)
- [ ] No horizontal page scroll on 375px mobile viewport
- [ ] Dark theme parity across all cards, badges, and charts

