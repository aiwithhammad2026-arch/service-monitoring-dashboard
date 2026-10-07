import sqlite3
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.config import settings
from backend.seed import seed
from backend.simulator import tick
from backend.status import evaluate_service_status

db = Path(tempfile.mkdtemp()) / "demo.db"
settings.db_path, settings.bcrypt_rounds = db, 4
seed(db)
conn = sqlite3.connect(str(db))
conn.row_factory = sqlite3.Row
svc = conn.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]
conn.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc,))

T0 = datetime(2025, 1, 1, tzinfo=UTC)
print(f"{'Min':>3}  {'Mode':<10}  {'Err%':>7}  {'p95':>7}  {'Status':<6} Label")
print("-" * 50)

for m in range(12):
    t = T0 + timedelta(minutes=m)
    mode = "normal" if m < 2 else ("failing" if m < 4 else "recovering")
    if m in (0, 2, 4):
        conn.execute("UPDATE sim_state SET mode=?, mode_since=? WHERE service_id=?",
                     (mode, t.isoformat(), svc))
    conn.commit()
    tick(conn, now=t, seed=42)
    st = evaluate_service_status(conn, svc, now=t)
    cur_mode = conn.execute("SELECT mode FROM sim_state WHERE service_id=?",
                            (svc,)).fetchone()["mode"]
    e = f"{st['error_pct']:.1f}%" if st["error_pct"] is not None else "null"
    p = f"{st['p95']:.0f}ms" if st["p95"] is not None else "null"
    print(f"{m:>3}  {cur_mode:<10}  {e:>7}  {p:>7}  {st['status']:<6} {st['label']}")
conn.close()
