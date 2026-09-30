# Backend/remedy/__init__.py
# Paquete de integración con la API REST de BMC Remedy.
#
# Módulos:
#   client.py   → Llamadas HTTP crudas (GET, PUT, POST, login)
#   parsers.py  → Parseo y normalización de respuestas Remedy → dict
#   queries.py  → Construcción de queries ARS + fetch de listas de tickets
#   sync.py     → Sincronización de tickets Remedy ↔ SQLite local
