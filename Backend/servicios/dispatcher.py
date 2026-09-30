import time
import threading
from datetime import datetime

from Backend.base_datos.connection import get_db
from Backend.servicios import remedy_session
from Backend.integraciones.remedy import queries as remedy_queries
from Backend.integraciones.remedy import client as remedy_client
from Backend.integraciones.remedy.parsers import map_element_type_to_tipo
from Backend.utils import now_iso, announce_event

DISPATCHER_LOGS = []
_logs_lock = threading.Lock()

def log_dispatcher(msg: str) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    print(formatted)
    with _logs_lock:
        DISPATCHER_LOGS.append(formatted)
        if len(DISPATCHER_LOGS) > 100:
            DISPATCHER_LOGS.pop(0)

def get_dispatcher_logs() -> list[str]:
    with _logs_lock:
        return list(DISPATCHER_LOGS)


def start_dispatcher_thread() -> None:
    """Inicia el hilo del despachador automático en segundo plano."""
    t = threading.Thread(target=_dispatcher_loop, daemon=True, name="dispatcher-auto-assign")
    t.start()
    print("Hilo de auto-asignación iniciado.")


def _update_last_run(org: str) -> None:
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO org_settings (organization, key, value) VALUES (?, 'dispatcher_last_run', ?)", (org, now_iso()))
        db.commit()


def _dispatcher_loop() -> None:
    # Espera inicial para asegurar inicio de base de datos
    time.sleep(15)
    print("Bucle principal de auto-asignación iniciado.")
    
    while True:
        try:
            # Sleep 60 segundos entre evaluaciones
            time.sleep(60)
            
            # 1. Buscar organizaciones con dispatcher activo en DB
            with get_db() as db:
                active_rows = db.execute("SELECT organization FROM org_settings WHERE key = 'dispatcher_active' AND value = '1'").fetchall()
                active_orgs = [r["organization"] for r in active_rows]
                
            if not active_orgs:
                continue
                
            # 2. Obtener credenciales de Remedy en memoria
            from Backend.servicios.remedy_session import get_active_user_ids
            active_creds_uids = get_active_user_ids()
            
            for org in active_orgs:
                # Buscar usuarios de esta organizacion
                with get_db() as db:
                    user_rows = db.execute("SELECT id, username FROM users WHERE organization = ?", (org,)).fetchall()
                    org_users = {r["id"]: r["username"] for r in user_rows}
                    
                # Ver si alguno de estos usuarios tiene credenciales en memoria
                matching_user_ids = [uid for uid in org_users.keys() if uid in active_creds_uids]
                
                if not matching_user_ids:
                    log_dispatcher(f"Auto-asignación activa para org '{org}' pero no hay credenciales Remedy en memoria para ningún operador de esta organización. Debe iniciar sesión en Remedy.")
                    continue
                    
                operator_user_id = matching_user_ids[0]
                
                # Obtener intervalo
                with get_db() as db:
                    interval_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_interval_minutes'", (org,)).fetchone()
                    interval_mins = int(interval_row["value"]) if interval_row else 15
                    
                    # Última corrida
                    last_run_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_last_run'", (org,)).fetchone()
                    
                run_now = False
                if not last_run_row or not last_run_row["value"]:
                    run_now = True
                else:
                    try:
                        last_run_dt = datetime.fromisoformat(last_run_row["value"])
                        diff = datetime.now() - last_run_dt
                        if diff.total_seconds() >= interval_mins * 60:
                            run_now = True
                    except Exception:
                        run_now = True
                        
                if not run_now:
                    continue
                    
                log_dispatcher(f"Ejecutando auto-asignador para: {org} (usando credenciales de {org_users[operator_user_id]})")
                _run_dispatcher_job(operator_user_id, org)
                
        except Exception as e:
            log_dispatcher(f"Error en loop: {e}")


def _run_dispatcher_job(user_id: str, org: str) -> None:
    # 1. Obtener límites configurados en la base de datos
    with get_db() as db:
        max_round_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_max_tickets_per_round'", (org,)).fetchone()
        max_tech_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_max_tickets_per_tech_per_round'", (org,)).fetchone()
        
    max_round = int(max_round_row["value"]) if max_round_row else 3
    max_tech = int(max_tech_row["value"]) if max_tech_row else 1
    
    # 2. Renovar Token Remedy
    log_dispatcher(f"[{org}] Iniciando tarea. Límite ronda: {max_round}, Límite técnico: {max_tech}. Renovando token...")
    token, err = remedy_session.renew(user_id)
    if not token or err:
        log_dispatcher(f"[{org}] Fallo al renovar token Remedy: {err}")
        return
        
    # 3. Buscar tickets INC sin asignar
    log_dispatcher(f"[{org}] Buscando incidentes sin asignar en Remedy...")
# Mapeo por defecto de tipo de elemento a nivel técnico requerido (1 o 2)
DEFAULT_LEVELS = {
    "vincha": 1,
    "kit": 1,
    "cargador": 1,
    "celular": 1,
    "monitor": 1,
    "red / conectividad": 2,
    "software / configuración": 2,
    "equipo": 2
}

DEFAULT_COMPLEXITIES = {
    "vincha": 1,
    "kit": 1,
    "cargador": 1,
    "celular": 3,
    "monitor": 2,
    "red / conectividad": 4,
    "software / configuración": 4,
    "equipo": 5
}

def detect_tipificacion(summary: str) -> str | None:
    if not summary:
        return None
    s = summary.lower()
    
    if "vincha" in s or "headset" in s or "auricular" in s:
        return "vincha"
    if "kit" in s or "teclado" in s or "mouse" in s:
        return "kit inalambrico"
    if "cargador" in s or "adaptador" in s:
        return "cargador"
    if "celular" in s or "movil" in s or "móvil" in s or "tel." in s:
        return "alta/cambio equipo celular"
    if "monitor" in s:
        return "solicitud de monitor"
    if "notebook baja" in s or "baja notebook" in s:
        return "notebook baja"
    if "software" in s and "instal" in s:
        return "software - instalacion"
    if "software" in s and "config" in s:
        return "software - configuracion"
    if "outlook" in s or "correo" in s:
        return "outlook - inconvenientes con correo"
    if "vpn" in s:
        return "equipo - configuracion de vpn"
    if "virtual" in s:
        return "maquina virtual"
    if "reparacion" in s or "reparación" in s:
        return "equipo - reparacion"
    if "generales" in s:
        return "generales"
    
    return None

def _run_dispatcher_job(user_id: str, org: str) -> None:
    # 1. Obtener límites configurados en la base de datos
    with get_db() as db:
        max_round_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_max_tickets_per_round'", (org,)).fetchone()
        max_tech_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_max_tickets_per_tech_per_round'", (org,)).fetchone()
        levels_row = db.execute("SELECT value FROM org_settings WHERE organization = ? AND key = 'dispatcher_ticket_levels'", (org,)).fetchone()
        
    max_round = int(max_round_row["value"]) if max_round_row else 3
    max_tech = int(max_tech_row["value"]) if max_tech_row else 1
    
    custom_rules = {}
    if levels_row and levels_row["value"]:
        try:
            import json
            custom_rules = json.loads(levels_row["value"])
        except Exception as e:
            log_dispatcher(f"[{org}] Error parsing dispatcher_ticket_levels: {e}")

    # 2. Renovar Token Remedy
    log_dispatcher(f"[{org}] Iniciando tarea. Límite ronda: {max_round}, Límite técnico: {max_tech}. Renovando token...")
    token, err = remedy_session.renew(user_id)
    if not token or err:
        log_dispatcher(f"[{org}] Fallo al renovar token Remedy: {err}")
        return
        
    # 3. Buscar tickets INC sin asignar
    log_dispatcher(f"[{org}] Buscando incidentes sin asignar en Remedy...")
    incidents = remedy_queries.fetch_unassigned_incidents(token)
    if not incidents:
        log_dispatcher(f"[{org}] Sin incidentes libres en Remedy.")
        _update_last_run(org)
        return
        
    log_dispatcher(f"[{org}] Encontrados {len(incidents)} incidentes sin asignar.")
    
    # 4. Buscar técnicos candidatos registrados en SQLite
    with get_db() as db:
        candidates = db.execute("SELECT id, username, name, nivel, disponible FROM users WHERE organization = ?", (org,)).fetchall()
        candidates = [dict(c) for c in candidates]
        
    if not candidates:
        log_dispatcher(f"[{org}] Sin técnicos candidatos en la base de datos.")
        return
        
    # Filtrar solo técnicos disponibles (fichados/activos)
    candidates = [c for c in candidates if (c.get("disponible") is None or c.get("disponible") == 1)]
    if not candidates:
        log_dispatcher(f"[{org}] No hay técnicos disponibles en este momento (todos fuera de servicio o en pausa/almuerzo).")
        return

    # Default users' nivel if not present
    for c in candidates:
        c["nivel"] = c.get("nivel", 1) or 1

    log_dispatcher(f"[{org}] Técnicos disponibles para asignación: {[(c['username'], 'N' + str(c['nivel'])) for c in candidates]}")
        
    # 5. Calcular Carga de trabajo ponderada en base a la complejidad del ticket
    weighted_workloads = {c["id"]: 0.0 for c in candidates}
    # Obtener los niveles de cada candidato para el cálculo
    tech_levels = {c["id"]: c.get("nivel", 1) or 1 for c in candidates}
    
    from datetime import datetime
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    with get_db() as db:
        open_cases = db.execute("""
            SELECT owner_id, tipo, tipificacion, puesto, fecha_retiro 
            FROM cases 
            WHERE organization = ? AND estado NOT IN ('done', 'reject') AND owner_id IS NOT NULL
        """, (org,)).fetchall()
        
        for case in open_cases:
            owner_id = case["owner_id"]
            if owner_id in weighted_workloads:
                t_level = tech_levels.get(owner_id, 1)
                case_tip = case["tipificacion"] or ""
                case_summary = case["puesto"] or ""
                detected_case_tip = detect_tipificacion(case_tip or case_summary)
                
                # Obtener peso de complejidad de las reglas (N1 o N2 según corresponda)
                case_complexity = 1
                if detected_case_tip and detected_case_tip in custom_rules:
                    rule = custom_rules[detected_case_tip]
                    if t_level == 2:
                        case_complexity = int(rule.get("complexity_n2", rule.get("complexity", 1)))
                    else:
                        case_complexity = int(rule.get("complexity_n1", rule.get("complexity", 1)))
                else:
                    # Fallback based on tipo (vincha, kit, cargador, cel, monitor, pc)
                    case_tipo = case["tipo"] or ""
                    if case_tipo in ["vincha", "kit", "cargador"]:
                        case_complexity = 1
                    elif case_tipo in ["cel", "monitor"]:
                        case_complexity = 2
                    else:
                        case_complexity = 4 # pc / software
                
                # Descuento por fecha de retiro programada a futuro
                alpha_date = 1.0
                if case["fecha_retiro"]:
                    try:
                        fr = case["fecha_retiro"].strip()
                        if len(fr) >= 10:
                            if fr[:10] > today_str[:10]:
                                alpha_date = 0.1
                    except Exception:
                        pass
                        
                weighted_workloads[owner_id] += (case_complexity * alpha_date)
                
    # 6. Calcular Experiencia (casos resueltos por clasificación/tipo)
    experience = {c["id"]: {} for c in candidates}
    with get_db() as db:
        rows = db.execute("""
            SELECT owner_id, tipo, COUNT(*) as cnt
            FROM cases
            WHERE organization = ? AND estado = 'done' AND owner_id IS NOT NULL
            GROUP BY owner_id, tipo
        """, (org,)).fetchall()
        for r in rows:
            if r["owner_id"] in experience:
                experience[r["owner_id"]][r["tipo"]] = r["cnt"]
                
    # 7. Asignar cada ticket
    assigned_any = False
    assigned_candidates_counts = {c["id"]: 0 for c in candidates}
    round_assigned_count = 0
    
    for inc in incidents:
        if round_assigned_count >= max_round:
            log_dispatcher(f"[{org}] Se alcanzó el límite configurado de {max_round} tickets asignados en esta ronda. Deteniendo.")
            break
            
        # Check si todos los candidatos alcanzaron el max por tecnico
        all_saturated = all(assigned_candidates_counts[c["id"]] >= max_tech for c in candidates)
        if all_saturated:
            log_dispatcher(f"[{org}] Todos los técnicos disponibles alcanzaron el límite de {max_tech} tickets asignados en esta ronda. Deteniendo.")
            break

        tid = inc["id"]
        el_type = inc.get("element_type", "Equipo")
        ticket_tipo = map_element_type_to_tipo(el_type)
        summary = inc.get("summary", "")
        
        # Detectar tipificación y nivel/complejidad
        detected_tip = detect_tipificacion(summary)
        req_levels = [1]
        complexity = 1
        
        if detected_tip and detected_tip in custom_rules:
            rule = custom_rules[detected_tip]
            if "niveles" in rule:
                req_levels = [int(x) for x in rule["niveles"]]
            elif "nivel" in rule:
                req_levels = [int(rule["nivel"])]
            complexity = int(rule.get("complexity", 1))
        else:
            req_levels = [DEFAULT_LEVELS.get(el_type.lower(), 1)]
            complexity = DEFAULT_COMPLEXITIES.get(el_type.lower(), 1)
        
        best_cand = None
        best_score = -999999
        
        for c in candidates:
            # Saltear si ya alcanzo el maximo de tickets por tecnico por ronda
            if assigned_candidates_counts[c["id"]] >= max_tech:
                continue
                
            # Validar niveles permitidos
            tech_level = c.get("nivel", 1) or 1
            if tech_level not in req_levels:
                continue
                
            w = weighted_workloads[c["id"]]
            exp = experience[c["id"]].get(ticket_tipo, 0)
            
            # Priorizar técnicos N1 para tickets de nivel 1
            level_preference = 0
            if 1 in req_levels and tech_level == 1:
                level_preference = 10  # Equivale a tener 1 ticket de complejidad 1 menos de carga
            
            # Score formula: (Experience * 1) - (WeightedWorkload * 10) + LevelPreference
            score = (exp * 1) - (w * 10) + level_preference
            if score > best_score:
                best_score = score
                best_cand = c
                
        if not best_cand:
            log_dispatcher(f"[{org}] No hay técnicos elegibles con nivel coincidente ({req_levels}) y cupo disponible para {tid} ({el_type}).")
            continue
            
        assignee_login = best_cand["username"]
        assignee_name = best_cand["name"]
        
        # Obtener Request ID Remedy
        log_dispatcher(f"[{org}] Obteniendo Request ID para ticket {tid}...")
        req_id, extra_data, err_req = remedy_client.get_request_id(token, "HPD:IncidentInterface", "Incident Number", tid)
        if err_req or not req_id:
            log_dispatcher(f"[{org}] Error Request ID para {tid}: {err_req}")
            continue
            
        current_group = extra_data.get("Assigned Group") or "TECNOLOGIA USUARIOS DT"
        current_org = extra_data.get("Assigned Support Organization") or "TECHNOLOGY & DATACENTERS"
        group_id_mapping = {
            "CTU DT": "SGP000000005909",
            "TECNOLOGIA CELULARES": "SGP000000005609",
            "TECNOLOGIA USUARIOS DT": "SGP000000003810",
        }
        group_id = group_id_mapping.get(current_group) or extra_data.get("Assigned Group ID")
        
        payload = {
            "Assignee Login ID":             assignee_login,
            "Assignee":                      assignee_name,
            "Status":                        "1",
            "Assigned Support Company":      extra_data.get("Assigned Support Company") or os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA"),
            "Assigned Support Organization": current_org,
            "Assigned Group":                current_group,
            "Assigned Group ID":             group_id,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        
        # Obtener peso de complejidad de las reglas (N1 o N2 según corresponda)
        tech_level = best_cand.get("nivel", 1) or 1
        assigned_complexity = 1
        if detected_tip and detected_tip in custom_rules:
            rule = custom_rules[detected_tip]
            if tech_level == 2:
                assigned_complexity = int(rule.get("complexity_n2", rule.get("complexity", 1)))
            else:
                assigned_complexity = int(rule.get("complexity_n1", rule.get("complexity", 1)))
        else:
            assigned_complexity = complexity

        # Realizar asignación en Remedy
        log_dispatcher(f"[{org}] Realizando asignación de {tid} a {assignee_login} en Remedy...")
        ok, put_err = remedy_client.put_entry(token, "HPD:IncidentInterface", req_id, payload)
        if not ok:
            log_dispatcher(f"[{org}] Error asignando {tid} a {assignee_login}: {put_err}")
            continue
            
        log_dispatcher(f"[{org}] {tid} asignado a {assignee_name} ({assignee_login}) con niveles permitidos {req_levels}")
        
        # Guardar en base de datos local y dejar log detallado
        _upsert_local_assigned_ticket(tid, best_cand["id"], org, ticket_tipo, extra_data, assignee_login, assignee_name, req_levels[0] if req_levels else 1)
        
        # Incrementar carga en memoria
        weighted_workloads[best_cand["id"]] += assigned_complexity
        assigned_candidates_counts[best_cand["id"]] += 1
        round_assigned_count += 1
        assigned_any = True
        
    _update_last_run(org)
    
    if assigned_any:
        announce_event("cases_updated")


def _upsert_local_assigned_ticket(tid: str, owner_id: str, org: str, tipo: str, extra_data: dict, assignee_login: str, assignee_name: str, nivel_requerido: int) -> None:
    ts = now_iso()
    
    fname = extra_data.get("First Name") or ""
    lname = extra_data.get("Last Name") or ""
    client_name = f"{fname} {lname}".strip() or "Sin nombre"
    company = extra_data.get("Company") or "—"
    summary = extra_data.get("Description") or "Incidente Remedy"
    notes = extra_data.get("Detailed Decription") or summary
    
    from Backend.servicios.users_directory import repo_get_user
    cached = repo_get_user(client_name)
    email = ""
    if cached and cached.get("email") != "NOT_FOUND":
        email = cached["email"]
        if cached.get("company"):
            company = cached["company"]
            
    with get_db() as db:
        row = db.execute("SELECT id FROM cases WHERE id = ? AND organization = ?", (tid, org)).fetchone()
        if row:
            db.execute("""
                UPDATE cases 
                SET owner_id = ?, excel_status = '1', estado = 'remedy_inc_assigned', updated_at = ?, nivel_requerido = ?
                WHERE id = ? AND organization = ?
            """, (owner_id, ts, nivel_requerido, tid, org))
        else:
            db.execute("""
                INSERT INTO cases (id, owner_id, name, email, company, puesto, tipo, estado, wo, notes, excel_status, organization, created_at, updated_at, items_json, nivel_requerido)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
            """, (tid, owner_id, client_name, email, company, summary, tipo, "remedy_inc_assigned", tid, notes, "1", org, ts, ts, nivel_requerido))
            
        event_text = f"Auto-asignación Dispatcher: ticket {tid} (requiere N{nivel_requerido}) asignado automáticamente al técnico {assignee_name} ({assignee_login})."
        db.execute("INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)", 
                   (tid, ts, event_text))
                   
        # Dejar log de auditoría
        db.execute("""
            INSERT INTO audit_logs (user_id, username, action, details, timestamp)
            VALUES (?, ?, ?, ?, ?)
        """, ("dispatcher", "dispatcher", "AUTO_ASSIGN", f"{tid} (N{nivel_requerido}) asignado a {assignee_name} ({assignee_login})", ts))
        db.commit()
