"""Bring the SQLite database up to the newest db/migrations/NNN_*.sql. Stdlib only.

    python db/migrate.py [path]

The path defaults to $DATABASE_PATH, then data/quire.db at the project root.
PRAGMA user_version holds the number of the last applied migration, so a second run
does nothing. Each migration runs in its own transaction.
"""
import os
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"
DEFAULT_PATH = ROOT / "data" / "quire.db"


def default_path():
    return pathlib.Path(os.environ.get("DATABASE_PATH") or DEFAULT_PATH)


def connect(path=None):
    """The one way the worker opens the database: the pragmas every connection needs,
    and no implicit transactions (callers write BEGIN IMMEDIATE themselves)."""
    conn = sqlite3.connect(path or default_path(), isolation_level=None)
    conn.execute("pragma foreign_keys = on")
    conn.execute("pragma journal_mode = wal")
    conn.execute("pragma busy_timeout = 5000")
    return conn


def migrate(path=None):
    """Apply every migration newer than the database. Returns the resulting version."""
    path = pathlib.Path(path or default_path())
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        version = conn.execute("pragma user_version").fetchone()[0]
        for file in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
            number = int(file.name[:3])
            if number <= version:
                continue
            sql = file.read_text(encoding="utf-8")
            try:
                conn.executescript(f"begin immediate;\n{sql}\n;pragma user_version = {number};\ncommit;")
            except sqlite3.Error as e:
                if conn.in_transaction:
                    conn.execute("rollback")
                raise RuntimeError(f"migration {file.name} failed: {e}") from e
            version = number
        return version
    finally:
        conn.close()


if __name__ == "__main__":
    target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else default_path()
    print(f"{target}: version {migrate(target)}")
