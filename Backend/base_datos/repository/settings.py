"""Repositorio de settings (key-value global)."""
from Backend.base_datos.connection import get_db


def repo_set_setting(key: str, value: str) -> None:
    with get_db() as db:
        db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        db.commit()

def repo_get_org_setting(org: str, key: str) -> str | None:
    """Settings scopeados por organizacion. Tabla aparte de settings global."""
    with get_db() as db:
        row = db.execute(
            "SELECT value FROM org_settings WHERE organization = ? AND key = ?",
            (org, key),
        ).fetchone()
        return row["value"] if row else None


def repo_set_org_setting(org: str, key: str, value: str) -> None:
    with get_db() as db:
        db.execute(
            "INSERT INTO org_settings (organization, key, value) VALUES (?, ?, ?) "
            "ON CONFLICT(organization, key) DO UPDATE SET value = excluded.value",
            (org, key, value),
        )
        db.commit()
