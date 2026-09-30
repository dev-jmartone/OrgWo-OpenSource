"""Servicios de cases. Logica de negocio sin Flask routes.

Los handlers HTTP viven en Backend/api/cases_routes.py y solo orquestan:
parsean request, llaman a estos servicios, devuelven jsonify(resultado).

Reglas:
- Estos services LEEN session (current_user_org) pero NO devuelven Response.
- Repository es la unica via a SQLite.
- Cambios de schema → tocar Backend/base_datos/schema.py.
"""
import json
import sqlite3
from datetime import datetime, timezone

from flask import session

from Backend.base_datos.connection import get_db
from Backend.base_datos.repository.cases import (
    repo_list_cases,
    repo_get_case,
    repo_get_case_global,
    repo_insert_case,
    repo_update_case,
    repo_update_case_global,
    repo_delete_case,
    repo_stats,
)
from Backend.base_datos.repository.events import (
    repo_add_event,
    repo_events_grouped_by_case,
    repo_events_of,
)
from Backend.utils import current_user_org, current_user_id, now_iso, new_id, parse_company_from_email
from Backend.integraciones.remedy import queries as remedy_queries
from Backend.integraciones.remedy.queries import RemedyAuthenticationError
from Backend.integraciones.remedy.parsers import map_element_type_to_tipo


class ValidationError(ValueError):
    """Validación de negocio antes de persistir."""


# Campos que el cliente puede actualizar vía PUT /api/cases/<id>.
# Mapeo camelCase (API) -> snake_case (columna).
_API_FIELD_MAP = {
    "name": "name",
    "email": "email",
    "company": "company",
    "puesto": "puesto",
    "svcTag": "svc_tag",
    "oldModel": "old_model",
    "tipo": "tipo",
    "estado": "estado",
    "wo": "wo",
    "clave": "clave",
    "newModel": "new_model",
    "newSvc": "new_svc",
    "apps": "apps",
    "zona": "zona",
    "notes": "notes",
    "snoozeUntil": "snooze_until",
    "fechaRetiro": "fecha_retiro",
    "priority": "priority",
    "brand": "brand",
    "imei1": "imei1",
    "imei2": "imei2",
    "fechaAsignacion": "fecha_asignacion",
    "fechaAsignacionNew": "fecha_asignacion_new",
    "movimiento": "movimiento",
    "action": "action",
    "reason": "reason",
    "logistics": "logistics",
    "prestamoDevuelto": "prestamo_devuelto",
    "prestamoDevolucionAt": "prestamo_devolucion_at",
    "tipificacion": "tipificacion",
    "ownerId": "owner_id",
    "outlookEventId": "outlook_event_id",
    "nivelRequerido": "nivel_requerido",
}


def case_to_dict(row: sqlite3.Row, events: list[dict] | None = None) -> dict:
    """Convierte una fila de SQLite al shape que consume el frontend."""
    d = dict(row)
    try:
        d["checks"] = json.loads(d.get("checks") or "{}")
    except (TypeError, ValueError):
        d["checks"] = {}
    d["svcTag"] = d.pop("svc_tag", "") or ""
    d["oldModel"] = d.pop("old_model", "") or ""
    d["newModel"] = d.pop("new_model", "") or ""
    d["newSvc"] = d.pop("new_svc", "") or ""
    d["excelStatus"] = d.pop("excel_status", "") or ""
    d["excelFecha"] = d.pop("excel_fecha", "") or ""
    d["createdAt"] = d.pop("created_at", "") or ""
    d["updatedAt"] = d.pop("updated_at", "") or ""
    d["snoozeUntil"] = d.pop("snooze_until", None)
    d["fechaRetiro"] = d.pop("fecha_retiro", None)
    d["priority"] = d.pop("priority", None) or "normal"
    d["slaDate"] = d.pop("sla_date", "") or ""
    d["slaStatus"] = d.pop("sla_status", "") or ""
    d["outlookEventId"] = d.pop("outlook_event_id", None)
    
    # Extra fields
    d["brand"] = d.get("brand", "") or ""
    d["imei1"] = d.get("imei1", "") or ""
    d["imei2"] = d.get("imei2", "") or ""
    d["fechaAsignacion"] = d.pop("fecha_asignacion", "") or ""
    d["fechaAsignacionNew"] = d.pop("fecha_asignacion_new", "") or ""
    d["movimiento"] = d.get("movimiento", "") or ""

    # Composable template spec
    d["action"] = d.get("action") or ""
    d["reason"] = d.get("reason") or ""
    d["logistics"] = d.get("logistics") or "presencial"
    raw_items = d.pop("items_json", None)
    try:
        d["items"] = json.loads(raw_items) if raw_items else []
    except (TypeError, ValueError):
        d["items"] = []
    d["prestamoDevuelto"] = bool(d.pop("prestamo_devuelto", 0))
    d["prestamoDevolucionAt"] = d.pop("prestamo_devolucion_at", None)
    d["tipificacion"] = d.get("tipificacion") or None
    d["ownerId"] = d.pop("owner_id", None)
    d["nivelRequerido"] = d.pop("nivel_requerido", 1) or 1

    if events is not None:
        d["events"] = events
    return d


def remedy_ticket_to_case(t: dict, local_anno: dict | None = None) -> dict:
    status_val = t.get("status", "1")

    # Mapeo por defecto de estado Remedy a visualización Kanban
    if status_val == "3" or "Pending" in status_val:
        estado = "wait"
    elif status_val == "4" or "Resolved" in status_val or "Completed" in status_val or status_val == "5":
        estado = "done"
    else:
        estado = "remedy_inc_assigned" if t["type"] == "INC" else "remedy_wo_assigned"

    # Si hay anotación de estado local guardada (ej. movido en Kanban), la priorizamos
    local_state = local_anno.get("estado") if local_anno else None

    tipo_mapped = map_element_type_to_tipo(t.get("element_type", ""))

    # Resolver email + company con prioridad:
    #   1. anotacion local (lo que el operador edito a mano).
    #   2. directorio canonico (lookup_outlook_user via GAL).
    #   3. data cruda del ticket Remedy (poco confiable, especialmente
    #      el email — viene como nombre o vacio).
    local_email = (local_anno.get("email") if local_anno else "") or ""
    local_company = (local_anno.get("company") if local_anno else "") or ""
    final_email = local_email
    final_company = local_company or t.get("company", "") or ""

    if not final_email:
        try:
            from Backend.servicios.users_directory import repo_get_user
            cached = repo_get_user(t.get("clientName") or "")
            if cached:
                if cached.get("email"):
                    final_email = cached["email"]
                if not local_company and cached.get("company"):
                    final_company = cached["company"]
        except Exception:
            pass

    case_dict = {
        "id": t["id"],
        "name": t["clientName"],
        "email": final_email,
        "company": final_company,
        "puesto": t["summary"],
        "svcTag": local_anno.get("svc_tag", "") if local_anno else "",
        "oldModel": local_anno.get("old_model", "") if local_anno else "",
        "tipo": tipo_mapped,
        "estado": local_state or estado,
        "wo": t["id"],
        "clave": local_anno.get("clave", "") if local_anno else "",
        "newModel": local_anno.get("new_model", "") if local_anno else "",
        "newSvc": local_anno.get("new_svc", "") if local_anno else "",
        "apps": local_anno.get("apps", "") if local_anno else "",
        "zona": local_anno.get("zona", "") if local_anno else "",
        "notes": t.get("description", ""),
        "checks": json.loads(local_anno["checks"]) if local_anno and local_anno.get("checks") else {},
        "excelStatus": status_val,
        "excelFecha": "",
        "createdAt": t.get("createdAt", ""),
        "updatedAt": local_anno.get("updated_at", t.get("createdAt", "")) if local_anno else t.get("createdAt", ""),
        "snoozeUntil": local_anno.get("snooze_until") if local_anno else None,
        "fechaRetiro": local_anno.get("fecha_retiro") if local_anno else None,
        "priority": local_anno.get("priority", "normal") if local_anno else "normal",
        "brand": local_anno.get("brand", "") if local_anno else "",
        "imei1": local_anno.get("imei1", "") if local_anno else "",
        "imei2": local_anno.get("imei2", "") if local_anno else "",
        "fechaAsignacion": local_anno.get("fecha_asignacion", "") if local_anno else "",
        "fechaAsignacionNew": local_anno.get("fecha_asignacion_new", "") if local_anno else "",
        "movimiento": local_anno.get("movimiento", "Egreso" if tipo_mapped in ["vincha", "kit", "cargador"] else "Recambio Tecnologico") if local_anno else ("Egreso" if tipo_mapped in ["vincha", "kit", "cargador"] else "Recambio Tecnologico"),
        "action": local_anno.get("action") if local_anno else "",
        "reason": local_anno.get("reason") if local_anno else "",
        "logistics": local_anno.get("logistics", "presencial") if local_anno else "presencial",
        "items": json.loads(local_anno["items_json"]) if local_anno and local_anno.get("items_json") else [],
        "prestamoDevuelto": bool(local_anno.get("prestamo_devuelto", 0)) if local_anno else False,
        "prestamoDevolucionAt": local_anno.get("prestamo_devolucion_at") if local_anno else None,
        "tipificacion": (local_anno.get("tipificacion") if local_anno else None) or t.get("tipificacion") or None,
        "ownerId": local_anno.get("owner_id") if local_anno else None,
        "slaDate": t.get("slaDate", ""),
        "slaStatus": t.get("slaStatus", ""),
        "outlookEventId": local_anno.get("outlook_event_id") if local_anno else None,
        "nivelRequerido": local_anno.get("nivel_requerido", 1) if local_anno else 1,
        "events": [],
    }
    return case_dict


def service_list_cases(all_cases=False) -> list[dict]:
    org = current_user_org()
    user_id = current_user_id()
    
    # 1. Obtener anotaciones locales de SQLite
    local_rows = repo_list_cases(org)
    local_map = {row["id"]: dict(row) for row in local_rows}
    
    # 2. Si hay sesión en Remedy, obtener tickets asignados en vivo
    live_tickets = []
    if "remedy_token" in session:
        try:
            token = session["remedy_token"]
            username = session.get("remedy_username", "")
            incidents = remedy_queries.fetch_assigned_incidents(token, username)
            workorders = remedy_queries.fetch_assigned_workorders(token, username)
            live_tickets = incidents + workorders
        except RemedyAuthenticationError as e:
            print("Error fetching assigned tickets from Remedy (auth expired):", e)
            session.pop("remedy_token", None)
        except Exception as e:
            print("Error fetching assigned tickets from Remedy:", e)
            
    # 3. Mapear y mezclar
    merged_cases = []
    seen_ids = set()
    events = repo_events_grouped_by_case(org)
    
    remedy_user = session.get("remedy_username", "")
    from Backend.integraciones.remedy.queries import _user_variants
    user_variants = [v.lower().strip() for v in _user_variants(remedy_user)] if remedy_user else []
    
    for t in live_tickets:
        tid = t["id"]
        seen_ids.add(tid)
        local_anno = local_map.get(tid)
        
        # Check if the SQLite owner is different from the logged in user
        if local_anno and local_anno.get("owner_id") and local_anno.get("owner_id") != user_id:
            # If the ticket was recently updated (e.g., transferred within the last 60 seconds),
            # we skip it and do NOT let live_tickets overwrite it or show it.
            is_recent = False
            updated_at_str = local_anno.get("updated_at")
            if updated_at_str:
                try:
                    updated_at_dt = datetime.fromisoformat(updated_at_str)
                    now_dt = datetime.now(timezone.utc)
                    if (now_dt - updated_at_dt).total_seconds() < 60:
                        is_recent = True
                except Exception:
                    pass
            
            if is_recent:
                continue
                
            # If it's not recent, check if the Remedy assignee login matches user_variants
            assignee = (t.get("assignee_login") or "").lower().strip()
            if assignee and assignee not in user_variants:
                continue
                
            # If it matches user_variants, it means it is currently assigned to us in Remedy
            # (e.g. assigned via Remedy console), so we sync the owner back to us.
            local_anno["owner_id"] = user_id
            try:
                with get_db() as db:
                    db.execute("UPDATE cases SET owner_id = ? WHERE id = ? AND organization = ?", (user_id, tid, org))
                    db.commit()
            except Exception as e:
                print(f"Error syncing owner_id for {tid}: {e}")

        # Migración automática / asignación automática de dueño si no lo tiene en la base de datos
        elif local_anno and not local_anno.get("owner_id"):
            local_anno["owner_id"] = user_id
            try:
                with get_db() as db:
                    db.execute("UPDATE cases SET owner_id = ? WHERE id = ? AND organization = ?", (user_id, tid, org))
                    db.commit()
            except Exception as e:
                print(f"Error migrating owner_id for {tid}: {e}")

        case_dict = remedy_ticket_to_case(t, local_anno)
        case_dict["events"] = events.get(tid, [])
        merged_cases.append(case_dict)
        
    # 4. Incluir los registros locales que NO están en los tickets asignados en vivo
    # (ej: casos cargados manualmente, o casos históricos que ya tienen anotaciones)
    # 4. Reconciliación por lote para tickets locales de Remedy que no están en seen_ids
    remedy_tickets_to_check = []
    for cid, local_anno in list(local_map.items()):
        if cid not in seen_ids:
            owner = local_anno.get("owner_id")
            if all_cases or owner == user_id:
                is_remedy = cid.startswith(("INC", "WO"))
                if is_remedy and "remedy_token" in session and owner == user_id and local_anno.get("estado") not in ("done", "reject", "not_accepted"):
                    remedy_tickets_to_check.append(cid)

    remedy_live_status = {}
    if remedy_tickets_to_check and "remedy_token" in session:
        try:
            token = session["remedy_token"]
            from Backend.integraciones.remedy.parsers import map_status
            
            # Separar INC y WO
            inc_ids = [cid for cid in remedy_tickets_to_check if cid.upper().startswith("INC")]
            wo_ids = [cid for cid in remedy_tickets_to_check if not cid.upper().startswith("INC")]
            
            CHUNK_SIZE = 40
            # Batch INC
            for i in range(0, len(inc_ids), CHUNK_SIZE):
                chunk = inc_ids[i:i+CHUNK_SIZE]
                conditions = " OR ".join(f"'Incident Number'=\"{cid}\"" for cid in chunk)
                query = f"({conditions})"
                fields = "values(Incident Number, Status, Assignee Login ID)"
                entries, err = remedy_queries.client.get_entries(token, "HPD:Help Desk", query, fields)
                if not err:
                    for entry in entries:
                        vals = entry.get("values", {})
                        tid = vals.get("Incident Number")
                        if tid:
                            remedy_live_status[tid] = {
                                "status": map_status(vals.get("Status")),
                                "assignee_login": vals.get("Assignee Login ID") or ""
                            }
            # Batch WO
            for i in range(0, len(wo_ids), CHUNK_SIZE):
                chunk = wo_ids[i:i+CHUNK_SIZE]
                conditions = " OR ".join(f"'Work Order ID'=\"{cid}\"" for cid in chunk)
                query = f"({conditions})"
                fields = "values(Work Order ID, Status, ASLOGID)"
                entries, err = remedy_queries.client.get_entries(token, "WOI:WorkOrder", query, fields)
                if not err:
                    for entry in entries:
                        vals = entry.get("values", {})
                        tid = vals.get("Work Order ID")
                        if tid:
                            remedy_live_status[tid] = {
                                "status": map_status(vals.get("Status")),
                                "assignee_login": vals.get("ASLOGID") or ""
                            }
        except Exception as e:
            print(f"Error in batch Remedy query: {e}")

    # 5. Incluir los registros locales que NO están en los tickets asignados en vivo
    # (ej: casos cargados manualmente, o casos históricos que ya tienen anotaciones)
    for cid, local_anno in list(local_map.items()):
        if cid not in seen_ids:
            owner = local_anno.get("owner_id")
            if all_cases or owner == user_id:
                is_remedy = cid.startswith(("INC", "WO"))
                if is_remedy and "remedy_token" in session and owner == user_id and local_anno.get("estado") not in ("done", "reject", "not_accepted"):
                    live_t = remedy_live_status.get(cid)
                    if live_t:
                        mapped_status = live_t["status"]
                        assignee = live_t["assignee_login"].lower().strip()
                        
                        if mapped_status == "4":
                            # Se cerró en Remedy
                            with get_db() as db:
                                db.execute("UPDATE cases SET estado = 'done', excel_status = '4', updated_at = ? WHERE id = ? AND organization = ?", (now_iso(), cid, org))
                                db.execute("INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)", (cid, now_iso(), f"Auto-sync Remedy: ticket {cid} detectado como cerrado en Remedy → marcado como done."))
                                db.commit()
                            local_anno["estado"] = "done"
                            local_anno["excel_status"] = "4"
                            print(f"[sync] Ticket {cid} detectado como cerrado en Remedy. Marcado como done localmente.")
                        else:
                            # Sigue abierto en Remedy pero el assignee es otro
                            if assignee and assignee not in user_variants:
                                new_owner_id = None
                                with get_db() as db:
                                    user_row = db.execute("SELECT id FROM users WHERE username = ?", (assignee,)).fetchone()
                                    if user_row:
                                        new_owner_id = user_row["id"]
                                        db.execute("UPDATE cases SET owner_id = ?, updated_at = ? WHERE id = ? AND organization = ?", (new_owner_id, now_iso(), cid, org))
                                    else:
                                        db.execute("UPDATE cases SET owner_id = NULL, updated_at = ? WHERE id = ? AND organization = ?", (now_iso(), cid, org))
                                    db.execute("INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)", (cid, now_iso(), f"Auto-sync Remedy: ticket {cid} detectado como asignado a {assignee} en Remedy → desasociando de {remedy_user}."))
                                    db.commit()
                                
                                local_anno["owner_id"] = new_owner_id
                                print(f"[sync] Ticket {cid} detectado como asignado a {assignee} en Remedy. Se desasociará.")
                                if not all_cases and new_owner_id != user_id:
                                    continue
                    else:
                        # No se encontró en la consulta por lotes, o la consulta falló.
                        # Evitamos hacer llamadas individuales lentas.
                        pass

                row = next(r for r in local_rows if r["id"] == cid)
                case_dict = case_to_dict(row, events.get(cid, []))
                merged_cases.append(case_dict)
            
    return merged_cases


def _validate_case_payload(data: dict) -> None:
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    if not name:
        raise ValidationError("El nombre es obligatorio")
    if not email:
        raise ValidationError("El email es obligatorio")


def service_create_case(data: dict) -> dict:
    _validate_case_payload(data)
    cid = new_id()
    ts = now_iso()
    org = current_user_org()
    
    email = (data.get("email") or "").strip()
    company = data.get("company", "")
    parsed_comp = parse_company_from_email(email)
    if parsed_comp:
        company = parsed_comp

    fields = {
        "name": (data.get("name") or "").strip(),
        "email": email,
        "company": company,
        "puesto": data.get("puesto", ""),
        "svc_tag": data.get("svcTag", ""),
        "old_model": data.get("oldModel", ""),
        "tipo": data.get("tipo", "pc"),
        "estado": data.get("estado", "contact"),
        "wo": data.get("wo", ""),
        "clave": data.get("clave", ""),
        "new_model": data.get("newModel", ""),
        "new_svc": data.get("newSvc", ""),
        "apps": data.get("apps", ""),
        "zona": data.get("zona", ""),
        "notes": data.get("notes", ""),
        "checks": json.dumps(data.get("checks", {})),
        "excel_status": data.get("excelStatus", ""),
        "excel_fecha": data.get("excelFecha", ""),
        "snooze_until": data.get("snoozeUntil"),
        "fecha_retiro": data.get("fechaRetiro"),
        "priority": data.get("priority") or "normal",
        "brand": data.get("brand", ""),
        "imei1": data.get("imei1", ""),
        "imei2": data.get("imei2", ""),
        "fecha_asignacion": data.get("fechaAsignacion", ""),
        "fecha_asignacion_new": data.get("fechaAsignacionNew", ""),
        "movimiento": data.get("movimiento", ""),
        "action": data.get("action") or None,
        "reason": data.get("reason") or None,
        "logistics": data.get("logistics") or "presencial",
        "items_json": json.dumps(data["items"]) if isinstance(data.get("items"), list) else None,
        "prestamo_devuelto": 1 if data.get("prestamoDevuelto") else 0,
        "prestamo_devolucion_at": data.get("prestamoDevolucionAt"),
        "owner_id": data.get("ownerId") or current_user_id(),
    }

    repo_insert_case(cid, fields, ts, org)
    repo_add_event(cid, ts, data.get("creationEvent", "Caso creado"))
    return case_to_dict(repo_get_case(cid, org), repo_events_of(cid))


def _find_live_ticket(cid: str) -> dict | None:
    """Busca un ticket Remedy en vivo por id: primero entre los incidentes
    asignados, luego entre las WO, y si no aparece lo trae directo por id.
    Devuelve None si no hay sesion Remedy o no se encuentra; limpia el token de
    la sesion si expiro."""
    if "remedy_token" not in session:
        return None
    try:
        token = session["remedy_token"]
        username = session.get("remedy_username", "")
        incidents = remedy_queries.fetch_assigned_incidents(token, username)
        live_t = next((x for x in incidents if x["id"] == cid), None)
        if not live_t:
            workorders = remedy_queries.fetch_assigned_workorders(token, username)
            live_t = next((x for x in workorders if x["id"] == cid), None)
        if not live_t:
            live_t = remedy_queries.fetch_ticket_by_id(token, cid)
        return live_t
    except RemedyAuthenticationError as e:
        print("Error buscando ticket Remedy en vivo (sesion expirada):", e)
        session.pop("remedy_token", None)
    except Exception as e:
        print("Error buscando ticket Remedy en vivo:", e)
    return None


def service_update_case(cid: str, data: dict) -> dict | None:
    org = current_user_org()
    existing = repo_get_case_global(cid)
    ts = now_iso()
    
    if not existing:
        # En demanda: inicializar anotaciones para un ticket Remedy en vivo interactuado por primera vez
        live_t = _find_live_ticket(cid)
                
        # Construir campos mínimos basados en los datos en vivo o en el payload
        email = data.get("email", "")
        company = live_t["company"] if live_t else data.get("company", "")
        parsed_comp = parse_company_from_email(email)
        if parsed_comp:
            company = parsed_comp

        fields = {
            "name": live_t["clientName"] if live_t else data.get("name", "Sin nombre"),
            "email": email,
            "company": company,
            "puesto": live_t["summary"] if live_t else data.get("puesto", ""),
            "notes": live_t.get("description", "") if live_t else data.get("notes", ""),
            "wo": cid,
            "tipo": map_element_type_to_tipo(live_t.get("element_type", "")) if live_t else data.get("tipo", "pc"),
            "excel_status": live_t.get("status", "1") if live_t else data.get("excelStatus", "1"),
            "owner_id": current_user_id(),
            "tipificacion": live_t.get("tipificacion") if live_t else data.get("tipificacion"),
        }
        
        for api_key, col in _API_FIELD_MAP.items():
            if api_key in data:
                val = data[api_key]
                if col == "prestamo_devuelto":
                    val = 1 if val else 0
                fields[col] = val
                
        if "email" in data:
            parsed_comp = parse_company_from_email(data["email"])
            if parsed_comp:
                fields["company"] = parsed_comp
                
        if "checks" in data:
            fields["checks"] = json.dumps(data["checks"])
        if "items" in data:
            fields["items_json"] = json.dumps(data["items"]) if isinstance(data["items"], list) else None

        repo_insert_case(cid, fields, ts, org)
        
        log_event = data.get("logEvent", "Caso inicializado desde Remedy")
        repo_add_event(cid, ts, log_event)
    else:
        sets: dict = {}
        # Tomar posesión si el ticket original no tenía dueño asignado (caso
        # legacy). sqlite3.Row no implementa .get(); usamos try/except.
        try:
            owner_existing = existing["owner_id"]
        except (KeyError, IndexError):
            owner_existing = None
        if not owner_existing:
            sets["owner_id"] = current_user_id()

        for api_key, col in _API_FIELD_MAP.items():
            if api_key in data:
                val = data[api_key]
                if col == "prestamo_devuelto":
                    val = 1 if val else 0
                sets[col] = val
        if "email" in data:
            parsed_comp = parse_company_from_email(data["email"])
            if parsed_comp:
                sets["company"] = parsed_comp
        if "checks" in data:
            sets["checks"] = json.dumps(data["checks"])
        if "items" in data:
            sets["items_json"] = json.dumps(data["items"]) if isinstance(data["items"], list) else None

        # Si el case existe en la base de datos pero tiene otra organizacion, actualizamos la organizacion a la del usuario actual
        if existing["organization"] != org:
            sets["organization"] = org
            repo_update_case_global(cid, sets, ts)
        elif sets or "checks" in data or "items" in data:
            repo_update_case(cid, sets, ts, org)
            
        log_event = data.get("logEvent")
        if log_event:
            repo_add_event(cid, ts, log_event)
            
    updated_anno = repo_get_case(cid, org)
    if not updated_anno:
        return None
        
    # Retornar fusionando en vivo para máxima consistencia visual
    live_t = _find_live_ticket(cid)
            
    if live_t:
        return remedy_ticket_to_case(live_t, dict(updated_anno))
    else:
        return case_to_dict(updated_anno, repo_events_of(cid))


def service_delete_case(cid: str) -> None:
    org = current_user_org()
    repo_delete_case(cid, org)


def service_add_event(cid: str, text: str) -> dict | None:
    org = current_user_org()
    # Validar que el case sea de la org del usuario antes de insertar el evento.
    # repo_add_event no scopea por org; sin este chequeo se podria insertar un
    # evento huerfano contra un case de otra organizacion.
    if not repo_get_case(cid, org):
        return None
    ts = now_iso()
    repo_add_event(cid, ts, text)
    # Tocar updated_at para que el caso "suba" en la lista.
    repo_update_case(cid, {}, ts, org)
    return {"at": ts, "text": text}


def service_stats() -> dict:
    org = current_user_org()
    user_id = current_user_id()
    base = repo_stats(org, user_id)
    return base


def service_list_org_users(org: str, current_uid: str) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT id, username, name, email FROM users WHERE organization = ? AND id != ? ORDER BY name",
            (org, current_uid),
        ).fetchall()
        return [dict(r) for r in rows]


def service_get_org_user(user_id: str, org: str) -> dict | None:
    with get_db() as db:
        row = db.execute(
            "SELECT id, name, username FROM users WHERE id = ? AND organization = ?",
            (user_id, org),
        ).fetchone()
        return dict(row) if row else None



# La sincronizacion con el calendario de Outlook NO corre en el backend: el
# server central no tiene Outlook (Docker/Linux) y no puede alcanzar el COM de
# cada operador. La hace el navegador de cada usuario contra su propio puente
# local (Frontend/js/ui/calendar.js::syncCaseToLocalOutlookBridge), que persiste
# el EntryID en cases.outlook_event_id. El backend solo guarda fecha_retiro.
