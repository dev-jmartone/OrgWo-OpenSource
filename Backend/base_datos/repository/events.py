"""Repositorio de eventos (timeline de cases). Sin logica de negocio."""
from Backend.base_datos.connection import get_db


def repo_add_event(cid: str, ts: str, text: str) -> None:
    with get_db() as db:
        db.execute(
            "INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)",
            (cid, ts, text),
        )
        db.commit()


def repo_events_grouped_by_case(org: str) -> dict[str, list[dict]]:
    """Eventos agrupados por case, scopeados a la organizacion (JOIN con cases).
    Antes traia TODOS los eventos de TODAS las orgs en una sola query."""
    with get_db() as db:
        out: dict[str, list[dict]] = {}
        for ev in db.execute(
            """SELECT e.case_id, e.at, e.text FROM events e
               JOIN cases c ON c.id = e.case_id
               WHERE c.organization = ?
               ORDER BY e.at DESC""",
            (org,),
        ).fetchall():
            out.setdefault(ev["case_id"], []).append(
                {"at": ev["at"], "text": ev["text"]}
            )
        return out


def repo_events_of(cid: str, limit: int = 50) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT at, text FROM events WHERE case_id = ? ORDER BY at DESC LIMIT ?",
            (cid, limit),
        ).fetchall()
        return [{"at": r["at"], "text": r["text"]} for r in rows]
