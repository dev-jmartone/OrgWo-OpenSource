"""
Backend/remedy/parsers.py

Parseo y normalización de respuestas crudas de la API de BMC Remedy.
Este módulo no hace llamadas HTTP ni accede a la base de datos.
No importa Flask ni SQLite.

Reemplaza la lógica de parseo que estaba duplicada 4 veces en remedy.py.
"""
import re

# ── Detección de tipo de elemento ─────────────────────────────────────────────

# Orden importa: "kit" va antes que "inalambrico" para que el match sea correcto.
_ELEMENT_KEYWORDS: list[tuple[str, str]] = [
    ("vincha",       "Vincha"),
    ("kit",          "Kit"),
    ("inalambrico",  "Kit"),
    ("inalámbrico",  "Kit"),
    ("celular",      "Celular"),
    ("movil",        "Celular"),
    ("móvil",        "Celular"),
    ("tel.",         "Celular"),
    ("cargador",     "Cargador"),
    ("adaptador",    "Cargador"),
    ("monitor",      "Monitor"),
    ("notebook",     "Equipo"),
    ("equipo",       "Equipo"),
    ("imagen corporativa", "Equipo"),
]

# No se utiliza blacklist de no-equipo, todos los tickets son válidos para ingresar al tracker
_NON_EQUIPMENT_BLACKLIST: tuple[str, ...] = ()


def parse_element_type(summary: str, description: str) -> str:
    """Detecta el tipo de elemento tecnológico desde el summary y la descripción.

    Returns:
        Una de: "Vincha", "Kit", "Celular", "Cargador", "Monitor", "Red / Conectividad", "Software / Configuración", "Equipo".
    """
    sum_lower = (summary or "").lower()
    desc_lower = (description or "").lower()
    full_text = sum_lower + " " + desc_lower

    # 1. Periféricos específicos (tienen prioridad para asociar al hardware)
    if "vincha" in full_text or "headset" in full_text or "auricular" in full_text:
        return "Vincha"
    if "kit" in full_text or "teclado" in full_text or "mouse" in full_text:
        return "Kit"
    if "celular" in full_text or "movil" in full_text or "móvil" in full_text or "tel." in full_text:
        return "Celular"
    if "cargador" in full_text or "adaptador" in full_text:
        return "Cargador"
    if "monitor" in full_text:
        return "Monitor"

    # 2. Categorías lógicas / Red / Conectividad
    network_keywords = ["wifi", "red", "conexion", "conexión", "switch", "router", "vpn", "conectividad"]
    if any(nw in full_text for nw in network_keywords):
        return "Red / Conectividad"

    # 3. Categorías de Software / Configuración
    software_keywords = [
        "software", "outlook", "correo", "virtual", "chat", "error", "acceso", 
        "configur", "instalac", "sistema", "programa", "licencia", "token"
    ]
    if any(sw in full_text for sw in software_keywords):
        return "Software / Configuración"

    return "Equipo"


def is_equipment_element_type(el_type: str) -> bool:
    """Helper bool — Todos los tickets son elegibles como equipamiento físico/lógico."""
    return True


# Empresas con variaciones corporativas que vienen del Remedy ("EMPRESA",
# etc.) y se prefieren cortas en los templates firmados. Mapeo manual chico.
_COMPANY_NORMALIZE: dict[str, str] = {
    "EMPRESA": "Empresa Principal",
    "EMPRESA PRINCIPAL": "Empresa Principal",
    "SUBSIDIARIA": "Subsidiaria",
    "SUBSIDIARIA B": "Subsidiaria B",
    "PROVEEDOR TI": "Proveedor TI",
}


def normalize_company(name: str) -> str:
    if not name:
        return ""
    s = name.strip()
    return _COMPANY_NORMALIZE.get(s.upper(), s)


def smart_case_name(name: str) -> str:
    """Title-case para nombres que vienen del Remedy en MAYÚSCULAS.
    Si ya tiene mezcla de mayús/minús lo deja como está. 'LEONEL BELMONTE'
    → 'Leonel Belmonte'. 'Maria F. Ippolito' → 'Maria F. Ippolito'.
    """
    if not name:
        return ""
    s = name.strip()
    if not s or s != s.upper():
        return s
    return " ".join(w.capitalize() for w in s.split())


# ── Parseo de cliente Jarvis Bot ──────────────────────────────────────────────

def parse_jarvis_client(client_name: str, description: str) -> tuple[str, str]:
    """Si el cliente es Jarvis Chatbot, extrae el usuario real y la solicitud
    del cuerpo de la descripción del ticket.

    Args:
        client_name: Nombre del cliente tal como viene de Remedy.
        description: Descripción detallada del ticket.

    Returns:
        Tupla (client_name_real, description_real).
    """
    if "jarvis" not in client_name.lower() and "jarvis" not in description.lower():
        return client_name, description

    user_match = re.search(r"para el usuario:\s*([^)]+)", description, re.IGNORECASE)
    if user_match:
        client_name = user_match.group(1).strip()

    solicitud_match = re.search(r"(?:Solicitud|Consulta|Incidente):\s*(.*)", description, re.DOTALL | re.IGNORECASE)
    if solicitud_match:
        description = solicitud_match.group(1).strip()
    else:
        # Fallback por si cambia la palabra clave, al menos limpiamos el prefijo de Jarvis
        prefix_match = re.search(r"JARVIS\s*\(.*?\)\s*-\s*(.*)", description, re.DOTALL | re.IGNORECASE)
        if prefix_match:
            description = prefix_match.group(1).strip()

    return client_name, description


# ── Mapeo de estado ───────────────────────────────────────────────────────────

def map_status(status_raw) -> str:
    """Mapea el estado crudo de Remedy a los valores internos del sistema.

    Returns:
        "1" = Assigned, "3" = Pending, "4" = Resolved/Completed/Closed/Cancelled/Rejected.
    """
    s = str(status_raw or "Assigned")
    if "Pending" in s or s == "3":
        return "3"
    if any(term in s for term in ["Resolved", "Completed", "Closed", "Cancelled", "Rejected"]) or s in ("4", "5", "6"):
        return "4"
    return "1"


def map_element_type_to_tipo(el_type: str) -> str:
    """Convierte el tipo de elemento (Remedy) al campo 'tipo' de la BD local."""
    el = (el_type or "").lower()
    if "vincha" in el:   return "vincha"
    if "kit" in el:      return "kit"
    if "celular" in el or "cel" in el: return "cel"
    if "cargador" in el: return "cargador"
    if "monitor" in el:  return "monitor"
    return "pc"


# ── Parsers de entradas Remedy ────────────────────────────────────────────────

def parse_incident(entry: dict, include_status: bool = False) -> dict | None:
    """Convierte una entrada cruda de HPD:Help Desk en un ticket normalizado.

    Args:
        entry: Un elemento de la lista "entries" devuelta por la API de Remedy.
        include_status: Si True, incluye el campo "status" mapeado internamente.

    Returns:
        Dict normalizado del ticket, o None si no tiene Incident Number.
    """
    vals = entry.get("values", {})
    inc_num = vals.get("Incident Number")
    if not inc_num:
        return None

    summary = vals.get("Description") or "Incidente Remedy"
    # Nota: "Detailed Decription" es el typo oficial en el schema de Remedy.
    description = vals.get("Detailed Decription") or summary

    first_name = vals.get("First Name") or ""
    last_name  = vals.get("Last Name") or ""
    client_name = smart_case_name(f"{first_name} {last_name}".strip()) or "Sin nombre"
    client_name, description = parse_jarvis_client(client_name, description)

    ticket: dict = {
        "id":           inc_num,
        "type":         "INC",
        "summary":      summary[:80] + "..." if len(summary) > 80 else summary,
        "description":  description,
        "createdAt":    vals.get("Submit Date") or "",
        "company":      normalize_company(vals.get("Company") or "Empresa Principal"),
        "element_type": parse_element_type(summary, description),
        "clientName":   client_name,
        "slaDate":      vals.get("Required Resolution DateTime") or "",
        "slaStatus":    vals.get("SLM Status") or "",
        "urgency":      vals.get("Urgency") or "",
        "impact":       vals.get("Impact") or "",
        "assignee_login": vals.get("Assignee Login ID") or "",
        "tipificacion": vals.get("Categorization Tier 3") or vals.get("Categorization Tier 2") or vals.get("Categorization Tier 1") or "",
    }
    if include_status:
        ticket["status"] = map_status(vals.get("Status"))
    return ticket


def parse_workorder(entry: dict, include_status: bool = False) -> dict | None:
    """Convierte una entrada cruda de WOI:WorkOrder en un ticket normalizado.

    Args:
        entry: Un elemento de la lista "entries" devuelta por la API de Remedy.
        include_status: Si True, incluye el campo "status" mapeado internamente.

    Returns:
        Dict normalizado del ticket, o None si no tiene Work Order ID.
    """
    vals = entry.get("values", {})
    wo_id = vals.get("Work Order ID")
    if not wo_id:
        return None

    summary     = vals.get("Summary") or "Work Order Remedy"
    description = vals.get("Detailed Description") or summary

    cust_first  = vals.get("Customer First Name") or ""
    cust_last   = vals.get("Customer Last Name") or ""
    client_name = smart_case_name(f"{cust_first} {cust_last}".strip()) or "Sin nombre"
    client_name, description = parse_jarvis_client(client_name, description)

    ticket: dict = {
        "id":           wo_id,
        "type":         "WO",
        "summary":      summary,
        "description":  description,
        "createdAt":    vals.get("Submit Date") or "",
        "company":      normalize_company(vals.get("Company") or "Empresa Principal"),
        "element_type": parse_element_type(summary, description),
        "clientName":   client_name,
        "slaDate":      vals.get("Next Target Date") or "",
        "slaStatus":    vals.get("SLM Status") or "",
        "assignee_login": vals.get("ASLOGID") or "",
        "tipificacion": vals.get("Categorization Tier 3") or vals.get("Categorization Tier 2") or vals.get("Categorization Tier 1") or "",
    }
    if include_status:
        ticket["status"] = map_status(vals.get("Status"))
    return ticket
