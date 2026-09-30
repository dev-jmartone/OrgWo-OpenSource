"""
Backend/api/remedy_routes.py

Rutas Flask (Blueprint) para la integración con BMC Remedy.

Responsabilidad de este módulo: SOLO orquestar.
- Lee request.json y session.
- Llama a remedy.client, remedy.queries o remedy.sync.
- Devuelve jsonify(...) con el código HTTP apropiado.

No contiene lógica de parseo, construcción de queries HTTP ni acceso directo a la BD.
"""
import ssl
import threading
import urllib.parse
import urllib.request
import json


from flask import Blueprint, jsonify, request, session

from Backend.config import ENV
from Backend.base_datos.connection import get_db
from Backend.integraciones.remedy import client as remedy_client
from Backend.integraciones.remedy import queries as remedy_queries
from Backend.integraciones.remedy.sync import sync_assigned_tickets
from Backend.servicios import remedy_session
from Backend.utils import current_user_id, announce_event

remedy_bp = Blueprint("remedy", __name__)

# Cache thread-safe para Reconciliation IDs de CIs (evita llamadas redundantes a Remedy)
_recon_id_cache: dict = {}
_recon_id_cache_lock = threading.Lock()


from Backend.integraciones.remedy.queries import RemedyAuthenticationError

@remedy_bp.errorhandler(RemedyAuthenticationError)
def handle_remedy_auth_error(e):
    print(f"[remedy] Remedy auth/session error caught globally: {e}")
    return _remedy_session_expired_response()

# Segundos antes del vencimiento del JWT en que disparamos la renovacion
# proactiva. Si el token vence dentro de esta ventana, el before_request
# re-loguea de forma transparente con las credenciales retenidas.
_RENEW_THRESHOLD_SECS = 120


# ── Helper: detectar token Remedy expirado ────────────────────────────────────

def _is_remedy_token_expired(err_msg: str | None) -> bool:
    """Determina si un error devuelto por Remedy indica token expirado/inválido."""
    if not err_msg:
        return False
    return "HTTP 401" in err_msg or "HTTP 403" in err_msg


def get_jwt_exp(token: str) -> int | None:
    """Decodifica un JWT sin dependencias externas y devuelve el timestamp de expiración."""
    import base64
    import json
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        payload_b64 = parts[1]
        payload_b64 += '=' * (4 - len(payload_b64) % 4)
        payload_json = base64.urlsafe_b64decode(payload_b64).decode('utf-8')
        payload = json.loads(payload_json)
        return payload.get('exp')
    except Exception as e:
        print(f"Error decodificando JWT: {e}")
        return None


def _clear_remedy_session() -> None:
    """Limpia los datos de sesión de Remedy."""
    session.pop("remedy_token",         None)
    session.pop("remedy_username",      None)
    session.pop("remedy_assignee_name", None)
    session.pop("remedy_first_name",    None)
    session.pop("remedy_last_name",     None)
    session.pop("remedy_company",       None)


def _remedy_session_expired_response():
    """Respuesta estándar cuando el token de Remedy expiró."""
    _clear_remedy_session()
    return jsonify({
        "error":        "La sesión de Remedy expiró. Por favor vuelve a autenticarte.",
        "remedy_error": "TOKEN_EXPIRED",
    }), 401


# ── Renovación proactiva del token ────────────────────────────────────────────

@remedy_bp.before_request
def _auto_renew_remedy_token():
    """Renueva el token de Remedy antes de que venza, de forma transparente.

    Corre antes de cada ruta del blueprint. Si hay token y esta dentro de la
    ventana de vencimiento (o ya vencio), re-loguea con las credenciales
    retenidas en memoria y actualiza la sesion. Si no hay credenciales o el
    re-login falla, no hace nada: la ruta seguira su curso y el manejo de 401
    existente devolvera TOKEN_EXPIRED como antes.
    """
    import time

    token = session.get("remedy_token")
    if not token:
        return  # login/status sin sesion: que la ruta maneje

    exp = get_jwt_exp(token)
    if exp is None:
        return  # token sin claim exp: no podemos anticipar, dejamos el flujo 401

    if exp - int(time.time()) > _RENEW_THRESHOLD_SECS:
        return  # todavia lejos del vencimiento

    user_id = current_user_id()
    if not remedy_session.has_creds(user_id):
        return  # nada que renovar (sesion vieja previa a esta feature)

    new_token, err = remedy_session.renew(user_id)
    if new_token:
        session["remedy_token"] = new_token
        print(f"[remedy] token renovado automaticamente para user_id={user_id}")
    else:
        print(f"[remedy] renovacion automatica fallo para user_id={user_id}: {err}")


# ── Autenticación Remedy ──────────────────────────────────────────────────────

@remedy_bp.route("/api/remedy/login", methods=["POST"])
def route_remedy_login():
    data     = request.json or {}
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "Usuario y contraseña son requeridos"}), 400

    token, err_msg = remedy_client.remedy_login(username, password)
    if not token:
        return jsonify({"error": f"Fallo al conectar con Remedy: {err_msg}"}), 401

    session.pop("remedy_explicit_logout", None)
    session["remedy_token"]    = token
    session["remedy_username"] = username

    # Retener credenciales en memoria del proceso (no en la cookie) para la
    # renovacion silenciosa del token cuando este por vencer.
    remedy_session.store_creds(current_user_id(), username, password)

    # Obtener detalles del usuario y grupos en paralelo usando concurrent.futures
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_details = executor.submit(remedy_client.fetch_user_details, token, username)
        future_groups  = executor.submit(remedy_client.fetch_user_groups, token, username)
        
        try:
            details = future_details.result(timeout=4.0)
        except concurrent.futures.TimeoutError:
            print("[remedy_login] Timeout fetching user details, using fallback")
            details = None
        except Exception as e:
            print(f"[remedy_login] Error fetching user details: {e}")
            details = None

        try:
            groups_info = future_groups.result(timeout=4.0)
        except concurrent.futures.TimeoutError:
            print("[remedy_login] Timeout fetching user groups, using fallback")
            groups_info = {
                "groups": ["TECNOLOGIA USUARIOS DT"],
                "default_group": "TECNOLOGIA USUARIOS DT"
            }
        except Exception as e:
            print(f"[remedy_login] Error fetching user groups: {e}")
            groups_info = {
                "groups": ["TECNOLOGIA USUARIOS DT"],
                "default_group": "TECNOLOGIA USUARIOS DT"
            }

    if details:
        session["remedy_first_name"] = details.get("first_name") or username
        session["remedy_last_name"]  = details.get("last_name") or ""
        session["remedy_company"]    = details.get("company") or os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")
        session["remedy_assignee_name"] = details.get("full_name") or username
    else:
        # Fallback
        session["remedy_first_name"] = username
        session["remedy_last_name"]  = ""
        session["remedy_company"]    = os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")
        session["remedy_assignee_name"] = username

    session["remedy_groups"] = groups_info["groups"]
    session["remedy_default_group"] = groups_info["default_group"]

    expires_at = get_jwt_exp(token)
    return jsonify({"ok": True, "username": username, "expiresAt": expires_at})


@remedy_bp.route("/api/remedy/logout", methods=["POST"])
def route_remedy_logout():
    session["remedy_explicit_logout"] = True
    remedy_session.clear_creds(current_user_id())
    _clear_remedy_session()
    return jsonify({"ok": True})


@remedy_bp.route("/api/remedy/status", methods=["GET"])
def route_remedy_status():
    from Backend.integraciones.remedy import mock_remedy

    # Auto-conectar en modo simulación/demo si el usuario está autenticado en OrgWo y no cerró explícitamente
    if mock_remedy.is_mock_mode() and "user_id" in session and "remedy_token" not in session and not session.get("remedy_explicit_logout"):
        username = session.get("username", "admin")
        mock_token = mock_remedy.make_mock_jwt(username)
        session["remedy_token"] = mock_token
        session["remedy_username"] = username
        details = mock_remedy.mock_fetch_user_details(username)
        session["remedy_first_name"] = details.get("first_name", username)
        session["remedy_last_name"] = details.get("last_name", "")
        session["remedy_company"] = details.get("company", "Empresa Principal")
        session["remedy_assignee_name"] = details.get("full_name", username)
        groups_info = mock_remedy.mock_fetch_user_groups(username)
        session["remedy_groups"] = groups_info["groups"]
        session["remedy_default_group"] = groups_info["default_group"]
        remedy_session.store_creds(session["user_id"], username, "demo123")

    token = session.get("remedy_token")
    expires_at = get_jwt_exp(token) if token else None
    return jsonify({
        "connected": "remedy_token" in session,
        "username":  session.get("remedy_username"),
        "firstName": session.get("remedy_first_name"),
        "lastName":  session.get("remedy_last_name"),
        "company":   session.get("remedy_company"),
        "env":       ENV,
        "expiresAt": expires_at,
        "isMock":    mock_remedy.is_mock_mode(),
    })


# ── Tickets no asignados ──────────────────────────────────────────────────────

@remedy_bp.route("/api/remedy-tickets",       methods=["GET"])
@remedy_bp.route("/api/remedy/tickets",        methods=["GET"])
def route_list_remedy_tickets():
    if "remedy_token" not in session:
        return jsonify([])

    token = session["remedy_token"]

    incidents = remedy_queries.fetch_unassigned_incidents(token)

    # Si los incidentes fallaron con 401, el token expiró
    # (fetch_unassigned_incidents devuelve [] con log; necesitamos verificar
    # el estado de sesión consultando directamente)
    if incidents is None:
        return _remedy_session_expired_response()

    workorders  = remedy_queries.fetch_unassigned_workorders(token)
    all_tickets = incidents + workorders
    _enrich_tickets_with_directory(all_tickets)
    return jsonify(all_tickets)


# ── Tickets asignados (todos los técnicos) ─────────────────────────────────────

@remedy_bp.route("/api/remedy/tickets/assigned", methods=["GET"])
def route_list_assigned_remedy_tickets():
    if "remedy_token" not in session:
        return jsonify([])

    token = session["remedy_token"]

    try:
        incidents = remedy_queries.fetch_group_open_incidents(token)
        workorders = remedy_queries.fetch_group_open_workorders(token)
        all_tickets = incidents + workorders
        _enrich_tickets_with_directory(all_tickets)

        # Enriquecer con nombre del técnico local
        with get_db() as db:
            users_rows = db.execute("SELECT username, name FROM users").fetchall()
            user_map = {u["username"].lower().strip(): u["name"] for u in users_rows}

        for t in all_tickets:
            login = (t.get("assignee_login") or "").lower().strip()
            login_clean = login.split("@")[0]
            t["assignee_name"] = user_map.get(login, user_map.get(login_clean, t.get("assignee_login") or "Sin asignar"))

        return jsonify(all_tickets)
    except remedy_queries.RemedyAuthenticationError:
        return _remedy_session_expired_response()
    except Exception as e:
        print(f"[remedy.routes] error in route_list_assigned_remedy_tickets: {e}")
        return jsonify([])


# ── Tomar ticket (asignación) ─────────────────────────────────────────────────

@remedy_bp.route("/api/remedy/tickets/<tid>/take", methods=["POST"])
def route_take_ticket(tid):
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401

    token         = session["remedy_token"]
    username      = session.get("remedy_username", "")
    data          = request.json or {}
    ticket_type   = data.get("type", "INC")

    # Asegurar el nombre completo del asignatario desde Remedy
    assignee_name = session.get("remedy_assignee_name")
    if not assignee_name or assignee_name == username:
        details = remedy_client.fetch_user_details(token, username)
        if details and details.get("full_name"):
            assignee_name = details["full_name"]
            session["remedy_assignee_name"] = assignee_name
        else:
            assignee_name = session.get("remedy_assignee_name") or data.get("assigneeName") or username

    if ticket_type == "WO":
        form_name    = "WOI:WorkOrder"
        ticket_field = "Work Order ID"
    else:
        form_name    = "HPD:IncidentInterface"
        ticket_field = "Incident Number"

    req_id, extra_data, err = remedy_client.get_request_id(token, form_name, ticket_field, tid)

    if err and _is_remedy_token_expired(err):
        return _remedy_session_expired_response()
    if not req_id:
        return jsonify({"error": f"No se pudo obtener el Request ID: {err}"}), 500

    target_username = data.get("assigneeUsername") or username
    target_fullname = data.get("assigneeName") or assignee_name

    # Intentar resolver los datos oficiales desde Remedy usando el email del usuario en la base de datos local
    target_email = None
    remedy_user = None
    try:
        with get_db() as db:
            row_u = db.execute("SELECT email FROM users WHERE username = ?", (target_username,)).fetchone()
            if row_u:
                target_email = row_u["email"]
    except Exception as e:
        print(f"[remedy_routes] error de base de datos al buscar email: {e}")

    # Si encontramos email, buscar en Remedy para obtener el Login ID y Full Name exactos
    if target_email:
        remedy_user = remedy_client.fetch_remedy_user_by_email(token, target_email)
        if remedy_user:
            target_username = remedy_user["username"]
            target_fullname = remedy_user["full_name"]
            print(f"[remedy_routes] usuario resuelto por email: {target_username} ({target_fullname})")

    # Si no pudimos resolver por email, intentar obtener por detalles del Login ID
    if not remedy_user:
        details = remedy_client.fetch_user_details(token, target_username)
        if details and details.get("full_name"):
            target_fullname = details["full_name"]

    # Restaurado de ad0edbc (toma que funcionaba): grupos del usuario desde la
    # sesion (o fetch si faltan) + mapeo de IDs conocido + payload con el grupo
    # del ticket (o el por defecto si el operador no es miembro). Status = "1".
    if target_username.lower() == username.lower():
        user_groups = session.get("remedy_groups")
        default_group = session.get("remedy_default_group")
        if not user_groups or not default_group:
            groups_info = remedy_client.fetch_user_groups(token, username)
            user_groups = groups_info["groups"]
            default_group = groups_info["default_group"]
            session["remedy_groups"] = user_groups
            session["remedy_default_group"] = default_group
    else:
        # Consultar grupos del técnico destino (no guardar en sesión)
        groups_info = remedy_client.fetch_user_groups(token, target_username)
        user_groups = groups_info["groups"]
        default_group = groups_info["default_group"]

    # Mapeo de IDs de grupo para evitar desalineacion entre nombre y ID en Remedy.
    group_id_mapping = {
        "CTU DT": "SGP000000005909",
        "TECNOLOGIA CELULARES": "SGP000000005609",
        "TECNOLOGIA USUARIOS DT": "SGP000000003810",
    }

    if ticket_type == "WO":
        current_group = extra_data.get("Support Group Name")
        if not current_group or current_group not in user_groups:
            current_group = default_group

        group_id = group_id_mapping.get(current_group) or extra_data.get("Support Group ID")
        payload = {
            "ASLOGID":               target_username,
            "Request Assignee":      target_fullname,
            "Status":                "1",
            "Support Group Name":    current_group,
            "Support Group ID":      group_id,
        }
    else:
        current_org   = extra_data.get("Assigned Support Organization") or "TECHNOLOGY & DATACENTERS"
        current_group = extra_data.get("Assigned Group")
        if not current_group or current_group not in user_groups:
            current_group = default_group
            current_org   = "TECHNOLOGY & DATACENTERS"

        group_id = group_id_mapping.get(current_group) or extra_data.get("Assigned Group ID")
        payload = {
            "Assignee Login ID":             target_username,
            "Assignee":                      target_fullname,
            "Status":                        "1",
            "Assigned Support Company":      extra_data.get("Assigned Support Company") or os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA"),
            "Assigned Support Organization": current_org,
            "Assigned Group":                current_group,
            "Assigned Group ID":             group_id,
        }

    # Eliminar valores nulos
    payload = {k: v for k, v in payload.items() if v is not None}

    print(f"[remedy_routes] take_ticket {tid} ({ticket_type}) -> PUT payload: {payload}")
    ok, err = remedy_client.put_entry(token, form_name, req_id, payload)
    if not ok:
        if _is_remedy_token_expired(err):
            return _remedy_session_expired_response()
        print(f"[remedy_routes] take_ticket {tid} FAILED (grupo={current_group}/{group_id}): {err}")
        return jsonify({"error": f"Error al actualizar en Remedy [grupo: {current_group} / {group_id}]: {err}"}), 500

    user_id = session.get("user_id")
    org = session.get("organization", "local")
    target_user_id = None
    target_org = org
    with get_db() as db:
        user_row = db.execute("SELECT id, organization FROM users WHERE username = ?", (target_username,)).fetchone()
        if user_row:
            target_user_id = user_row["id"]
            target_org = user_row["organization"] or org
        if not target_user_id and target_username == username:
            target_user_id = user_id

        # El case local es un shadow del ticket (id = wo = tid). Se le fija la
        # organization del dueño para que aparezca en SU lista (scopeada por org)
        # y no choque al editarlo.
        row = db.execute("SELECT id FROM cases WHERE wo = ? OR id = ?", (tid, tid)).fetchone()
        
        tipificacion = extra_data.get("Categorization Tier 3") or extra_data.get("Categorization Tier 2") or extra_data.get("Categorization Tier 1") or None
        summary = extra_data.get("Summary") or extra_data.get("Description") or ""
        description = extra_data.get("Detailed Description") or extra_data.get("Detailed Decription") or ""
        
        if row:
            if target_user_id:
                db.execute("UPDATE cases SET excel_status = '1', owner_id = ?, organization = ?, tipificacion = COALESCE(tipificacion, ?) WHERE wo = ? OR id = ?", (target_user_id, target_org, tipificacion, tid, tid))
            else:
                db.execute("UPDATE cases SET excel_status = '1', organization = ?, tipificacion = COALESCE(tipificacion, ?) WHERE wo = ? OR id = ?", (target_org, tipificacion, tid, tid))
        else:
            # Insertar un caso mínimo
            from Backend.utils import now_iso
            ts = now_iso()
            
            if ticket_type == "WO":
                fname = extra_data.get("Customer First Name") or ""
                lname = extra_data.get("Customer Last Name") or ""
            else:
                fname = extra_data.get("First Name") or ""
                lname = extra_data.get("Last Name") or ""
                
            client_name = f"{fname} {lname}".strip() or "Sin nombre"
            company = extra_data.get("Company") or "—"
            estado = "remedy_wo_assigned" if ticket_type == "WO" else "remedy_inc_assigned"
            
            from Backend.servicios.users_directory import repo_get_user
            cached = repo_get_user(client_name)
            email = ""
            if cached and cached.get("email") != "NOT_FOUND":
                email = cached["email"]
                if cached.get("company"):
                    company = cached["company"]

            from Backend.integraciones.remedy.parsers import parse_element_type, map_element_type_to_tipo
            el_type = parse_element_type(summary, description)
            tipo = map_element_type_to_tipo(el_type)

            db.execute("""
                INSERT INTO cases (id, owner_id, name, email, company, puesto, tipo, estado, wo, notes, excel_status, organization, created_at, updated_at, tipificacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (tid, target_user_id, client_name, email, company, summary, tipo, estado, tid, description, "1", target_org, ts, ts, tipificacion))
        db.commit()

    remedy_queries.invalidate_remedy_cache(username)
    if target_username != username:
        remedy_queries.invalidate_remedy_cache(target_username)
    announce_event("cases_updated")
    return jsonify({"ok": True, "message": f"Ticket {tid} asignado a {target_username}"})


def _fetch_ci_recon_id_live(token: str, ci_name: str) -> str | None:
    """Intenta obtener el Reconciliation Identity de un Service CI de forma dinámica de Remedy."""
    if not token or not ci_name:
        return None
    from Backend.integraciones.remedy import client

    with _recon_id_cache_lock:
        cached = _recon_id_cache.get(ci_name)
    if cached is not None:
        return cached

    # Intentar en AST:BusinessService con 'CI Name'
    try:
        query = f"'CI Name'=\"{ci_name}\""
        fields = "values(Reconciliation Identity)"
        entries, err = client.get_entries(token, "AST:BusinessService", query, fields, limit=1)
        if not err and entries:
            recon = entries[0].get("values", {}).get("Reconciliation Identity")
            if recon:
                with _recon_id_cache_lock:
                    _recon_id_cache[ci_name] = recon
                return recon
    except Exception:
        pass

    # Intentar en AST:BusinessService con 'Name'
    try:
        query = f"'Name'=\"{ci_name}\""
        fields = "values(Reconciliation Identity)"
        entries, err = client.get_entries(token, "AST:BusinessService", query, fields, limit=1)
        if not err and entries:
            recon = entries[0].get("values", {}).get("Reconciliation Identity")
            if recon:
                with _recon_id_cache_lock:
                    _recon_id_cache[ci_name] = recon
                return recon
    except Exception:
        pass

    # Intentar en BMC.CORE:BMC_BusinessService
    try:
        query = f"'Name'=\"{ci_name}\""
        fields = "values(ReconciliationIdentity)"
        entries, err = client.get_entries(token, "BMC.CORE:BMC_BusinessService", query, fields, limit=1)
        if not err and entries:
            recon = entries[0].get("values", {}).get("ReconciliationIdentity")
            if recon:
                with _recon_id_cache_lock:
                    _recon_id_cache[ci_name] = recon
                return recon
    except Exception:
        pass

    return None



def _determine_service_ci(tid: str, extra_data: dict, token: str = None) -> tuple[str, str | None]:
    """Determina ServiceCI y ServiceCI_ReconID de acuerdo a las reglas de negocio y al entorno (QA/PROD):
    - Si el ticket ya tiene un ServiceCI válido (no vacío),
      se PRESERVA el del ticket original para evitar errores de selección inválida.
    - Si es vacío:
      - Resuelve ServiceCI corporativo configurado por entorno.
    """
    service_ci = extra_data.get("ServiceCI")
    service_recon = extra_data.get("ServiceCI_ReconID")
    
    # 1. Si el ticket ya tiene un ServiceCI válido y no es el chatbot indeseado, lo preservamos intacto.
    if service_ci and service_ci.strip() and service_ci != os.environ.get("REMEDY_DEFAULT_SERVICE_CI", "Servicios TI Corporativos"):
        return service_ci, service_recon

    # 2. Si no es válido, determinamos el adecuado de forma dinámica
    db_company = ""
    db_email = ""
    
    # Intentamos primero buscar en el caso de la DB local
    try:
        with get_db() as db:
            org = session.get("organization", "local")
            row = db.execute("SELECT company, email FROM cases WHERE wo = ? AND organization = ?", (tid, org)).fetchone()
            if row:
                db_company = row["company"] or ""
                db_email = row["email"] or ""
    except Exception as e:
        print(f"[remedy_routes] Error fetching case for ServiceCI: {e}")
        
    # Si no lo encontramos en la DB local (ej: ticket solo en Remedy), extraemos el nombre del cliente
    # de los metadatos de la llamada get_request_id y hacemos un lookup en el directorio local de usuarios.
    if not db_company and not db_email:
        first = extra_data.get("First Name") or extra_data.get("Customer First Name") or ""
        last = extra_data.get("Last Name") or extra_data.get("Customer Last Name") or ""
        client_name = f"{first} {last}".strip()
        if client_name:
            try:
                from Backend.servicios.users_directory import repo_get_user
                cached = repo_get_user(client_name)
                if cached and cached.get("email") != "NOT_FOUND":
                    db_company = cached.get("company") or ""
                    db_email = cached.get("email") or ""
            except Exception as ex:
                print(f"[remedy_routes] Error looking up directory user for ServiceCI: {ex}")
                
    company = db_company or extra_data.get("Company") or ""
    email = db_email
    
    comp_lower = str(company).lower()
    email_lower = str(email).lower()
    
    is_subsidiaria = "subsidiaria" in comp_lower or "subsidiaria" in email_lower
    
    from Backend.config import ENV
    is_prod = (ENV == "PROD")
    
    if is_subsidiaria:
        resolved_ci = "Usuarios Subsidiaria"
        if is_prod:
            resolved_recon = "OI-F578CD0B5E0C46F3A4F327037EBDA63A"
        else:
            # En QA intentamos dinámico
            resolved_recon = _fetch_ci_recon_id_live(token, "Usuarios Subsidiaria") or "OI-F578CD0B5E0C46F3A4F327037EBDA63A"
    else:
        resolved_ci = os.environ.get("REMEDY_DEFAULT_SERVICE_CI", "Servicios TI Corporativos")
        if is_prod:
            resolved_recon = "834D222F-FA56-1382-4300-863B9DBA822B"
        else:
            resolved_recon = "OI-CBF380FFF08542C29A2A3A766A091409"
            
    return resolved_ci, resolved_recon


# ── Cambio de estado de ticket ────────────────────────────────────────────────

@remedy_bp.route("/api/remedy/tickets/<tid>/status", methods=["PUT"])
def route_change_ticket_status(tid):
    """Cambia el estado de un ticket en Remedy y permite adjuntar opcionalmente un archivo al resolver.

    Para 'Pendiente': PUT de estado + POST a WorkLog con nota interna.
    Para 'Resuelto': Status_Reason depende de ENV (QA/PROD) + opcionalmente subir adjunto (multipart/form-data).
    """
    import os
    import tempfile

    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401

    token = session["remedy_token"]

    # Soporte para JSON tradicional y multipart/form-data
    if request.is_json:
        data            = request.json or {}
        ticket_type     = data.get("type", "INC")
        new_status      = data.get("status")
        resolution_note = data.get("resolutionNote", "")
        file            = None
    else:
        ticket_type     = request.form.get("type", "INC")
        new_status      = request.form.get("status")
        resolution_note = request.form.get("resolutionNote", "")
        file            = request.files.get("file")

    if ticket_type == "WO":
        form_name    = "WOI:WorkOrder"
        ticket_field = "Work Order ID"
    else:
        form_name    = "HPD:IncidentInterface"
        ticket_field = "Incident Number"

    req_id, extra_data, err = remedy_client.get_request_id(token, form_name, ticket_field, tid)
    if err and _is_remedy_token_expired(err):
        return _remedy_session_expired_response()
    if not req_id:
        return jsonify({"error": f"No se pudo obtener el Request ID: {err}"}), 500

    if new_status == "assigned":
        payload = {"Status": "1"}

    elif new_status == "inprogress":
        payload = {"Status": "2"}

    elif new_status == "pending":
        if ticket_type == "WO":
            payload = {"Status": "3"}
        else:
            resolved_ci, resolved_recon = _determine_service_ci(tid, extra_data, token)
            payload = {
                "values": {k: v for k, v in {
                    "Status":            "3",
                    "Status_Reason":     "13000",
                    "Observaciones":     "Solicitud recibida, en proceso.",
                    "ServiceCI":         resolved_ci,
                    "ServiceCI_ReconID": resolved_recon,
                }.items() if v is not None}
            }

    elif new_status == "resolved":
        if ticket_type == "WO":
            # WOI:WorkOrder en este tenant usa "Status Reason" (con espacio)
            # y "Detalle Terminado" como nota de cierre custom.
            payload = {
                "values": {
                    "Status":            "Completed",
                    "Status Reason":     "Successful",
                    "Detalle Terminado": resolution_note or "Se entregó el equipo de reemplazo.",
                }
            }
        else:
            status_reason        = "19000" if ENV == "PROD" else "No Further Action Required"
            assigned_support_org = extra_data.get("Assigned Support Organization") or "TECHNOLOGY & DATACENTERS"
            assigned_group       = extra_data.get("Assigned Group") or "TECNOLOGIA USUARIOS DT"
            assigned_group_id    = extra_data.get("Assigned Group ID") or "SGP000000000XXX"
            assignee_login_id    = session.get("remedy_username") or "USUARIO_LOGIN_ID"
            assignee             = session.get("remedy_assignee_name") or "NOMBRE_ASIGNADO"
            
            # Recuperar o completar el servicio relacionado (ServiceCI) para evitar error 13501
            resolved_ci, resolved_recon = _determine_service_ci(tid, extra_data, token)

            values = {
                "Status":                       "4",  # Resolved en HPD:Help Desk
                "Status_Reason":                status_reason,
                "Resolution":                   resolution_note or "Se entregó el equipo de reemplazo.",
                "Assigned Support Organization": assigned_support_org,
                "Assigned Group":               assigned_group,
                "Assigned Group ID":            assigned_group_id,
                "Assignee Login ID":            assignee_login_id,
                "Assignee":                     assignee,
                "ServiceCI":                    resolved_ci,
                "ServiceCI_ReconID":            resolved_recon,
            }
            payload = {"values": {k: v for k, v in values.items() if v is not None}}
    else:
        return jsonify({"error": f"Estado desconocido: {new_status}"}), 400

    # Paso 1: PUT del estado para resolver o cambiar estado del ticket
    ok, err = remedy_client.put_entry(token, form_name, req_id, payload)
    if not ok:
        if _is_remedy_token_expired(err):
            return _remedy_session_expired_response()
        return jsonify({"error": f"Error al actualizar estado en Remedy: {err}"}), 500

    # Paso 2 (Condicional): Si hay archivo adjunto y está en estado resolved, subirlo usando cURL
    file_upload_error = None
    if file and file.filename and new_status == "resolved":
        filename = file.filename
        temp_dir = tempfile.gettempdir()
        
        original_temp_path = os.path.join(temp_dir, filename)
        pdf_temp_path = None
        
        try:
            file.save(original_temp_path)
            
            # Si el archivo es una imagen (jpg, jpeg, png, tif, tiff), se convierte automáticamente a PDF
            base_ext = os.path.splitext(filename.lower())[1]
            if base_ext in ['.jpg', '.jpeg', '.png', '.tif', '.tiff']:
                base_name = os.path.splitext(filename)[0]
                filename = f"{base_name}.pdf"
                pdf_temp_path = os.path.join(temp_dir, filename)
                
                # Conversión con Pillow
                from PIL import Image
                with Image.open(original_temp_path) as img:
                    if hasattr(img, "n_frames") and img.n_frames > 1:
                        pages = []
                        for i in range(img.n_frames):
                            img.seek(i)
                            pages.append(img.convert('RGB'))
                        pages[0].save(pdf_temp_path, "PDF", save_all=True, append_images=pages[1:])
                    else:
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        img.save(pdf_temp_path, "PDF")
                
                upload_path = pdf_temp_path
            else:
                upload_path = original_temp_path
                
            ok_upload, upload_err = remedy_client.post_worklog_with_attachment(
                token, ticket_type, tid, upload_path, filename,
                comment=resolution_note,
            )
            if not ok_upload:
                file_upload_error = upload_err or "Error desconocido al subir el archivo a Remedy"
        except Exception as ex:
            file_upload_error = f"Error en procesamiento/conversión de archivo: {str(ex)}"
        finally:
            # Limpieza segura de todos los archivos temporales generados
            for path in [original_temp_path, pdf_temp_path]:
                if path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception:
                        pass

    # Paso 3: Si pasa a Pendiente, inyectar nota interna vía WorkLog/WorkInfo
    if new_status == "pending":
        pending_note = "Solicitud recibida, en proceso."
        ok_wl, err_wl = remedy_client.post_worklog(token, ticket_type, tid, pending_note)
        if not ok_wl:
            print(f"[remedy_routes] Advertencia WorkLog para {tid}: {err_wl}")

    # Actualizar estado local en la BD
    status_val = "1" if new_status == "assigned" else ("2" if new_status == "inprogress" else ("3" if new_status == "pending" else "4"))
    org = session.get("organization", "local")
    with get_db() as db:
        if new_status == "resolved":
            db.execute("UPDATE cases SET excel_status = ?, estado = 'done' WHERE wo = ? AND organization = ?", (status_val, tid, org))
        else:
            db.execute("UPDATE cases SET excel_status = ? WHERE wo = ? AND organization = ?", (status_val, tid, org))
        db.commit()

    # Si el ticket fue resuelto, intentar abrir un draft de Outlook como reply
    # al mail de aprobacion de Rafa con el template firmado adjunto.
    outlook_draft_status = None
    if new_status == "resolved":
        outlook_draft_status = _trigger_outlook_reply_for_ticket(tid)

    response_data = {
        "ok":       True,
        "status":   new_status,
        "ticketId": tid
    }
    if file_upload_error:
        response_data["file_error"] = f"El ticket se resolvió pero el archivo no pudo cargarse: {file_upload_error}"
    if outlook_draft_status:
        response_data["outlook_draft"] = outlook_draft_status

    # Invalidate cache for Remedy queries
    username = session.get("remedy_username")
    remedy_queries.invalidate_remedy_cache(username)

    announce_event("cases_updated")
    return jsonify(response_data)


def _perform_remedy_resolve(
    token: str,
    tid: str,
    ticket_type: str,
    resolution_note: str,
    file_disk_path: str | None,
    file_filename: str | None,
    extra_session_data: dict,
) -> tuple[dict, int]:
    """Logica nucleo de cerrar ticket en Remedy + adjuntar (opcional).
    Devuelve (response_dict, http_status). No depende de flask.request.

    extra_session_data: dict con keys 'remedy_username' y 'remedy_assignee_name'.
    """
    import os
    import tempfile

    if ticket_type == "WO":
        form_name    = "WOI:WorkOrder"
        ticket_field = "Work Order ID"
    else:
        form_name    = "HPD:IncidentInterface"
        ticket_field = "Incident Number"

    req_id, extra_data, err = remedy_client.get_request_id(token, form_name, ticket_field, tid)
    if err and _is_remedy_token_expired(err):
        return {"error": "Sesión Remedy expirada", "remedy_error": "TOKEN_EXPIRED"}, 401
    if not req_id:
        return {"error": f"No se pudo obtener el Request ID: {err}"}, 500

    # Precheck del estado actual. Si el user cerro la WO manualmente en
    # Remedy (Completed / Closed / Cancelled para WO, Resolved / Closed /
    # Cancelled para INC), salteamos el PUT — repetir la transicion
    # tiraria ARERR 314 en algunos workflows y abortaria el flujo. Igual
    # subimos el adjunto + actualizamos la DB + abrimos draft Outlook,
    # que es lo que el operador realmente quiere lograr.
    current_status = (extra_data.get("Status") or "").strip()
    if ticket_type == "WO":
        closed_states = {"Completed", "Closed", "Cancelled", "Rejected"}
    else:
        closed_states = {"Resolved", "Closed", "Cancelled"}
    already_resolved = current_status in closed_states

    if already_resolved:
        ok, err = True, None
    else:
        if ticket_type == "WO":
            # WOI:WorkOrder en este tenant: usar nombres literales del schema.
            # "Status Reason" con espacio (no Status_Reason). "Detalle Terminado"
            # es el campo custom de la empresa para la nota de cierre (no existe
            # un "Resolution" generico aca).
            payload = {
                "values": {
                    "Status":            "Completed",
                    "Status Reason":     "Successful",
                    "Detalle Terminado": resolution_note or "Se entregó el equipo de reemplazo.",
                }
            }
        else:
            status_reason        = "19000" if ENV == "PROD" else "No Further Action Required"
            assigned_support_org = extra_data.get("Assigned Support Organization") or "TECHNOLOGY & DATACENTERS"
            assigned_group       = extra_data.get("Assigned Group") or "TECNOLOGIA USUARIOS DT"
            assigned_group_id    = extra_data.get("Assigned Group ID") or "SGP000000000XXX"
            assignee_login_id    = extra_session_data.get("remedy_username") or "USUARIO_LOGIN_ID"
            assignee             = extra_session_data.get("remedy_assignee_name") or "NOMBRE_ASIGNADO"

            # Recuperar o completar el servicio relacionado (ServiceCI) para evitar error 13501
            resolved_ci, resolved_recon = _determine_service_ci(tid, extra_data, token)

            values = {
                "Status":                       "4",
                "Status_Reason":                status_reason,
                "Resolution":                   resolution_note or "Se entregó el equipo de reemplazo.",
                "Assigned Support Organization": assigned_support_org,
                "Assigned Group":               assigned_group,
                "Assigned Group ID":            assigned_group_id,
                "Assignee Login ID":            assignee_login_id,
                "Assignee":                     assignee,
                "ServiceCI":                    resolved_ci,
                "ServiceCI_ReconID":            resolved_recon,
            }
            payload = {"values": {k: v for k, v in values.items() if v is not None}}

        ok, err = remedy_client.put_entry(token, form_name, req_id, payload)
        if not ok:
            if _is_remedy_token_expired(err):
                return {"error": "Sesión Remedy expirada", "remedy_error": "TOKEN_EXPIRED"}, 401
            return {"error": f"Error al actualizar estado en Remedy: {err}"}, 500

    file_upload_error = None
    if file_disk_path and os.path.exists(file_disk_path):
        try:
            upload_filename = file_filename or os.path.basename(file_disk_path)
            base_ext = os.path.splitext(upload_filename.lower())[1]
            if base_ext in [".jpg", ".jpeg", ".png"]:
                from PIL import Image
                pdf_temp = os.path.join(
                    tempfile.gettempdir(),
                    f"{os.path.splitext(upload_filename)[0]}.pdf",
                )
                with Image.open(file_disk_path) as img:
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                    img.save(pdf_temp, "PDF")
                upload_path = pdf_temp
                upload_filename = os.path.basename(pdf_temp)
            else:
                upload_path = file_disk_path

            ok_upload, upload_err = remedy_client.post_worklog_with_attachment(
                token, ticket_type, tid, upload_path, upload_filename,
                comment=resolution_note,
            )
            if not ok_upload:
                file_upload_error = upload_err or "Error al subir el archivo a Remedy"
        except Exception as ex:
            file_upload_error = f"Error procesando archivo: {ex}"

    return {"ok": True, "file_error": file_upload_error, "already_resolved": already_resolved}, 200


@remedy_bp.route("/api/remedy/probe-workinfo", methods=["GET"])
def route_probe_workinfo():
    """Lista WorkInfos asociados a la WO especificada en ?wo=<WOID>. Devuelve
    fields y values de los primeros 3 para inferir schema."""
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401
    token = session["remedy_token"]
    wo = request.args.get("wo", "")
    form = request.args.get("form", "WOI:WorkInfo")
    if not wo:
        return jsonify({"error": "?wo=WO... requerido"}), 400

    import ssl
    import urllib.error
    import urllib.parse
    import urllib.request
    from Backend.config import REMEDY_BASE_URL

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    query = f"'Work Order ID'=\"{wo}\""
    params = urllib.parse.urlencode({"q": query}, quote_via=urllib.parse.quote)
    url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/{urllib.parse.quote(form)}?{params}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"AR-JWT {token}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else str(e)
        return jsonify({"form": form, "error": remedy_client.format_remedy_error(f"HTTP {e.code}: {body}")}), 200
    except Exception as e:
        return jsonify({"form": form, "error": str(e)}), 200

    entries = data.get("entries", [])
    sample = entries[:3]
    field_names = sorted(sample[0].get("values", {}).keys()) if sample else []
    return jsonify({
        "form": form,
        "wo": wo,
        "entries_count": len(entries),
        "field_names": field_names,
        "samples": [{"values": e.get("values", {})} for e in sample],
    })


@remedy_bp.route("/api/remedy/probe-wo/<tid>", methods=["GET"])
def route_probe_wo(tid):
    """Diagnostico: trae TODOS los fields del WO especificado para ver que
    keys existen en el schema y poder armar el payload de cierre."""
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401
    token = session["remedy_token"]

    # Primero obtener el Request ID
    req_id, _extra, err = remedy_client.get_request_id(token, "WOI:WorkOrder", "Work Order ID", tid)
    if not req_id:
        return jsonify({"error": f"No se pudo obtener Request ID: {err}"}), 500

    import ssl
    import urllib.error
    import urllib.parse
    import urllib.request
    from Backend.config import REMEDY_BASE_URL

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/WOI:WorkOrder/{urllib.parse.quote(req_id)}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"AR-JWT {token}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else str(e)
        return jsonify({"error": remedy_client.format_remedy_error(f"HTTP {e.code}: {body}")}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    vals = data.get("values", {})
    return jsonify({
        "ticket_id": tid,
        "request_id": req_id,
        "fields_count": len(vals),
        "field_names": sorted(vals.keys()),
        "values": vals,
    })


@remedy_bp.route("/api/cases/<cid>/remedy-close", methods=["POST"])
def route_close_case_from_drawer(cid):
    """Cierra el ticket Remedy asociado al case usando el ultimo template_firmado
    adjunto del case. Tras el cierre, dispara draft Outlook reply automatico."""
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401

    org = session.get("organization")
    with get_db() as db:
        case = db.execute(
            "SELECT id, wo FROM cases WHERE id = ? AND organization = ?",
            (cid, org),
        ).fetchone()
        if not case:
            return jsonify({"error": "case no encontrado"}), 404
        att = db.execute(
            """SELECT id, filename, path FROM attachments
               WHERE case_id = ? AND kind = 'template_firmado'
               ORDER BY created_at DESC LIMIT 1""",
            (cid,),
        ).fetchone()

    if not att:
        return jsonify({"error": "case sin template_firmado adjunto"}), 400
    tid = (case["wo"] or "").strip()
    if not tid:
        return jsonify({"error": "case sin numero de ticket en campo wo"}), 400

    ticket_type = "INC" if tid.upper().startswith("INC") else ("REQ" if tid.upper().startswith("REQ") else "WO")
    resolution_note = (request.json or {}).get("resolutionNote", "") if request.is_json else ""

    result, status_code = _perform_remedy_resolve(
        token=session["remedy_token"],
        tid=tid,
        ticket_type=ticket_type,
        resolution_note=resolution_note,
        file_disk_path=att["path"],
        file_filename=att["filename"],
        extra_session_data={
            "remedy_username": session.get("remedy_username", ""),
            "remedy_assignee_name": session.get("remedy_assignee_name", ""),
        },
    )
    if status_code != 200:
        if result.get("remedy_error") == "TOKEN_EXPIRED":
            return _remedy_session_expired_response()
        return jsonify(result), status_code

    # Updatear estado local
    with get_db() as db:
        db.execute(
            "UPDATE cases SET excel_status = '4', estado = 'done' WHERE id = ? AND organization = ?",
            (cid, org),
        )
        db.commit()

    # Disparar Outlook reply draft (sin enviar)
    outlook_draft = _trigger_outlook_reply_for_ticket(tid)

    # Archivar el template_firmado: el PDF ya esta en Remedy + en el draft
    # Outlook que va al aprobador. El binario local ya no aporta nada (es
    # ~200KB-2MB por case, x cientos de cases al año, x N operadores). La
    # metadata persiste como registro auditable de que el PDF se proceso.
    # Si el upload a Remedy fallo (file_error), NO archivamos: el operador
    # puede necesitar el binario para reintentar.
    if not result.get("file_error"):
        try:
            from Backend.servicios.attachments import service_archive_attachment
            service_archive_attachment(att["id"], org)
        except Exception as e:
            # No bloqueamos el cierre por una falla de archivado.
            print(f"[remedy-close] archive fallo para att {att['id']}: {e}")

    response = {"ok": True, "ticketId": tid, "ticketType": ticket_type}
    if result.get("file_error"):
        response["file_error"] = result["file_error"]
    if result.get("already_resolved"):
        response["already_resolved"] = True
    if outlook_draft:
        response["outlook_draft"] = outlook_draft

    # Invalidate cache for Remedy queries
    username = session.get("remedy_username")
    remedy_queries.invalidate_remedy_cache(username)

    return jsonify(response)


def _trigger_outlook_reply_for_ticket(tid: str) -> dict:
    """Busca el case correspondiente al ticket en la org del usuario actual,
    toma su attachment template_firmado mas reciente y abre un draft Outlook
    como reply al mail de Rafa. NUNCA envia.

    El llamado COM a Outlook se ejecuta en un daemon thread para no bloquear
    el worker HTTP. Devuelve un dict con resultado para incluir en la response JSON."""
    org = session.get("organization")
    if not org:
        return {"opened": False, "reason": "sin organizacion en sesion"}

    with get_db() as db:
        case = db.execute(
            "SELECT id, wo FROM cases WHERE wo = ? AND organization = ?",
            (tid, org),
        ).fetchone()
        if not case:
            return {"opened": False, "reason": f"no hay case con wo={tid!r} en org"}
        att = db.execute(
            """SELECT id, filename, path FROM attachments
               WHERE case_id = ? AND kind = 'template_firmado'
               ORDER BY created_at DESC LIMIT 1""",
            (case["id"],),
        ).fetchone()
    if not att:
        return {"opened": False, "reason": "case no tiene template_firmado adjunto"}

    # Capturar datos necesarios fuera del request context antes de hacer spawn.
    case_wo = case["wo"] or ""
    att_path = att["path"]
    att_filename = att["filename"]

    def _run_draft():
        try:
            from pathlib import Path
            from Backend.integraciones.outlook.reply import open_reply_draft
            ok, err = open_reply_draft(case_wo, Path(att_path), att_filename)
            if not ok:
                print(f"[outlook reply] draft falló para {case_wo}: {err}")
        except Exception as e:
            print(f"[outlook reply] excepcion para {case_wo}: {e}")

    threading.Thread(target=_run_draft, daemon=True, name=f"outlook-reply-{tid}").start()
    return {"opened": True, "case_id": case["id"]}



# ── Reconciliacion de cases con Remedy ────────────────────────────────────────

@remedy_bp.route("/api/remedy/reconcile-cases", methods=["POST"])
def route_reconcile_cases():
    """Cierra automaticamente cases del operador cuya WO/INC ya esta resuelta
    o cancelada en Remedy. Util cuando el user cierra el ticket directo en
    Remedy (sin pasar por el tracker) y la web local queda desactualizada.

    Source of truth: Remedy. Tracker se reconcila contra eso.

    Returns: {checked: N, reconciled: [wo_ids], errors: [...]}.
    """
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401

    from Backend.utils import current_user_org, now_iso
    import uuid
    import json as _json

    token    = session["remedy_token"]
    username = session.get("remedy_username", "")
    org      = current_user_org()

    # Fetch closed tickets del usuario en una sola pasada (mas barato que
    # querear ticket por ticket).
    closed_incs = remedy_queries.fetch_closed_incidents(token, username) or []
    closed_wos  = remedy_queries.fetch_closed_workorders(token, username) or []
    closed_ids  = {t.get("id") for t in (closed_incs + closed_wos) if t.get("id")}

    if not closed_ids:
        return jsonify({"checked": 0, "reconciled": [], "errors": []})

    reconciled = []
    errors = []
    with get_db() as db:
        rows = db.execute(
            """SELECT id, wo FROM cases
               WHERE organization = ?
                 AND wo IS NOT NULL AND wo != ''
                 AND estado NOT IN ('done', 'reject')""",
            (org,),
        ).fetchall()
        for r in rows:
            wo = (r["wo"] or "").strip()
            if wo not in closed_ids:
                continue
            try:
                db.execute(
                    """UPDATE cases
                       SET estado = 'done',
                           excel_status = '4',
                           updated_at = ?
                       WHERE id = ? AND organization = ?""",
                    (now_iso(), r["id"], org),
                )
                # Evento al timeline para trazabilidad.
                db.execute(
                    """INSERT INTO events (case_id, at, text)
                       VALUES (?, ?, ?)""",
                    (
                        r["id"],
                        now_iso(),
                        f"Auto-sync Remedy: ticket {wo} detectado como cerrado en Remedy → marcado como done.",
                    ),
                )
                reconciled.append(wo)
            except Exception as ex:
                errors.append({"case_id": r["id"], "wo": wo, "error": str(ex)})
        db.commit()

    return jsonify({
        "checked":    len(rows),
        "reconciled": reconciled,
        "errors":     errors,
    })


# ── Mis tickets ───────────────────────────────────────────────────────────────

@remedy_bp.route("/api/remedy/my-tickets", methods=["GET"])
def route_my_tickets():
    """Devuelve los tickets asignados al usuario actual.

    Query params:
        ?status=open   → INC < Resolved + WO < Completed  (default)
        ?status=closed → INC >= Resolved + WO >= Completed
        ?q=...         → Filtro de búsqueda opcional
    """
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401

    token         = session["remedy_token"]
    username      = session.get("remedy_username", "")
    status_filter = request.args.get("status", "open")
    search_q      = request.args.get("q", "").strip()

    if status_filter == "closed":
        inc_tickets = remedy_queries.fetch_closed_incidents(token, username, search_q=search_q)
        wo_tickets  = remedy_queries.fetch_closed_workorders(token, username, search_q=search_q)
    else:
        inc_tickets = remedy_queries.fetch_assigned_incidents(token, username)
        wo_tickets  = remedy_queries.fetch_assigned_workorders(token, username)

    tickets = inc_tickets + wo_tickets
    _enrich_tickets_with_directory(tickets)
    return jsonify(tickets)


def _enrich_tickets_with_directory(tickets: list[dict]) -> None:
    """Enriquece tickets Remedy con email + company del directorio canonico.
    Modifica los dicts in-place. SIEMPRE prefiere el email del directorio
    sobre el de Remedy — el campo Remedy viene con data poco confiable
    (nombre puesto en el slot email, vacio, etc), por eso el GAL lookup
    es la fuente de verdad."""
    try:
        from Backend.servicios.users_directory import _normalize_name_key
        with get_db() as db:
            rows = db.execute("SELECT name_key, email, company FROM users_directory").fetchall()
            directory_map = {r["name_key"]: {"email": r["email"], "company": r["company"]} for r in rows}
    except Exception as e:
        print(f"Error loading users directory map: {e}")
        return
    for t in tickets:
        name = (t.get("clientName") or "").strip()
        if not name:
            continue
        key = _normalize_name_key(name)
        cached = directory_map.get(key)
        if cached and cached.get("email") and cached.get("email") != "NOT_FOUND":
            t["email"] = cached["email"]
            if cached.get("company"):
                t["company"] = cached["company"]

@remedy_bp.route("/api/remedy/import-closed", methods=["POST"])
def route_import_closed():
    """Importa tickets cerrados de Remedy y los guarda en la base de datos local."""
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401
    
    user_id = session["user_id"]
    token = session["remedy_token"]
    username = session.get("remedy_username", "")
    
    from Backend.utils import current_user_org, now_iso
    org = current_user_org()
    is_dispatcher = session.get("role_id") == 2 or (session.get("role") or "").lower() == "dispatcher"
    
    data = request.get_json() or {}
    days = int(data.get("days", 60))
    group = bool(data.get("group", False)) and is_dispatcher
    
    try:
        incidents = remedy_queries.fetch_closed_incidents(token, username, days_back=days, group_tickets=group) or []
        workorders = remedy_queries.fetch_closed_workorders(token, username, days_back=days, group_tickets=group) or []
        
        if group:
            open_inc = remedy_queries.fetch_group_open_incidents(token) or []
            open_wo = remedy_queries.fetch_group_open_workorders(token) or []
            incidents += open_inc
            workorders += open_wo
    except Exception as e:
        return jsonify({"error": f"Error al consultar Remedy: {str(e)}"}), 500
        
    tickets = incidents + workorders
    _enrich_tickets_with_directory(tickets)
    
    imported_count = 0
    skipped_count = 0
    
    with get_db() as db:
        for t in tickets:
            tid = t.get("id")
            if not tid:
                continue
                
            # Check if ticket already exists in local DB
            existing = db.execute(
                "SELECT id, estado FROM cases WHERE id = ? AND organization = ?", 
                (tid, org)
            ).fetchone()
            
            # Use default item type 'pc'
            tipo = "pc"
            
            name = t.get("clientName") or "Sin nombre"
            email = t.get("email") or ""
            company = t.get("company") or "—"
            notes = t.get("description") or ""
            summary = t.get("summary") or ""
            
            # Resolve owner_id based on Remedy assignee_login
            assignee = (t.get("assignee_login") or "").lower().strip()
            ticket_owner_id = None
            if assignee:
                user_row = db.execute("SELECT id FROM users WHERE username = ? AND organization = ?", (assignee, org)).fetchone()
                if user_row:
                    ticket_owner_id = user_row["id"]
            
            # If personal import, fall back to current user if unmapped
            if not group and not ticket_owner_id:
                ticket_owner_id = user_id
                
            # Determine correct status
            status_mapped = t.get("status") or "1"
            if status_mapped == "4":
                target_estado = "done"
                target_excel_status = "4"
            else:
                target_estado = "remedy_inc_assigned" if t.get("type") == "INC" else "remedy_wo_assigned"
                target_excel_status = status_mapped
            
            tipificacion = t.get("tipificacion") or None
            if existing:
                # If it exists, update it (and if Remedy status is closed but local isn't closed, update to done)
                if status_mapped == "4" and existing["estado"] not in ("done", "reject"):
                    db.execute(
                        """UPDATE cases 
                           SET estado = 'done', excel_status = '4', owner_id = ?, updated_at = ?, tipificacion = COALESCE(tipificacion, ?)
                           WHERE id = ? AND organization = ?""",
                        (ticket_owner_id, now_iso(), tipificacion, tid, org)
                      )
                    db.execute(
                        "INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)",
                        (tid, now_iso(), "Importación Remedy: ticket marcado como done.")
                    )
                    imported_count += 1
                else:
                    db.execute(
                        """UPDATE cases 
                           SET tipificacion = COALESCE(tipificacion, ?)
                           WHERE id = ? AND organization = ?""",
                        (tipificacion, tid, org)
                    )
                    skipped_count += 1
            else:
                # Insert new case (open or closed)
                db.execute(
                    """INSERT INTO cases (
                        id, name, email, company, puesto, tipo, estado, wo, notes, 
                        excel_status, owner_id, organization, updated_at, created_at, items_json, tipificacion
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        tid, name, email, company, summary, tipo, target_estado, tid, notes,
                        target_excel_status, ticket_owner_id, org, now_iso(), now_iso(), "[]", tipificacion
                    )
                )
                db.execute(
                    "INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)",
                    (tid, now_iso(), f"Importación Remedy: ticket registrado localmente en estado '{target_estado}'.")
                )
                imported_count += 1
                
        db.commit()
        
    return jsonify({
        "imported": imported_count,
        "skipped": skipped_count,
        "total": len(tickets)
    })


# ── Comentar ticket ───────────────────────────────────────────────────────────

@remedy_bp.route("/api/remedy/tickets/<tid>/comments", methods=["POST"])
def route_add_ticket_comment(tid):
    """Agrega un comentario (WorkLog/WorkInfo) en Remedy sin alterar el estado actual."""
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401

    token = session["remedy_token"]
    data = request.json or {}
    text = data.get("comment", "").strip()
    ticket_type = data.get("type", "INC")

    if not text:
        return jsonify({"error": "El comentario no puede estar vacío"}), 400

    ok, err = remedy_client.post_worklog(token, ticket_type, tid, text)
    if not ok:
        if _is_remedy_token_expired(err):
            return _remedy_session_expired_response()
        return jsonify({"error": f"Error al agregar comentario en Remedy: {err}"}), 500

    # Invalidate cache for Remedy queries
    username = session.get("remedy_username")
    remedy_queries.invalidate_remedy_cache(username)

    return jsonify({"ok": True, "message": "Comentario agregado exitosamente en Remedy"})


# ── Debug ─────────────────────────────────────────────────────────────────────

@remedy_bp.route("/api/remedy/debug-inc", methods=["GET"])
def route_remedy_debug_inc():
    if "remedy_token" not in session:
        return jsonify({"error": "Not logged into Remedy"}), 401

    token    = session["remedy_token"]
    username = session.get("remedy_username", "")
    incidents = remedy_queries.fetch_assigned_incidents(token, username)

    return jsonify({
        "username_in_session": username,
        "clean_user":          username.split("@")[0],
        "count":               len(incidents),
        "incidents":           incidents,
    })


@remedy_bp.route("/api/remedy/debug-ticket/<tid>", methods=["GET"])
def route_remedy_debug_ticket(tid):
    if "remedy_token" not in session:
        return jsonify({"error": "Not logged into Remedy"}), 401

    token = session["remedy_token"]
    from Backend.integraciones.remedy import client

    form_name = "HPD:Help Desk" if tid.upper().startswith("INC") else "WOI:WorkOrder"
    ticket_field = "Incident Number" if tid.upper().startswith("INC") else "Work Order ID"
    
    query = f"'{ticket_field}'=\"{tid.upper()}\""
    if tid.upper().startswith("INC"):
        fields = "values(Incident Number,ServiceCI,ServiceCI_ReconID,Company,Status,Description)"
    else:
        fields = "values(Work Order ID,ServiceCI,ServiceCI_ReconID,Company,Status,Description)"
    
    entries, err = client.get_entries(token, form_name, query, fields)
    if err:
        return jsonify({"error": err}), 500
    if not entries:
        return jsonify({"error": "Ticket no encontrado"}), 404
        
    return jsonify({
        "tid": tid,
        "entry": entries[0]
    })




@remedy_bp.route("/api/remedy/tickets/create", methods=["POST"])
def route_create_remedy_ticket():
    """Crea un nuevo ticket (INC o WO) en Remedy."""
    if ENV != "QA":
        return jsonify({"error": "La creación de tickets solo está permitida en el entorno QA"}), 403

    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401

    token = session["remedy_token"]
    data = request.json or {}

    ticket_type = data.get("type", "INC")
    
    # El solicitante y la empresa son los del usuario Remedy autenticado
    first_name = session.get("remedy_first_name", "").strip() or data.get("firstName", "").strip()
    last_name  = session.get("remedy_last_name", "").strip() or data.get("lastName", "").strip()
    company    = session.get("remedy_company", "").strip() or data.get("company", os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")).strip()
    
    if not first_name:
        first_name = session.get("remedy_username", "Usuario")
    if not last_name:
        last_name = "." # Fallback si no tiene apellido en CTM:People
        
    summary = data.get("summary", "").strip()
    description = data.get("description", "").strip()

    if not (first_name and last_name and summary and description):
        return jsonify({"error": "Todos los campos (nombre, apellido, resumen y descripción) son requeridos."}), 400

    payload = {
        "username": session.get("remedy_username", "").strip(),
        "firstName": first_name,
        "lastName": last_name,
        "company": company,
        "summary": summary,
        "description": description,
        "priority": data.get("priority", "Low"),
        "impact": data.get("impact", "4-Minor/Localized"),
        "urgency": data.get("urgency", "4-Low"),
        "op_tier_1": data.get("op_tier_1"),
        "op_tier_2": data.get("op_tier_2"),
        "op_tier_3": data.get("op_tier_3"),
    }

    created_id, err = remedy_client.create_ticket(token, ticket_type, payload)
    if not created_id:
        if err and _is_remedy_token_expired(err):
            return _remedy_session_expired_response()
        return jsonify({"error": f"Error al crear ticket en Remedy: {err}"}), 500

    return jsonify({"ok": True, "ticketId": created_id})


# ── Comentarios y Adjuntos de Remedy ──────────────────────────────────────────

@remedy_bp.route("/api/remedy/tickets/<tid>/comments", methods=["GET"])
def route_get_ticket_comments(tid):
    """Devuelve los comentarios y adjuntos de Remedy para el ticket especificado."""
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401
    token = session["remedy_token"]
    tid = tid.upper().strip()

    ticket_type = "INC" if tid.startswith("INC") else "WO"
    if ticket_type == "INC":
        form_name = "HPD:WorkLog"
        query = f"'Incident Number'=\"{tid}\""
    else:
        form_name = "WOI:WorkInfo"
        query = f"'Work Order ID'=\"{tid}\""

    fields = "values(Description,Detailed Description,Submit Date,Submitter,z2AF Work Log01)"
    
    from Backend.integraciones.remedy import client as remedy_client
    entries, err = remedy_client.get_entries(token, form_name, query, fields)
    if err:
        if "401" in err or "token" in err.lower():
            return jsonify({"error": "Sesión de Remedy expirada"}), 401
        return jsonify({"error": f"Error al traer comentarios: {err}"}), 500

    system_submitters = ["ar_escalator", "remedy application service", "system", "remedy", "automation"]
    
    comments = []
    for entry in entries:
        vals = entry.get("values", {})
        submitter = str(vals.get("Submitter") or "").lower().strip()
        
        # Filtrar comentarios de sistema
        if any(sys_sub in submitter for sys_sub in system_submitters):
            continue

        desc = str(vals.get("Description") or "")
        detailed = str(vals.get("Detailed Description") or "")
        
        # Filtrar comentarios automáticos del tracker
        if "nota interna de cambio de estado" in desc.lower() or "se entregó el equipo de reemplazo" in detailed.lower():
            continue

        # Parsear ID de entrada
        self_links = entry.get("_links", {}).get("self", [])
        entry_id = None
        if self_links:
            href = self_links[0].get("href", "")
            entry_id = href.rstrip("/").split("/")[-1]

        attachment_name = vals.get("z2AF Work Log01")

        comments.append({
            "id": entry_id or vals.get("Request ID"),
            "submitter": vals.get("Submitter"),
            "date": vals.get("Submit Date"),
            "description": desc,
            "detailed": detailed,
            "attachment": attachment_name
        })

    comments.sort(key=lambda x: x["date"] or "", reverse=True)
    return jsonify(comments)


@remedy_bp.route("/api/remedy/tickets/<tid>/attachments/<entry_id>/<field_name>", methods=["GET"])
def route_get_ticket_attachment(tid, entry_id, field_name):
    """Descarga/Previsualiza un archivo adjunto desde Remedy."""
    if "remedy_token" not in session:
        return jsonify({"error": "No autenticado en Remedy"}), 401
    token = session["remedy_token"]
    tid = tid.upper().strip()

    ticket_type = "INC" if tid.startswith("INC") else "WO"
    form_name = "HPD:WorkLog" if ticket_type == "INC" else "WOI:WorkInfo"

    import ssl
    import urllib.request
    import urllib.parse
    from flask import Response
    from Backend.config import REMEDY_BASE_URL

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/{urllib.parse.quote(form_name)}/{urllib.parse.quote(entry_id)}/attach/{urllib.parse.quote(field_name)}"
    headers = {
        "Authorization": f"AR-JWT {token}",
    }
    req = urllib.request.Request(url, headers=headers)
    
    try:
        from Backend.integraciones.remedy.client import _remedy_sem
        with _remedy_sem:
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                data = resp.read()
                headers_resp = dict(resp.info())
        
        content_type = headers_resp.get("Content-Type", "application/octet-stream")
        content_disp = headers_resp.get("Content-Disposition", "")
        
        res = Response(data, mimetype=content_type)
        if content_disp:
            res.headers["Content-Disposition"] = content_disp
        return res
        
    except Exception as e:
        return jsonify({"error": f"Error al descargar adjunto: {str(e)}"}), 500


@remedy_bp.route("/api/dispatcher/status", methods=["GET"])
def route_dispatcher_status():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    
    org = session.get("organization", "local")
    
    from Backend.base_datos.connection import get_db
    with get_db() as db:
        active_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_active'", (org,)).fetchone()
        interval_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_interval_minutes'", (org,)).fetchone()
        last_run_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_last_run'", (org,)).fetchone()
        max_round_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_max_tickets_per_round'", (org,)).fetchone()
        max_tech_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_max_tickets_per_tech_per_round'", (org,)).fetchone()
        
    active = active_row["value"] == "1" if (active_row and active_row["value"]) else False
    interval = int(interval_row["value"]) if (interval_row and interval_row["value"] is not None and str(interval_row["value"]).strip()) else 15
    last_run = last_run_row["value"] if last_run_row else None
    max_round = int(max_round_row["value"]) if (max_round_row and max_round_row["value"] is not None and str(max_round_row["value"]).strip()) else 3
    max_tech = int(max_tech_row["value"]) if (max_tech_row and max_tech_row["value"] is not None and str(max_tech_row["value"]).strip()) else 1
    
    return jsonify({
        "active": active,
        "interval": interval,
        "lastRun": last_run,
        "maxRound": max_round,
        "maxTech": max_tech
    })


@remedy_bp.route("/api/dispatcher/config", methods=["POST"])
def route_dispatcher_config():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    if session.get("role_id") != 2 and (session.get("role") or "").lower() != "dispatcher":
        return jsonify({"error": "Solo un dispatcher puede cambiar la configuración"}), 403
        
    org = session.get("organization", "local")
    data = request.json or {}
    
    active = "1" if data.get("active") else "0"
    interval = str(data.get("interval", 15))
    max_round = str(data.get("maxRound", 3))
    max_tech = str(data.get("maxTech", 1))
    
    from Backend.base_datos.connection import get_db
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO org_settings (organization, key, value) VALUES (?, 'dispatcher_active', ?)", (org, active))
        db.execute("INSERT OR REPLACE INTO org_settings (organization, key, value) VALUES (?, 'dispatcher_interval_minutes', ?)", (org, interval))
        db.execute("INSERT OR REPLACE INTO org_settings (organization, key, value) VALUES (?, 'dispatcher_max_tickets_per_round', ?)", (org, max_round))
        db.execute("INSERT OR REPLACE INTO org_settings (organization, key, value) VALUES (?, 'dispatcher_max_tickets_per_tech_per_round', ?)", (org, max_tech))
        db.commit()
        
    # Log audit
    from Backend.utils import log_action
    log_action("DISPATCHER_CONFIG", f"Configuración del despachador actualizada: activa={active}, intervalo={interval}, max_round={max_round}, max_tech={max_tech}")
    
    return jsonify({"ok": True})


@remedy_bp.route("/api/dispatcher/debug", methods=["GET"])
def route_dispatcher_debug():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
        
    org = session.get("organization", "local")
    
    from Backend.base_datos.connection import get_db
    with get_db() as db:
        active_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_active'", (org,)).fetchone()
        interval_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_interval_minutes'", (org,)).fetchone()
        last_run_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_last_run'", (org,)).fetchone()
        max_round_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_max_tickets_per_round'", (org,)).fetchone()
        max_tech_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_max_tickets_per_tech_per_round'", (org,)).fetchone()
        
    active = active_row["value"] == "1" if (active_row and active_row["value"]) else False
    interval = int(interval_row["value"]) if (interval_row and interval_row["value"] is not None and str(interval_row["value"]).strip()) else 15
    last_run = last_run_row["value"] if last_run_row else None
    max_round = int(max_round_row["value"]) if (max_round_row and max_round_row["value"] is not None and str(max_round_row["value"]).strip()) else 3
    max_tech = int(max_tech_row["value"]) if (max_tech_row and max_tech_row["value"] is not None and str(max_tech_row["value"]).strip()) else 1

    from Backend.servicios.remedy_session import get_active_user_ids
    from Backend.servicios.dispatcher import get_dispatcher_logs
    
    return jsonify({
        "active": active,
        "interval": interval,
        "lastRun": last_run,
        "maxRound": max_round,
        "maxTech": max_tech,
        "remedyCredsInMemory": get_active_user_ids(),
        "logs": get_dispatcher_logs()
    })


@remedy_bp.route("/api/users/availability", methods=["GET", "POST"])
def route_user_availability():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    user_id = session["user_id"]
    from Backend.base_datos.connection import get_db
    from Backend.config import DB_PATH
    with get_db() as db:
        if request.method == "POST":
            data = request.json or {}
            disponible = int(data.get("disponible", 1))
            print(f"[DEBUG-AVAILABILITY-POST] user_id={user_id!r}, disponible={disponible}, DB_PATH={DB_PATH}")
            res = db.execute("UPDATE users SET disponible = ? WHERE id = ?", (disponible, user_id))
            db.commit()
            print(f"[DEBUG-AVAILABILITY-POST] rowcount={res.rowcount}")
            announce_event("tech_status_updated")
            return jsonify({"ok": True, "disponible": disponible})
        else:
            row = db.execute("SELECT disponible FROM users WHERE id = ?", (user_id,)).fetchone()
            print(f"[DEBUG-AVAILABILITY-GET] user_id={user_id!r}, row_found={row is not None}, DB_PATH={DB_PATH}")
            if row:
                print(f"[DEBUG-AVAILABILITY-GET] DB value={row['disponible']}")
            disponible = row["disponible"] if (row and row["disponible"] is not None) else 1
            return jsonify({"disponible": disponible})


@remedy_bp.route("/api/dispatcher/tech-status", methods=["GET"])
def route_tech_status():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    if session.get("role_id") != 2 and (session.get("role") or "").lower() != "dispatcher":
        return jsonify({"error": "Solo un dispatcher puede ver el estado de los técnicos"}), 403
    org = session.get("organization", "local")
    from Backend.base_datos.connection import get_db
    with get_db() as db:
        rows = db.execute(
            "SELECT id, username, name, email, disponible, role, nivel FROM users WHERE organization = ?", (org,)
        ).fetchall()
    return jsonify([{
        "id": r["id"],
        "username": r["username"],
        "name": r["name"],
        "email": r["email"],
        "disponible": r["disponible"] if (r["disponible"] is not None) else 1,
        "role": "dispatcher" if str(r["role"]) == "2" else "tecnico",
        "nivel": r["nivel"] or 1
    } for r in rows])


@remedy_bp.route("/api/dispatcher/tech-status/<uid>", methods=["POST"])
def route_update_tech_status(uid):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    if session.get("role_id") != 2 and (session.get("role") or "").lower() != "dispatcher":
        return jsonify({"error": "Solo un dispatcher puede modificar el estado de los técnicos"}), 403
    org = session.get("organization", "local")
    data = request.json or {}
    disponible = int(data.get("disponible", 1))
    from Backend.base_datos.connection import get_db
    with get_db() as db:
        user = db.execute("SELECT id FROM users WHERE id = ? AND organization = ?", (uid, org)).fetchone()
        if not user:
            return jsonify({"error": "Usuario no encontrado en la organización"}), 404
        db.execute("UPDATE users SET disponible = ? WHERE id = ?", (disponible, uid))
        db.commit()
        announce_event("tech_status_updated")
    return jsonify({"ok": True, "disponible": disponible})


@remedy_bp.route("/api/dispatcher/rules", methods=["GET", "POST"])
def route_dispatcher_rules():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    org = session.get("organization", "local")
    from Backend.base_datos.connection import get_db
    with get_db() as db:
        if request.method == "POST":
            if session.get("role_id") != 2 and (session.get("role") or "").lower() != "dispatcher":
                return jsonify({"error": "Solo un dispatcher puede cambiar la configuración"}), 403
            data = request.json or {}
            import json
            rules_str = json.dumps(data.get("rules", {}))
            db.execute("INSERT OR REPLACE INTO org_settings (organization, key, value) VALUES (?, 'dispatcher_ticket_levels', ?)", (org, rules_str))
            db.commit()
            return jsonify({"ok": True})
        else:
            row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_ticket_levels'", (org,)).fetchone()
            rules = {}
            if row and row["value"]:
                try:
                    import json
                    rules = json.loads(row["value"])
                except Exception:
                    pass
            return jsonify({"rules": rules})


@remedy_bp.route("/api/dispatcher/run", methods=["POST"])
def route_dispatcher_run():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    if session.get("role_id") != 2 and (session.get("role") or "").lower() != "dispatcher":
        return jsonify({"error": "Solo un dispatcher puede forzar la asignación"}), 403
        
    org = session.get("organization", "local")
    user_id = session["user_id"]
    
    from Backend.servicios.dispatcher import _run_dispatcher_job
    import threading
    threading.Thread(
        target=_run_dispatcher_job,
        args=(user_id, org),
        daemon=True,
        name=f"dispatcher-manual-run-{org}"
    ).start()
    
    return jsonify({"ok": True, "message": "Ronda de asignación iniciada en segundo plano"})


