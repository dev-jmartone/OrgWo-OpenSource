"""
Backend/remedy/sync.py

Sincronización bidireccional entre tickets asignados en Remedy y la base de
datos SQLite local.

Este módulo:
- Recibe el token, username y org como parámetros (no lee Flask session).
- Delega la consulta de tickets a queries.py.
- Escribe directamente en SQLite a través de get_db().
- No importa Flask.
"""
from Backend.base_datos.connection import get_db
from Backend.integraciones.outlook.lookup import backfill_case_emails
from Backend.integraciones.remedy import queries
from Backend.integraciones.remedy.parsers import is_equipment_element_type, map_element_type_to_tipo
from Backend.utils import new_id, now_iso


def sync_assigned_tickets(token: str, username: str, org: str) -> None:
    """No-op — Sincronización desactivada. Los tickets se consultan 100% en vivo."""
    return
