"""Rutas del módulo de estadísticas de grupos Remedy (Exclusivo Administradores).

Endpoints REST para:
  - Consulta de métricas agregadas por grupo, período, estado y tipología.
  - Estadísticas específicas y anónimas de tickets de JARVIS CHATBOT (Empresa Principal vs. Subsidiaria).
  - Control de sincronización fragmentada en segundo plano para evitar saturar WebCenter.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, session, Response

from Backend.servicios.remedy_stats import (
    get_remedy_group_stats,
    get_remedy_company_report,
    get_remedy_report_tickets_detail,
    generate_remedy_report_csv,
    start_remedy_stats_sync,
    get_sync_status,
    request_sync_cancel,
    resolve_unidentified_tickets_gal,
    REMEDY_ASSIGNED_GROUPS,
)
from Backend.servicios.excel_report import build_remedy_report_excel
from Backend.base_datos.connection import get_db

admin_stats_bp = Blueprint("admin_stats", __name__)


def _is_admin() -> bool:
    """Verifica si el usuario autenticado tiene rol de administrador (dispatcher)."""
    user_id = session.get("user_id")
    role_id = session.get("role_id")
    role = (session.get("role") or "").lower()
    return bool(user_id and (role_id == 2 or role == "dispatcher"))


@admin_stats_bp.before_request
def _enforce_admin():
    """Protección estricta: bloquea cualquier request no administrativo con HTTP 403."""
    if not _is_admin():
        return jsonify({
            "error": "Acceso restringido: este módulo es exclusivo para administradores.",
            "code": "FORBIDDEN"
        }), 403


@admin_stats_bp.route("/api/admin/stats/data", methods=["GET"])
def route_get_stats_data():
    """Retorna los datos estadísticos consolidados con los filtros indicados."""
    group = request.args.get("group", "ALL")
    period = request.args.get("period", "all")
    status_filter = request.args.get("status")  # 'open', 'closed' o None
    ticket_type = request.args.get("type")      # 'INC', 'WO' o None
    month = request.args.get("month")           # 'YYYY-MM' o None

    try:
        data = get_remedy_group_stats(
            group=group if group != "ALL" else None,
            period=period,
            status_filter=status_filter,
            ticket_type=ticket_type,
            month=month,
        )
        return jsonify({"ok": True, "data": data, "configured_groups": REMEDY_ASSIGNED_GROUPS})
    except Exception as e:
        print(f"[admin_stats_routes] Error obteniendo estadísticas: {e}")
        return jsonify({"error": f"Error al calcular estadísticas: {str(e)}"}), 500


@admin_stats_bp.route("/api/admin/stats/report", methods=["GET"])
def route_get_company_report():
    """Genera el reporte por empresa (Empresa Principal vs. Subsidiaria) con tipificaciones y dominios."""
    company = request.args.get("company", "all")
    month = request.args.get("month")
    period = request.args.get("period", "all")
    group = request.args.get("group", "ALL")
    ticket_type = request.args.get("type")
    status_filter = request.args.get("status")
    origin = request.args.get("origin", "all")

    try:
        data = get_remedy_company_report(
            company_filter=company,
            month=month,
            period=period,
            group=group if group != "ALL" else None,
            ticket_type=ticket_type,
            status_filter=status_filter,
            origin=origin,
        )
        return jsonify({"ok": True, "report": data})
    except Exception as e:
        print(f"[admin_stats_routes] Error generando reporte por empresa: {e}")
        return jsonify({"error": f"Error al generar reporte: {str(e)}"}), 500


@admin_stats_bp.route("/api/admin/stats/report/csv", methods=["GET"])
def route_export_company_report_csv():
    """Descarga el reporte por empresa en formato CSV con codificación Excel en español."""
    company = request.args.get("company", "all")
    month = request.args.get("month")
    period = request.args.get("period", "all")
    group = request.args.get("group", "ALL")
    ticket_type = request.args.get("type")
    status_filter = request.args.get("status")
    origin = request.args.get("origin", "all")

    try:
        data = get_remedy_company_report(
            company_filter=company,
            month=month,
            period=period,
            group=group if group != "ALL" else None,
            ticket_type=ticket_type,
            status_filter=status_filter,
            origin=origin,
        )
        csv_content = generate_remedy_report_csv(data)

        clean_comp = company.replace(" ", "_").upper()
        clean_month = month if (month and month != "all") else "HISTORICO"
        filename = f"Reporte_Remedy_{clean_comp}_{clean_month}.csv"

        return Response(
            csv_content,
            mimetype="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        print(f"[admin_stats_routes] Error exportando reporte CSV: {e}")
        return jsonify({"error": f"Error al exportar reporte: {str(e)}"}), 500


@admin_stats_bp.route("/api/admin/stats/report/excel", methods=["GET"])
def route_export_company_report_excel():
    """Descarga el reporte por empresa en formato Excel (.xlsx) nativo estructurado por libros/hojas."""
    company = request.args.get("company", "all")
    month = request.args.get("month")
    period = request.args.get("period", "all")
    group = request.args.get("group", "ALL")
    ticket_type = request.args.get("type")
    status_filter = request.args.get("status")
    origin = request.args.get("origin", "all")

    try:
        data = get_remedy_company_report(
            company_filter=company,
            month=month,
            period=period,
            group=group if group != "ALL" else None,
            ticket_type=ticket_type,
            status_filter=status_filter,
            origin=origin,
        )

        detailed_tickets = get_remedy_report_tickets_detail(
            company_filter=company,
            month=month,
            period=period,
            group=group if group != "ALL" else None,
            ticket_type=ticket_type,
            status_filter=status_filter,
            origin=origin,
        )

        excel_bytes = build_remedy_report_excel(data, detailed_tickets)

        clean_comp = company.replace(" ", "_").upper()
        clean_month = month if (month and month != "all") else "HISTORICO"
        filename = f"Reporte_Remedy_{clean_comp}_{clean_month}.xlsx"

        return Response(
            excel_bytes,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        print(f"[admin_stats_routes] Error exportando reporte Excel (.xlsx): {e}")
        return jsonify({"error": f"Error al exportar reporte Excel: {str(e)}"}), 500


@admin_stats_bp.route("/api/admin/stats/sync/start", methods=["POST"])
def route_start_sync():
    """Inicia la extracción fragmentada de tickets desde WebCenter en background."""
    if "remedy_token" not in session:
        return jsonify({
            "error": "No hay una sesión activa de Remedy. Por favor conectate a Remedy desde la barra superior antes de sincronizar.",
            "remedy_required": True
        }), 401

    token = session["remedy_token"]
    user_id = session["user_id"]

    body = request.get_json(silent=True) or {}
    days_back = body.get("days_back")
    if days_back is not None:
        try:
            days_back = int(days_back)
            if days_back <= 0:
                days_back = None
        except ValueError:
            days_back = 30
    else:
        days_back = 30  # Default 30 días para sincronización inicial rápida

    include_closed = bool(body.get("include_closed", True))
    groups = body.get("groups") or REMEDY_ASSIGNED_GROUPS

    ok, msg = start_remedy_stats_sync(
        user_id=user_id,
        token=token,
        days_back=days_back,
        include_closed=include_closed,
        groups=groups,
    )

    if not ok:
        return jsonify({"error": msg}), 409

    return jsonify({"ok": True, "message": msg})


@admin_stats_bp.route("/api/admin/stats/sync/status", methods=["GET"])
def route_sync_status():
    """Devuelve el progreso en vivo de la sincronización fragmentada."""
    status = get_sync_status()
    return jsonify(status)


@admin_stats_bp.route("/api/admin/stats/sync/cancel", methods=["POST"])
def route_sync_cancel():
    """Detiene la sincronización en curso de forma segura."""
    res = request_sync_cancel()
    return jsonify(res)


@admin_stats_bp.route("/api/admin/stats/resolve-gal", methods=["POST"])
def route_resolve_gal():
    """Ejecuta la resolución de usuarios no identificados mediante Outlook GAL."""
    if not _is_admin():
        return jsonify({"error": "Acceso denegado: solo administradores"}), 403

    try:
        res = resolve_unidentified_tickets_gal()
        return jsonify(res)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@admin_stats_bp.route("/api/admin/stats/clear", methods=["POST"])
def route_clear_stats():
    """Limpia la base local de tickets cacheados de los grupos."""
    try:
        with get_db() as db:
            db.execute("DELETE FROM remedy_group_tickets")
            db.execute("DELETE FROM remedy_group_sync_status")
            db.commit()
        return jsonify({"ok": True, "message": "Datos de estadísticas limpiados correctamente"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
