"""
Backend/api/users_lookup.py

Endpoints HTTP para resolver nombres → email via el GAL del Outlook
local del operador. No requiere admin M365 ni registrar app en Entra ID.
La lógica de COM vive en Backend/outlook_lookup.py.
"""
from flask import Blueprint, jsonify, request, session

from Backend.integraciones.outlook.lookup import lookup_user_email
from Backend.servicios.users_directory import (
    repo_list_users, repo_get_user, repo_upsert_user, infer_company_from_email,
    service_lookup_and_update_case,
)
from Backend.utils import current_user_org, now_iso

users_lookup_bp = Blueprint('users_lookup', __name__)


@users_lookup_bp.route("/api/users/directory", methods=["GET"])
def route_users_directory():
    """Lista el directorio canonico de usuarios. Filtros opcionales:
       ?company=Empresa Principal     - solo de esa empresa.
       ?limit=100          - cap resultado."""
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    company = request.args.get("company") or None
    limit_raw = request.args.get("limit")
    limit = int(limit_raw) if limit_raw and limit_raw.isdigit() else None
    return jsonify({"users": repo_list_users(company, limit)})


@users_lookup_bp.route("/api/users/directory", methods=["POST"])
def route_users_directory_upsert():
    """Override manual: agrega o pisa un usuario en el directorio.
    Util para nombres que el GAL no resuelve (typos en Remedy, gente
    con nombre largo, etc).

    Body: {"name": "Maximiliano Martin", "email": "mmartin@...", "company": "Empresa Principal" (opcional)}
    Si company no viene, se infiere del dominio del email."""
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    company = (data.get("company") or "").strip() or None
    if not name or not email:
        return jsonify({"error": "name y email requeridos"}), 400
    if not company:
        company = infer_company_from_email(email)
    inserted = repo_upsert_user(name, email, company)
    return jsonify({"ok": True, "inserted": inserted, "name": name, "email": email, "company": company})


@users_lookup_bp.route("/api/users/directory/backfill", methods=["POST"])
def route_users_directory_backfill():
    """Backfill SINCRONO. Procesa dos fuentes:

    1. Cases locales sin email (lookup contra Outlook GAL + UPDATE case).
    2. Lista opcional `names` en el body — para resolver tickets de Remedy
       live que NO tienen case local todavia. Devuelve el map resuelto
       asi el frontend puede aplicarlo a los tickets en memoria.

    Body JSON opcional:
        {"names": ["JUAN PEREZ", "MARIA LOPEZ", ...]}

    Response:
        {
            "ok": True,
            "stats": {checked, found, not_found, errors, seeded_from_existing},
            "resolved": {
                "JUAN PEREZ": {"email": "...", "company": "Empresa Principal"},
                "MARIA LOPEZ": null,
                ...
            }
        }
    """
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    from Backend.servicios.users_directory import (
        seed_from_cases, backfill_missing_emails,
        repo_get_user, repo_upsert_user, infer_company_from_email,
    )
    from Backend.integraciones.outlook.lookup import lookup_user_email
    try:
        seeded = seed_from_cases()
        remedy_token = session.get("remedy_token")
        stats = backfill_missing_emails(verbose=True, remedy_token=remedy_token)
        stats["seeded_from_existing"] = seeded

        # Resolver lista de nombres extra (tickets Remedy live).
        body = request.get_json(silent=True) or {}
        extra_names = body.get("names") or []
        resolved: dict[str, dict | None] = {}
        if isinstance(extra_names, list) and extra_names:
            print(f"[users_directory] backfill extra names: {len(extra_names)} desde Remedy")
            for raw_name in extra_names:
                name = (raw_name or "").strip()
                if not name:
                    continue
                # Cache directorio primero.
                cached = repo_get_user(name)
                if cached:
                    if cached["email"] == "NOT_FOUND":
                        resolved[name] = None
                    else:
                        resolved[name] = {"email": cached["email"], "company": cached["company"]}
                    continue
                email = lookup_user_email(name)
                source = "outlook-gal"
                if not email and remedy_token:
                    from Backend.integraciones.remedy.client import lookup_remedy_user_email
                    email = lookup_remedy_user_email(remedy_token, name)
                    source = "remedy-people"

                if not email:
                    resolved[name] = None
                    print(f"[users_directory] extra miss: {name}")
                    # Cache the miss to avoid querying Outlook/Remedy next time
                    repo_upsert_user(name, "NOT_FOUND", None)
                    continue
                company = infer_company_from_email(email)
                repo_upsert_user(name, email, company)
                resolved[name] = {"email": email, "company": company}
                print(f"[users_directory] extra hit ({source}): {name} -> {email}  [{company or 'sin company'}]")

        return jsonify({"ok": True, "stats": stats, "resolved": resolved})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@users_lookup_bp.route("/api/users/lookup", methods=["GET"])
def route_users_lookup():
    """Lookup on-demand: ?name=Apellido Nombre → {email: "..."} o {email: null}.
    Primero chequea directorio canonico, sino dispara Outlook GAL con Remedy fallback."""
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"email": None, "error": "name requerido"}), 400

    cached = repo_get_user(name)
    if cached:
        return jsonify({"email": cached["email"], "company": cached["company"], "source": "directory"})

    email = lookup_user_email(name)
    source = "outlook-gal"
    remedy_token = session.get("remedy_token")
    if not email and remedy_token:
        from Backend.integraciones.remedy.client import lookup_remedy_user_email
        email = lookup_remedy_user_email(remedy_token, name)
        source = "remedy-people"

    if email:
        company = infer_company_from_email(email)
        repo_upsert_user(name, email, company)
        return jsonify({"email": email, "company": company, "source": source})
    return jsonify({"email": None, "source": "not-found"})


@users_lookup_bp.route("/api/users/lookup/<cid>", methods=["POST"])
def route_users_lookup_case(cid):
    """Lookup y persistir en un case específico. Chequea directorio
    canonico primero (instant), sino dispara Outlook GAL con Remedy fallback
    y popula directorio para futuros hits."""
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    org = current_user_org()
    remedy_token = session.get("remedy_token")
    
    res = service_lookup_and_update_case(cid, org, remedy_token)
    if not res:
        return jsonify({"error": "case no encontrado"}), 404
    res["case_id"] = cid
    return jsonify(res)
