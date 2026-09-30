"""Repositorio de adjuntos (archivos asociados a cases). Sin logica negocio.

El path en disco vive en la tabla attachments; el binario en si vive en
disco bajo ATTACH_DIR (ver config.py).
"""
import sqlite3
from Backend.base_datos.connection import get_db


def repo_attach_insert(att_id: str, case_id: str, fields: dict, ts: str) -> None:
    cols = list(fields.keys()) + ["id", "case_id", "created_at"]
    vals = list(fields.values()) + [att_id, case_id, ts]
    placeholders = ", ".join(["?"] * len(cols))
    with get_db() as db:
        db.execute(
            f"INSERT INTO attachments ({', '.join(cols)}) VALUES ({placeholders})",
            vals,
        )
        db.commit()


def repo_attach_list_for_case(case_id: str, org: str) -> list[sqlite3.Row]:
    with get_db() as db:
        return db.execute(
            """
            SELECT a.* FROM attachments a
            JOIN cases c ON c.id = a.case_id
            WHERE a.case_id = ? AND c.organization = ?
            ORDER BY a.created_at DESC
            """,
            (case_id, org),
        ).fetchall()


def repo_attach_get(att_id: str, org: str) -> sqlite3.Row | None:
    with get_db() as db:
        return db.execute(
            """
            SELECT a.* FROM attachments a
            JOIN cases c ON c.id = a.case_id
            WHERE a.id = ? AND c.organization = ?
            """,
            (att_id, org),
        ).fetchone()


def repo_attach_delete(att_id: str, org: str) -> str | None:
    """Borra el row y devuelve el path del archivo en disco para que el caller
    lo borre. Devuelve None si el adjunto no existe en el org."""
    with get_db() as db:
        row = db.execute(
            """
            SELECT a.path FROM attachments a
            JOIN cases c ON c.id = a.case_id
            WHERE a.id = ? AND c.organization = ?
            """,
            (att_id, org),
        ).fetchone()
        if not row:
            return None
        db.execute("DELETE FROM attachments WHERE id = ?", (att_id,))
        db.commit()
        return row["path"]


def repo_attach_archive(att_id: str, org: str | None, ts: str) -> str | None:
    """Marca el adjunto como archivado: setea archived_at + anula path.
    Devuelve el path previo para que el caller borre el binario en disco.
    Si org es None, no filtra por organization (uso en scripts de cleanup
    cross-org). Idempotente: si ya esta archivado, devuelve None."""
    with get_db() as db:
        if org is None:
            row = db.execute(
                "SELECT path, archived_at FROM attachments WHERE id = ?",
                (att_id,),
            ).fetchone()
        else:
            row = db.execute(
                """
                SELECT a.path, a.archived_at FROM attachments a
                JOIN cases c ON c.id = a.case_id
                WHERE a.id = ? AND c.organization = ?
                """,
                (att_id, org),
            ).fetchone()
        if not row or row["archived_at"]:
            return None
        previous_path = row["path"]
        db.execute(
            "UPDATE attachments SET archived_at = ?, path = NULL WHERE id = ?",
            (ts, att_id),
        )
        db.commit()
        return previous_path


def repo_attach_list_archivable(kind: str) -> list[sqlite3.Row]:
    """Lista attachments de un kind dado, asociados a cases done/reject/
    not_accepted, todavia con binario en disco (archived_at IS NULL).
    Pensado para scripts de cleanup batch. Cross-org."""
    with get_db() as db:
        return db.execute(
            """
            SELECT a.id, a.case_id, a.filename, a.path, c.wo, c.organization
            FROM attachments a
            JOIN cases c ON c.id = a.case_id
            WHERE a.kind = ?
              AND a.archived_at IS NULL
              AND c.estado IN ('done', 'reject', 'not_accepted')
            """,
            (kind,),
        ).fetchall()
