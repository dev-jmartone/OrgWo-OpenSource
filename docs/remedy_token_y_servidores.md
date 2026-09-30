# Información de Servidores y Renovación de Token — BMC Remedy

Este documento detalla las URLs oficiales de los servidores de Remedy de la organización y la estrategia técnica recomendada para la renovación del token JWT.

---

## 1. URLs de Servidores BMC Remedy

Dependiendo del entorno de ejecución, debes configurar la URL base adecuada:

- **Entorno de Producción (PROD):**
  `https://remedy.yourcompany.com`

- **Entorno de Pruebas / Calidad (QA):**
  `https://remedy-qa.yourcompany.com`

---

## 2. Estrategia de Renovación del Token JWT

BMC Remedy **no cuenta con un endpoint nativo de refresco** (ej. `refresh_token`). La renovación del token JWT se realiza mediante **re-autenticación automática** utilizando las credenciales originales del usuario.

### Mecánica de Renovación Sugerida

1. **Almacenamiento de Credenciales en Memoria:**
   Cuando el usuario inicia sesión por primera vez, guarda de manera segura las credenciales (`username` y `password`) únicamente en la memoria del proceso (evitando guardarlas en cookies legibles o persistirlas en disco).

2. **Decodificación del JWT para obtener la Expiración:**
   El token retornado por Remedy es un JWT estándar. Decodifica la parte del payload (el segundo bloque separado por puntos) usando Base64 para extraer el campo de expiración `exp` (timestamp Unix).

3. **Renovación Proactiva (Silent Renewal):**
   Antes de procesar cada petición a Remedy (o mediante un middleware/interceptor):
   - Calcula el tiempo restante: `tiempo_restante = exp - timestamp_actual`.
   - Si el `tiempo_restante` es menor a **120 segundos** (2 minutos), ejecuta silenciosamente un nuevo login (`POST /api/jwt/login`) en segundo plano con las credenciales que tienes en memoria.
   - Si la re-autenticación es exitosa, reemplaza el token actual en tu sesión. Si falla (por ejemplo, por contraseña expirada o cuenta bloqueada), limpia las credenciales y redirige al usuario a la pantalla de login.

---

## Código de Ejemplo en Python (Interceptor de Token)

```python
import base64
import json
import time
import urllib.request
import ssl

REMEDY_BASE_URL = "https://remedy-qa.yourcompany.com"  # QA por defecto

# Credenciales temporales almacenadas en memoria del proceso
_USER_CREDS = {
    "username": "tu_usuario",
    "password": "tu_password"
}

def get_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

def get_jwt_expiration(token: str) -> int:
    """Extrae el timestamp de expiración 'exp' de un token JWT."""
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return 0
        payload_b64 = parts[1]
        # Ajustar padding de base64 si es necesario
        payload_b64 += '=' * (4 - len(payload_b64) % 4)
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(payload_bytes.decode('utf-8'))
        return payload.get('exp', 0)
    except Exception:
        return 0

def remedy_login(username, password):
    url = f"{REMEDY_BASE_URL}/api/jwt/login"
    data = urllib.parse.urlencode({
        "username": username,
        "password": password,
        "authString": "authenticationstring"
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, context=get_ssl_context(), timeout=15) as resp:
            return resp.read().decode("utf-8").strip()
    except Exception as e:
        print(f"Error al loguearse en Remedy: {e}")
        return None

def get_valid_token(current_token: str) -> str:
    """Verifica si el token actual está por expirar y lo renueva si es necesario."""
    if not current_token:
        # Si no hay token, hacemos login inicial
        print("[Remedy] Login inicial...")
        return remedy_login(_USER_CREDS["username"], _USER_CREDS["password"])
        
    exp_timestamp = get_jwt_expiration(current_token)
    current_timestamp = int(time.time())
    
    # Umbral de renovación: 2 minutos (120 segundos) antes de vencer
    if exp_timestamp - current_timestamp <= 120:
        print("[Remedy] Token cercano a expirar o vencido. Renovando...")
        new_token = remedy_login(_USER_CREDS["username"], _USER_CREDS["password"])
        if new_token:
            return new_token
        else:
            print("[Remedy] Fallo en la renovación del token.")
            return current_token # Devuelve el viejo (fallará la petición con 401/403)
            
    return current_token
```
