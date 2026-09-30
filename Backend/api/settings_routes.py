"""Rutas Flask de settings (globales + por org + por usuario).

Endpoints:
- PUT  /api/settings/<key>            — settings globales del sistema
- GET  /api/user/settings             — settings del user actual (column_settings)
- PUT  /api/user/settings
- GET  /api/org/settings/<key>        — settings por organizacion
- PUT  /api/org/settings/<key>

Para checklist_templates (key especial en org_settings), si no existe se
inicializa con DEFAULT_CHECKLIST_TEMPLATES la primera vez que se lee.
"""
import json
from flask import Blueprint, jsonify, request, session

from Backend.base_datos.connection import get_db
from Backend.base_datos.repository.settings import (
    repo_set_setting,
    repo_get_org_setting,
    repo_set_org_setting,
)

settings_bp = Blueprint("settings", __name__)


DEFAULT_CHECKLIST_TEMPLATES = {
    "default": [
        {"id": "user_pass", "label": "Usuario y pass", "required_for_state": "userpass", "order": 10},
        {"id": "coord_date", "label": "Fecha de retiro coordinada con usuario", "required_for_state": "coord", "order": 20},
        {"id": "autopilot_ok", "label": "Configurando Autopilot", "required_for_state": "config", "order": 30},
        {"id": "template_sent", "label": "Enviar template", "required_for_state": "req", "order": 40},
        {"id": "template_appr", "label": "Template aprobado", "required_for_state": "appr", "order": 50},
        {"id": "delivered", "label": "Entrega de equipo nuevo + vieja recibida + 1ª firma", "required_for_state": "wipe", "order": 60},
        {"id": "old_returned", "label": "Vieja wipeada retirada + 2ª firma", "required_for_state": "scan", "order": 70},
        {"id": "scanned", "label": "Template escaneado", "required_for_state": "scan", "order": 80},
        {"id": "wo_closed", "label": "WO cerrada con template adjunto", "required_for_state": "done", "order": 90},
    ],
    "Kit Inalambrico": [
        {"id": "retiro_deposito", "label": "Se retira de depósito (anotar Marca, Modelo, Serial)", "required_for_state": "config", "order": 10},
        {"id": "contact_coord", "label": "Contacto con usuario con mensaje rápido", "required_for_state": "coord", "order": 20},
        {"id": "template_sent", "label": "Carga y envío de Template", "required_for_state": "req", "order": 30},
        {"id": "template_appr", "label": "Recepción de la Aprobación", "required_for_state": "appr", "order": 40},
        {"id": "ready_notice", "label": "Entrega del elemento", "required_for_state": "appr", "order": 50},
        {"id": "scanned", "label": "Escaneo del template", "required_for_state": "scan", "order": 60},
        {"id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70},
    ],
    "Vincha": [
        {"id": "retiro_deposito", "label": "Se retira de depósito (anotar Marca, Modelo, Serial)", "required_for_state": "config", "order": 10},
        {"id": "contact_coord", "label": "Contacto con usuario con mensaje rápido", "required_for_state": "coord", "order": 20},
        {"id": "template_sent", "label": "Carga y envío de Template", "required_for_state": "req", "order": 30},
        {"id": "template_appr", "label": "Recepción de la Aprobación", "required_for_state": "appr", "order": 40},
        {"id": "ready_notice", "label": "Entrega del elemento", "required_for_state": "appr", "order": 50},
        {"id": "scanned", "label": "Escaneo del template", "required_for_state": "scan", "order": 60},
        {"id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70},
    ],
    "Cargador": [
        {"id": "retiro_deposito", "label": "Se retira de depósito (anotar Marca, Modelo, Serial)", "required_for_state": "config", "order": 10},
        {"id": "contact_coord", "label": "Contacto con usuario con mensaje rápido", "required_for_state": "coord", "order": 20},
        {"id": "template_sent", "label": "Carga y envío de Template", "required_for_state": "req", "order": 30},
        {"id": "template_appr", "label": "Recepción de la Aprobación", "required_for_state": "appr", "order": 40},
        {"id": "ready_notice", "label": "Entrega del elemento", "required_for_state": "appr", "order": 50},
        {"id": "scanned", "label": "Escaneo del template", "required_for_state": "scan", "order": 60},
        {"id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70},
    ],
    "Notebook Baja": [
        {"id": "coord_date", "label": "Fecha de retiro coordinada con usuario", "required_for_state": "coord", "order": 10},
        {"id": "template_sent", "label": "Enviar template", "required_for_state": "req", "order": 20},
        {"id": "template_appr", "label": "Template aprobado", "required_for_state": "appr", "order": 30},
        {"id": "delivered", "label": "Entrega de equipo nuevo + vieja recibida + 1ª firma", "required_for_state": "wipe", "order": 40},
        {"id": "old_returned", "label": "Vieja wipeada retirada + 2ª firma", "required_for_state": "scan", "order": 50},
        {"id": "scanned", "label": "Template escaneado", "required_for_state": "scan", "order": 60},
        {"id": "wo_closed", "label": "WO cerrada con template adjunto", "required_for_state": "done", "order": 70},
    ],
}


@settings_bp.route("/api/settings/<key>", methods=["PUT"])
def route_set_setting(key):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    val = (request.json or {}).get("value", "")
    repo_set_setting(key, val)
    return jsonify({"ok": True})


@settings_bp.route("/api/user/settings", methods=["GET"])
def route_get_user_settings():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401

    user_id = session["user_id"]
    with get_db() as db:
        row = db.execute("SELECT column_settings FROM users WHERE id = ?", (user_id,)).fetchone()

    if not row or not row["column_settings"]:
        return jsonify({})

    try:
        settings = json.loads(row["column_settings"])
        return jsonify(settings)
    except Exception:
        return jsonify({})


@settings_bp.route("/api/user/settings", methods=["PUT"])
def route_update_user_settings():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401

    user_id = session["user_id"]
    data = request.json or {}

    try:
        with get_db() as db:
            db.execute(
                "UPDATE users SET column_settings = ? WHERE id = ?",
                (json.dumps(data), user_id),
            )
            db.commit()
    except Exception as e:
        return jsonify({"error": f"Error de base de datos: {e}"}), 500

    return jsonify({"ok": True})


@settings_bp.route("/api/org/settings/<key>", methods=["GET"])
def route_get_org_setting(key):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    org = session["organization"]
    val = repo_get_org_setting(org, key)
    if val is None:
        if key == "checklist_templates":
            initial_val = json.dumps(DEFAULT_CHECKLIST_TEMPLATES)
            repo_set_org_setting(org, key, initial_val)
            return jsonify({"value": initial_val})
        return jsonify({"value": None})
    return jsonify({"value": val})


@settings_bp.route("/api/org/settings/<key>", methods=["PUT"])
def route_set_org_setting(key):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    org = session["organization"]
    val = (request.json or {}).get("value", "")
    repo_set_org_setting(org, key, val)
    return jsonify({"ok": True})
