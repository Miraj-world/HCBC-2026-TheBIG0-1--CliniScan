from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone

import asyncpg


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS product_analytics_events (
    id BIGSERIAL PRIMARY KEY,
    event_name TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    image_used BOOLEAN,
    duration_bucket TEXT,
    error_category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""

CREATE_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS product_analytics_events_created_at_idx
ON product_analytics_events (created_at)
"""


def _database_url() -> str:
    return os.getenv(
        "DATABASE_URL_RAW",
        "postgresql://postgres:postgres@localhost:5432/cliniscan",
    )


def hash_session_id(session_id: str) -> str:
    salt = os.getenv("ANALYTICS_HASH_SALT", "cliniscan-anonymous-analytics")
    return hashlib.sha256(f"{salt}:{session_id}".encode("utf-8")).hexdigest()


async def record_event(
    *,
    event_name: str,
    session_id: str,
    image_used: bool | None = None,
    duration_bucket: str | None = None,
    error_category: str | None = None,
) -> None:
    connection = await asyncpg.connect(_database_url())
    try:
        await connection.execute(CREATE_TABLE_SQL)
        await connection.execute(CREATE_INDEX_SQL)
        await connection.execute(
            """
            INSERT INTO product_analytics_events
                (event_name, session_hash, image_used, duration_bucket, error_category)
            VALUES ($1, $2, $3, $4, $5)
            """,
            event_name,
            hash_session_id(session_id),
            image_used,
            duration_bucket,
            error_category,
        )
    finally:
        await connection.close()


async def analytics_summary(days: int) -> dict:
    connection = await asyncpg.connect(_database_url())
    try:
        await connection.execute(CREATE_TABLE_SQL)
        cutoff = datetime.now(timezone.utc)
        rows = await connection.fetch(
            """
            SELECT event_name, COUNT(*) AS event_count,
                   COUNT(DISTINCT session_hash) AS unique_sessions
            FROM product_analytics_events
            WHERE created_at >= $1 - ($2 * INTERVAL '1 day')
            GROUP BY event_name
            ORDER BY event_name
            """,
            cutoff,
            days,
        )
        totals = {
            row["event_name"]: {
                "events": row["event_count"],
                "unique_sessions": row["unique_sessions"],
            }
            for row in rows
        }
        return {"days": days, "events": totals}
    finally:
        await connection.close()
