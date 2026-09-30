"""Servicio de estadísticas de grupos Remedy y extracción fragmentada.

Gestiona la extracción controlada y en lotes (anti-saturación de WebCenter)
para los 3 grupos asignados de la mesa de ayuda:
  - TECNOLOGIA USUARIOS DT
  - CTU DT
  - TECNOLOGIA CELULARES

Incluye la clasificación rigurosa de tickets provenientes de JARVIS CHATBOT
según la empresa real del usuario (Empresa Principal vs. Subsidiaria) sin exponer nombres personales.
"""
from __future__ import annotations

import re
import time
import json
import threading
from datetime import datetime, timezone

from Backend.base_datos.connection import get_db
from Backend.integraciones.remedy import client
from Backend.integraciones.remedy.parsers import (
    smart_case_name,
    normalize_company,
    map_status,
    parse_element_type,
)
from Backend.servicios import remedy_session
from Backend.servicios.users_directory import _normalize_name_key, repo_upsert_user
from Backend.utils import now_iso, parse_company_from_email, parse_submit_month, format_month_label


import os
from Backend.config import REMEDY_ASSIGNED_GROUPS

# ── Estado de Sincronización en Memoria ────────────────────────────────────────
_sync_state = {
    "is_syncing": False,
    "status": "idle",  # 'idle', 'running', 'completed', 'error', 'cancelled'
    "current_group": "",
    "current_form": "",
    "progress_percent": 0,
    "tickets_fetched": 0,
    "batches_processed": 0,
    "current_message": "Listo para sincronizar",
    "error": None,
    "start_time": None,
    "end_time": None,
}

_cancel_requested = False
_sync_lock = threading.Lock()


def get_sync_status() -> dict:
    """Retorna una copia segura del estado actual de sincronización."""
    with _sync_lock:
        return dict(_sync_state)


def request_sync_cancel() -> dict:
    """Solicita la cancelación de la sincronización en curso."""
    global _cancel_requested
    with _sync_lock:
        if _sync_state["is_syncing"]:
            _cancel_requested = True
            _sync_state["current_message"] = "Cancelación solicitada por el administrador..."
            return {"ok": True, "message": "Cancelación solicitada"}
        return {"ok": False, "message": "No hay sincronización activa"}


def start_remedy_stats_sync(
    user_id: str,
    token: str,
    days_back: int | None = 30,
    include_closed: bool = True,
    groups: list[str] | None = None,
) -> tuple[bool, str]:
    """Inicia el proceso de sincronización fragmentada en un hilo en segundo plano."""
    global _cancel_requested
    with _sync_lock:
        if _sync_state["is_syncing"]:
            return False, "Ya hay una sincronización en curso"

        _cancel_requested = False
        _sync_state["is_syncing"] = True
        _sync_state["status"] = "running"
        _sync_state["progress_percent"] = 0
        _sync_state["tickets_fetched"] = 0
        _sync_state["batches_processed"] = 0
        _sync_state["current_message"] = "Iniciando extracción fragmentada..."
        _sync_state["error"] = None
        _sync_state["start_time"] = now_iso()
        _sync_state["end_time"] = None

    target_groups = groups or list(REMEDY_ASSIGNED_GROUPS)

    worker = threading.Thread(
        target=_run_sync_worker,
        args=(user_id, token, days_back, include_closed, target_groups),
        daemon=True,
        name="remedy-stats-sync-worker",
    )
    worker.start()
    return True, "Sincronización iniciada"


# ── Worker de Sincronización en Segundo Plano ─────────────────────────────────

def _run_sync_worker(
    user_id: str,
    initial_token: str,
    days_back: int | None,
    include_closed: bool,
    target_groups: list[str],
) -> None:
    token = initial_token
    total_steps = len(target_groups) * 2  # INC y WO por cada grupo
    current_step_num = 0
    total_tickets_stored = 0

    print(f"[remedy_stats] Iniciando sincronización para grupos: {target_groups}, days_back={days_back}, closed={include_closed}")

    # 1. Cargar diccionarios locales en memoria para mapeo ultrarrápido
    directory_map = {}
    cases_user_map = {}
    cases_email_map = {}
    local_users_map = {}
    try:
        with get_db() as db:
            dir_rows = db.execute("SELECT name_key, email, company FROM users_directory WHERE email IS NOT NULL AND email != '' AND email != 'NOT_FOUND'").fetchall()
            for r in dir_rows:
                directory_map[r["name_key"]] = {"email": r["email"], "company": r["company"]}

            case_rows = db.execute("SELECT DISTINCT name, email, company FROM cases WHERE name IS NOT NULL AND name != ''").fetchall()
            for r in case_rows:
                nk = _normalize_name_key(r["name"])
                cases_user_map[nk] = r["company"]
                if r["email"] and "@" in r["email"]:
                    cases_email_map[nk] = r["email"].strip().lower()

            u_rows = db.execute("SELECT username, name FROM users").fetchall()
            for r in u_rows:
                local_users_map[r["username"].lower().strip()] = r["name"]
    except Exception as e:
        print(f"[remedy_stats] Error precargando directorio: {e}")

    try:
        for group in target_groups:
            if _cancel_requested:
                break

            for form_type in ["INC", "WO"]:
                if _cancel_requested:
                    break

                current_step_num += 1
                pct = int((current_step_num - 1) / total_steps * 100)

                with _sync_lock:
                    _sync_state["current_group"] = group
                    _sync_state["current_form"] = form_type
                    _sync_state["progress_percent"] = pct
                    _sync_state["current_message"] = (
                        f"Extrayendo {form_type} de '{group}' (Paso {current_step_num}/{total_steps})..."
                    )

                # Construir parámetros de la consulta según el formulario
                if form_type == "INC":
                    form_name = "HPD:Help Desk"
                    fields = (
                        "values(Incident Number, Description, Detailed Decription, Submit Date, "
                        "Last Modified Date, Status, First Name, Last Name, Submitter, Assignee Login ID, "
                        "Assignee, Assigned Group, Company, Required Resolution DateTime, SLM Status, "
                        "Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
                    )
                    conds = [f"'Assigned Group' = \"{group}\""]
                    if not include_closed:
                        conds.append("'Status' < 4")
                    if days_back is not None and days_back > 0:
                        epoch = int(time.time()) - (days_back * 86400)
                        conds.append(f"'Submit Date' >= {epoch}")
                    query = " AND ".join(conds)
                else:
                    form_name = "WOI:WorkOrder"
                    fields = (
                        "values(Work Order ID, Summary, Detailed Description, Submit Date, "
                        "Last Modified Date, Status, Customer First Name, Customer Last Name, "
                        "Submitter, ASLOGID, Support Group Name, Company, Next Target Date, "
                        "SLM Status, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
                    )
                    conds = [f"'Support Group Name' = \"{group}\""]
                    if not include_closed:
                        conds.append("'Status' < 3")
                    if days_back is not None and days_back > 0:
                        epoch = int(time.time()) - (days_back * 86400)
                        conds.append(f"'Submit Date' >= {epoch}")
                    query = " AND ".join(conds)

                # Paginación en lotes para proteger el AR Server de sobrecargas
                BATCH_SIZE = 100
                offset = 0
                step_tickets = 0

                while True:
                    if _cancel_requested:
                        break

                    entries, err = client.get_entries(
                        token=token,
                        form=form_name,
                        query=query,
                        fields=fields,
                        limit=BATCH_SIZE,
                        offset=offset,
                        timeout=30,
                    )

                    if err:
                        if "HTTP 401" in err or "HTTP 403" in err:
                            # Renovación silenciosa de credenciales
                            print("[remedy_stats] Token vencido durante extracción, renovando...")
                            new_token, rerr = remedy_session.renew(user_id)
                            if new_token:
                                token = new_token
                                # Reintentar el lote actual
                                continue
                            else:
                                raise Exception(f"No se pudo renovar la sesión de Remedy: {rerr}")
                        print(f"[remedy_stats] Error al consultar Remedy ({form_name}): {err}")
                        break

                    if not entries:
                        break

                    # Procesar y guardar el lote en SQLite
                    stored = _save_batch_to_db(
                        entries=entries,
                        group=group,
                        form_type=form_type,
                        directory_map=directory_map,
                        cases_user_map=cases_user_map,
                        local_users_map=local_users_map,
                    )
                    step_tickets += stored
                    total_tickets_stored += stored

                    with _sync_lock:
                        _sync_state["tickets_fetched"] = total_tickets_stored
                        _sync_state["batches_processed"] += 1
                        _sync_state["current_message"] = (
                            f"{group} ({form_type}): {step_tickets} tickets acumulados (offset {offset + len(entries)})..."
                        )

                    offset += len(entries)
                    if len(entries) < BATCH_SIZE:
                        # Se agotaron los registros para esta consulta
                        break

                    # Pausa breve anti-saturación entre lotes consecutivos
                    time.sleep(0.08)

        if not _cancel_requested:
            try:
                with _sync_lock:
                    _sync_state["current_message"] = "Resolviendo identidades de usuarios con Libreta de Outlook (GAL)..."
                gal_res = resolve_unidentified_tickets_gal()
                print(f"[remedy_stats] Auto-resolución GAL completada: {gal_res}")
            except Exception as ex_gal:
                print(f"[remedy_stats] Auto-resolución GAL error: {ex_gal}")

        with _sync_lock:
            if _cancel_requested:
                _sync_state["status"] = "cancelled"
                _sync_state["current_message"] = f"Sincronización cancelada. Se procesaron {total_tickets_stored} tickets."
            else:
                _sync_state["status"] = "completed"
                _sync_state["progress_percent"] = 100
                _sync_state["current_message"] = (
                    f"Sincronización completada exitosamente. Total: {total_tickets_stored} tickets extraídos y clasificados."
                )
            _sync_state["is_syncing"] = False
            _sync_state["end_time"] = now_iso()

        # Registrar en la tabla de auditoría de sincronización
        try:
            with get_db() as db:
                db.execute(
                    """INSERT INTO remedy_group_sync_status 
                       (last_sync_start, last_sync_end, status, progress_percent, current_step, total_tickets)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (
                        _sync_state["start_time"],
                        _sync_state["end_time"],
                        _sync_state["status"],
                        _sync_state["progress_percent"],
                        _sync_state["current_message"],
                        total_tickets_stored,
                    ),
                )
                db.commit()
        except Exception as e:
            print(f"[remedy_stats] Error guardando status de sync en DB: {e}")

    except Exception as e:
        print(f"[remedy_stats] Error crítico en worker de sync: {e}")
        with _sync_lock:
            _sync_state["is_syncing"] = False
            _sync_state["status"] = "error"
            _sync_state["error"] = str(e)
            _sync_state["current_message"] = f"Error durante la sincronización: {e}"
            _sync_state["end_time"] = now_iso()


# ── Procesamiento y Almacenamiento de Lotes ───────────────────────────────────

def _save_batch_to_db(
    entries: list[dict],
    group: str,
    form_type: str,
    directory_map: dict,
    cases_user_map: dict,
    local_users_map: dict,
) -> int:
    """Procesa un lote de tickets y los guarda o actualiza en la tabla remedy_group_tickets."""
    if not entries:
        return 0

    records = []
    ts_now = now_iso()

    for entry in entries:
        vals = entry.get("values", {})
        if form_type == "INC":
            tid = vals.get("Incident Number")
            if not tid:
                continue
            summary = vals.get("Description") or ""
            description = vals.get("Detailed Decription") or summary
            first_name = vals.get("First Name") or ""
            last_name = vals.get("Last Name") or ""
            submitter = vals.get("Submitter") or ""
            assignee_login = vals.get("Assignee Login ID") or ""
            assignee_raw = vals.get("Assignee") or assignee_login
            raw_status = vals.get("Status")
            company_raw = vals.get("Company") or ""
            sla_status = vals.get("SLM Status") or ""
            submit_date = vals.get("Submit Date") or ""
            last_mod = vals.get("Last Modified Date") or ""
            cat_tier = (
                vals.get("Categorization Tier 3")
                or vals.get("Categorization Tier 2")
                or vals.get("Categorization Tier 1")
                or ""
            )
        else:  # WO
            tid = vals.get("Work Order ID")
            if not tid:
                continue
            summary = vals.get("Summary") or ""
            description = vals.get("Detailed Description") or summary
            first_name = vals.get("Customer First Name") or ""
            last_name = vals.get("Customer Last Name") or ""
            submitter = vals.get("Submitter") or ""
            assignee_login = vals.get("ASLOGID") or ""
            assignee_raw = assignee_login
            raw_status = vals.get("Status")
            company_raw = vals.get("Company") or ""
            sla_status = vals.get("SLM Status") or ""
            submit_date = vals.get("Submit Date") or ""
            last_mod = vals.get("Last Modified Date") or ""
            cat_tier = (
                vals.get("Categorization Tier 3")
                or vals.get("Categorization Tier 2")
                or vals.get("Categorization Tier 1")
                or ""
            )

        # Mapear estado
        status_mapped = map_status(raw_status)
        element_type = parse_element_type(summary, description)

        # Mapear técnico asignado
        login_clean = assignee_login.lower().strip().split("@")[0]
        assignee_name = local_users_map.get(
            assignee_login.lower().strip(),
            local_users_map.get(login_clean, assignee_raw or "Sin asignar"),
        )
        if not assignee_login:
            assignee_name = "Sin asignar"

        # Detección de JARVIS CHATBOT
        full_name = f"{first_name} {last_name}".strip()
        check_text = f"{full_name} {submitter} {summary} {description}".lower()

        is_jarvis = 0
        client_name = full_name
        extracted_email = None

        if "jarvis" in check_text or "chatbot" in check_text or "para el usuario:" in description.lower():
            is_jarvis = 1

            # Extraer usuario real del cuerpo del ticket Jarvis
            user_match = re.search(r"para el usuario:\s*([^)\r\n.,;]+)", description, re.IGNORECASE)
            if user_match:
                client_name = user_match.group(1).strip()
            elif "jarvis" not in full_name.lower():
                client_name = full_name
            else:
                client_name = "Usuario no especificado"

            # Extraer email si figura en la descripción
            email_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", description)
            if email_match:
                extracted_email = email_match.group(0).lower().strip()
        else:
            client_name = smart_case_name(full_name) or "Sin nombre"

        # Enriquecimiento proactivo de email si no vino en el texto de Jarvis
        if not extracted_email:
            em_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", f"{description} {summary}")
            if em_match:
                cand = em_match.group(0).lower().strip()
                if parse_company_from_email(cand):
                    extracted_email = cand

        # Si aún no tiene email, buscar por nombre en users_directory o cases
        if not extracted_email and client_name and client_name not in ("Sin nombre", "Usuario no especificado"):
            k = _normalize_name_key(client_name)
            cached_u = directory_map.get(k)
            if cached_u and cached_u.get("email") and cached_u["email"] != "NOT_FOUND":
                extracted_email = cached_u["email"]
            elif k in cases_email_map:
                extracted_email = cases_email_map[k]

        # Determinar Empresa Real del Usuario (Empresa Principal vs. Subsidiaria)
        user_company = _resolve_user_company(
            name=client_name,
            extracted_email=extracted_email,
            remedy_company=company_raw,
            directory_map=directory_map,
            cases_user_map=cases_user_map,
            is_jarvis=bool(is_jarvis),
        )

        # Extraer clave de mes normalizada (YYYY-MM)
        m_tuple = parse_submit_month(submit_date)
        submit_month = m_tuple[0] if m_tuple else ""

        records.append((
            tid,
            form_type,
            group,
            str(raw_status or ""),
            status_mapped,
            summary[:160],
            description[:800],
            client_name,
            extracted_email or "",
            assignee_login,
            assignee_name,
            company_raw,
            is_jarvis,
            user_company,
            element_type,
            cat_tier,
            sla_status,
            submit_date,
            submit_month,
            last_mod,
            ts_now,
        ))

    with get_db() as db:
        db.executemany(
            """INSERT OR REPLACE INTO remedy_group_tickets (
                id, ticket_type, group_name, status_raw, status_mapped,
                summary, description, client_name, client_email,
                assignee_login, assignee_name, remedy_company,
                is_jarvis, user_company, element_type, tipificacion,
                sla_status, submit_date, submit_month, last_modified_date, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            records,
        )
        db.commit()

    return len(records)


def _resolve_user_company(
    name: str,
    extracted_email: str | None,
    remedy_company: str,
    directory_map: dict,
    cases_user_map: dict,
    is_jarvis: bool,
) -> str:
    """Clasifica con precisión si el usuario real pertenece a Empresa Principal o a Subsidiaria.

    Precedencia de resolución:
      1. Correo electrónico extraído directamente (dominio).
      2. users_directory canonico (GAL / Directorio corporativo sincronizado).
      3. Historial de casos previos de la base de datos local.
      4. Empresa del ticket en Remedy (si no es ticket ambiguo de Jarvis).
      5. Fallback a 'Otro / No determinado'.
    """
    # 1. Correo directo
    if extracted_email:
        comp = parse_company_from_email(extracted_email)
        if comp:
            norm = _normalize_target_company(comp)
            if norm != "Otro / No determinado":
                return norm

    # 2. Directorio corporativo
    if name and name != "Usuario no especificado":
        key = _normalize_name_key(name)
        cached = directory_map.get(key)
        if cached:
            if cached.get("company"):
                norm = _normalize_target_company(cached["company"])
                if norm != "Otro / No determinado":
                    return norm
            if cached.get("email") and cached["email"] != "NOT_FOUND":
                comp = parse_company_from_email(cached["email"])
                if comp:
                    norm = _normalize_target_company(comp)
                    if norm != "Otro / No determinado":
                        return norm

    # 3. Casos históricos locales
    if name and name != "Usuario no especificado":
        key = _normalize_name_key(name)
        case_comp = cases_user_map.get(key)
        if case_comp:
            norm = _normalize_target_company(case_comp)
            if norm != "Otro / No determinado":
                return norm

    # 4. Campo Company de Remedy
    if remedy_company:
        norm = normalize_company(remedy_company)
        if "subsidiaria" in norm.lower():
            return "Subsidiaria"
        if any(k in norm.lower() for k in ["empresa", "visa", "newpay", "texper"]):
            # Si no es Jarvis, confiamos directamente en el campo nativo de Remedy
            if not is_jarvis:
                return "Empresa Principal"

    return "Otro / No determinado"


def _normalize_target_company(company_str: str) -> str:
    """Unifica variaciones a 'Empresa Principal', 'Subsidiaria' u 'Otro'.

    Regla de negocio:
      - SUBSIDIARIA B, PROVEEDOR, PROVEEDOR TI, EMPRESA, VISA -> Empresa Principal
      - SUBSIDIARIA -> Subsidiaria
    """
    s = (company_str or "").strip().lower()
    if any(k in s for k in ["empresa", "visa", "newpay", "texper"]):
        return "Empresa Principal"
    if "subsidiaria" in s:
        return "Subsidiaria"
    return "Otro / No determinado"


def _generate_gal_candidates(name: str) -> list[str]:
    """Genera permutaciones inteligentes de nombres para maximizar hits en ANR de Outlook."""
    cands = []
    clean = re.sub(r'[^\w\s]', ' ', name or '').strip()
    words = clean.split()
    if not words:
        return cands

    # 1. Nombre original
    cands.append(name.strip())

    # 2. Sin acentos / caracteres extraños
    from Backend.integraciones.outlook.lookup import _strip_accents
    clean_no_accents = _strip_accents(name)
    if clean_no_accents != name.lower():
        cands.append(clean_no_accents)

    # 3. Permutaciones según cantidad de palabras
    if len(words) == 2:
        # "Apellido Nombre"
        cands.append(f"{words[1]} {words[0]}")
    elif len(words) >= 3:
        # "First Last"
        cands.append(f"{words[0]} {words[-1]}")
        # "Last First"
        cands.append(f"{words[-1]} {words[0]}")
        cands.append(f"{words[0]} {words[1]}")
        cands.append(f"{words[1]} {words[2]} {words[0]}")

    # Dedup conservando orden
    seen = set()
    result = []
    for c in cands:
        c_low = c.lower().strip()
        if c_low not in seen and len(c_low) > 2:
            seen.add(c_low)
            result.append(c)
    return result


def resolve_unidentified_tickets_gal() -> dict:
    """Resuelve la empresa real de tickets no identificados consultando Outlook GAL.

    Aplica la regla de negocio corporativa para normalizar empresas y dominios.
    1. Busca todos los tickets con user_company = 'Otro / No determinado'.
    2. Realiza resolución en lote mediante ANR de Outlook contra la libreta GAL.
    3. Si GAL entrega correo corporativo:
       - Si es @subsidiaria.com / serv.externos -> Subsidiaria
       - Si es @empresa.com -> Empresa Principal
       - Guarda en users_directory para caching permanente.
       - Actualiza remedy_group_tickets con el email y la empresa.
    4. Para los no encontrados en GAL (o si Outlook no está abierto):
       - Aplica fallback según remedy_company configurado.
    """
    import pythoncom
    import win32com.client
    from Backend.integraciones.outlook.lookup import _email_from_address_entry

    print("[remedy_stats] Iniciando resolución de tickets no determinados vía Outlook GAL...")
    # Paso 0: Auto-enriquecer tickets con la base de datos local (users_directory, cases, texto)
    try:
        enrich_ticket_emails_from_local_db()
    except Exception as ex_enr:
        print(f"[remedy_stats] Error en auto-enriquecimiento previo a GAL: {ex_enr}")

    stats = {
        "ok": True,
        "total_unidentified": 0,
        "distinct_users": 0,
        "gal_hits": 0,
        "gal_misses": 0,
        "resolved_empresa": 0,
        "resolved_subsidiaria": 0,
        "updated_tickets": 0,
    }

    try:
        with get_db() as db:
            unid_rows = db.execute(
                """SELECT id, client_name, remedy_company, is_jarvis
                   FROM remedy_group_tickets
                   WHERE user_company = 'Otro / No determinado'"""
            ).fetchall()
    except Exception as e:
        return {"ok": False, "error": f"Error leyendo base de datos: {e}"}

    if not unid_rows:
        return {"ok": True, "message": "No hay tickets pendientes de identificación", "updated_tickets": 0}

    stats["total_unidentified"] = len(unid_rows)

    # Identificar nombres únicos válidos
    distinct_names = sorted(list(set(
        r["client_name"].strip()
        for r in unid_rows
        if r["client_name"] and r["client_name"].strip() not in ("Sin nombre", "Usuario no especificado", "None")
    )))
    stats["distinct_users"] = len(distinct_names)

    # Conectar a sesión Outlook COM
    outlook_session = None
    co_initialized = False
    try:
        pythoncom.CoInitialize()
        co_initialized = True
        outlook = win32com.client.Dispatch("Outlook.Application")
        outlook_session = outlook.Session
    except Exception as ex_ol:
        print(f"[remedy_stats] Outlook COM no disponible: {ex_ol}")

    resolved_users: dict[str, dict] = {}

    if outlook_session:
        for name in distinct_names:
            found_email = None
            found_gal_name = None
            for cand in _generate_gal_candidates(name):
                try:
                    rcp = outlook_session.CreateRecipient(cand)
                    rcp.Resolve()
                    if rcp.Resolved:
                        email = _email_from_address_entry(rcp.AddressEntry)
                        if email:
                            found_email = email
                            found_gal_name = rcp.AddressEntry.Name or ""
                            break
                except Exception:
                    continue

            if found_email:
                stats["gal_hits"] += 1
                raw_comp = parse_company_from_email(found_email) or ""
                target_comp = _normalize_target_company(raw_comp or found_email)
                resolved_users[name] = {
                    "email": found_email,
                    "gal_name": found_gal_name,
                    "company": target_comp,
                }
                # Guardar en users_directory para que quede persistente
                try:
                    repo_upsert_user(name, found_email, target_comp)
                except Exception:
                    pass
            else:
                stats["gal_misses"] += 1

    if co_initialized:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass

    # Ahora aplicar actualizaciones a la tabla remedy_group_tickets
    total_updated = 0
    try:
        with get_db() as db:
            for r in unid_rows:
                tid = r["id"]
                c_name = (r["client_name"] or "").strip()
                remedy_co = (r["remedy_company"] or "").strip()

                target_company = None
                target_email = None

                # 1. Si se resolvió vía GAL
                if c_name in resolved_users:
                    res = resolved_users[c_name]
                    target_company = res["company"]
                    target_email = res["email"]
                else:
                    # 2. Fallback de negocio: si figura como SUBSIDIARIA B, PROVEEDOR, EMPRESA -> Empresa Principal
                    norm = _normalize_target_company(remedy_co)
                    if norm in ("Empresa Principal", "Subsidiaria"):
                        target_company = norm
                    elif any(k in remedy_co.lower() for k in ["empresa", "newpay", "texper", "visa"]):
                        target_company = "Empresa Principal"
                    elif "subsidiaria" in remedy_co.lower():
                        target_company = "Subsidiaria"

                if target_company and target_company != "Otro / No determinado":
                    if target_company == "Empresa Principal":
                        stats["resolved_empresa"] += 1
                    elif target_company == "Subsidiaria":
                        stats["resolved_subsidiaria"] += 1

                    if target_email:
                        db.execute(
                            "UPDATE remedy_group_tickets SET user_company = ?, client_email = ? WHERE id = ?",
                            (target_company, target_email, tid),
                        )
                    else:
                        db.execute(
                            "UPDATE remedy_group_tickets SET user_company = ? WHERE id = ?",
                            (target_company, tid),
                        )
                    total_updated += 1

            db.commit()
    except Exception as ex_db:
        print(f"[remedy_stats] Error actualizando tickets en base de datos: {ex_db}")
        return {"ok": False, "error": str(ex_db)}

    stats["updated_tickets"] = total_updated
    print(f"[remedy_stats] Resolución GAL finalizada. {total_updated} tickets reclasificados "
          f"({stats['resolved_empresa']} Empresa Principal, {stats['resolved_subsidiaria']} Subsidiaria).")
    return stats


def enrich_ticket_emails_from_local_db() -> dict:
    """Enriquece en lote tickets existentes en remedy_group_tickets que carecen de client_email.

    Busca coincidencias en:
      1. Direcciones de correo presentes en summary y description.
      2. users_directory (directorio canonico local / GAL indexado).
      3. Tabla cases (historial de casos resueltos por tecnicos).

    Actualiza tanto client_email como user_company (si estaba no determinado).
    """
    stats = {"from_text": 0, "from_directory": 0, "from_cases": 0, "total_enriched": 0}
    try:
        with get_db() as db:
            rows = db.execute(
                """SELECT id, client_name, summary, description, remedy_company, user_company
                   FROM remedy_group_tickets
                   WHERE client_email IS NULL OR client_email = ''"""
            ).fetchall()

            if not rows:
                return stats

            # Pre-cargar mapas
            dir_map = {}
            for r in db.execute(
                "SELECT name_key, email, company FROM users_directory WHERE email IS NOT NULL AND email != '' AND email != 'NOT_FOUND'"
            ).fetchall():
                dir_map[r["name_key"]] = (r["email"], r["company"])

            case_map = {}
            for r in db.execute(
                "SELECT DISTINCT name, email, company FROM cases WHERE name IS NOT NULL AND name != '' AND email IS NOT NULL AND email != ''"
            ).fetchall():
                nk = _normalize_name_key(r["name"])
                case_map[nk] = (r["email"], r["company"])

            updates = []
            for row in rows:
                tid = row["id"]
                c_name = (row["client_name"] or "").strip()
                summary = row["summary"] or ""
                desc = row["description"] or ""
                cur_user_co = row["user_company"] or ""

                found_email = None
                found_comp = None
                src = None

                # 1. Regex en texto (description + summary)
                m = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", f"{desc} {summary}")
                if m:
                    cand = m.group(0).lower().strip()
                    co_cand = parse_company_from_email(cand)
                    if co_cand:
                        found_email = cand
                        found_comp = co_cand
                        src = "from_text"

                # 2. Match por nombre en users_directory
                if not found_email and c_name and c_name not in ("Sin nombre", "Usuario no especificado"):
                    nk = _normalize_name_key(c_name)
                    if nk in dir_map:
                        found_email, found_comp = dir_map[nk]
                        src = "from_directory"
                    elif nk in case_map:
                        found_email, found_comp = case_map[nk]
                        src = "from_cases"

                if found_email:
                    target_co = cur_user_co
                    if not cur_user_co or cur_user_co == "Otro / No determinado":
                        if found_comp:
                            target_co = _normalize_target_company(found_comp)

                    updates.append((found_email, target_co, tid))
                    stats[src] += 1
                    stats["total_enriched"] += 1

            if updates:
                db.executemany(
                    "UPDATE remedy_group_tickets SET client_email = ?, user_company = ? WHERE id = ?",
                    updates,
                )
                db.commit()
                print(f"[remedy_stats] Auto-enriquecidos {len(updates)} tickets con emails: {stats}")
    except Exception as ex:
        print(f"[remedy_stats] Error en auto-enriquecimiento de emails: {ex}")

    return stats


# ── Cálculo y Agregación de Estadísticas ──────────────────────────────────────

def get_remedy_group_stats(
    group: str | None = None,
    period: str | None = "all",
    status_filter: str | None = None,
    ticket_type: str | None = None,
    month: str | None = None,
) -> dict:
    """Calcula y devuelve todas las métricas agregadas de los 3 grupos y Jarvis Chatbot.

    Soporta desglose y filtrado por meses específicos (Enero, Febrero, etc.)
    para comparar volumen de Subsidiaria vs. Empresa Principal y sus respectivas tipificaciones.

    IMPORTANTE: Respeta el requisito de NO incluir nombres de personas en la
    información de Jarvis Chatbot.
    """
    where_clauses = ["1=1"]
    params = []

    if group and group != "ALL":
        where_clauses.append("group_name = ?")
        params.append(group)
    else:
        # Asegurar que solo consideramos los 3 grupos configurados
        placeholders = ",".join("?" for _ in REMEDY_ASSIGNED_GROUPS)
        where_clauses.append(f"group_name IN ({placeholders})")
        params.extend(REMEDY_ASSIGNED_GROUPS)

    if ticket_type and ticket_type in ("INC", "WO"):
        where_clauses.append("ticket_type = ?")
        params.append(ticket_type)

    if status_filter == "open":
        where_clauses.append("status_mapped IN ('1', '2', '3')")
    elif status_filter == "closed":
        where_clauses.append("status_mapped = '4'")

    # Filtro de mes específico (tiene precedencia sobre período)
    if month and month != "all":
        where_clauses.append("submit_month = ?")
        params.append(month)
    elif period and period != "all":
        now_ts = int(time.time())
        days_map = {"7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365}
        days = days_map.get(period)
        if days:
            min_epoch = now_ts - (days * 86400)
            where_clauses.append("(CAST(submit_date AS INTEGER) >= ? OR submit_date >= ?)")
            iso_limit = datetime.fromtimestamp(min_epoch, tz=timezone.utc).isoformat()
            params.extend([min_epoch, iso_limit])

    where_sql = " AND ".join(where_clauses)

    with get_db() as db:
        # Integridad: asegurar que registros existentes tengan submit_month calculado
        try:
            unmigrated = db.execute(
                "SELECT COUNT(*) FROM remedy_group_tickets WHERE (submit_month IS NULL OR submit_month = '') AND submit_date IS NOT NULL AND submit_date != ''"
            ).fetchone()[0]
            if unmigrated > 0:
                rows_fix = db.execute(
                    "SELECT id, submit_date FROM remedy_group_tickets WHERE (submit_month IS NULL OR submit_month = '') AND submit_date IS NOT NULL AND submit_date != ''"
                ).fetchall()
                for rf in rows_fix:
                    m = parse_submit_month(rf["submit_date"])
                    if m:
                        db.execute("UPDATE remedy_group_tickets SET submit_month = ? WHERE id = ?", (m[0], rf["id"]))
                db.commit()
        except Exception as ex_m:
            print(f"[remedy_stats] Nota submit_month: {ex_m}")
        # 1. Totales generales
        total_row = db.execute(
            f"""SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status_mapped IN ('1','2','3') THEN 1 ELSE 0 END) as open_count,
                SUM(CASE WHEN status_mapped = '4' THEN 1 ELSE 0 END) as closed_count,
                SUM(CASE WHEN ticket_type = 'INC' THEN 1 ELSE 0 END) as inc_count,
                SUM(CASE WHEN ticket_type = 'WO' THEN 1 ELSE 0 END) as wo_count,
                SUM(CASE WHEN is_jarvis = 1 THEN 1 ELSE 0 END) as jarvis_count
               FROM remedy_group_tickets 
               WHERE {where_sql}""",
            params,
        ).fetchone()

        total = total_row["total"] or 0
        open_count = total_row["open_count"] or 0
        closed_count = total_row["closed_count"] or 0
        inc_count = total_row["inc_count"] or 0
        wo_count = total_row["wo_count"] or 0
        jarvis_count = total_row["jarvis_count"] or 0

        # 2. Desglose por los 3 Grupos de Soporte
        groups_data = []
        for g_name in REMEDY_ASSIGNED_GROUPS:
            g_params = list(params)
            # Reemplazar o añadir filtro de grupo
            g_row = db.execute(
                f"""SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status_mapped IN ('1','2','3') THEN 1 ELSE 0 END) as open_count,
                    SUM(CASE WHEN status_mapped = '4' THEN 1 ELSE 0 END) as closed_count,
                    SUM(CASE WHEN ticket_type = 'INC' THEN 1 ELSE 0 END) as inc_count,
                    SUM(CASE WHEN ticket_type = 'WO' THEN 1 ELSE 0 END) as wo_count,
                    SUM(CASE WHEN is_jarvis = 1 THEN 1 ELSE 0 END) as jarvis_total,
                    SUM(CASE WHEN is_jarvis = 1 AND user_company = 'Empresa Principal' THEN 1 ELSE 0 END) as jarvis_empresa,
                    SUM(CASE WHEN is_jarvis = 1 AND user_company = 'Subsidiaria' THEN 1 ELSE 0 END) as jarvis_subsidiaria,
                    SUM(CASE WHEN is_jarvis = 1 AND user_company NOT IN ('Empresa Principal', 'Subsidiaria') THEN 1 ELSE 0 END) as jarvis_other
                   FROM remedy_group_tickets 
                   WHERE group_name = ? AND {where_sql.replace(f"group_name IN ({','.join('?' for _ in REMEDY_ASSIGNED_GROUPS)})", '1=1') if 'group_name IN' in where_sql else where_sql}""",
                [g_name] + [p for p in params if p not in REMEDY_ASSIGNED_GROUPS],
            ).fetchone()

            g_total = g_row["total"] or 0
            groups_data.append({
                "group_name": g_name,
                "total": g_total,
                "percentage": round(g_total / total * 100, 1) if total > 0 else 0,
                "open": g_row["open_count"] or 0,
                "closed": g_row["closed_count"] or 0,
                "inc": g_row["inc_count"] or 0,
                "wo": g_row["wo_count"] or 0,
                "jarvis_total": g_row["jarvis_total"] or 0,
                "jarvis_empresa": g_row["jarvis_empresa"] or 0,
                "jarvis_subsidiaria": g_row["jarvis_subsidiaria"] or 0,
                "jarvis_other": g_row["jarvis_other"] or 0,
            })

        # 3. Desglose Especial: JARVIS CHATBOT (Empresa Principal vs. Subsidiaria)
        # Sin nombres de usuario, únicamente cantidades y porcentajes
        jarvis_row = db.execute(
            f"""SELECT 
                COUNT(*) as total_jarvis,
                SUM(CASE WHEN user_company = 'Empresa Principal' THEN 1 ELSE 0 END) as empresa_count,
                SUM(CASE WHEN user_company = 'Subsidiaria' THEN 1 ELSE 0 END) as subsidiaria_count,
                SUM(CASE WHEN user_company NOT IN ('Empresa Principal', 'Subsidiaria') THEN 1 ELSE 0 END) as other_count,
                SUM(CASE WHEN status_mapped IN ('1','2','3') THEN 1 ELSE 0 END) as open_jarvis,
                SUM(CASE WHEN status_mapped = '4' THEN 1 ELSE 0 END) as closed_jarvis
               FROM remedy_group_tickets 
               WHERE is_jarvis = 1 AND {where_sql}""",
            params,
        ).fetchone()

        j_total = jarvis_row["total_jarvis"] or 0
        j_empresa = jarvis_row["empresa_count"] or 0
        j_subsidiaria = jarvis_row["subsidiaria_count"] or 0
        j_other = jarvis_row["other_count"] or 0

        jarvis_stats = {
            "total_jarvis": j_total,
            "empresa_count": j_empresa,
            "subsidiaria_count": j_subsidiaria,
            "other_count": j_other,
            "empresa_percentage": round(j_empresa / j_total * 100, 1) if j_total > 0 else 0,
            "subsidiaria_percentage": round(j_subsidiaria / j_total * 100, 1) if j_total > 0 else 0,
            "other_percentage": round(j_other / j_total * 100, 1) if j_total > 0 else 0,
            "open_jarvis": jarvis_row["open_jarvis"] or 0,
            "closed_jarvis": jarvis_row["closed_jarvis"] or 0,
        }

        # 4. Carga por Técnico Asignado (Top 12)
        tech_rows = db.execute(
            f"""SELECT 
                assignee_name,
                COUNT(*) as total,
                SUM(CASE WHEN status_mapped IN ('1','2','3') THEN 1 ELSE 0 END) as open_count,
                SUM(CASE WHEN status_mapped = '4' THEN 1 ELSE 0 END) as closed_count
               FROM remedy_group_tickets 
               WHERE {where_sql}
               GROUP BY assignee_name 
               ORDER BY total DESC 
               LIMIT 12""",
            params,
        ).fetchall()

        technicians_data = [
            {
                "name": r["assignee_name"] or "Sin asignar",
                "total": r["total"],
                "open": r["open_count"] or 0,
                "closed": r["closed_count"] or 0,
            }
            for r in tech_rows
        ]

        # 5. Distribución por Tipo de Elemento (Hardware / Servicio)
        element_rows = db.execute(
            f"""SELECT 
                element_type,
                COUNT(*) as count
               FROM remedy_group_tickets 
               WHERE {where_sql}
               GROUP BY element_type 
               ORDER BY count DESC""",
            params,
        ).fetchall()

        elements_data = [
            {"element_type": r["element_type"] or "pc", "count": r["count"]}
            for r in element_rows
        ]

        # 6. Distribución por Estado Mapeado
        status_rows = db.execute(
            f"""SELECT 
                status_mapped,
                COUNT(*) as count
               FROM remedy_group_tickets 
               WHERE {where_sql}
               GROUP BY status_mapped 
               ORDER BY count DESC""",
            params,
        ).fetchall()

        status_name_map = {
            "1": "Asignado",
            "2": "En Curso",
            "3": "Pendiente",
            "4": "Resuelto / Cerrado",
        }
        status_data = [
            {
                "status_code": r["status_mapped"],
                "status_name": status_name_map.get(r["status_mapped"], "Otro"),
                "count": r["count"],
            }
            for r in status_rows
        ]

        # 7. Listado dinámico de meses disponibles en la base de datos
        available_months = []
        try:
            month_rows = db.execute(
                """SELECT submit_month, COUNT(*) as cnt 
                   FROM remedy_group_tickets 
                   WHERE submit_month IS NOT NULL AND submit_month != '' 
                   GROUP BY submit_month 
                   ORDER BY submit_month DESC"""
            ).fetchall()
            for mr in month_rows:
                m_key = mr["submit_month"]
                available_months.append({
                    "key": m_key,
                    "month_key": m_key,
                    "label": format_month_label(m_key),
                    "count": mr["cnt"],
                })
        except Exception as ex_am:
            print(f"[remedy_stats] Error obteniendo available_months: {ex_am}")

        # 8. Desglose Mensual Detallado: Empresa Principal vs. Subsidiaria y Tipificaciones
        monthly_breakdown = []
        try:
            breakdown_where = ["submit_month IS NOT NULL AND submit_month != ''"]
            breakdown_params = []

            if group and group != "ALL":
                breakdown_where.append("group_name = ?")
                breakdown_params.append(group)
            else:
                placeholders = ",".join("?" for _ in REMEDY_ASSIGNED_GROUPS)
                breakdown_where.append(f"group_name IN ({placeholders})")
                breakdown_params.extend(REMEDY_ASSIGNED_GROUPS)

            if ticket_type and ticket_type in ("INC", "WO"):
                breakdown_where.append("ticket_type = ?")
                breakdown_params.append(ticket_type)

            if status_filter == "open":
                breakdown_where.append("status_mapped IN ('1', '2', '3')")
            elif status_filter == "closed":
                breakdown_where.append("status_mapped = '4'")

            bw_sql = " AND ".join(breakdown_where)

            b_rows = db.execute(
                f"""SELECT 
                    submit_month,
                    user_company,
                    element_type,
                    tipificacion,
                    group_name,
                    status_mapped,
                    COUNT(*) as cnt
                   FROM remedy_group_tickets
                   WHERE {bw_sql}
                   GROUP BY submit_month, user_company, element_type, tipificacion, group_name, status_mapped
                   ORDER BY submit_month DESC""",
                breakdown_params,
            ).fetchall()

            months_dict = {}
            for r in b_rows:
                m_k = r["submit_month"]
                if not m_k:
                    continue

                if m_k not in months_dict:
                    months_dict[m_k] = {
                        "month_key": m_k,
                        "month_name": format_month_label(m_k),
                        "total": 0,
                        "open": 0,
                        "closed": 0,
                        "empresa": {
                            "total": 0,
                            "open": 0,
                            "closed": 0,
                            "element_types": {},
                            "tipificaciones": {},
                        },
                        "subsidiaria": {
                            "total": 0,
                            "open": 0,
                            "closed": 0,
                            "element_types": {},
                            "tipificaciones": {},
                        },
                        "other": {
                            "total": 0,
                            "open": 0,
                            "closed": 0,
                            "element_types": {},
                            "tipificaciones": {},
                        },
                        "groups": {g: {"total": 0, "open": 0, "closed": 0} for g in REMEDY_ASSIGNED_GROUPS},
                    }

                m_data = months_dict[m_k]
                cnt = r["cnt"]
                m_data["total"] += cnt

                st = str(r["status_mapped"] or "")
                is_cl = (st == "4")
                if is_cl:
                    m_data["closed"] += cnt
                else:
                    m_data["open"] += cnt

                # Grupos
                grp = r["group_name"]
                if grp in m_data["groups"]:
                    m_data["groups"][grp]["total"] += cnt
                    if is_cl:
                        m_data["groups"][grp]["closed"] += cnt
                    else:
                        m_data["groups"][grp]["open"] += cnt

                # Empresa Real
                raw_comp = (r["user_company"] or "").strip().lower()
                if "empresa" in raw_comp:
                    comp_key = "empresa"
                elif "subsidiaria" in raw_comp:
                    comp_key = "subsidiaria"
                else:
                    comp_key = "other"

                c_data = m_data[comp_key]
                c_data["total"] += cnt
                if is_cl:
                    c_data["closed"] += cnt
                else:
                    c_data["open"] += cnt

                el = (r["element_type"] or "Equipo").strip()
                if el:
                    c_data["element_types"][el] = c_data["element_types"].get(el, 0) + cnt

                tip = (r["tipificacion"] or "").strip()
                if tip:
                    c_data["tipificaciones"][tip] = c_data["tipificaciones"].get(tip, 0) + cnt

            # Formatear lista ordenada de meses
            for m_k in sorted(months_dict.keys(), reverse=True):
                m_data = months_dict[m_k]
                m_tot = m_data["total"]

                for c_k in ("empresa", "subsidiaria", "other"):
                    c_obj = m_data[c_k]
                    c_tot = c_obj["total"]
                    c_obj["percentage"] = round((c_tot / m_tot * 100), 1) if m_tot > 0 else 0

                    c_obj["element_types"] = [
                        {
                            "name": name,
                            "count": count,
                            "percentage": round((count / c_tot * 100), 1) if c_tot > 0 else 0,
                        }
                        for name, count in sorted(c_obj["element_types"].items(), key=lambda x: x[1], reverse=True)
                    ]

                    c_obj["tipificaciones"] = [
                        {
                            "name": name,
                            "count": count,
                            "percentage": round((count / c_tot * 100), 1) if c_tot > 0 else 0,
                        }
                        for name, count in sorted(c_obj["tipificaciones"].items(), key=lambda x: x[1], reverse=True)
                    ]

                m_data["groups"] = [
                    {
                        "group_name": g_name,
                        "total": g_info["total"],
                        "open": g_info["open"],
                        "closed": g_info["closed"],
                        "percentage": round((g_info["total"] / m_tot * 100), 1) if m_tot > 0 else 0,
                    }
                    for g_name, g_info in m_data["groups"].items()
                ]

                monthly_breakdown.append(m_data)

        except Exception as ex_mb:
            print(f"[remedy_stats] Error calculando monthly_breakdown: {ex_mb}")

        # 9. Información de última sincronización
        last_sync_row = db.execute(
            """SELECT last_sync_end, total_tickets, status 
               FROM remedy_group_sync_status 
               ORDER BY id DESC LIMIT 1"""
        ).fetchone()

        db_total_count = db.execute("SELECT COUNT(*) FROM remedy_group_tickets").fetchone()[0]

    return {
        "kpis": {
            "total_tickets": total,
            "open_tickets": open_count,
            "closed_tickets": closed_count,
            "inc_tickets": inc_count,
            "wo_tickets": wo_count,
            "jarvis_tickets": jarvis_count,
        },
        "groups": groups_data,
        "jarvis": jarvis_stats,
        "technicians": technicians_data,
        "elements": elements_data,
        "statuses": status_data,
        "available_months": available_months,
        "monthly_breakdown": monthly_breakdown,
        "selected_month": month if (month and month != "all") else "all",
        "sync_info": {
            "last_sync_date": last_sync_row["last_sync_end"] if last_sync_row else None,
            "last_sync_status": last_sync_row["status"] if last_sync_row else "none",
            "total_cached_tickets": db_total_count,
            "live_sync": get_sync_status(),
        },
    }


def _normalize_month_filter(month_val: str | None) -> tuple[str | None, str]:
    """Interpreta el parámetro month de forma ultra-flexible.

    Acepta:
      - '2026-04' (clave directa YYYY-MM) -> ('exact', '2026-04')
      - '04' o '4' (mes sin año) -> ('like', '%-04')
      - 'abril' / 'Abril' (nombre de mes) -> ('like', '%-04')
      - 'all' / 'undefined' / 'null' / None -> (None, '')
    """
    if not month_val:
        return None, ""
    clean = str(month_val).strip().lower()
    if clean in ("all", "undefined", "null", "none", "", "todos"):
        return None, ""

    m_match = re.match(r"^(\d{4})[-/](\d{1,2})$", clean)
    if m_match:
        y = int(m_match.group(1))
        mo = int(m_match.group(2))
        return "exact", f"{y:04d}-{mo:02d}"

    if clean.isdigit():
        mo = int(clean)
        if 1 <= mo <= 12:
            return "like", f"%-{mo:02d}"

    month_names = {
        "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
        "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
        "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12"
    }
    for name, num in month_names.items():
        if name in clean:
            y_match = re.search(r"\b(20\d{2})\b", clean)
            if y_match:
                return "exact", f"{y_match.group(1)}-{num}"
            return "like", f"%-{num}"

    return "exact", clean


def get_remedy_company_report(
    company_filter: str = "all",
    month: str | None = None,
    period: str = "all",
    group: str | None = None,
    ticket_type: str | None = None,
    status_filter: str | None = None,
    origin: str | None = None,
) -> dict:
    """Genera el reporte consolidado y detallado por empresa (Empresa Principal vs. Subsidiaria).

    Extracción basada en el dominio de correo y resolución corporativa:
      - Trae datos reales de Remedy de empresa (columna remedy_company: EMPRESA, SUBSIDIARIA, SUBSIDIARIA B, etc.).
      - Trae catalogación de usuarios ('Usuarios Empresa Principal' vs 'Usuarios SUBSIDIARIA').
      - Desglosa tipificaciones de hardware y categorizaciones Remedy con su recuento y porcentajes.
      - Rango de tiempo/mes seleccionado y cantidad total de tickets procesados.
      - Soporta filtrar por origen: 'all' (todos), 'jarvis' (solo Jarvis Chatbot), o 'no_jarvis' (otros canales).
      - REGLA ESTRICTA: Los números de Empresa Principal y Subsidiaria se mantienen estrictamente
        separados y nunca se mezclan ni suman en una sola entidad.
    """
    # Auto-enriquecimiento de tickets sin email contra la BD local (instantáneo)
    try:
        enrich_ticket_emails_from_local_db()
    except Exception:
        pass

    where_clauses = ["1=1"]
    params: list = []

    if group and group != "ALL":
        where_clauses.append("group_name = ?")
        params.append(group)
    else:
        placeholders = ",".join("?" for _ in REMEDY_ASSIGNED_GROUPS)
        where_clauses.append(f"group_name IN ({placeholders})")
        params.extend(REMEDY_ASSIGNED_GROUPS)

    if ticket_type and ticket_type.strip():
        t_clean = ticket_type.strip().upper()
        if t_clean in ("INC", "WO"):
            where_clauses.append("UPPER(ticket_type) = ?")
            params.append(t_clean)

    if status_filter == "open":
        where_clauses.append("status_mapped IN ('1', '2', '3')")
    elif status_filter == "closed":
        where_clauses.append("status_mapped = '4'")

    # Filtro de origen (Jarvis Bot vs Otros canales)
    orig_clean = (origin or "all").strip().lower()
    if orig_clean in ("jarvis", "solo_jarvis", "solo jarvis"):
        where_clauses.append("is_jarvis = 1")
    elif orig_clean in ("no_jarvis", "otros", "no jarvis", "human"):
        where_clauses.append("is_jarvis = 0")

    # Filtro de Mes
    m_mode, m_val = _normalize_month_filter(month)
    if m_mode == "exact":
        where_clauses.append("submit_month = ?")
        params.append(m_val)
        month_label = format_month_label(m_val) or m_val
    elif m_mode == "like":
        where_clauses.append("submit_month LIKE ?")
        params.append(m_val)
        month_label = str(month).strip().capitalize()
    elif period and period != "all":
        now_ts = int(time.time())
        days_map = {"7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365}
        days = days_map.get(period)
        if days:
            min_epoch = now_ts - (days * 86400)
            where_clauses.append("(CAST(submit_date AS INTEGER) >= ? OR submit_date >= ?)")
            iso_limit = datetime.fromtimestamp(min_epoch, tz=timezone.utc).isoformat()
            params.extend([min_epoch, iso_limit])
        month_label = f"Últimos {period}"
    else:
        month_label = "Todos los meses / Histórico"

    where_sql = " AND ".join(where_clauses)

    comp_norm = (company_filter or "all").strip().lower()
    if comp_norm in ("empresa", "solo_empresa", "solo empresa"):
        selected_companies = ["Empresa Principal"]
        filter_mode = "empresa"
        filter_label = "Solo EMPRESA"
    elif comp_norm in ("subsidiaria", "solo_subsidiaria", "solo subsidiaria"):
        selected_companies = ["Subsidiaria"]
        filter_mode = "subsidiaria"
        filter_label = "Solo SUBSIDIARIA"
    else:
        selected_companies = ["Empresa Principal", "Subsidiaria"]
        filter_mode = "all"
        filter_label = "Todas las empresas (Separadas)"

    now_dt = datetime.now()
    generated_at_friendly = now_dt.strftime("%d/%m/%Y %H:%M:%S")

    with get_db() as db:
        tot_row = db.execute(
            f"SELECT COUNT(*) as total FROM remedy_group_tickets WHERE {where_sql}",
            params,
        ).fetchone()
        universe_total = (tot_row["total"] if tot_row else 0) or 0

        companies_data = []
        for comp_name in selected_companies:
            catalog_name = "Usuarios Empresa Principal" if comp_name == "Empresa Principal" else ("Usuarios SUBSIDIARIA" if comp_name == "Subsidiaria" else "Otros / Sin clasificar")
            brand_color = "#0078D4" if comp_name == "Empresa Principal" else ("#8764B8" if comp_name == "Subsidiaria" else "#8A8886")

            comp_params = [comp_name] + list(params)
            comp_where = f"LOWER(user_company) = LOWER(?) AND {where_sql}"

            # 1. Totales de esta empresa
            c_row = db.execute(
                f"""SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status_mapped IN ('1','2','3') THEN 1 ELSE 0 END) as open_count,
                    SUM(CASE WHEN status_mapped = '4' THEN 1 ELSE 0 END) as closed_count,
                    SUM(CASE WHEN ticket_type = 'INC' THEN 1 ELSE 0 END) as inc_count,
                    SUM(CASE WHEN ticket_type = 'WO' THEN 1 ELSE 0 END) as wo_count,
                    SUM(CASE WHEN is_jarvis = 1 THEN 1 ELSE 0 END) as jarvis_count
                   FROM remedy_group_tickets 
                   WHERE {comp_where}""",
                comp_params,
            ).fetchone()

            comp_total = (c_row["total"] if c_row else 0) or 0
            if comp_total == 0:
                companies_data.append({
                    "company_name": comp_name,
                    "catalog_label": catalog_name,
                    "brand_color": brand_color,
                    "total_tickets": 0,
                    "percentage_of_universe": 0,
                    "open_tickets": 0,
                    "closed_tickets": 0,
                    "inc_tickets": 0,
                    "wo_tickets": 0,
                    "jarvis_tickets": 0,
                    "remedy_companies": [],
                    "email_domains": [],
                    "element_types": [],
                    "tipificaciones": [],
                    "groups": [],
                })
                continue

            pct_univ = round(comp_total / universe_total * 100, 1) if universe_total > 0 else 0

            # 2. Datos reales de Remedy (columna remedy_company)
            r_comps_rows = db.execute(
                f"""SELECT 
                    COALESCE(NULLIF(TRIM(remedy_company), ''), 'No especificada en Remedy') as r_comp,
                    COUNT(*) as count
                   FROM remedy_group_tickets 
                   WHERE {comp_where}
                   GROUP BY r_comp
                   ORDER BY count DESC""",
                comp_params,
            ).fetchall()

            remedy_companies = [
                {
                    "company": rc["r_comp"],
                    "count": rc["count"],
                    "percentage": round(rc["count"] / comp_total * 100, 1),
                }
                for rc in r_comps_rows
            ]

            # 3. Extracción por Dominio de correo corporativo
            email_rows = db.execute(
                f"""SELECT client_email, COUNT(*) as count 
                   FROM remedy_group_tickets 
                   WHERE {comp_where}
                   GROUP BY client_email""",
                comp_params,
            ).fetchall()

            domain_counts: dict[str, int] = {}
            for er in email_rows:
                em = (er["client_email"] or "").strip().lower()
                c = er["count"]
                if em and "@" in em:
                    dom = "@" + em.split("@")[-1].strip()
                else:
                    dom = "Sin dominio / Correo no informado"
                domain_counts[dom] = domain_counts.get(dom, 0) + c

            sorted_domains = sorted(domain_counts.items(), key=lambda x: x[1], reverse=True)
            email_domains = [
                {
                    "domain": dom,
                    "count": cnt,
                    "percentage": round(cnt / comp_total * 100, 1),
                }
                for dom, cnt in sorted_domains
            ]

            # 4. Tipificación de Elemento / Hardware
            elem_rows = db.execute(
                f"""SELECT 
                    COALESCE(NULLIF(TRIM(element_type), ''), 'No tipificado / Otro') as elem,
                    COUNT(*) as count,
                    SUM(CASE WHEN status_mapped IN ('1','2','3') THEN 1 ELSE 0 END) as open_count,
                    SUM(CASE WHEN status_mapped = '4' THEN 1 ELSE 0 END) as closed_count
                   FROM remedy_group_tickets 
                   WHERE {comp_where}
                   GROUP BY elem
                   ORDER BY count DESC""",
                comp_params,
            ).fetchall()

            element_types = [
                {
                    "name": er["elem"],
                    "count": er["count"],
                    "percentage": round(er["count"] / comp_total * 100, 1),
                    "open": er["open_count"] or 0,
                    "closed": er["closed_count"] or 0,
                }
                for er in elem_rows
            ]

            # 5. Categorizaciones Remedy BMC (Tier 1/2/3)
            tip_rows = db.execute(
                f"""SELECT 
                    COALESCE(NULLIF(TRIM(tipificacion), ''), 'Sin categorización Remedy') as tip,
                    COUNT(*) as count
                   FROM remedy_group_tickets 
                   WHERE {comp_where}
                   GROUP BY tip
                   ORDER BY count DESC
                   LIMIT 30""",
                comp_params,
            ).fetchall()

            tipificaciones = [
                {
                    "name": tr["tip"],
                    "count": tr["count"],
                    "percentage": round(tr["count"] / comp_total * 100, 1),
                }
                for tr in tip_rows
            ]

            # 6. Distribución en los 3 Grupos de Soporte
            group_rows = db.execute(
                f"""SELECT 
                    group_name,
                    COUNT(*) as count,
                    SUM(CASE WHEN status_mapped IN ('1','2','3') THEN 1 ELSE 0 END) as open_count,
                    SUM(CASE WHEN status_mapped = '4' THEN 1 ELSE 0 END) as closed_count
                   FROM remedy_group_tickets 
                   WHERE {comp_where}
                   GROUP BY group_name
                   ORDER BY count DESC""",
                comp_params,
            ).fetchall()

            comp_groups = [
                {
                    "group_name": gr["group_name"],
                    "count": gr["count"],
                    "percentage": round(gr["count"] / comp_total * 100, 1),
                    "open": gr["open_count"] or 0,
                    "closed": gr["closed_count"] or 0,
                }
                for gr in group_rows
            ]

            companies_data.append({
                "company_name": comp_name,
                "catalog_label": catalog_name,
                "brand_color": brand_color,
                "total_tickets": comp_total,
                "percentage_of_universe": pct_univ,
                "open_tickets": c_row["open_count"] or 0,
                "closed_tickets": c_row["closed_count"] or 0,
                "inc_tickets": c_row["inc_count"] or 0,
                "wo_tickets": c_row["wo_count"] or 0,
                "jarvis_tickets": c_row["jarvis_count"] or 0,
                "remedy_companies": remedy_companies,
                "email_domains": email_domains,
                "element_types": element_types,
                "tipificaciones": tipificaciones,
                "groups": comp_groups,
            })

        # Available months para sincronizar selectores del frontend
        available_months = []
        try:
            m_rows = db.execute(
                """SELECT submit_month, COUNT(*) as cnt 
                   FROM remedy_group_tickets 
                   WHERE submit_month IS NOT NULL AND submit_month != '' 
                   GROUP BY submit_month 
                   ORDER BY submit_month DESC"""
            ).fetchall()
            for mr in m_rows:
                m_key = mr["submit_month"]
                available_months.append({
                    "key": m_key,
                    "month_key": m_key,
                    "label": format_month_label(m_key),
                    "count": mr["cnt"],
                })
        except Exception:
            pass

    return {
        "filter_mode": filter_mode,
        "filter_label": filter_label,
        "origin_filter": orig_clean,
        "selected_month": month if (month and month != "all") else "all",
        "month_label": month_label,
        "period": period,
        "group_filter": group or "ALL",
        "total_tickets_processed": universe_total,
        "generated_at": now_iso(),
        "generated_at_friendly": generated_at_friendly,
        "companies_data": companies_data,
        "available_months": available_months,
    }


def generate_remedy_report_csv(report: dict) -> str:
    """Genera un archivo CSV con formato legible y delimitador punto y coma (;).

    Incluye BOM UTF-8 (\\ufeff) para compatibilidad nativa con Microsoft Excel en español.
    Garantiza que las empresas (Empresa Principal y Subsidiaria) se mantengan estrictamente separadas en secciones independientes.
    """
    lines = []
    lines.append("\ufeff================================================================================;")
    lines.append("REPORTE ESTADÍSTICO DE TICKETS REMEDY POR EMPRESA;")
    lines.append(f"Rango Temporal / Mes:;{report.get('month_label', '')};")
    lines.append(f"Fecha de Emisión:;{report.get('generated_at_friendly', '')};")
    lines.append(f"Filtro de Empresa Aplicado:;{report.get('filter_label', '')};")
    lines.append(f"Total Tickets Procesados en Período:;{report.get('total_tickets_processed', 0)};")
    lines.append("================================================================================;\n")

    for comp in report.get("companies_data", []):
        cname = comp.get("company_name", "")
        clabel = comp.get("catalog_label", "")
        ctotal = comp.get("total_tickets", 0)
        lines.append("--------------------------------------------------------------------------------;")
        lines.append(f"EMPRESA: {cname.upper()} ({clabel});")
        lines.append(f"Total de Tickets Procesados:;{ctotal};({comp.get('percentage_of_universe', 0)}% del universo)")
        lines.append(f"Estado de Gestión:;Abiertos: {comp.get('open_tickets', 0)};Resueltos/Cerrados: {comp.get('closed_tickets', 0)};")
        lines.append(f"Tipo de Ticket:;Incidentes (INC): {comp.get('inc_tickets', 0)};Work Orders (WO): {comp.get('wo_tickets', 0)};Ingresados por Jarvis Bot: {comp.get('jarvis_tickets', 0)};")
        lines.append("--------------------------------------------------------------------------------;")

        # 1. Datos Reales de Remedy
        lines.append("\n[1. DATOS REALES DE REMEDY (Campo Company)];")
        lines.append("Empresa Registrada en Remedy;Cantidad Tickets;Porcentaje")
        for rc in comp.get("remedy_companies", []):
            lines.append(f"\"{rc['company']}\";{rc['count']};{rc['percentage']}%")

        # 2. Extracción por Dominio de Correo
        lines.append("\n[2. EXTRACCIÓN POR DOMINIO DE CORREO CORPORATIVO];")
        lines.append("Dominio de Correo;Cantidad Tickets;Porcentaje")
        for ed in comp.get("email_domains", []):
            lines.append(f"\"{ed['domain']}\";{ed['count']};{ed['percentage']}%")

        # 3. Tipificación por Elemento / Hardware
        lines.append("\n[3. TIPIFICACIÓN POR ELEMENTO / SERVICIO];")
        lines.append("Tipo de Elemento;Cantidad;Abiertos;Cerrados;Porcentaje")
        for et in comp.get("element_types", []):
            lines.append(f"\"{et['name']}\";{et['count']};{et.get('open', 0)};{et.get('closed', 0)};{et['percentage']}%")

        # 4. Categorizaciones BMC Remedy
        lines.append("\n[4. CATEGORIZACIONES REMEDY (Tier 1 / 2 / 3)];")
        lines.append("Categorización Remedy;Cantidad Tickets;Porcentaje")
        for tip in comp.get("tipificaciones", []):
            lines.append(f"\"{tip['name']}\";{tip['count']};{tip['percentage']}%")

        # 5. Grupos de Soporte
        lines.append("\n[5. DISTRIBUCIÓN POR GRUPO DE SOPORTE];")
        lines.append("Grupo de Soporte;Cantidad;Abiertos;Cerrados;Porcentaje")
        for gr in comp.get("groups", []):
            lines.append(f"\"{gr['group_name']}\";{gr['count']};{gr.get('open', 0)};{gr.get('closed', 0)};{gr['percentage']}%")

        lines.append("\n")

    return "\n".join(lines)


def get_remedy_report_tickets_detail(
    company_filter: str = "all",
    month: str | None = None,
    period: str = "all",
    group: str | None = None,
    ticket_type: str | None = None,
    status_filter: str | None = None,
    origin: str | None = None,
    limit: int = 15000,
) -> list[dict]:
    """Retorna los tickets individuales filtrados para la hoja de detalle en Excel."""
    where_clauses = ["1=1"]
    params: list = []

    if group and group != "ALL":
        where_clauses.append("group_name = ?")
        params.append(group)
    else:
        placeholders = ",".join("?" for _ in REMEDY_ASSIGNED_GROUPS)
        where_clauses.append(f"group_name IN ({placeholders})")
        params.extend(REMEDY_ASSIGNED_GROUPS)

    if ticket_type and ticket_type.strip():
        t_clean = ticket_type.strip().upper()
        if t_clean in ("INC", "WO"):
            where_clauses.append("UPPER(ticket_type) = ?")
            params.append(t_clean)

    if status_filter == "open":
        where_clauses.append("status_mapped IN ('1', '2', '3')")
    elif status_filter == "closed":
        where_clauses.append("status_mapped = '4'")

    orig_clean = (origin or "all").strip().lower()
    if orig_clean in ("jarvis", "solo_jarvis", "solo jarvis"):
        where_clauses.append("is_jarvis = 1")
    elif orig_clean in ("no_jarvis", "otros", "no jarvis", "human"):
        where_clauses.append("is_jarvis = 0")

    comp_norm = (company_filter or "all").strip().lower()
    if comp_norm in ("empresa", "solo_empresa", "solo empresa"):
        where_clauses.append("LOWER(user_company) = 'empresa'")
    elif comp_norm in ("subsidiaria", "solo_subsidiaria", "solo subsidiaria"):
        where_clauses.append("LOWER(user_company) = 'subsidiaria'")

    m_mode, m_val = _normalize_month_filter(month)
    if m_mode == "exact":
        where_clauses.append("submit_month = ?")
        params.append(m_val)
    elif m_mode == "like":
        where_clauses.append("submit_month LIKE ?")
        params.append(m_val)
    elif period and period != "all":
        now_ts = int(time.time())
        days_map = {"7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365}
        days = days_map.get(period)
        if days:
            min_epoch = now_ts - (days * 86400)
            where_clauses.append("(CAST(submit_date AS INTEGER) >= ? OR submit_date >= ?)")
            iso_limit = datetime.fromtimestamp(min_epoch, tz=timezone.utc).isoformat()
            params.extend([min_epoch, iso_limit])

    where_sql = " AND ".join(where_clauses)
    params.append(limit)

    with get_db() as db:
        rows = db.execute(
            f"""SELECT 
                id, ticket_type, group_name, status_mapped, user_company, remedy_company,
                client_name, client_email, element_type, tipificacion, is_jarvis,
                submit_month, submit_date, assignee_name, summary
               FROM remedy_group_tickets
               WHERE {where_sql}
               ORDER BY submit_date DESC
               LIMIT ?""",
            params,
        ).fetchall()

        return [dict(r) for r in rows]


