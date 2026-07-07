import os
import sqlite3
import threading


_DEFAULT_DB = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "usage.db")


class TokenTracker:
    """Tracks token usage across different AI providers, persisted to SQLite."""

    def __init__(self, db_path: str | None = None):
        self._db_path = db_path or _DEFAULT_DB
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider TEXT NOT NULL,
                    prompt_tokens INTEGER NOT NULL,
                    completion_tokens INTEGER NOT NULL,
                    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )"""
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage(provider)")

    def record_usage(self, provider_label: str, prompt: int, completion: int):
        with self._lock:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    "INSERT INTO usage (provider, prompt_tokens, completion_tokens) VALUES (?, ?, ?)",
                    (provider_label, prompt, completion),
                )
                conn.commit()

    def get_stats(self) -> dict:
        with self._lock:
            with sqlite3.connect(self._db_path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    """SELECT provider,
                               SUM(prompt_tokens) AS prompt_tokens,
                               SUM(completion_tokens) AS completion_tokens,
                               SUM(prompt_tokens + completion_tokens) AS total_tokens,
                               COUNT(*) AS request_count
                        FROM usage
                        GROUP BY provider"""
                ).fetchall()
                return {
                    r["provider"]: {
                        "prompt_tokens": r["prompt_tokens"],
                        "completion_tokens": r["completion_tokens"],
                        "total_tokens": r["total_tokens"],
                        "request_count": r["request_count"],
                    }
                    for r in rows
                }

    def reset(self):
        with self._lock:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute("DELETE FROM usage")
                conn.commit()