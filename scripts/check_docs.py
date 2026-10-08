"""Check that all file paths mentioned in README.md and docs/*.md exist in git ls-files."""

import re
import subprocess
from pathlib import Path

FILE_EXTS = (".py", ".js", ".sql", ".css", ".md", ".html", ".png", ".svg", ".jpg", ".jpeg", ".webp")
KNOWN_ROOTS = ("backend", "frontend", "docs", "scripts", "tests", "assets")


def get_tracked_set() -> set[str]:
    out = subprocess.check_output(["git", "ls-files"], text=True)
    tracked = set()
    for line in out.splitlines():
        line = line.strip().replace("\\", "/")
        if not line:
            continue
        tracked.add(line)
        p = Path(line)
        for parent in p.parents:
            s = parent.as_posix()
            if s != ".":
                tracked.add(s)
                tracked.add(s + "/")
    return tracked


def extract_paths_from_doc(doc_path: Path) -> set[str]:
    text = doc_path.read_text(encoding="utf-8")
    paths = set()

    # 1. Backticked tokens
    for tok in re.findall(r"`([^`\n]+)`", text):
        tok = tok.strip()
        # strip pytest selector or line numbers: tests/test_api.py::func or file.py:10
        base = re.split(r"[:#]", tok)[0].strip().replace("\\", "/")
        if base.startswith("http://") or base.startswith("https://") or base.startswith("/"):
            continue
        if any(base.startswith(m) for m in ("GET ", "POST ", "PUT ", "DELETE ")):
            continue

        is_path = any(base.endswith(ext) for ext in FILE_EXTS) or (
            "/" in base and not base.startswith("$")
        )
        if is_path:
            paths.add(base.rstrip("/"))

    # 2. Folder tree in README
    tree_pattern = r"```text\s*\n(service-monitoring-dashboard/.*?)\n```"
    for block in re.findall(tree_pattern, text, re.DOTALL):
        dir_stack: list[tuple[int, str]] = []
        for line in block.splitlines():
            if "service-monitoring-dashboard" in line:
                continue
            m = re.search(r"([│\s]*)[├└]──\s+([a-zA-Z0-9_\-\.\/]+)(.*)", line)
            if not m:
                continue
            prefix, item, rest = m.groups()
            indent = len(prefix)
            item = item.strip()

            while dir_stack and dir_stack[-1][0] >= indent:
                dir_stack.pop()

            parent = dir_stack[-1][1] if dir_stack else ""
            full = f"{parent}/{item}" if parent else item
            paths.add(full.rstrip("/"))

            if item.endswith("/"):
                dir_stack.append((indent, full.rstrip("/")))

            # Check listed files in comment of tree lines
            for cf in re.findall(r"([a-zA-Z0-9_\-\.]+\.(?:css|js|sql|py|md|html))", rest):
                curr_dir = full.rstrip("/") if item.endswith("/") else parent
                if curr_dir:
                    paths.add(f"{curr_dir}/{cf}")
                else:
                    paths.add(cf)

    return paths


def run_check() -> tuple[int, list[tuple[str, str]]]:
    tracked = get_tracked_set()
    doc_files = [Path("README.md")] + sorted(Path("docs").glob("*.md"))

    all_checked: set[tuple[str, str]] = set()
    missing: list[tuple[str, str]] = []

    for doc in doc_files:
        extracted = extract_paths_from_doc(doc)
        for p in sorted(extracted):
            all_checked.add((p, doc.as_posix()))
            norm = p.rstrip("/")
            if norm not in tracked and (norm + "/") not in tracked:
                # Check if it's a bare filename that matches a tracked file basename
                if "/" not in norm and any(t.endswith("/" + norm) or t == norm for t in tracked):
                    continue
                missing.append((p, doc.as_posix()))

    return len(all_checked), sorted(missing)


def main() -> None:
    total, missing = run_check()
    print(f"Total paths checked: {total}")
    if missing:
        print(f"MISSING ({len(missing)}):")
        for path, doc in missing:
            print(f"  - {path} (in {doc})")
    else:
        print("MISSING (0): none")


if __name__ == "__main__":
    main()
