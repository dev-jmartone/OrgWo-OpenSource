"""
Backend/remedy/queries.py

Construcción de queries ARS y obtención de listas de tickets ya parseados.

Este módulo:
- Sabe QUÉ preguntar a Remedy (queries, campos, formularios).
- Delega el transporte HTTP a client.py.
- Delega el parseo de respuestas a parsers.py.
- No importa Flask ni SQLite.
"""
import os
import time
import threading

REMEDY_SUPPORT_COMPANY = os.getenv("REMEDY_SUPPORT_COMPANY", "EMPRESA")

# Cache global para consultas Remedy.
# TTL 60s: con un solo worker (ver Dockerfile) el cache es compartido entre
# todos los operadores. La primera carga de Cartelera calienta los tickets
# sin asignar y el resto del equipo pega al cache en vez de a Remedy durante
# la ventana. Sube la latencia maxima de frescura a 60s a cambio de recortar
# ~Nx las llamadas al AR Server (que es lo que satura sesiones y dispara
# timeouts con varios usuarios).
_query_cache = {}
_cache_lock = threading.Lock()
_CACHE_TTL_SECS = 60

def _get_cached_query(cache_key: str):
    with _cache_lock:
        cached = _query_cache.get(cache_key)
        if cached:
            val, timestamp = cached
            if time.time() - timestamp < _CACHE_TTL_SECS:
                return val
    return None

def _set_cached_query(cache_key: str, value):
    with _cache_lock:
        _query_cache[cache_key] = (value, time.time())

def invalidate_remedy_cache(username: str = None):
    """Invalida la caché de consultas de Remedy. Si se pasa username, invalida la suya y la de no asignados."""
    with _cache_lock:
        # Siempre invalidamos la lista de no asignados para que el pool general de
        # la Cartelera se refresque de inmediato para los otros operadores.
        _query_cache.pop("unassigned_incidents", None)
        _query_cache.pop("unassigned_workorders", None)
        _query_cache.pop("all_assigned_incidents", None)
        _query_cache.pop("all_assigned_workorders", None)
        _query_cache.pop("group_open_incidents", None)
        _query_cache.pop("group_open_workorders", None)

        if username:
            user_key_part = f"user:{username.lower().strip()}"
            keys_to_del = [k for k in _query_cache.keys() if user_key_part in k.lower()]
            for k in keys_to_del:
                _query_cache.pop(k, None)
            print(f"[queries.cache] Caché invalidada para el usuario: {username} y pool general")
        else:
            _query_cache.clear()
            print("[queries.cache] Toda la caché de Remedy invalidada")

class RemedyAuthenticationError(Exception):
    """Excepción lanzada cuando una consulta a Remedy falla por expiración de token o falta de autorización (HTTP 401/403)."""
    pass

from Backend.integraciones.remedy import client
from Backend.integraciones.remedy.parsers import parse_incident, parse_workorder

# Ventana de tiempo: tickets de los últimos 30 días
_DAYS_BACK = 30


def _epoch_30d() -> int:
    return int(time.time()) - (_DAYS_BACK * 24 * 60 * 60)


def _epoch_today() -> int:
    import datetime
    now = datetime.datetime.now()
    today_midnight = datetime.datetime(now.year, now.month, now.day, 0, 0, 0)
    return int(today_midnight.timestamp())


def _user_variants(username: str) -> list[str]:
    """Genera todas las variantes de un login de usuario que puede usar Remedy."""
    if not username:
        return []
    clean = username.split("@")[0]
    return [v for v in dict.fromkeys([
        username, username.upper(), username.lower(),
        clean,    clean.upper(),    clean.lower(),
    ]) if v]


# ── Generic Fetch Helper ──────────────────────────────────────────────────────

def _query_remedy_generic(
    token: str,
    cache_key: str | None,
    form_name: str,
    query: str,
    fields: str,
    parser_fn: callable,
    limit: int = None,
    timeout: int = None,
    post_filter_fn: callable = None,
    paginate: bool = False,
    parser_kwargs: dict = None,
    skip_cache: bool = False
) -> list[dict]:
    if not skip_cache and cache_key:
        cached = _get_cached_query(cache_key)
        if cached is not None:
            return cached

    all_entries = []
    offset = 0
    while True:
        if paginate:
            entries, err = client.get_entries(token, form_name, query, fields, limit=limit, offset=offset, timeout=timeout)
        else:
            entries, err = client.get_entries(token, form_name, query, fields, limit=limit, timeout=timeout)

        if err:
            if "HTTP 401" in err or "HTTP 403" in err:
                raise RemedyAuthenticationError(err)
            print(f"[remedy.queries] fetch error on {form_name}: {err}")
            break

        if not entries:
            break

        all_entries.extend(entries)
        if not paginate or len(entries) < limit:
            break
        offset += limit

    result = []
    kwargs = parser_kwargs or {}
    for e in all_entries:
        if post_filter_fn and post_filter_fn(e):
            continue
        t = parser_fn(e, **kwargs)
        if t is not None:
            result.append(t)

    if not skip_cache and cache_key:
        _set_cached_query(cache_key, result)
    return result


# ── Tickets no asignados (pool general) ───────────────────────────────────────

def fetch_unassigned_incidents(token: str) -> list[dict]:
    """Tickets INC abiertos no asignados de los grupos de soporte configurados."""
    epoch = _epoch_30d()
    query = (
        f"('Assigned Group'=\"TECNOLOGIA USUARIOS DT\" OR "
        f"'Assigned Group'=\"CTU DT\" OR "
        f"'Assigned Group'=\"TECNOLOGIA CELULARES\") "
        f"AND ('Assignee Login ID'=$NULL$ OR 'Assignee Login ID'=\"\") "
        f"AND 'Status' < 4 AND 'Submit Date' >= {epoch}"
    )
    fields = (
        "values(Incident Number, Description, Detailed Decription, Submit Date, "
        "Status, First Name, Last Name, Required Resolution DateTime, SLM Status, "
        "Urgency, Impact, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    return _query_remedy_generic(
        token=token,
        cache_key="unassigned_incidents",
        form_name="HPD:Help Desk",
        query=query,
        fields=fields,
        parser_fn=parse_incident,
        limit=1000
    )


def fetch_unassigned_workorders(token: str) -> list[dict]:
    """Work Orders abiertas no asignadas de los grupos de soporte configurados."""
    epoch = _epoch_30d()
    query = (
        f"('Support Group Name'=\"TECNOLOGIA USUARIOS DT\" OR "
        f"'Support Group Name'=\"CTU DT\" OR "
        f"'Support Group Name'=\"TECNOLOGIA CELULARES\") "
        f"AND 'Status' < 3 AND 'Submit Date' >= {epoch}"
    )
    fields = (
        "values(Work Order ID, Summary, Detailed Description, Submit Date, "
        "Status, Customer First Name, Customer Last Name, Next Target Date, "
        "SLM Status, ASLOGID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    return _query_remedy_generic(
        token=token,
        cache_key="unassigned_workorders",
        form_name="WOI:WorkOrder",
        query=query,
        fields=fields,
        parser_fn=parse_workorder,
        limit=1000,
        post_filter_fn=lambda e: bool(((e.get("values") or {}).get("ASLOGID") or "").strip())
    )


def fetch_all_assigned_incidents(token: str) -> list[dict]:
    """Tickets INC abiertos asignados de los grupos de soporte configurados (a cualquier técnico)."""
    epoch = _epoch_30d()
    query = (
        f"('Assigned Group'=\"TECNOLOGIA USUARIOS DT\" OR "
        f"'Assigned Group'=\"CTU DT\" OR "
        f"'Assigned Group'=\"TECNOLOGIA CELULARES\") "
        f"AND 'Assigned Support Company'=\"{REMEDY_SUPPORT_COMPANY}\" "
        f"AND 'Assignee Login ID' != $NULL$ AND 'Assignee Login ID' != \"\" "
        f"AND 'Status' < 4 AND 'Submit Date' >= {epoch}"
    )
    fields = (
        "values(Incident Number, Description, Detailed Decription, Submit Date, "
        "Status, First Name, Last Name, Required Resolution DateTime, SLM Status, Company, "
        "Urgency, Impact, Assignee Login ID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    return _query_remedy_generic(
        token=token,
        cache_key="all_assigned_incidents",
        form_name="HPD:Help Desk",
        query=query,
        fields=fields,
        parser_fn=parse_incident,
        parser_kwargs={"include_status": True}
    )


def fetch_all_assigned_workorders(token: str) -> list[dict]:
    """Work Orders abiertas asignadas de los grupos de soporte configurados (a cualquier técnico)."""
    epoch = _epoch_30d()
    query = (
        f"('Support Group Name'=\"TECNOLOGIA USUARIOS DT\" OR "
        f"'Support Group Name'=\"CTU DT\" OR "
        f"'Support Group Name'=\"TECNOLOGIA CELULARES\") "
        f"AND 'ASLOGID' != $NULL$ AND 'ASLOGID' != \"\" "
        f"AND 'Status' < 3 AND 'Submit Date' >= {epoch}"
    )
    fields = (
        "values(Work Order ID, Summary, Detailed Description, Submit Date, "
        "Status, Customer First Name, Customer Last Name, Next Target Date, "
        "SLM Status, Company, ASLOGID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    return _query_remedy_generic(
        token=token,
        cache_key="all_assigned_workorders",
        form_name="WOI:WorkOrder",
        query=query,
        fields=fields,
        parser_fn=parse_workorder,
        parser_kwargs={"include_status": True}
    )


# ── Tickets asignados al usuario ──────────────────────────────────────────────

def fetch_assigned_incidents(token: str, username: str) -> list[dict]:
    """INC abiertos asignados al usuario (todas las variantes de login)."""
    variants = _user_variants(username)
    if not variants:
        return []
    conditions = " OR ".join(f"'Assignee Login ID'=\"{v}\"" for v in variants)
    query      = f"({conditions}) AND 'Status' < 4"
    fields = (
        "values(Incident Number, Description, Detailed Decription, Submit Date, "
        "Status, First Name, Last Name, Required Resolution DateTime, SLM Status, Company, "
        "Urgency, Impact, Assignee Login ID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    print(f"[remedy.queries] fetch_assigned_incidents -> variants={variants}")
    return _query_remedy_generic(
        token=token,
        cache_key=f"assigned_incidents:user:{username.lower().strip()}",
        form_name="HPD:Help Desk",
        query=query,
        fields=fields,
        parser_fn=parse_incident,
        timeout=15,
        parser_kwargs={"include_status": True}
    )


def fetch_assigned_workorders(token: str, username: str) -> list[dict]:
    """Work Orders abiertas asignadas al usuario (todas las variantes de login)."""
    variants = _user_variants(username)
    if not variants:
        return []
    conditions = " OR ".join(f"'ASLOGID'=\"{v}\"" for v in variants)
    query      = f"({conditions}) AND 'Status' < 3"
    fields = (
        "values(Work Order ID, Summary, Detailed Description, Submit Date, "
        "Status, Customer First Name, Customer Last Name, Next Target Date, "
        "SLM Status, Company, ASLOGID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    return _query_remedy_generic(
        token=token,
        cache_key=f"assigned_workorders:user:{username.lower().strip()}",
        form_name="WOI:WorkOrder",
        query=query,
        fields=fields,
        parser_fn=parse_workorder,
        timeout=15,
        parser_kwargs={"include_status": True}
    )


# ── Tickets cerrados/resueltos del usuario ────────────────────────────────────

def fetch_closed_incidents(token: str, username: str, search_q: str = None, days_back: int = None, group_tickets: bool = False) -> list[dict]:
    """INC resueltos asignados al usuario or support groups (hoy, máx 1000, o filtrados por búsqueda o ventana de días)."""
    skip_cache = bool(search_q or days_back is not None or group_tickets)
    
    if group_tickets:
        conditions = (
            f"('Assigned Group'=\"TECNOLOGIA USUARIOS DT\" OR "
            f"'Assigned Group'=\"CTU DT\" OR "
            f"'Assigned Group'=\"TECNOLOGIA CELULARES\") "
            f"AND 'Assigned Support Company'=\"{REMEDY_SUPPORT_COMPANY}\""
        )
    else:
        variants = _user_variants(username)
        if not variants:
            return []
        conditions = " OR ".join(f"'Assignee Login ID'=\"{v}\"" for v in variants)
    query      = f"({conditions}) AND 'Status' >= 4"
    
    if search_q:
        clean_q = search_q.replace('"', '').strip()
        if clean_q:
            if clean_q.upper().startswith("INC") or clean_q.isdigit():
                query += f" AND 'Incident Number' LIKE \"%{clean_q}%\""
            else:
                query += f" AND ('First Name' LIKE \"%{clean_q}%\" OR 'Last Name' LIKE \"%{clean_q}%\" OR 'Description' LIKE \"%{clean_q}%\")"
    else:
        if days_back is not None:
            epoch = int(time.time()) - (days_back * 24 * 60 * 60)
        else:
            epoch = _epoch_today()
        query += f" AND 'Last Modified Date' >= {epoch}"

    fields = (
        "values(Incident Number, Description, Detailed Decription, Submit Date, "
        "Status, First Name, Last Name, Required Resolution DateTime, SLM Status, Company, "
        "Assignee Login ID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    
    return _query_remedy_generic(
        token=token,
        cache_key=f"closed_incidents:user:{username.lower().strip()}",
        form_name="HPD:Help Desk",
        query=query,
        fields=fields,
        parser_fn=parse_incident,
        limit=1000,
        timeout=15,
        paginate=True,
        parser_kwargs={"include_status": True},
        skip_cache=skip_cache
    )


def fetch_closed_workorders(token: str, username: str, search_q: str = None, days_back: int = None, group_tickets: bool = False) -> list[dict]:
    """Work Orders completadas asignadas al usuario or support groups (hoy, máx 1000, o filtrados por búsqueda o ventana de días)."""
    skip_cache = bool(search_q or days_back is not None or group_tickets)
    
    if group_tickets:
        conditions = (
            f"('Support Group Name'=\"TECNOLOGIA USUARIOS DT\" OR "
            f"'Support Group Name'=\"CTU DT\" OR "
            f"'Support Group Name'=\"TECNOLOGIA CELULARES\")"
        )
    else:
        variants = _user_variants(username)
        if not variants:
            return []
        conditions = " OR ".join(f"'ASLOGID'=\"{v}\"" for v in variants)
    query      = f"({conditions}) AND 'Status' >= 3"
    
    if search_q:
        clean_q = search_q.replace('"', '').strip()
        if clean_q:
            if clean_q.upper().startswith("WO") or clean_q.isdigit():
                query += f" AND 'Work Order ID' LIKE \"%{clean_q}%\""
            else:
                query += f" AND ('Customer First Name' LIKE \"%{clean_q}%\" OR 'Customer Customer Last Name' LIKE \"%{clean_q}%\" OR 'Summary' LIKE \"%{clean_q}%\")"
    else:
        if days_back is not None:
            epoch = int(time.time()) - (days_back * 24 * 60 * 60)
        else:
            epoch = _epoch_today()
        query += f" AND 'Last Modified Date' >= {epoch}"

    fields = (
        "values(Work Order ID, Summary, Detailed Description, Submit Date, "
        "Status, Customer First Name, Customer Last Name, Next Target Date, "
        "SLM Status, Company, ASLOGID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    
    return _query_remedy_generic(
        token=token,
        cache_key=f"closed_workorders:user:{username.lower().strip()}",
        form_name="WOI:WorkOrder",
        query=query,
        fields=fields,
        parser_fn=parse_workorder,
        limit=1000,
        timeout=15,
        paginate=True,
        parser_kwargs={"include_status": True},
        skip_cache=skip_cache
    )


def fetch_ticket_by_id(token: str, tid: str) -> dict | None:
    """Busca un ticket (INC o WO) por su ID directamente en Remedy."""
    tid_upper = tid.upper().strip()
    if tid_upper.startswith("INC"):
        form_name = "HPD:Help Desk"
        ticket_field = "Incident Number"
        fields = (
            "values(Incident Number, Description, Detailed Decription, Submit Date, "
            "Status, First Name, Last Name, Required Resolution DateTime, SLM Status, Company, Assignee Login ID, "
            "Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
        )
        res = _query_remedy_generic(
            token=token,
            cache_key=None,
            form_name=form_name,
            query=f"'{ticket_field}'=\"{tid_upper}\"",
            fields=fields,
            parser_fn=parse_incident,
            parser_kwargs={"include_status": True},
            skip_cache=True
        )
        return res[0] if res else None
    else:
        form_name = "WOI:WorkOrder"
        ticket_field = "Work Order ID"
        fields = (
            "values(Work Order ID, Summary, Detailed Description, Submit Date, "
            "Status, Customer First Name, Customer Last Name, Next Target Date, "
            "SLM Status, Company, ASLOGID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
        )
        res = _query_remedy_generic(
            token=token,
            cache_key=None,
            form_name=form_name,
            query=f"'{ticket_field}'=\"{tid_upper}\"",
            fields=fields,
            parser_fn=parse_workorder,
            parser_kwargs={"include_status": True},
            skip_cache=True
        )
        return res[0] if res else None


def fetch_group_open_incidents(token: str) -> list[dict]:
    """Todos los INC abiertos (asignados y no asignados) de los grupos de la mesa."""
    epoch = _epoch_30d()
    query = (
        f"('Assigned Group'=\"TECNOLOGIA USUARIOS DT\" OR "
        f"'Assigned Group'=\"CTU DT\" OR "
        f"'Assigned Group'=\"TECNOLOGIA CELULARES\") "
        f"AND 'Status' < 4 AND 'Submit Date' >= {epoch}"
    )
    fields = (
        "values(Incident Number, Description, Detailed Decription, Submit Date, "
        "Status, First Name, Last Name, Required Resolution DateTime, SLM Status, Company, "
        "Urgency, Impact, Assignee Login ID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    return _query_remedy_generic(
        token=token,
        cache_key="group_open_incidents",
        form_name="HPD:Help Desk",
        query=query,
        fields=fields,
        parser_fn=parse_incident,
        limit=1000,
        parser_kwargs={"include_status": True}
    )


def fetch_group_open_workorders(token: str) -> list[dict]:
    """Todas las WO abiertas (asignadas y no asignadas) de los grupos de la mesa."""
    epoch = _epoch_30d()
    query = (
        f"('Support Group Name'=\"TECNOLOGIA USUARIOS DT\" OR "
        f"'Support Group Name'=\"CTU DT\" OR "
        f"'Support Group Name'=\"TECNOLOGIA CELULARES\") "
        f"AND 'Status' < 3 AND 'Submit Date' >= {epoch}"
    )
    fields = (
        "values(Work Order ID, Summary, Detailed Description, Submit Date, "
        "Status, Customer First Name, Customer Last Name, Next Target Date, "
        "SLM Status, Company, ASLOGID, Categorization Tier 1, Categorization Tier 2, Categorization Tier 3)"
    )
    return _query_remedy_generic(
        token=token,
        cache_key="group_open_workorders",
        form_name="WOI:WorkOrder",
        query=query,
        fields=fields,
        parser_fn=parse_workorder,
        limit=1000,
        parser_kwargs={"include_status": True}
    )

