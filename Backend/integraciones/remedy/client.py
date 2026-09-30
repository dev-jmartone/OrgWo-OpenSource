"""
Backend/remedy/client.py

Capa de transporte HTTP para la API REST de BMC Remedy.
Este módulo SOLO se encarga de ejecutar llamadas HTTP.

Reglas:
- No importa Flask.
- No accede a la base de datos.
- No conoce lógica de negocio ni reglas de parseo.
- Toda respuesta no-2xx se propaga como excepción o se retorna como
  tupla (None/False, mensaje_de_error).
"""
import json
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request

from Backend.config import REMEDY_BASE_URL
from Backend.integraciones.remedy import mock_remedy

# Tope de llamadas concurrentes al AR Server de Remedy.
# El server de tickets (gunicorn) puede tener muchos threads sirviendo a
# varios operadores a la vez. Sin tope, todos esos threads le pegarian a
# Remedy en simultaneo y saturarian el pool de sesiones del AR Server, que
# responde evictando tokens antes de su vencimiento (TTL real 60 min). Este
# semaforo acota el pico de sesiones concurrentes; el cache de queries.py
# ademas recorta cuantas llamadas llegan hasta aca. Si el cap se queda corto,
# subirlo, pero medir antes: mas concurrencia contra Remedy = mas riesgo de
# eviction, no menos.
_REMEDY_MAX_CONCURRENCY = 8
_remedy_sem = threading.BoundedSemaphore(_REMEDY_MAX_CONCURRENCY)


# ── SSL Context ───────────────────────────────────────────────────────────────

def _make_ssl_ctx() -> ssl.SSLContext:
    """Crea un contexto SSL sin verificación de certificado.
    Necesario para entornos Remedy con certificados autofirmados.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _auth_headers(token: str) -> dict:
    return {
        "Authorization": f"AR-JWT {token}",
        "Accept":        "application/json",
        "X-AR-Client-Type": "34",
    }


def format_remedy_error(error_msg: str) -> str:
    """Parses a BMC Remedy REST error response (which can be a JSON array inside a string)
    and formats it into a beautiful, human-readable message.
    """
    if not error_msg:
        return "Error desconocido"
    
    # Check if this contains HTTP status and a body
    prefix = ""
    json_part = error_msg
    if "HTTP " in error_msg and ":" in error_msg:
        parts = error_msg.split(":", 1)
        prefix = parts[0].strip() + ": "
        json_part = parts[1].strip()
        
    try:
        data = json.loads(json_part)
        if isinstance(data, list):
            msgs = []
            for item in data:
                text = item.get("messageText")
                appended = item.get("messageAppendedText")
                if text:
                    msg = text
                    if appended:
                        msg += f" ({appended})"
                    msgs.append(msg)
            if msgs:
                return prefix + " | ".join(msgs)
        elif isinstance(data, dict):
            text = data.get("messageText") or data.get("error") or data.get("message")
            if text:
                return prefix + text
    except Exception:
        pass
        
    return error_msg


# ── Autenticación ─────────────────────────────────────────────────────────────

def remedy_login(username: str, password: str) -> tuple[str | None, str | None]:
    """Autentica contra Remedy y devuelve el token JWT.

    Returns:
        (token, None) en éxito.
        (None, mensaje_error) en fallo.
    """
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_login(username, password)

    url  = f"{REMEDY_BASE_URL}/api/jwt/login"
    data = urllib.parse.urlencode({
        "username":   username,
        "password":   password,
        "authString": "authenticationstring",
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type":    "application/x-www-form-urlencoded",
            "X-AR-Client-Type": "34",
        },
    )

    try:
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=15) as resp:
            token = resp.read().decode("utf-8").strip()
            return token, None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else str(e)
        return None, format_remedy_error(f"HTTP {e.code}: {body}")
    except Exception as e:
        return None, str(e)


# ── GET entries ───────────────────────────────────────────────────────────────

def get_entries(
    token: str,
    form: str,
    query: str,
    fields: str,
    timeout: int = 20,
    limit: int = None,
    offset: int = None,
) -> tuple[list[dict], str | None]:
    """Consulta un formulario ARS y devuelve la lista de entries.

    Returns:
        (entries, None) en éxito.
        ([], mensaje_error) en fallo.
    """
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_get_entries(form, query, fields, limit=limit, offset=offset)

    p_dict = {"q": query, "fields": fields}
    if limit is not None:
        p_dict["limit"] = limit
    if offset is not None:
        p_dict["offset"] = offset

    params = urllib.parse.urlencode(
        p_dict,
        quote_via=urllib.parse.quote,
    )
    url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/{urllib.parse.quote(form)}?{params}"
    req = urllib.request.Request(url, headers=_auth_headers(token))

    try:
        # El semaforo acota cuantas lecturas concurrentes golpean el AR Server
        # a la vez (ver _remedy_sem). Solo envuelve la llamada de red, no el
        # parseo, para soltar el slot lo antes posible.
        with _remedy_sem:
            with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=timeout) as resp:
                raw = resp.read()
        data = json.loads(raw.decode("utf-8"))
        return data.get("entries", []), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else str(e)
        return [], format_remedy_error(f"HTTP {e.code}: {body}")
    except Exception as e:
        return [], str(e)


def get_request_id(
    token: str,
    form_name: str,
    ticket_field: str,
    ticket_value: str,
) -> tuple[str | None, dict, str | None]:
    """Obtiene el Request ID interno de Remedy (necesario para PUT) y datos extra.

    Returns:
        (request_id, extra_data_dict, None) en éxito.
        (None, {}, mensaje_error) en fallo.
    """
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_get_request_id(form_name, ticket_field, ticket_value)

    query = f"'{ticket_field}'=\"{ticket_value}\""

    if "WOI" in form_name:
        # WOI schema en este tenant no expone Support Company.
        # Necesitamos: Request ID + Status (para saltear PUT si ya esta
        # cerrado manualmente) + Support Group Name / Support Group ID
        # (requeridos por el take para asignar el ticket al grupo correcto)
        # + campos de cliente para identificacion.
        fields = "values(Request ID,Status,Support Group Name,Support Group ID,Customer First Name,Customer Last Name,Company,Categorization Tier 1,Categorization Tier 2,Categorization Tier 3,Summary,Detailed Description)"
    else:
        fields = "values(Request ID,Status,Assigned Support Company,Assigned Support Organization,Assigned Group,Assigned Group ID,ServiceCI,ServiceCI_ReconID,Company,First Name,Last Name,Categorization Tier 1,Categorization Tier 2,Categorization Tier 3,Description,Detailed Decription)"

    entries, err = get_entries(token, form_name, query, fields, timeout=15)
    if err:
        return None, {}, err

    if not entries:
        return None, {}, "No entry found"

    vals      = entries[0].get("values", {})
    extra     = dict(vals)
    req_id    = vals.get("Request ID") or entries[0].get("entryId")

    if req_id:
        return req_id, extra, None
    return None, extra, "No Request ID in response"


def get_ci_recon_id(token: str, ci_name: str) -> str | None:
    """Obtiene el Reconciliation Identity de un Service CI por su nombre de forma dinámica."""
    if mock_remedy.is_mock_mode():
        return "OI-CBF380FFF08542C29A2A3A766A091409"

    if not token or not ci_name:
        return None
    
    global _client_recon_id_cache
    if "_client_recon_id_cache" not in globals():
        _client_recon_id_cache = {}
        
    if ci_name in _client_recon_id_cache:
        return _client_recon_id_cache[ci_name]

    # Intentar AST:BusinessService con CI Name
    try:
        q = f"'CI Name'=\"{ci_name}\""
        entries, err = get_entries(token, "AST:BusinessService", q, "values(Reconciliation Identity)", limit=1)
        if not err and entries:
            recon = entries[0].get("values", {}).get("Reconciliation Identity")
            if recon:
                _client_recon_id_cache[ci_name] = recon
                return recon
    except Exception:
        pass

    # Intentar AST:BusinessService con Name
    try:
        q = f"'Name'=\"{ci_name}\""
        entries, err = get_entries(token, "AST:BusinessService", q, "values(Reconciliation Identity)", limit=1)
        if not err and entries:
            recon = entries[0].get("values", {}).get("Reconciliation Identity")
            if recon:
                _client_recon_id_cache[ci_name] = recon
                return recon
    except Exception:
        pass

    # Intentar BMC.CORE:BMC_BusinessService
    try:
        q = f"'Name'=\"{ci_name}\""
        entries, err = get_entries(token, "BMC.CORE:BMC_BusinessService", q, "values(ReconciliationIdentity)", limit=1)
        if not err and entries:
            recon = entries[0].get("values", {}).get("ReconciliationIdentity")
            if recon:
                _client_recon_id_cache[ci_name] = recon
                return recon
    except Exception:
        pass

    return None


# ── PUT entry ─────────────────────────────────────────────────────────────────

def put_entry(
    token: str,
    form_name: str,
    request_id: str,
    payload: dict,
) -> tuple[bool, str | None]:
    """Actualiza una entrada existente en Remedy vía PUT.

    Returns:
        (True, None) en éxito.
        (False, mensaje_error) en fallo.
    """
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_put_entry(form_name, request_id, payload)

    url = (
        f"{REMEDY_BASE_URL}/api/arsys/v1/entry/"
        f"{urllib.parse.quote(form_name)}/{urllib.parse.quote(request_id)}"
    )
    # Aceptar payload con o sin envoltura "values"
    body_dict = payload if "values" in payload else {"values": payload}
    body      = json.dumps(body_dict).encode("utf-8")
    headers   = {**_auth_headers(token), "Content-Type": "application/json"}

    req = urllib.request.Request(url, data=body, method="PUT", headers=headers)
    try:
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=20):
            return True, None
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="ignore")
        print(f"[remedy.client] PUT {form_name}/{request_id} -> HTTP {e.code}: {body_err}")
        return False, format_remedy_error(f"HTTP {e.code}: {body_err}")
    except Exception as e:
        print(f"[remedy.client] PUT {form_name}/{request_id} -> {type(e).__name__}: {e}")
        return False, str(e)


# ── POST entry ────────────────────────────────────────────────────────────────

def post_entry(
    token: str,
    form_name: str,
    payload: dict,
) -> tuple[bool, str | None]:
    """Crea una nueva entrada en Remedy vía POST.

    Returns:
        (True, None) en éxito.
        (False, mensaje_error) en fallo.
    """
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_post_entry(form_name, payload)

    url     = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/{urllib.parse.quote(form_name)}"
    body    = json.dumps({"values": payload}).encode("utf-8")
    headers = {**_auth_headers(token), "Content-Type": "application/json"}

    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=20):
            return True, None
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="ignore")
        print(f"[remedy.client] POST {form_name} -> HTTP {e.code}: {body_err}")
        return False, format_remedy_error(f"HTTP {e.code}: {body_err}")
    except Exception as e:
        print(f"[remedy.client] POST {form_name} -> {type(e).__name__}: {e}")
        return False, str(e)


# ── Helpers de alto nivel ─────────────────────────────────────────────────────

def post_worklog(
    token: str,
    ticket_type: str,
    ticket_id: str,
    text: str,
) -> tuple[bool, str | None]:
    """Crea una entrada de WorkLog (INC) o WorkInfo (WO) vinculada al ticket."""
    desc = (text or "").strip()[:99]
    if not desc:
        desc = "Nota interna de cambio de estado"
    if ticket_type == "WO":
        form_name = "WOI:WorkInfo"
        payload   = {
            "Work Order ID":              ticket_id,
            "Description":               desc,
            "Detailed Description":       text,
            "Work Log Type":              "General Information",
            "Secure Work Log":            "No",
            "View Access":                "Internal",
            "z1D Action":                 "CREATE",
        }
    else:
        form_name = "HPD:WorkLog"
        payload   = {
            "Incident Number":                ticket_id,
            "Description":                    desc,
            "Detailed Description":           text,
            "Work Log Type":                  "General Information",
            "Secure Work Log":                "No",
            "View Access":                "Internal",
            "z1D Action":                     "CREATE",
        }
    return post_entry(token, form_name, payload)


def post_worklog_with_attachment(
    token: str,
    ticket_type: str,
    ticket_id: str,
    temp_file_path: str,
    original_filename: str,
    comment: str | None = None,
) -> tuple[bool, str | None]:
    """Crea una entrada de WorkLog (INC) o WorkInfo (WO) con un archivo
    adjunto utilizando curl.exe. Si comment es non-empty, va como
    Detailed Description del worklog. Sino, default fijo."""
    import subprocess

    detailed = (comment or "").strip() or "Se entregó el equipo de reemplazo."

    url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/HPD:WorkLog"
    if ticket_type == "WO":
        url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/WOI:WorkInfo"
        # WOI:WorkInfo en este tenant usa "Work Log Type" (no "Work Info Type")
        # y el field de adjunto es "z2AF Work Log01" (no "z2AF Work Info01").
        entry_data = {
            "values": {
                "Work Order ID":         ticket_id,
                "Work Log Type":         "General Information",
                "View Access":           "Internal",
                "Secure Work Log":       "No",
                "z1D Action":            "CREATE",
                "Description":           "Archivo adjunto de resolucion",
                "Detailed Description":  detailed,
                "z2AF Work Log01":       original_filename
            }
        }
        attach_field = "attach-z2AF Work Log01"
    else:
        entry_data = {
            "values": {
                "Incident Number":       ticket_id,
                "Work Log Type":         "General Information",
                "View Access":           "Internal",
                "Secure Work Log":       "No",
                "z1D Action":            "CREATE",
                "Description":           "Archivo adjunto de resolucion",
                "Detailed Description":  detailed,
                "z2AF Work Log01":       original_filename
            }
        }
        attach_field = "attach-z2AF Work Log01"
        
    entry_json = json.dumps(entry_data)

    # Remedy multipart espera el JSON del entry como un archivo separado con
    # @<path>, no inline. Escribirlo a temp y referenciarlo.
    import tempfile as _tf
    entry_tmp = _tf.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    )
    entry_tmp.write(entry_json)
    entry_tmp.close()
    entry_tmp_path = entry_tmp.name

    # Construir comando curl
    cmd = [
        "curl",
        "-k",
        "-X", "POST",
        url,
        "-H", f"Authorization: AR-JWT {token}",
        "-F", f"entry=@{entry_tmp_path};type=application/json",
        "-F", f"{attach_field}=@{temp_file_path};type=application/octet-stream"
    ]
    
    # -w captura el HTTP code real al final del body.
    cmd.insert(1, "-w")
    cmd.insert(2, "\nHTTP_CODE:%{http_code}\n")
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            encoding="utf-8",
            errors="ignore",
            timeout=90
        )

        stdout = result.stdout or ""
        stderr = result.stderr or ""
        print(f"[remedy.client] curl POST attach -> exit={result.returncode}")
        print(f"[remedy.client] stdout: {stdout!r}")
        print(f"[remedy.client] stderr (last 400 chars): {stderr[-400:]!r}")
        http_code = None
        for line in stdout.splitlines():
            if line.startswith("HTTP_CODE:"):
                http_code = line.split(":", 1)[1].strip()
                break
        if result.returncode != 0:
            return False, f"cURL error ({result.returncode}): {stderr[-300:]}"
        if http_code and not http_code.startswith("2"):
            return False, f"HTTP {http_code} en POST attach. body: {stdout[:500]}"
        return True, None
    except Exception as e:
        return False, str(e)
    finally:
        try:
            import os as _os
            _os.unlink(entry_tmp_path)
        except Exception:
            pass


def fetch_user_fullname(token: str, username: str) -> str | None:
    """Obtiene el Full Name del usuario desde CTM:People."""
    if mock_remedy.is_mock_mode():
        details = mock_remedy.mock_fetch_user_details(username)
        return details.get("full_name")

    import ssl as _ssl
    import urllib.request as _req_mod

    query  = f"'Remedy Login ID'=\"{username}\""
    fields = "values(Full Name)"
    params = urllib.parse.urlencode({"q": query, "fields": fields}, quote_via=urllib.parse.quote)
    url    = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/CTM:People?{params}"

    req = urllib.request.Request(url, headers=_auth_headers(token))
    try:
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            entries = data.get("entries", [])
            if entries:
                return entries[0].get("values", {}).get("Full Name")
    except Exception as e:
        print(f"[remedy.client] fetch_user_fullname error: {e}")
    return None


def fetch_user_details(token: str, username: str) -> dict | None:
    """Obtiene detalles (First Name, Last Name, Company, Full Name) del usuario desde CTM:People."""
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_fetch_user_details(username)

    import ssl as _ssl
    import urllib.request as _req_mod

    query  = f"'Remedy Login ID'=\"{username}\""
    fields = "values(First Name, Last Name, Company, Full Name)"
    params = urllib.parse.urlencode({"q": query, "fields": fields}, quote_via=urllib.parse.quote)
    url    = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/CTM:People?{params}"

    req = urllib.request.Request(url, headers=_auth_headers(token))
    try:
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            entries = data.get("entries", [])
            if entries:
                vals = entries[0].get("values", {})
                return {
                    "first_name": vals.get("First Name"),
                    "last_name": vals.get("Last Name"),
                    "company": vals.get("Company"),
                    "full_name": vals.get("Full Name"),
                }
    except Exception as e:
        print(f"[remedy.client] fetch_user_details error: {e}")
    return None


def lookup_remedy_user_email(token: str, name: str) -> str | None:
    """Busca el email de un usuario en Remedy CTM:People por su nombre completo."""
    if mock_remedy.is_mock_mode():
        user = mock_remedy.mock_fetch_user_by_email(name)
        if user:
            return f"{user['username']}@empresa.com"
        clean = (name or "usuario").lower().strip().replace(" ", ".")
        return f"{clean}@empresa.com"

    import urllib.parse
    from Backend.utils import is_valid_corporate_email
    clean_name = (name or "").strip()
    if not clean_name:
        return None
        
    query = f"'Full Name'=\"{clean_name}\""
    fields = "values(Internet E-mail)"
    
    params = urllib.parse.urlencode({"q": query, "fields": fields}, quote_via=urllib.parse.quote)
    url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/CTM:People?{params}"
    
    req = urllib.request.Request(url, headers=_auth_headers(token))
    try:
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            entries = data.get("entries", [])
            if entries:
                vals = entries[0].get("values", {})
                email = vals.get("Internet E-mail")
                if email:
                    if is_valid_corporate_email(email):
                        return email
                    else:
                        print(f"[remedy.client] descartando email de dominio invalido en exact match: {email}")
    except Exception as e:
        print(f"[remedy.client] lookup_remedy_user_email error: {e}")
        
    # Fallback fuzzy search: First Name y Last Name
    words = clean_name.split()
    if len(words) >= 2:
        first = words[0]
        last = words[-1]
        query = f"'First Name' LIKE \"{first}%\" AND 'Last Name' LIKE \"{last}%\""
        params = urllib.parse.urlencode({"q": query, "fields": fields}, quote_via=urllib.parse.quote)
        url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/CTM:People?{params}"
        req = urllib.request.Request(url, headers=_auth_headers(token))
        try:
            with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                entries = data.get("entries", [])
                if entries:
                    vals = entries[0].get("values", {})
                    email = vals.get("Internet E-mail")
                    if email:
                        if is_valid_corporate_email(email):
                            return email
                        else:
                            print(f"[remedy.client] descartando email de dominio invalido en fuzzy match: {email}")
        except Exception:
            pass
            
    return None


def fetch_user_groups(token: str, username: str) -> dict:
    """Obtiene los grupos de soporte habilitados del usuario en Remedy.

    Retorna un diccionario:
    {
        "groups": ["CTU DT", "TECNOLOGIA CELULARES", "TECNOLOGIA USUARIOS DT"],
        "default_group": "CTU DT"
    }
    """
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_fetch_user_groups(username)

    query = f"'Login ID'=\"{username}\" AND 'Status'=\"Enabled\""
    fields = "values(Support Group ID, Default)"

    # Mapeo preestablecido de los grupos core del tracker para evitar consultas extra
    group_mapping = {
        "SGP000000005909": "CTU DT",
        "SGP000000005609": "TECNOLOGIA CELULARES",
        "SGP000000003810": "TECNOLOGIA USUARIOS DT",
    }

    entries, err = get_entries(token, "CTM:Support Group Association", query, fields, timeout=10)
    if err or not entries:
        # Fallback a un grupo genérico válido si no se puede consultar
        return {
            "groups": ["TECNOLOGIA USUARIOS DT"],
            "default_group": "TECNOLOGIA USUARIOS DT"
        }

    user_groups = []
    default_group = None

    for entry in entries:
        vals = entry.get("values", {})
        group_id = vals.get("Support Group ID")
        is_default = vals.get("Default") == "Yes"

        group_name = group_mapping.get(group_id)
        if group_name:
            user_groups.append(group_name)
            if is_default:
                default_group = group_name

    # Si no se encontró un default de los conocidos, tomamos el primero
    if not default_group and user_groups:
        default_group = user_groups[0]

    if not user_groups:
        user_groups = ["TECNOLOGIA USUARIOS DT"]
        default_group = "TECNOLOGIA USUARIOS DT"

    return {
        "groups": user_groups,
        "default_group": default_group
    }



def create_ticket(
    token: str,
    ticket_type: str,
    payload: dict,
) -> tuple[str | None, str | None]:
    """Crea un nuevo ticket (INC o WO) en Remedy utilizando los formularios de interfaz estándar.

    Para WO: el campo Product Categorization Tier 1 no es aceptado por
    WOI:WorkOrderInterface_Create; se setea en un PUT post-creación sobre
    WOI:WorkOrder.

    Returns:
        (ticket_id, None) en éxito.
        (None, mensaje_error) en fallo.
    """
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_create_ticket(ticket_type, payload)

    if ticket_type == "WO":
        form_name = "WOI:WorkOrderInterface_Create"
        url_param = "?fields=" + urllib.parse.quote("values(WorkOrder_ID)")
        values = {
            "z1D_Action":            "CREATE",
            "Summary":               payload.get("summary"),
            "Detailed Description":  payload.get("description"),
            "Company":               payload.get("company", os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")),
            "Customer Company":      payload.get("company", os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")),
            "Location Company":      payload.get("company", os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")),
            "First Name":            payload.get("firstName"),
            "Last Name":             payload.get("lastName"),
            "Customer First Name":   payload.get("firstName"),
            "Customer Last Name":    payload.get("lastName"),
            "Status":                "Assigned",
            "Priority":              payload.get("priority", "Low"),
            # Categorización operacional (espacios, no guiones bajos)
            "Categorization Tier 1": payload.get("op_tier_1"),
            "Categorization Tier 2": payload.get("op_tier_2"),
            "Categorization Tier 3": payload.get("op_tier_3"),
            # NOTA: "Product Categorization Tier 1" NO es aceptado por el
            # formulario de interfaz WOI:WorkOrderInterface_Create.
            # Se setea en un PUT posterior sobre WOI:WorkOrder.
        }
        id_field = "WorkOrder_ID"

    else:
        form_name = "HPD:IncidentInterface_Create"
        url_param = "?fields=" + urllib.parse.quote("values(Incident Number)")
        
        service_ci = payload.get("service_ci")
        if not service_ci:
            service_ci = "Usuarios Subsidiaria" if "subsidiaria" in str(payload.get("company", "")).lower() else "Usuarios Empresa"
            
        service_recon = payload.get("service_recon_id")
        if not service_recon:
            if service_ci == "Usuarios Empresa":
                service_recon = "OI-CBF380FFF08542C29A2A3A766A091409"
            else:
                service_recon = get_ci_recon_id(token, service_ci)
                
        raw_values = {
            "z1D_Action":                    "CREATE",
            "First_Name":                    payload.get("firstName"),
            "Last_Name":                     payload.get("lastName"),
            "Description":                   payload.get("summary"),
            "Detailed_Decription":           payload.get("description"),
            "Impact":                        payload.get("impact", "4-Minor/Localized"),
            "Urgency":                       payload.get("urgency", "4-Low"),
            "Status":                        "Assigned",
            "Reported Source":               "Direct Input",
            "Service_Type":                  "User Service Restoration",
            "Company":                       payload.get("company", os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")),
            "ServiceCI":                     service_ci,
            "ServiceCI_ReconID":             service_recon,
            "Login_ID":                      payload.get("username"),
            "Categorization Tier 1":         payload.get("op_tier_1"),
            "Categorization Tier 2":         payload.get("op_tier_2"),
            "Categorization Tier 3":         payload.get("op_tier_3"),
            "Product Categorization Tier 1": "Service",
        }
        values = {k: v for k, v in raw_values.items() if v is not None}
        id_field = "Incident Number"

    print(f"[remedy.client] Enviando payload de creacion a Remedy ({ticket_type}):")
    print(f"  Summary:               '{values.get('Summary') or values.get('Description')}'")
    print(f"  Categorization Tier 1: '{values.get('Categorization Tier 1')}'")
    print(f"  Categorization Tier 2: '{values.get('Categorization Tier 2')}'")
    print(f"  Categorization Tier 3: '{values.get('Categorization Tier 3')}'")

    url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/{urllib.parse.quote(form_name)}{url_param}"
    body = json.dumps({"values": values}).encode("utf-8")
    headers = {**_auth_headers(token), "Content-Type": "application/json"}

    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=25) as resp:
            resp_body = resp.read().decode("utf-8")
            created_id = None
            if resp_body:
                data = json.loads(resp_body)
                created_id = data.get("values", {}).get(id_field)
            if not created_id:
                loc = resp.headers.get("Location")
                if loc:
                    created_id = loc.split("/")[-1]
            if not created_id:
                created_id = "Creado"

            # ── Post-creación WO: setear Product Categorization Tier 1 ──
            # El formulario de interfaz WOI:WorkOrderInterface_Create no acepta
            # este campo, así que se actualiza sobre WOI:WorkOrder post-creación.
            if ticket_type == "WO" and created_id and created_id != "Creado":
                _patch_wo_product_category(token, created_id)

            return created_id, None

    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else str(e)
        return None, format_remedy_error(f"HTTP {e.code}: {body_err}")
    except Exception as e:
        return None, str(e)


def _patch_wo_product_category(token: str, wo_id: str) -> None:
    """Setea Product Categorization Tier 1 = 'Service' en un WO ya creado.

    WOI:WorkOrderInterface_Create no acepta este campo en el POST inicial,
    por lo que se hace un PUT posterior sobre WOI:WorkOrder.
    Los errores se loguean pero NO se propagan (la creacion ya fue exitosa).
    El usuario logueado debe tener permisos de modificacion sobre el WO
    (miembro del grupo Request Manager o Request Assignee).
    """
    try:
        query  = f"'Work Order ID'=\"{wo_id}\""
        fields = "values(Request ID)"
        entries, err = get_entries(token, "WOI:WorkOrder", query, fields, timeout=15)
        if err or not entries:
            print(f"[remedy.client] _patch_wo_product_category: no entries para {wo_id}: {err}")
            return

        req_id = entries[0].get("values", {}).get("Request ID") or entries[0].get("entryId")
        if not req_id:
            print(f"[remedy.client] _patch_wo_product_category: no req_id en {wo_id}")
            return

        ok, put_err = put_entry(token, "WOI:WorkOrder", req_id, {
            "Product Categorization Tier 1": "Service",
        })
        if ok:
            print(f"[remedy.client] Product Categorization Tier 1='Service' seteado en {wo_id}")
        else:
            print(f"[remedy.client] _patch_wo_product_category {wo_id} WARN: {put_err}")
    except Exception as ex:
        print(f"[remedy.client] _patch_wo_product_category {wo_id} EXCEPTION: {ex}")


def fetch_remedy_user_by_email(token: str, email: str) -> dict | None:
    """Busca un usuario en CTM:People por su email y retorna su Login ID y Full Name."""
    if mock_remedy.is_mock_mode():
        return mock_remedy.mock_fetch_user_by_email(email)

    import urllib.parse
    import urllib.request
    query  = f"'Internet E-mail'=\"{email}\""
    fields = "values(Remedy Login ID, Full Name)"
    params = urllib.parse.urlencode({"q": query, "fields": fields}, quote_via=urllib.parse.quote)
    url    = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/CTM:People?{params}"

    req = urllib.request.Request(url, headers=_auth_headers(token))
    try:
        with urllib.request.urlopen(req, context=_make_ssl_ctx(), timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            entries = data.get("entries", [])
            if entries:
                vals = entries[0].get("values", {})
                return {
                    "username": vals.get("Remedy Login ID"),
                    "full_name": vals.get("Full Name"),
                }
    except Exception as e:
        print(f"[remedy.client] fetch_remedy_user_by_email error: {e}")
    return None

