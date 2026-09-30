# Guía de Integración con BMC Remedy REST API

Esta guía detalla los pasos, endpoints y estructuras necesarios para autenticarse en BMC Remedy, buscar Incidentes (INC) y Órdenes de Trabajo (WO), listar sus comentarios para detectar archivos adjuntos (PDF u otros) y descargarlos.

---

## 1. Autenticación (Login)

Para interactuar con la API REST de Remedy, primero debes obtener un token JWT (JSON Web Token).

- **Endpoint:** `POST /api/jwt/login`
- **Content-Type:** `application/x-www-form-urlencoded`
- **Parámetros del Body:**
  - `username`: El usuario de Remedy.
  - `password`: La contraseña del usuario.
  - `authString`: Valor fijo `"authenticationstring"` (requerido por Remedy).
  
- **Respuesta:** Retorna el token JWT en texto plano (Content-Type: `text/plain`). Este token suele expirar en 60 minutos y debe enviarse en la cabecera `Authorization: AR-JWT <token>` en todas las solicitudes posteriores.

---

## 2. Buscar Tickets (Incidentes y Work Orders)

Los tickets en Remedy están separados en dos formularios principales:

- **Incidentes (INC):** Formulario `HPD:Help Desk`
- **Órdenes de Trabajo (WO):** Formulario `WOI:WorkOrder`

### Endpoint de Consulta
- **Endpoint:** `GET /api/arsys/v1/entry/<Formulario>`
- **Cabeceras:**
  - `Authorization: AR-JWT <token>`
  - `Accept: application/json`
- **Parámetros URL:**
  - `q`: Consulta en formato ARS.
    - Para INC: `'Incident Number'="INC000000123456"`
    - Para WO: `'Work Order ID'="WO000000123456"`
  - `fields`: Campos específicos a retornar (ejemplo: `values(Incident Number, Status, Summary)`). Si se omite, retorna la estructura básica del entry.

---

## 3. Detectar Archivos Adjuntos (PDFs)

Los adjuntos no se consultan directamente en el ticket principal, sino a través de sus bitácoras/comentarios asociados.

- **Incidentes (INC):** Se consultan en el formulario `HPD:WorkLog` filtrando por `'Incident Number'="INC..."`.
- **Órdenes de Trabajo (WO):** Se consultan en el formulario `WOI:WorkInfo` filtrando por `'Work Order ID'="WO..."`.

### Consulta de Comentarios y Adjuntos
- **Endpoint:** `GET /api/arsys/v1/entry/<Formulario_Comentarios>`
- **Parámetros URL:**
  - `q`: `'Incident Number'="INC..."` o `'Work Order ID'="WO..."`
  - `fields`: `values(Description, Detailed Description, Submit Date, Submitter, z2AF Work Log01)`

### Cómo saber si hay un PDF o archivo:
1. Recorre la lista de `entries` devueltas.
2. Revisa el campo `z2AF Work Log01` dentro de `values`. Si tiene un valor no vacío (por ejemplo, `"comprobante.pdf"`), ese registro contiene un archivo adjunto.
3. Extrae el `entry_id` de la entrada (puedes obtenerlo de la propiedad `"entryId"` o del último segmento de la URL en `_links.self[0].href`).

---

## 4. Descargar el Archivo Adjunto

Una vez identificado el `entry_id` del comentario que contiene el archivo, puedes descargarlo con el siguiente endpoint de adjuntos:

- **Endpoint:** `GET /api/arsys/v1/entry/<Formulario_Comentarios>/<entry_id>/attach/<Nombre_Campo_Adjunto>`
- **Valores:**
  - `<Formulario_Comentarios>`: `HPD:WorkLog` o `WOI:WorkInfo`
  - `<entry_id>`: El ID del comentario obtenido en el paso 3.
  - `<Nombre_Campo_Adjunto>`: `z2AF Work Log01` (nombre del campo de adjunto por defecto).
- **Cabecera:** `Authorization: AR-JWT <token>`

La respuesta de este endpoint devolverá el flujo binario del archivo junto con cabeceras como `Content-Type` y `Content-Disposition`.

---

## Código de Ejemplo en Python (Script de Integración Completo)

Puedes utilizar este ejemplo base en tu otro proyecto (usa la librería estándar `urllib` para evitar dependencias externas):

```python
import json
import urllib.parse
import urllib.request
import ssl

REMEDY_BASE_URL = "https://tu-servidor-remedy.com"  # Reemplaza con la URL base de tu entorno

def get_ssl_context():
    # Deshabilita la verificación SSL para entornos de desarrollo/QA con certs autofirmados
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

def remedy_login(username, password):
    url = f"{REMEDY_BASE_URL}/api/jwt/login"
    data = urllib.parse.urlencode({
        "username": username,
        "password": password,
        "authString": "authenticationstring"
    }).encode("utf-8")
    
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    
    try:
        with urllib.request.urlopen(req, context=get_ssl_context(), timeout=15) as resp:
            token = resp.read().decode("utf-8").strip()
            return token
    except Exception as e:
        print(f"Error en login: {e}")
        return None

def check_and_download_attachments(token, ticket_id):
    ticket_id = ticket_id.upper().strip()
    is_inc = ticket_id.startswith("INC")
    
    # 1. Definir formulario y query de bitácora
    if is_inc:
        form_name = "HPD:WorkLog"
        query = f"'Incident Number'=\"{ticket_id}\""
    else:
        form_name = "WOI:WorkInfo"
        query = f"'Work Order ID'=\"{ticket_id}\""
        
    fields = "values(Description,Detailed Description,z2AF Work Log01)"
    params = urllib.parse.urlencode({"q": query, "fields": fields}, quote_via=urllib.parse.quote)
    url = f"{REMEDY_BASE_URL}/api/arsys/v1/entry/{urllib.parse.quote(form_name)}?{params}"
    
    headers = {
        "Authorization": f"AR-JWT {token}",
        "Accept": "application/json"
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, context=get_ssl_context(), timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            entries = data.get("entries", [])
    except Exception as e:
        print(f"Error consultando comentarios: {e}")
        return
        
    print(f"Buscando adjuntos en {len(entries)} registros de bitácora para {ticket_id}...")
    
    for entry in entries:
        vals = entry.get("values", {})
        filename = vals.get("z2AF Work Log01")
        
        # Verificar si tiene algún archivo adjunto (especialmente PDF)
        if filename and filename.strip():
            print(f"-> ¡Adjunto encontrado! Archivo: {filename}")
            
            # Obtener el entryId
            entry_id = entry.get("entryId")
            if not entry_id:
                # Fallback: parsear desde los links
                self_links = entry.get("_links", {}).get("self", [])
                if self_links:
                    entry_id = self_links[0].get("href", "").rstrip("/").split("/")[-1]
            
            if not entry_id:
                print("No se pudo determinar el ID de la entrada para descargar el archivo.")
                continue
                
            # Descargar archivo
            download_attachment(token, form_name, entry_id, filename)

def download_attachment(token, form_name, entry_id, filename):
    field_name = "z2AF Work Log01"
    url = (
        f"{REMEDY_BASE_URL}/api/arsys/v1/entry/"
        f"{urllib.parse.quote(form_name)}/{urllib.parse.quote(entry_id)}/"
        f"attach/{urllib.parse.quote(field_name)}"
    )
    
    headers = {"Authorization": f"AR-JWT {token}"}
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, context=get_ssl_context(), timeout=30) as resp:
            file_data = resp.read()
            
            # Guardar el archivo en disco
            with open(filename, "wb") as f:
                f.write(file_data)
            print(f"   Archivo '{filename}' descargado exitosamente.")
    except Exception as e:
        print(f"   Error descargando '{filename}': {e}")

# --- Ejecución de prueba ---
if __name__ == "__main__":
    USER = "tu_usuario"
    PASS = "tu_password"
    TICKET = "INC000000123456"  # O "WO000000123456"
    
    token = remedy_login(USER, PASS)
    if token:
        check_and_download_attachments(token, TICKET)
```
