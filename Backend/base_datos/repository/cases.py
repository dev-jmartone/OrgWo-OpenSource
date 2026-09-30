"""Repositorio de cases. Acceso unico a la tabla. Sin logica de negocio.

Cambios de motor (SQLite -> Postgres) o filtros nuevos por usuario se
hacen aca. Todas las queries filtran por `organization` para aislamiento
multi-user.
"""
import sqlite3
from Backend.base_datos.connection import get_db


def repo_list_cases(org: str) -> list[sqlite3.Row]:
    with get_db() as db:
        return db.execute(
            "SELECT * FROM cases WHERE organization = ? ORDER BY updated_at DESC",
            (org,),
        ).fetchall()


def repo_get_case(cid: str, org: str) -> sqlite3.Row | None:
    with get_db() as db:
        return db.execute(
            "SELECT * FROM cases WHERE id = ? AND organization = ?",
            (cid, org),
        ).fetchone()


def repo_get_case_global(cid: str) -> sqlite3.Row | None:
    with get_db() as db:
        return db.execute(
            "SELECT * FROM cases WHERE id = ?",
            (cid,),
        ).fetchone()


def repo_insert_case(cid: str, fields: dict, ts: str, org: str) -> None:
    cols = list(fields.keys()) + ["id", "created_at", "updated_at", "organization"]
    vals = list(fields.values()) + [cid, ts, ts, org]
    placeholders = ", ".join(["?"] * len(cols))
    with get_db() as db:
        db.execute(
            f"INSERT INTO cases ({', '.join(cols)}) VALUES ({placeholders})",
            vals,
        )
        db.commit()


def repo_update_case(cid: str, sets: dict, ts: str, org: str) -> None:
    """Update parcial. sets = {col: value, ...}. Siempre actualiza updated_at."""
    if not sets:
        cols = ["updated_at"]
        vals = [ts, cid, org]
    else:
        cols = list(sets.keys()) + ["updated_at"]
        vals = list(sets.values()) + [ts, cid, org]
    assignments = ", ".join(f"{c} = ?" for c in cols)
    with get_db() as db:
        db.execute(
            f"UPDATE cases SET {assignments} WHERE id = ? AND organization = ?",
            vals,
        )
        db.commit()


def repo_update_case_global(cid: str, sets: dict, ts: str) -> None:
    """Update global sin filtrar por organizacion (para transferencias o recupero multi-org)."""
    if not sets:
        cols = ["updated_at"]
        vals = [ts, cid]
    else:
        cols = list(sets.keys()) + ["updated_at"]
        vals = list(sets.values()) + [ts, cid]
    assignments = ", ".join(f"{c} = ?" for c in cols)
    with get_db() as db:
        db.execute(
            f"UPDATE cases SET {assignments} WHERE id = ?",
            vals,
        )
        db.commit()


def repo_delete_case(cid: str, org: str) -> None:
    with get_db() as db:
        db.execute("DELETE FROM cases WHERE id = ? AND organization = ?", (cid, org))
        db.commit()


def repo_stats(org: str, owner_id: str | None = None) -> dict:
    """Stats de cases. Si owner_id viene seteado, filtra al operador individual
    dentro de la org (util cuando varios usan la misma organization)."""
    with get_db() as db:
        if owner_id:
            total = db.execute(
                "SELECT COUNT(*) FROM cases WHERE organization = ? AND owner_id = ?",
                (org, owner_id),
            ).fetchone()[0]
            by_estado = {
                r["estado"]: r["c"]
                for r in db.execute(
                    "SELECT estado, COUNT(*) as c FROM cases WHERE organization = ? AND owner_id = ? GROUP BY estado",
                    (org, owner_id),
                ).fetchall()
            }
        else:
            total = db.execute(
                "SELECT COUNT(*) FROM cases WHERE organization = ?", (org,)
            ).fetchone()[0]
            by_estado = {
                r["estado"]: r["c"]
                for r in db.execute(
                    "SELECT estado, COUNT(*) as c FROM cases WHERE organization = ? GROUP BY estado",
                    (org,),
                ).fetchall()
            }
        return {"total": total, "by_estado": by_estado}

def repo_restore(payload: dict, org: str) -> None:
    """Pisa cases + events para la organizacion actual."""
    with get_db() as db:
        cases = db.execute(
            "SELECT id FROM cases WHERE organization = ?", (org,)
        ).fetchall()
        case_ids = [c["id"] for c in cases]
        if case_ids:
            placeholders = ", ".join(["?"] * len(case_ids))
            db.execute(
                f"DELETE FROM events WHERE case_id IN ({placeholders})", case_ids
            )
            db.execute(f"DELETE FROM cases WHERE organization = ?", (org,))

        for c in payload.get("cases", []):
            c["organization"] = org
            cols = ", ".join(c.keys())
            placeholders = ", ".join(["?"] * len(c))
            db.execute(
                f"INSERT INTO cases ({cols}) VALUES ({placeholders})",
                list(c.values()),
            )
        for e in payload.get("events", []):
            cols = [k for k in e.keys() if k != "id"]
            vals = [e[k] for k in cols]
            placeholders = ", ".join(["?"] * len(vals))
            db.execute(
                f"INSERT INTO events ({', '.join(cols)}) VALUES ({placeholders})",
                vals,
            )
        db.commit()
