"""Rutas Flask de adjuntos. Thin: delegan a servicios/attachments.py.

Endpoints:
- GET    /api/cases/<cid>/attachments       — lista adjuntos del case
- POST   /api/cases/<cid>/attachments       — sube nuevo adjunto
- GET    /api/attachments/<aid>/file        — descarga / inline
- DELETE /api/attachments/<aid>             — borra (row + archivo en disco)
"""
from flask import Blueprint, jsonify, request, session, send_file

from Backend.utils import current_user_org
from Backend.servicios.attachments import (
    service_list_attachments,
    service_save_attachment,
    service_get_attachment_file,
    service_delete_attachment,
)

attachments_bp = Blueprint("attachments", __name__)


@attachments_bp.route("/api/cases/<cid>/attachments", methods=["GET"])
def route_list_attachments(cid):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    org = current_user_org()
    result = service_list_attachments(cid, org)
    if result is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@attachments_bp.route("/api/cases/<cid>/attachments", methods=["POST"])
def route_upload_attachment(cid):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    if "file" not in request.files:
        return jsonify({"error": "Falta el archivo (campo 'file')"}), 400
    f = request.files["file"]
    content = f.read()
    if not content:
        return jsonify({"error": "Archivo vacio"}), 400
    org = current_user_org()
    saved = service_save_attachment(
        case_id=cid,
        org=org,
        filename=f.filename or "archivo.bin",
        content=content,
        mime_type=f.mimetype or None,
        kind=request.form.get("kind") or None,
        source=request.form.get("source") or "manual_upload",
    )
    if saved is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(saved), 201


@attachments_bp.route("/api/attachments/<aid>/file", methods=["GET"])
def route_get_attachment_file(aid):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    org = current_user_org()
    res = service_get_attachment_file(aid, org)
    if res is None:
        return jsonify({"error": "not found"}), 404
    path, filename, mime_type = res
    disposition = "inline" if request.args.get("inline") else "attachment"
    return send_file(
        str(path),
        mimetype=mime_type or "application/octet-stream",
        as_attachment=(disposition == "attachment"),
        download_name=filename,
    )


@attachments_bp.route("/api/attachments/<aid>", methods=["DELETE"])
def route_delete_attachment(aid):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    org = current_user_org()
    if not service_delete_attachment(aid, org):
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})
