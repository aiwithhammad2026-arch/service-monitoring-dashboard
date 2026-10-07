"""Automated tests for documentation integrity and file path accuracy."""

from scripts.check_docs import run_check


def test_documentation_paths_exist() -> None:
    """Verify that all file paths mentioned in README.md and docs/*.md exist in git ls-files."""
    total, missing = run_check()
    assert total > 0, "No paths were found/checked in documentation."
    assert not missing, f"Documentation references missing or fictional paths: {missing}"
