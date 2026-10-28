"""Online SQLite backup, including committed WAL pages; never copy a live DB file."""
from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from auth_system import AuthSettings
from medsim_backend.config import load_env_local


def backup_database(source: Path, directory: Path) -> Path | None:
    if not source.exists():
        return None
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = directory / f"medsim-{stamp}.db"
    # Exclusive creation prevents accidental overwrites; source is read-only.
    with target.open("xb"):
        pass
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=10)) as original:
        with closing(sqlite3.connect(target)) as snapshot:
            original.backup(snapshot)
            if snapshot.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("SQLite backup integrity check failed; pilot was not started")
    return target


if __name__ == "__main__":
    load_env_local()
    target = backup_database(AuthSettings.from_env().database_path,
                             Path(__file__).resolve().parent / "data" / "pilot-backups")
    print(f"SQLite backup verified: {target}" if target else "No existing SQLite database; first startup will create it.")
