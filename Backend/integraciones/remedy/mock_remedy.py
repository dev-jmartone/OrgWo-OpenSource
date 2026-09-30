"""
Backend/integraciones/remedy/mock_remedy.py

Motor de simulación y Mock para BMC Remedy AR System en OrgWo.
Permite ejecutar el proyecto de forma 100% funcional en entornos de demostración (GitHub Showcase),
sin requerir conectividad real con un servidor BMC Remedy ARS empresarial.

Características:
- Genera tokens AR-JWT válidos con expiración configurable.
- Provee un catálogo dinámico y persistente en memoria de tickets INC y WO (no asignados y asignados).
- Soporta asignación de tickets ("Tomar ticket"), cambio de estados (Pendiente, Resuelto, Cerrado) y bitácoras (WorkLog / WorkInfo).
- Soporta ejecución del Despachador Automático (Dispatcher).
"""
from __future__ import annotations

import base64
import copy
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta

_lock = threading.Lock()


def is_mock_mode() -> bool:
    """Determina si la aplicación debe utilizar el modo simulación de Remedy.
    Activo por defecto si REMEDY_MOCK_MODE=true o si la URL de Remedy apunta al dominio de ejemplo.
    """
    from Backend.config import REMEDY_MOCK_MODE, REMEDY_BASE_URL
    if REMEDY_MOCK_MODE:
        return True
    if not REMEDY_BASE_URL or "yourcompany.com" in REMEDY_BASE_URL:
        return True
    return False


def make_mock_jwt(username: str, ttl_seconds: int = 86400) -> str:
    """Genera un token JWT sintético válido para decodificadores."""
    now = int(time.time())
    header_json = json.dumps({"alg": "HS256", "typ": "JWT"}).encode("utf-8")
    payload_json = json.dumps({
        "sub": username,
        "username": username,
        "iat": now,
        "exp": now + ttl_seconds,
        "iss": "OrgWo-Mock-Remedy",
        "company": "Empresa Principal"
    }).encode("utf-8")

    h_b64 = base64.urlsafe_b64encode(header_json).decode("utf-8").rstrip("=")
    p_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8").rstrip("=")
    return f"{h_b64}.{p_b64}.orgwo_mock_signature"


def mock_login(username: str, password: str) -> tuple[str | None, str | None]:
    """Simula el login exitoso contra BMC Remedy devolviendo un token AR-JWT."""
    uname = (username or "admin").strip()
    token = make_mock_jwt(uname)
    return token, None


def mock_fetch_user_details(username: str) -> dict:
    """Simula la consulta a CTM:People."""
    u = (username or "admin").lower().strip()
    if "1" in u or "gomez" in u:
        return {
            "first_name": "Carlos",
            "last_name": "Gomez",
            "full_name": "Carlos Gomez",
            "company": "Empresa Principal"
        }
    if "2" in u or "martinez" in u:
        return {
            "first_name": "Laura",
            "last_name": "Martinez",
            "full_name": "Laura Martinez",
            "company": "Empresa Principal"
        }
    if "3" in u or "fernandez" in u:
        return {
            "first_name": "Diego",
            "last_name": "Fernandez",
            "full_name": "Diego Fernandez",
            "company": "Empresa Principal"
        }
    return {
        "first_name": "Admin",
        "last_name": "OrgWo",
        "full_name": "Administrador OrgWo",
        "company": "Empresa Principal"
    }


def mock_fetch_user_groups(username: str) -> dict:
    """Simula la consulta a CTM:Support Group Association."""
    return {
        "groups": ["TECNOLOGIA USUARIOS DT", "CTU DT", "TECNOLOGIA CELULARES"],
        "default_group": "TECNOLOGIA USUARIOS DT"
    }


def mock_fetch_user_by_email(email: str) -> dict | None:
    """Busca en la lista de usuarios conocidos por email."""
    em = (email or "").lower().strip()
    if "cgomez" in em or "gomez" in em:
        return {"username": "tecnico1", "full_name": "Carlos Gomez"}
    if "lmartinez" in em or "martinez" in em:
        return {"username": "tecnico2", "full_name": "Laura Martinez"}
    if "dfernandez" in em or "fernandez" in em:
        return {"username": "tecnico3", "full_name": "Diego Fernandez"}
    if "admin" in em:
        return {"username": "admin", "full_name": "Administrador OrgWo"}
    return None


# ── Banco de Tickets Simulados ────────────────────────────────────────────────
def _build_initial_mock_data():
    now = datetime.now()
    
    def dt_str(days_ago=0, hours_ago=0):
        t = now - timedelta(days=days_ago, hours=hours_ago)
        return t.strftime("%Y-%m-%dT%H:%M:%S.000+0000")

    incidents = [
        {
            "Incident Number": "INC8291040",
            "Request ID": "0000000008291040",
            "Description": "Notebook Dell Latitude 5440 - Renovación de Puesto",
            "Detailed Decription": "Solicitud de renovación tecnológica por leasing vencido para el colaborador Martin Alvarez (Gerencia de Operaciones). Requiere migración de perfil corporativo, Office 365, Teams y SAP GUI. Coordinar entrega presencial en Sede Central Piso 2.",
            "Submit Date": dt_str(1, 2),
            "Status": "Assigned",
            "Assignee Login ID": "",
            "Assignee": "",
            "First Name": "Martin",
            "Last Name": "Alvarez",
            "Company": "Empresa Principal",
            "Assigned Group": "TECNOLOGIA USUARIOS DT",
            "Assigned Group ID": "SGP000000003810",
            "Assigned Support Organization": "TECHNOLOGY & DATACENTERS",
            "Assigned Support Company": "EMPRESA",
            "Categorization Tier 1": "Hardware",
            "Categorization Tier 2": "Notebook",
            "Categorization Tier 3": "Renovación",
            "Required Resolution DateTime": dt_str(-3),
            "SLM Status": "Within the Service Target",
            "Urgency": "3-Medium",
            "Impact": "3-Moderate",
            "ServiceCI": "Servicios TI Corporativos",
            "ServiceCI_ReconID": "RECON-001",
            "worklogs": [
                {"id": "WL-101", "submitter": "JARVIS CHATBOT", "submit_date": dt_str(1, 2), "notes": "Ticket originado vía Autoservicio Digital. Usuario validado."},
                {"id": "WL-102", "submitter": "Sistema", "submit_date": dt_str(1, 1), "notes": "Asignado a cola de grupo TECNOLOGIA USUARIOS DT."}
            ]
        },
        {
            "Incident Number": "INC8291041",
            "Request ID": "0000000008291041",
            "Description": "Falla de Hardware Pantalla - Notebook ThinkPad T14",
            "Detailed Decription": "La colaboradora Sofia Navarro informa parpadeos intermitentes en la pantalla de su Lenovo ThinkPad tras conectar a la dock station. Requiere revisión técnica en banco de soporte o recambio de equipo.",
            "Submit Date": dt_str(2, 4),
            "Status": "Assigned",
            "Assignee Login ID": "",
            "Assignee": "",
            "First Name": "Sofia",
            "Last Name": "Navarro",
            "Company": "Subsidiaria",
            "Assigned Group": "TECNOLOGIA USUARIOS DT",
            "Assigned Group ID": "SGP000000003810",
            "Assigned Support Organization": "TECHNOLOGY & DATACENTERS",
            "Assigned Support Company": "EMPRESA",
            "Categorization Tier 1": "Hardware",
            "Categorization Tier 2": "Notebook",
            "Categorization Tier 3": "Falla de Hardware",
            "Required Resolution DateTime": dt_str(-2),
            "SLM Status": "Within the Service Target",
            "Urgency": "2-High",
            "Impact": "3-Moderate",
            "ServiceCI": "Servicios TI Corporativos",
            "ServiceCI_ReconID": "RECON-001",
            "worklogs": [
                {"id": "WL-103", "submitter": "Mesa de Ayuda", "submit_date": dt_str(2, 4), "notes": "Pruebas iniciales de drivers completadas sin solución. Derivado a soporte en sitio."}
            ]
        },
        {
            "Incident Number": "INC8291042",
            "Request ID": "0000000008291042",
            "Description": "Alta Celular Corporativo Samsung Galaxy S23",
            "Detailed Decription": "Asignación de dispositivo móvil Samsung Galaxy S23 para nuevo ingreso directivo (Julian Vega). Requiere configuración de perfil MDM Intune y enrolamiento corporativo.",
            "Submit Date": dt_str(3, 1),
            "Status": "Assigned",
            "Assignee Login ID": "",
            "Assignee": "",
            "First Name": "Julian",
            "Last Name": "Vega",
            "Company": "Servicios Operativos",
            "Assigned Group": "TECNOLOGIA CELULARES",
            "Assigned Group ID": "SGP000000005609",
            "Assigned Support Organization": "TECHNOLOGY & DATACENTERS",
            "Assigned Support Company": "EMPRESA",
            "Categorization Tier 1": "Comunicaciones",
            "Categorization Tier 2": "Móviles",
            "Categorization Tier 3": "Alta de Celular",
            "Required Resolution DateTime": dt_str(-4),
            "SLM Status": "Within the Service Target",
            "Urgency": "3-Medium",
            "Impact": "3-Moderate",
            "ServiceCI": "Servicios TI Corporativos",
            "ServiceCI_ReconID": "RECON-001",
            "worklogs": [
                {"id": "WL-104", "submitter": "Recursos Humanos", "submit_date": dt_str(3, 1), "notes": "Aprobación de línea corporativa confirmada por Dirección."}
            ]
        },
        {
            "Incident Number": "INC8291043",
            "Request ID": "0000000008291043",
            "Description": "Cargador USB-C Dell 65W adicional para oficina",
            "Detailed Decription": "Solicitud de fuente de alimentación USB-C 65W adicional para Carolina Gomez en Sede Norte para evitar traslados diarios de cables.",
            "Submit Date": dt_str(1, 5),
            "Status": "Assigned",
            "Assignee Login ID": "",
            "Assignee": "",
            "First Name": "Carolina",
            "Last Name": "Gomez",
            "Company": "Empresa Principal",
            "Assigned Group": "TECNOLOGIA USUARIOS DT",
            "Assigned Group ID": "SGP000000003810",
            "Assigned Support Organization": "TECHNOLOGY & DATACENTERS",
            "Assigned Support Company": "EMPRESA",
            "Categorization Tier 1": "Hardware",
            "Categorization Tier 2": "Accesorios",
            "Categorization Tier 3": "Cargador",
            "Required Resolution DateTime": dt_str(-5),
            "SLM Status": "Within the Service Target",
            "Urgency": "4-Low",
            "Impact": "4-Minor",
            "ServiceCI": "Servicios TI Corporativos",
            "ServiceCI_ReconID": "RECON-001",
            "worklogs": []
        },
        {
            "Incident Number": "INC8291044",
            "Request ID": "0000000008291044",
            "Description": "Configuración VPN y Certificados Digitales en Puesto",
            "Detailed Decription": "La usuaria Mariana Silva requiere reconfiguración de conectividad VPN remota y reemisión de certificado de acceso en su equipo corporativo Dell.",
            "Submit Date": dt_str(2, 6),
            "Status": "Assigned",
            "Assignee Login ID": "",
            "Assignee": "",
            "First Name": "Mariana",
            "Last Name": "Silva",
            "Company": "Empresa Principal",
            "Assigned Group": "TECNOLOGIA USUARIOS DT",
            "Assigned Group ID": "SGP000000003810",
            "Assigned Support Organization": "TECHNOLOGY & DATACENTERS",
            "Assigned Support Company": "EMPRESA",
            "Categorization Tier 1": "Software",
            "Categorization Tier 2": "Red / Conectividad",
            "Categorization Tier 3": "VPN",
            "Required Resolution DateTime": dt_str(-1),
            "SLM Status": "Within the Service Target",
            "Urgency": "2-High",
            "Impact": "3-Moderate",
            "ServiceCI": "Servicios TI Corporativos",
            "ServiceCI_ReconID": "RECON-001",
            "worklogs": []
        },
        # Tickets asignados inicialmente a técnicos
        {
            "Incident Number": "INC8291020",
            "Request ID": "0000000008291020",
            "Description": "Notebook Dell Latitude 5430 - Cambio de Batería y Mantenimiento",
            "Detailed Decription": "Equipo asignado a Carlos Gomez para reemplazo de módulo de batería agotado y verificación de sistema operativo.",
            "Submit Date": dt_str(5),
            "Status": "In Progress",
            "Assignee Login ID": "tecnico1",
            "Assignee": "Carlos Gomez",
            "First Name": "Facundo",
            "Last Name": "Gimenez",
            "Company": "Empresa Principal",
            "Assigned Group": "TECNOLOGIA USUARIOS DT",
            "Assigned Group ID": "SGP000000003810",
            "Assigned Support Organization": "TECHNOLOGY & DATACENTERS",
            "Assigned Support Company": "EMPRESA",
            "Categorization Tier 1": "Hardware",
            "Categorization Tier 2": "Notebook",
            "Categorization Tier 3": "Mantenimiento",
            "Required Resolution DateTime": dt_str(1),
            "SLM Status": "Within the Service Target",
            "Urgency": "3-Medium",
            "Impact": "3-Moderate",
            "ServiceCI": "Servicios TI Corporativos",
            "ServiceCI_ReconID": "RECON-001",
            "worklogs": [
                {"id": "WL-201", "submitter": "tecnico1", "submit_date": dt_str(4), "notes": "Repuesto solicitado a depósito central. Esperando recepción."}
            ]
        }
    ]

    workorders = [
        {
            "Work Order ID": "WO1092031",
            "Request ID": "0000000001092031",
            "Summary": "Kit Inalámbrico - Entrega Teclado y Mouse Logitech MK270",
            "Detailed Description": "Entrega de kit inalámbrico Logitech MK270 para el colaborador Joaquin Castro. Aprobado por jefatura de área.",
            "Submit Date": dt_str(1, 3),
            "Status": "Assigned",
            "ASLOGID": "",
            "Request Assignee": "",
            "Customer First Name": "Joaquin",
            "Customer Last Name": "Castro",
            "Company": "Empresa Principal",
            "Support Group Name": "CTU DT",
            "Support Group ID": "SGP000000005909",
            "Categorization Tier 1": "Hardware",
            "Categorization Tier 2": "Periféricos",
            "Categorization Tier 3": "Kit Inalámbrico",
            "Next Target Date": dt_str(-3),
            "SLM Status": "Within the Service Target",
            "worklogs": [
                {"id": "WI-301", "submitter": "Sistema", "submit_date": dt_str(1, 3), "notes": "Work Order generada desde catálogo DWP."}
            ]
        },
        {
            "Work Order ID": "WO1092032",
            "Request ID": "0000000001092032",
            "Summary": "Vincha / Headset Jabra Evolve 20 USB",
            "Detailed Description": "Solicitud de vincha telefónica USB con supresión de ruido para la colaboradora Florencia Rios.",
            "Submit Date": dt_str(2, 2),
            "Status": "Assigned",
            "ASLOGID": "",
            "Request Assignee": "",
            "Customer First Name": "Florencia",
            "Customer Last Name": "Rios",
            "Company": "Empresa Principal",
            "Support Group Name": "TECNOLOGIA USUARIOS DT",
            "Support Group ID": "SGP000000003810",
            "Categorization Tier 1": "Hardware",
            "Categorization Tier 2": "Periféricos",
            "Categorization Tier 3": "Vincha",
            "Next Target Date": dt_str(-2),
            "SLM Status": "Within the Service Target",
            "worklogs": []
        },
        {
            "Work Order ID": "WO1092033",
            "Request ID": "0000000001092033",
            "Summary": "Solicitud Monitor Dell 24 pulgadas FHD",
            "Detailed Description": "Configuración de segundo monitor Dell P2422H para estación de trabajo de Patricio Morales.",
            "Submit Date": dt_str(2, 5),
            "Status": "Assigned",
            "ASLOGID": "",
            "Request Assignee": "",
            "Customer First Name": "Patricio",
            "Customer Last Name": "Morales",
            "Company": "Empresa Principal",
            "Support Group Name": "CTU DT",
            "Support Group ID": "SGP000000005909",
            "Categorization Tier 1": "Hardware",
            "Categorization Tier 2": "Monitores",
            "Categorization Tier 3": "Monitor",
            "Next Target Date": dt_str(-4),
            "SLM Status": "Within the Service Target",
            "worklogs": []
        },
        # WO asignada a técnico
        {
            "Work Order ID": "WO1092015",
            "Request ID": "0000000001092015",
            "Summary": "Kit Inalámbrico Dell KM5221W y Dock USB-C",
            "Detailed Description": "Preparación de periféricos asignada a Laura Martinez para despacho a sucursal Rosario.",
            "Submit Date": dt_str(4),
            "Status": "In Progress",
            "ASLOGID": "tecnico2",
            "Request Assignee": "Laura Martinez",
            "Customer First Name": "Esteban",
            "Customer Last Name": "Molina",
            "Company": "Subsidiaria",
            "Support Group Name": "CTU DT",
            "Support Group ID": "SGP000000005909",
            "Categorization Tier 1": "Hardware",
            "Categorization Tier 2": "Periféricos",
            "Categorization Tier 3": "Kit Inalámbrico",
            "Next Target Date": dt_str(2),
            "SLM Status": "Within the Service Target",
            "worklogs": [
                {"id": "WI-302", "submitter": "tecnico2", "submit_date": dt_str(3), "notes": "Periféricos embalados con remito y etiqueta de despacho postal."}
            ]
        }
    ]

    return incidents, workorders


_MOCK_INCIDENTS, _MOCK_WORKORDERS = _build_initial_mock_data()


# ── Operaciones de Consulta y Mutación Simulación ─────────────────────────────

def mock_get_entries(form: str, query: str, fields: str, limit: int = None, offset: int = None) -> tuple[list[dict], str | None]:
    """Interpreta la consulta ARS sobre el banco de datos en memoria y devuelve entries simuladas."""
    with _lock:
        form_name = form.strip()
        q_upper = (query or "").upper()

        if "HPD:HELP DESK" in form_name or "HPD:INCIDENTINTERFACE" in form_name:
            items = _MOCK_INCIDENTS
            id_field = "Incident Number"
        elif "WOI:WORKORDER" in form_name:
            items = _MOCK_WORKORDERS
            id_field = "Work Order ID"
        elif "HPD:WORKLOG" in form_name or "WOI:WORKINFO" in form_name:
            # Buscar worklogs para el ticket consultado en el query
            ticket_id_match = re.search(r'(INC\d+|WO\d+)', query or "")
            if ticket_id_match:
                tid = ticket_id_match.group(1)
                all_t = _MOCK_INCIDENTS if "INC" in tid else _MOCK_WORKORDERS
                for t in all_t:
                    if t.get(id_field) == tid:
                        entries = []
                        for wl in t.get("worklogs", []):
                            entries.append({
                                "entryId": wl.get("id"),
                                "values": {
                                    "Incident Number" if "INC" in tid else "Work Order ID": tid,
                                    "Submit Date": wl.get("submit_date"),
                                    "Submitter": wl.get("submitter"),
                                    "Detailed Decription" if "INC" in tid else "Detailed Description": wl.get("notes"),
                                    "Description": wl.get("notes")[:50],
                                    "Work Log Type": "General Information",
                                    "Request ID": wl.get("id")
                                }
                            })
                        return entries, None
            return [], None
        elif "CTM:PEOPLE" in form_name:
            # Lookups de usuario
            m = re.search(r"'(?:Remedy Login ID|Login ID|Full Name)'\s*=\s*\"([^\"]+)\"", query or "")
            key = m.group(1) if m else "admin"
            details = mock_fetch_user_details(key)
            return [{
                "entryId": "PPL-001",
                "values": {
                    "Remedy Login ID": key,
                    "Login ID": key,
                    "First Name": details["first_name"],
                    "Last Name": details["last_name"],
                    "Full Name": details["full_name"],
                    "Company": details["company"],
                    "Internet E-mail": f"{key.lower()}@empresa.com"
                }
            }], None
        elif "CTM:SUPPORT GROUP ASSOCIATION" in form_name:
            return [
                {"entryId": "SGA-1", "values": {"Support Group ID": "SGP000000003810", "Default": "Yes"}},
                {"entryId": "SGA-2", "values": {"Support Group ID": "SGP000000005909", "Default": "No"}},
                {"entryId": "SGA-3", "values": {"Support Group ID": "SGP000000005609", "Default": "No"}},
            ], None
        else:
            return [], None

        results = []
        is_unassigned_query = ("$NULL$" in query or "='' " in query or '=""' in query) and ("ASSIGNEE" in q_upper or "ASLOGID" in q_upper)
        is_closed_query = "STATUS" in q_upper and (">=" in query or "RESOLVED" in q_upper or "CLOSED" in q_upper or "STATUS' >" in query)

        for item in items:
            login_id = item.get("Assignee Login ID" if "INC" in item.get(id_field, "") else "ASLOGID", "")
            status_val = str(item.get("Status", "Assigned"))

            # Filtrar por no asignado
            if is_unassigned_query:
                if login_id and login_id.strip():
                    continue
                if status_val in ("Resolved", "Closed", "4", "5", "6"):
                    continue

            # Filtrar por cerrado
            elif is_closed_query:
                if status_val not in ("Resolved", "Closed", "4", "5", "6"):
                    continue

            # Consulta por ticket específico (ej: 'Incident Number'="INC8291040")
            elif f'"{item[id_field]}"' in query or f"'{item[id_field]}'" in query:
                results.append({"entryId": item.get("Request ID"), "values": copy.deepcopy(item)})
                continue

            results.append({"entryId": item.get("Request ID"), "values": copy.deepcopy(item)})

        if offset:
            results = results[offset:]
        if limit:
            results = results[:limit]

        return results, None


def mock_get_request_id(form_name: str, ticket_field: str, ticket_value: str) -> tuple[str | None, dict, str | None]:
    """Retorna el Request ID y valores del ticket simulado."""
    with _lock:
        items = _MOCK_INCIDENTS if "WO" not in form_name else _MOCK_WORKORDERS
        id_field = "Incident Number" if "WO" not in form_name else "Work Order ID"
        for item in items:
            if item.get(id_field) == ticket_value:
                return item.get("Request ID"), copy.deepcopy(item), None
        return None, {}, f"Ticket {ticket_value} no encontrado en mock"


def mock_put_entry(form_name: str, request_id: str, payload: dict) -> tuple[bool, str | None]:
    """Actualiza los atributos del ticket simulado en memoria."""
    with _lock:
        items = _MOCK_INCIDENTS if "WO" not in form_name else _MOCK_WORKORDERS
        values = payload.get("values", payload)

        for item in items:
            if item.get("Request ID") == request_id or request_id in str(item.get("Incident Number", "")) or request_id in str(item.get("Work Order ID", "")):
                # Mapear asignatario si viene en payload
                if "Assignee Login ID" in values:
                    item["Assignee Login ID"] = values["Assignee Login ID"]
                if "Assignee" in values:
                    item["Assignee"] = values["Assignee"]
                if "ASLOGID" in values:
                    item["ASLOGID"] = values["ASLOGID"]
                if "Request Assignee" in values:
                    item["Request Assignee"] = values["Request Assignee"]

                # Mapear estado
                st = values.get("Status")
                if st:
                    if st in ("1", "Assigned"):
                        item["Status"] = "Assigned"
                    elif st in ("2", "In Progress", "InProgress"):
                        item["Status"] = "In Progress"
                    elif st in ("3", "Pending"):
                        item["Status"] = "Pending"
                    elif st in ("4", "Resolved", "Closed"):
                        item["Status"] = "Resolved"
                    else:
                        item["Status"] = str(st)

                # Agregar nota en worklog si se incluye
                note = values.get("Observaciones") or values.get("Detalle Terminado") or values.get("resolutionNote")
                if note:
                    item.setdefault("worklogs", []).append({
                        "id": f"WL-{int(time.time())}",
                        "submitter": values.get("Assignee") or values.get("Request Assignee") or "Operador",
                        "submit_date": datetime.now().strftime("%Y-%m-%dT%H:%M:%S.000+0000"),
                        "notes": str(note)
                    })

                return True, None

        return True, None


def mock_post_entry(form_name: str, payload: dict) -> tuple[bool, str | None]:
    """Simula creación de entradas (ej: WorkLogs)."""
    with _lock:
        values = payload.get("values", payload)
        tid = values.get("Incident Number") or values.get("Work Order ID")
        if tid:
            items = _MOCK_INCIDENTS if "INC" in tid else _MOCK_WORKORDERS
            id_field = "Incident Number" if "INC" in tid else "Work Order ID"
            for item in items:
                if item.get(id_field) == tid:
                    item.setdefault("worklogs", []).append({
                        "id": f"WL-{int(time.time())}",
                        "submitter": values.get("Submitter", "Operador"),
                        "submit_date": datetime.now().strftime("%Y-%m-%dT%H:%M:%S.000+0000"),
                        "notes": values.get("Detailed Description") or values.get("Detailed Decription") or values.get("Description") or "Comentario registrado"
                    })
                    return True, None
        return True, None


def mock_create_ticket(ticket_type: str, payload: dict) -> tuple[str | None, str | None]:
    """Crea un nuevo ticket en el pool simulado."""
    with _lock:
        now_ts = int(time.time())
        is_wo = (ticket_type == "WO")
        new_id = f"WO10{now_ts % 100000:05d}" if is_wo else f"INC82{now_ts % 100000:05d}"
        now_str = datetime.now().strftime("%Y-%m-%dT%H:%M:%S.000+0000")

        new_entry = {
            "Work Order ID" if is_wo else "Incident Number": new_id,
            "Request ID": f"000000000{new_id}",
            "Summary" if is_wo else "Description": payload.get("summary", "Solicitud Creada"),
            "Detailed Description" if is_wo else "Detailed Decription": payload.get("description", ""),
            "Submit Date": now_str,
            "Status": "Assigned",
            "ASLOGID" if is_wo else "Assignee Login ID": "",
            "Request Assignee" if is_wo else "Assignee": "",
            "Customer First Name" if is_wo else "First Name": payload.get("firstName", "Usuario"),
            "Customer Last Name" if is_wo else "Last Name": payload.get("lastName", "Demo"),
            "Company": payload.get("company", "Empresa Principal"),
            "Support Group Name" if is_wo else "Assigned Group": "TECNOLOGIA USUARIOS DT",
            "Support Group ID" if is_wo else "Assigned Group ID": "SGP000000003810",
            "Categorization Tier 1": payload.get("op_tier_1", "Hardware"),
            "Categorization Tier 2": payload.get("op_tier_2", "Puestos"),
            "Categorization Tier 3": payload.get("op_tier_3", "General"),
            "worklogs": [
                {"id": f"WL-{now_ts}", "submitter": "Operador", "submit_date": now_str, "notes": "Ticket creado exitosamente desde OrgWo."}
            ]
        }

        if is_wo:
            _MOCK_WORKORDERS.insert(0, new_entry)
        else:
            _MOCK_INCIDENTS.insert(0, new_entry)

        return new_id, None
