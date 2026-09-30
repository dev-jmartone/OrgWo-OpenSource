"""Directorio de usuarios (registry de personas conocidas).

Tabla `users_directory` indexa nombre → email + company. Se popula a partir
de los cases que ya tienen email + via Outlook GAL lookup en background al
arrancar el server (para cases sin email).

Empresa se parsea del dominio del mail. Cubre dominios corporativos
directos (`@empresa.com`) + sub-dominios de servicios externos
(`@serv.externos.empresa.com`).
"""
from __future__ import annotations

import re
from typing import Iterable

from Backend.base_datos.connection import get_db
from Backend.utils import now_iso, parse_company_from_email


def infer_company_from_email(email: str) -> str | None:
    """Alias historico. Fuente unica de la regla dominio -> empresa:
    Backend.utils.parse_company_from_email (antes habia dos implementaciones con
    reglas distintas, dando 'company' inconsistente segun el camino)."""
    return parse_company_from_email(email)


def _normalize_name_key(name: str) -> str:
    """Clave canonica para deduplicar nombres: lowercase + espacios
    colapsados. Asi 'JUAN  PEREZ' y 'Juan Perez' apuntan al mismo registro."""
    return " ".join(re.split(r"\s+", (name or "").strip().lower()))


def repo_upsert_user(name: str, email: str, company: str | None = None) -> bool:
    """Inserta o actualiza un usuario en el directorio.

    Returns:
        True si se inserto (registro nuevo), False si solo se actualizo o
        no se hizo nada (mismo email + company ya estaba).
    """
    if not name or not email:
        return False

    if email != "NOT_FOUND":
        from Backend.utils import is_valid_corporate_email
        if not is_valid_corporate_email(email):
            print(f"[users_directory] repo_upsert_user: descartando email invalido '{email}' para '{name}'")
            return False

    key = _normalize_name_key(name)
    if not key:
        return False
    company = company or infer_company_from_email(email)
    ts = now_iso()

    with get_db() as db:
        existing = db.execute(
            "SELECT id, email, company FROM users_directory WHERE name_key = ?",
            (key,),
        ).fetchone()
        if existing:
            same_email = (existing["email"] or "").lower() == email.lower()
            same_company = (existing["company"] or "") == (company or "")
            if same_email and same_company:
                return False
            db.execute(
                "UPDATE users_directory SET email = ?, company = ?, updated_at = ? WHERE id = ?",
                (email, company, ts, existing["id"]),
            )
            db.commit()
            return False
        db.execute(
            "INSERT INTO users_directory (name_key, name, email, company, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (key, name.strip(), email, company, ts, ts),
        )
        db.commit()
        return True


def repo_get_user(name: str) -> dict | None:
    key = _normalize_name_key(name)
    if not key:
        return None
    with get_db() as db:
        row = db.execute(
            "SELECT name, email, company FROM users_directory WHERE name_key = ?",
            (key,),
        ).fetchone()
        return dict(row) if row else None


def repo_list_users(company: str | None = None, limit: int | None = None) -> list[dict]:
    sql = "SELECT name, email, company, updated_at FROM users_directory"
    params: list = []
    if company:
        sql += " WHERE company = ?"
        params.append(company)
    sql += " ORDER BY name COLLATE NOCASE"
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    with get_db() as db:
        return [dict(r) for r in db.execute(sql, params).fetchall()]


# ── Backfill on startup ──────────────────────────────────────────────────────

def seed_from_cases() -> int:
    """Importa al directorio todos los cases que ya tienen email cargado.
    No hace lookups Outlook — solo agrega lo que ya tenemos en DB local."""
    inserted = 0
    with get_db() as db:
        rows = db.execute(
            "SELECT DISTINCT name, email, company FROM cases "
            "WHERE name IS NOT NULL AND name != '' "
            "AND email IS NOT NULL AND email != ''"
        ).fetchall()
    for r in rows:
        if repo_upsert_user(r["name"], r["email"], r["company"]):
            inserted += 1
    return inserted


def backfill_missing_emails(verbose: bool = True, remedy_token: str | None = None) -> dict:
    """Recorre cases SIN email + intenta lookup contra Outlook GAL.
    Si falla el lookup local (Outlook Classic), se intenta Remedy (New Outlook fallback).

    Returns dict con stats:
        {checked: int, found: int, not_found: int, errors: int}

    verbose=True imprime una linea por case al stdout para debuggear casos
    en los que el lookup falla (Outlook cerrado, GAL sin entry, etc).
    """
    from Backend.integraciones.outlook.lookup import lookup_user_email

    with get_db() as db:
        rows = db.execute(
            "SELECT c.id, c.name FROM cases c "
            "LEFT JOIN users_directory u ON LOWER(TRIM(c.name)) = LOWER(u.name) "
            "WHERE c.name IS NOT NULL AND c.name != '' "
            "AND (c.email IS NULL OR c.email = '') "
            "AND (u.email IS NULL OR u.email != 'NOT_FOUND')"
        ).fetchall()

    stats = {"checked": len(rows), "found": 0, "not_found": 0, "errors": 0}
    if verbose:
        print(f"[users_directory] backfill start: {stats['checked']} cases sin email")

    for r in rows:
        name = r["name"]
        try:
            cached = repo_get_user(name)
            if cached:
                if cached["email"] == "NOT_FOUND":
                    stats["not_found"] += 1
                    continue
                email = cached["email"]
                company = cached["company"]
                source = "directory-cache"
            else:
                email = lookup_user_email(name)
                source = "outlook-gal"
                if not email and remedy_token:
                    from Backend.integraciones.remedy.client import lookup_remedy_user_email
                    email = lookup_remedy_user_email(remedy_token, name)
                    source = "remedy-people"

                if not email:
                    stats["not_found"] += 1
                    if verbose:
                        print(f"[users_directory] miss: {name}")
                    # Cache the miss to avoid querying Outlook/Remedy next time
                    repo_upsert_user(name, "NOT_FOUND", None)
                    continue
                company = infer_company_from_email(email)
                repo_upsert_user(name, email, company)

            with get_db() as db:
                if company:
                    db.execute(
                        "UPDATE cases SET email = ?, company = COALESCE(NULLIF(company, ''), ?) WHERE id = ?",
                        (email, company, r["id"]),
                    )
                else:
                    db.execute(
                        "UPDATE cases SET email = ? WHERE id = ?",
                        (email, r["id"]),
                    )
                db.commit()
            stats["found"] += 1
            if verbose:
                print(f"[users_directory] hit  ({source}): {name} -> {email}  [{company or 'sin company'}]")
        except Exception as e:
            stats["errors"] += 1
            if verbose:
                print(f"[users_directory] ERR  : {name} -> {e}")

    if verbose:
        print(f"[users_directory] backfill done: {stats}")
    return stats


# Compat: nombre legacy.
backfill_missing_emails_async = backfill_missing_emails


def run_startup_seed_and_backfill(in_background: bool = True) -> None:
    """Pipeline completo de arranque:
      1. seed_from_cases (instantaneo, sin red).
      2. backfill_missing_emails_async (puede tardar, queda en thread).
    """
    import threading

    def _job():
        try:
            seeded = seed_from_cases()
            if seeded:
                print(f"[users_directory] seed: {seeded} usuarios nuevos desde cases.")
        except Exception as e:
            print(f"[users_directory] seed fallo: {e}")
        try:
            found = backfill_missing_emails_async()
            if found:
                print(f"[users_directory] backfill: {found} cases actualizados con email + company.")
        except Exception as e:
            print(f"[users_directory] backfill fallo: {e}")

    if in_background:
        threading.Thread(target=_job, daemon=True, name="users-directory-backfill").start()
    else:
        _job()


def service_lookup_and_update_case(cid: str, org: str, remedy_token: str | None = None) -> dict | None:
    from Backend.integraciones.outlook.lookup import lookup_user_email
    
    with get_db() as db:
        row = db.execute(
            "SELECT id, name, email FROM cases WHERE id = ? AND organization = ?",
            (cid, org),
        ).fetchone()
        if not row:
            return None
        if row["email"]:
            return {"email": row["email"], "company": None, "source": "cached"}

        # Hit directorio antes de Outlook.
        cached = repo_get_user(row["name"])
        if cached:
            email = cached["email"]
            company = cached["company"]
            updates_sql = (
                "UPDATE cases SET email = ?, company = COALESCE(NULLIF(company, ''), ?), updated_at = ? WHERE id = ?"
                if company else
                "UPDATE cases SET email = ?, updated_at = ? WHERE id = ?"
            )
            if company:
                db.execute(updates_sql, (email, company, now_iso(), cid))
            else:
                db.execute(updates_sql, (email, now_iso(), cid))
            db.commit()
            return {"email": email, "company": company, "source": "directory"}

        # Sin hit local → Outlook GAL con Remedy fallback.
        email = lookup_user_email(row["name"])
        source = "outlook-gal"
        if not email and remedy_token:
            from Backend.integraciones.remedy.client import lookup_remedy_user_email
            email = lookup_remedy_user_email(remedy_token, row["name"])
            source = "remedy-people"

        if email:
            company = infer_company_from_email(email)
            repo_upsert_user(row["name"], email, company)
            if company:
                db.execute(
                    "UPDATE cases SET email = ?, company = COALESCE(NULLIF(company, ''), ?), updated_at = ? WHERE id = ?",
                    (email, company, now_iso(), cid),
                )
            else:
                db.execute(
                    "UPDATE cases SET email = ?, updated_at = ? WHERE id = ?",
                    (email, now_iso(), cid),
                )
            db.commit()
            return {"email": email, "company": company, "source": source}
        return {"email": None, "source": "not-found"}

