"""Servicios de adjuntos. Persisten archivos binarios + metadata.

Los binarios viven en ATTACH_DIR/<case_id>/<att_id>__<filename>; la
metadata (filename, mime, size, kind, source, ocr_text, detected_ids)
en la tabla attachments.

Si el adjunto es un template firmado (kind='template_firmado'), el flujo
ya ocurrio: marcamos automaticamente los checks pre-scan que aplican al
tipo del case + avanzamos estado a 'scan'. Ver _mark_pre_scan_checks.
"""
import json
import mimetypes
import re
import sqlite3
from pathlib import Path

from Backend.config import ATTACH_DIR
from Backend.base_datos.repository.cases import repo_get_case, repo_update_case
from Backend.base_datos.repository.events import repo_add_event
from Backend.base_datos.repository.attachments import (
    repo_attach_insert,
    repo_attach_list_for_case,
    repo_attach_get,
    repo_attach_delete,
    repo_attach_archive,
)
from Backend.utils import now_iso, new_id


_SAFE_NAME_RX = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    name = (name or "").strip() or "archivo"
    return _SAFE_NAME_RX.sub("_", name)[:120]


# Checks que se consideran "ya cumplidos" cuando el template firmado ya esta
# escaneado. Mantener en sync con Frontend/js/constants.js::CHECKLIST_ITEMS:
# todos los checks con order <= 80 (scanned) que apliquen al tipo del case.
# wo_closed (order 90) NO se marca: el cierre del ticket en Remedy es paso aparte.
_PRE_SCAN_CHECKS_BY_TIPO = {
    "pc":   ["user_pass", "coord_date", "autopilot_ok", "template_sent", "template_appr", "delivered", "old_returned", "scanned"],
    "cel":  ["user_pass", "coord_date", "autopilot_ok", "template_sent", "template_appr", "delivered", "old_returned", "scanned"],
    "both": ["user_pass", "coord_date", "autopilot_ok", "template_sent", "template_appr", "delivered", "old_returned", "scanned"],
    "monitor":   ["coord_date", "template_sent", "template_appr", "delivered", "scanned"],
    "vincha":    ["retiro_deposito", "contact_coord", "template_sent", "template_appr", "ready_notice", "scanned"],
    "kit":       ["retiro_deposito", "contact_coord", "template_sent", "template_appr", "ready_notice", "scanned"],
    "cargador":  ["retiro_deposito", "contact_coord", "template_sent", "template_appr", "ready_notice", "scanned"],
    "adaptador": ["retiro_deposito", "contact_coord", "template_sent", "template_appr", "ready_notice", "scanned"],
    "hdmi":      ["retiro_deposito", "contact_coord", "template_sent", "template_appr", "ready_notice", "scanned"],
    "parlante":  ["retiro_deposito", "contact_coord", "template_sent", "template_appr", "ready_notice", "scanned"],
}


def _mark_pre_scan_checks(case_row: sqlite3.Row) -> tuple[dict, list[str]]:
    """Devuelve (checks_dict_actualizado, lista_de_ids_recien_marcados).
    Solo agrega; no desmarca lo que ya estaba marcado."""
    try:
        checks = json.loads(case_row["checks"] or "{}")
    except (TypeError, ValueError):
        checks = {}
    if not isinstance(checks, dict):
        checks = {}
    tipo = (case_row["tipo"] or "").lower()
    targets = _PRE_SCAN_CHECKS_BY_TIPO.get(tipo, [])
    newly = []
    for cid in targets:
        if not checks.get(cid):
            checks[cid] = True
            newly.append(cid)
    return checks, newly


def attachment_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    raw = d.pop("detected_ids", None)
    try:
        d["detectedIds"] = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        d["detectedIds"] = []
    d["caseId"] = d.pop("case_id", "")
    d["mimeType"] = d.pop("mime_type", None)
    d["sizeBytes"] = d.pop("size_bytes", None)
    d["ocrText"] = d.pop("ocr_text", None)
    d["createdAt"] = d.pop("created_at", "")
    d["archivedAt"] = d.pop("archived_at", None)
    d.pop("path", None)  # nunca exponer paths absolutos al cliente
    return d


def service_save_attachment(
    case_id: str,
    org: str,
    *,
    filename: str,
    content: bytes,
    mime_type: str | None = None,
    kind: str | None = None,
    source: str | None = None,
    ocr_text: str | None = None,
    detected_ids: list[str] | None = None,
    log_event: str | None = None,
) -> dict | None:
    """Persiste un adjunto para el caso. Devuelve dict del adjunto o None si no existe el caso."""
    existing = repo_get_case(case_id, org)
    if not existing:
        return None

    att_id = new_id()
    ts = now_iso()
    safe_name = _safe_filename(filename)
    case_dir = ATTACH_DIR / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    on_disk = case_dir / f"{att_id}__{safe_name}"
    on_disk.write_bytes(content)

    fields = {
        "filename": safe_name,
        "path": str(on_disk),
        "mime_type": mime_type or mimetypes.guess_type(safe_name)[0],
        "size_bytes": len(content),
        "kind": kind,
        "source": source,
        "ocr_text": ocr_text,
        "detected_ids": json.dumps(detected_ids) if detected_ids else None,
    }
    repo_attach_insert(att_id, case_id, fields, ts)

    event_txt = log_event or f"Adjunto cargado: {safe_name}"
    repo_add_event(case_id, ts, event_txt)

    # Si el adjunto es un template firmado, los pasos previos del flujo ya
    # ocurrieron en la realidad (entrega, firma, wipe, etc). Marcarlos
    # automaticamente y avanzar el estado del caso a 'scan'.
    updates = {}
    if kind == "template_firmado":
        updated_checks, newly_marked = _mark_pre_scan_checks(existing)
        if newly_marked:
            updates["checks"] = json.dumps(updated_checks)
            labels = ", ".join(newly_marked)
            repo_add_event(case_id, ts, f"Checks marcados automaticamente por OCR de template: {labels}")
        if (existing["estado"] or "") not in ("scan", "done", "reject"):
            updates["estado"] = "scan"
            repo_add_event(case_id, ts, f"Estado movido a 'scan' (template firmado adjuntado)")

    repo_update_case(case_id, updates, ts, org)

    row = repo_attach_get(att_id, org)
    return attachment_to_dict(row) if row else None


def service_list_attachments(case_id: str, org: str) -> list[dict] | None:
    if not repo_get_case(case_id, org):
        return None
    rows = repo_attach_list_for_case(case_id, org)
    return [attachment_to_dict(r) for r in rows]


def service_get_attachment_file(att_id: str, org: str) -> tuple[Path, str, str | None] | None:
    row = repo_attach_get(att_id, org)
    if not row:
        return None
    # Archivado: binario borrado tras cierre de WO. La metadata persiste
    # como registro, pero ya no hay archivo para descargar.
    if row["archived_at"] or not row["path"]:
        return None
    path = Path(row["path"])
    if not path.is_file():
        return None
    return path, row["filename"], row["mime_type"]


def service_delete_attachment(att_id: str, org: str) -> bool:
    path_str = repo_attach_delete(att_id, org)
    if not path_str:
        return False
    try:
        Path(path_str).unlink(missing_ok=True)
    except Exception:
        pass
    return True


def service_archive_attachment(att_id: str, org: str | None = None) -> bool:
    """Archiva un adjunto: borra el binario en disco y marca archived_at.
    La metadata persiste. Idempotente: si ya estaba archivado, devuelve
    False sin tocar nada. Si org es None, no filtra por organization
    (uso en scripts cross-org)."""
    ts = now_iso()
    previous_path = repo_attach_archive(att_id, org, ts)
    if previous_path is None:
        return False
    try:
        Path(previous_path).unlink(missing_ok=True)
    except Exception:
        pass
    return True

