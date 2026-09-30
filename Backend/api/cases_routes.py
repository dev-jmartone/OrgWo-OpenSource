"""Rutas Flask de cases. Thin: parsean request, llaman a servicios/cases.py.

list/create/update/delete + transfer (a otro tecnico de la org) +
list_org_users + add_event + stats. Lo de adjuntos vive en
attachments_routes.py para no inflar este modulo.
"""
from flask import Blueprint, jsonify, request, session

from Backend.utils import current_user_org, now_iso, announce_event
from Backend.servicios.cases import (
    ValidationError,
    service_list_cases,
    service_create_case,
    service_update_case,
    service_delete_case,
    service_add_event,
    service_stats,
    service_list_org_users,
    service_get_org_user,
)

cases_bp = Blueprint("cases", __name__)


@cases_bp.route("/api/cases", methods=["GET"])
def route_list_cases():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    all_cases = request.args.get("all", "false").lower() == "true"
    is_dispatcher = session.get("role_id") == 2 or (session.get("role") or "").lower() == "dispatcher"
    return jsonify(service_list_cases(all_cases=(all_cases and is_dispatcher)))


@cases_bp.route("/api/cases", methods=["POST"])
def route_create_case():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    data = request.json or {}
    try:
        created = service_create_case(data)
        announce_event("cases_updated")
    except ValidationError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(created), 201


@cases_bp.route("/api/cases/<cid>", methods=["PUT"])
def route_update_case(cid):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    data = request.json or {}
    updated = service_update_case(cid, data)
    if updated is None:
        return jsonify({"error": "not found"}), 404
    announce_event("cases_updated")
    return jsonify(updated)


@cases_bp.route("/api/cases/<cid>", methods=["DELETE"])
def route_delete_case(cid):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    service_delete_case(cid)
    announce_event("cases_updated")
    return jsonify({"ok": True})


@cases_bp.route("/api/cases/<cid>/transfer", methods=["POST"])
def route_transfer_case(cid):
    """Transfiere un case a otro tecnico de la organizacion (y en Remedy si corresponde)."""
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    data = request.json or {}
    target_user_id = data.get("target_user_id")
    if not target_user_id:
        return jsonify({"error": "target_user_id requerido"}), 400

    org = current_user_org()
    ts = now_iso()

    # Verificar que el target pertenece a la misma org
    target = service_get_org_user(target_user_id, org)

    if not target:
        return jsonify({"error": "Técnico no encontrado o de otra organización"}), 404

    # Si es un ticket de Remedy y el usuario está logueado en Remedy, transferirlo también en Remedy
    is_remedy_ticket = cid.startswith(("INC", "WO"))
    if is_remedy_ticket:
        if "remedy_token" not in session:
            return jsonify({"error": "Debes iniciar sesión en Remedy para transferir este ticket."}), 400
        
        token = session["remedy_token"]
        target_username = target["username"]
        
        from Backend.integraciones.remedy import client as remedy_api_client
        
        # 1. Obtener detalles del técnico destino (Nombre Completo)
        details = remedy_api_client.fetch_user_details(token, target_username)
        if not details:
            return jsonify({
                "error": f"No se pudo encontrar al técnico {target_username} en Remedy (CTM:People)."
            }), 404

        target_fullname = details.get("full_name")

        # 2. Obtener grupos y asociación detallada del técnico destino en Remedy
        query = f"('Login ID'=\"{target_username.lower()}\" OR 'Login ID'=\"{target_username.upper()}\") AND 'Status'=\"Enabled\""
        fields = "values(Company, Support Organization, Support Group Name, Support Group ID, Default)"
        entries, err = remedy_api_client.get_entries(token, "CTM:Support Group Association", query, fields, timeout=10)
        print(f"[transfer] CTM:Support Group Association for {target_username}: entries={entries}, err={err}")
        
        if err or not entries:
            import json, os
            try:
                with open(os.path.join("database", "transfer_debug.json"), "w", encoding="utf-8") as f:
                    json.dump({"username": target_username, "entries": entries, "err": err}, f, indent=4)
            except Exception:
                pass
            return jsonify({
                "error": f"El técnico {target_username} no tiene asociaciones de grupo activas en Remedy: {err}"
            }), 404
            
        # Buscar la asociación por defecto, o usar la primera habilitada
        association = next((x.get("values", {}) for x in entries if x.get("values", {}).get("Default") == "Yes"), None)
        if not association:
            association = entries[0].get("values", {})
            
        target_company = association.get("Company")
        target_org = association.get("Support Organization")
        target_group = association.get("Support Group Name")
        target_group_id = association.get("Support Group ID")

        # Fallback dinámico: si falta el nombre de grupo o la compañía, consultar CTM:Support Group
        if target_group_id and (not target_company or not target_group or not target_org):
            try:
                sg_query = f"'Support Group ID'=\"{target_group_id}\""
                sg_fields = "values(Company, Support Organization, Support Group Name)"
                sg_entries, sg_err = remedy_api_client.get_entries(token, "CTM:Support Group", sg_query, sg_fields, timeout=10)
                if sg_entries and not sg_err:
                    sg_vals = sg_entries[0].get("values", {})
                    if not target_company:
                        target_company = sg_vals.get("Company")
                    if not target_org:
                        target_org = sg_vals.get("Support Organization")
                    if not target_group:
                        target_group = sg_vals.get("Support Group Name")
            except Exception as ex:
                print(f"[transfer] Error al intentar consultar CTM:Support Group como fallback: {ex}")

        # Fallback estático: si siguen faltando datos del grupo, usar mapeo preestablecido
        group_name_mapping = {
            "SGP000000005909": "CTU DT",
            "SGP000000005609": "TECNOLOGIA CELULARES",
            "SGP000000003810": "TECNOLOGIA USUARIOS DT",
        }
        if not target_group and target_group_id in group_name_mapping:
            target_group = group_name_mapping[target_group_id]
        if not target_company:
            target_company = os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")
        if not target_org:
            target_org = "TECHNOLOGY & DATACENTERS"

        if not target_company or not target_group:
            import json, os
            try:
                with open(os.path.join("database", "transfer_debug.json"), "w", encoding="utf-8") as f:
                    json.dump({"username": target_username, "entries": entries, "err": err}, f, indent=4)
            except Exception:
                pass
            return jsonify({
                "error": f"La asociación de grupo para {target_username} está incompleta en Remedy."
            }), 400

        # 3. Obtener el Request ID y datos actuales del ticket
        ticket_type = "WO" if cid.startswith("WO") else "INC"
        form_name = "WOI:WorkOrder" if ticket_type == "WO" else "HPD:IncidentInterface"
        ticket_field = "Work Order ID" if ticket_type == "WO" else "Incident Number"

        req_id, extra_data, err = remedy_api_client.get_request_id(token, form_name, ticket_field, cid)
        if err:
            return jsonify({"error": f"Error al obtener Request ID del ticket: {err}"}), 500
        if not req_id:
            return jsonify({"error": "Ticket no encontrado en Remedy"}), 404

        # 4. Construir payload de transferencia con la combinación exacta válida de Remedy
        if ticket_type == "WO":
            payload = {
                "ASLOGID":               target_username,
                "Request Assignee":      target_fullname,
                "Support Group Name":    target_group,
                "Support Group ID":      target_group_id
            }
        else:
            payload = {
                "Assignee Login ID":             target_username,
                "Assignee":                      target_fullname,
                "Assigned Support Company":      target_company,
                "Assigned Support Organization": target_org,
                "Assigned Group":                target_group,
                "Assigned Group ID":             target_group_id,
            }

        # Limpiar nulos
        payload = {k: v for k, v in payload.items() if v is not None}

        # 5. Ejecutar la llamada PUT
        print(f"[transfer] Enviando PUT a {form_name}/{req_id}: {payload}")
        ok, put_err = remedy_api_client.put_entry(token, form_name, req_id, payload)
        if not ok:
            return jsonify({"error": f"Error al transferir ticket en Remedy: {put_err}"}), 500

    service_update_case(cid, {
        "ownerId": target_user_id,
        "logEvent": f"Ticket transferido a {target['name']}"
    })

    # Invalidate Remedy query cache for both sender and target user to ensure immediate dashboard updates
    from Backend.integraciones.remedy.queries import invalidate_remedy_cache
    sender_username = session.get("remedy_username")
    if sender_username:
        invalidate_remedy_cache(sender_username)
    if target["username"]:
        invalidate_remedy_cache(target["username"])

    announce_event("cases_updated")

    return jsonify({"ok": True, "transferred_to": target["name"]})


@cases_bp.route("/api/users/org", methods=["GET"])
def route_list_org_users():
    """Lista los usuarios de la misma organizacion (para transferencia)."""
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    org = session["organization"]
    current_uid = session["user_id"]
    users = service_list_org_users(org, current_uid)
    return jsonify(users)


@cases_bp.route("/api/cases/<cid>/event", methods=["POST"])
def route_add_event(cid):
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    text = ((request.json or {}).get("text") or "").strip()
    if not text:
        return jsonify({"error": "text required"}), 400
    result = service_add_event(cid, text)
    if result is None:
        return jsonify({"error": "Caso no encontrado"}), 404
    return jsonify(result)


@cases_bp.route("/api/stats", methods=["GET"])
def route_stats():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    return jsonify(service_stats())


@cases_bp.route("/api/outlook/draft", methods=["POST"])
def route_outlook_draft():
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401
    data = request.json or {}
    to_addr = data.get("to", "")
    cc_addr = data.get("cc", "")
    subject = data.get("subject", "")
    html_body = data.get("body", "")

    from Backend.integraciones.outlook.draft import open_blank_draft
    ok, err = open_blank_draft(to_addr, cc_addr, subject, html_body)
    if not ok:
        return jsonify({"error": err}), 500
    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/barcode?text=INC000001234567
# Genera un PNG Code 39 y lo devuelve. No requiere sesión — Outlook lo carga
# directamente desde http://127.0.0.1:5000 cuando muestra el draft.
# ─────────────────────────────────────────────────────────────────────────────
@cases_bp.route("/api/barcode", methods=["GET"])
def route_barcode_png():
    import io
    from PIL import Image, ImageDraw
    from flask import make_response

    raw = request.args.get("text", "").strip().upper()
    if not raw:
        return "", 400

    CODE39 = {
        '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
        '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
        '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
        'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
        'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
        'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
        'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
        'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
        'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
        '-': '010000101', '.': '110000100', ' ': '011000100', '*': '010010100',
        '$': '010101000', '/': '010100010', '+': '010001010', '%': '000101010',
    }

    # Limpiar y añadir start/stop
    clean = '*' + ''.join(c for c in raw if c in CODE39) + '*'
    if len(clean) <= 2:
        return "", 400

    narrow = 1   # px por módulo estrecho
    wide   = 2   # px por módulo ancho
    height = 18  # px altura de barra

    # Calcular ancho total
    total_width = 0
    for i, char in enumerate(clean):
        pattern = CODE39.get(char)
        if not pattern:
            continue
        for bit in pattern:
            total_width += wide if bit == '1' else narrow
        if i < len(clean) - 1:
            total_width += narrow  # inter-char gap

    # Dibujar barcode
    img  = Image.new('RGB', (total_width, height), color='white')
    draw = ImageDraw.Draw(img)
    x = 0
    for i, char in enumerate(clean):
        pattern = CODE39.get(char)
        if not pattern:
            continue
        for j, bit in enumerate(pattern):
            w = wide if bit == '1' else narrow
            if j % 2 == 0:  # posiciones pares = barras negras
                draw.rectangle([x, 0, x + w - 1, height - 1], fill='black')
            x += w
        if i < len(clean) - 1:
            x += narrow  # inter-char gap

    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    buf.seek(0)

    resp = make_response(buf.getvalue())
    resp.headers['Content-Type']  = 'image/png'
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp
