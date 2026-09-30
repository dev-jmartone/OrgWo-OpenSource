"""Renovacion silenciosa del token de Remedy.

Guarda las credenciales de Remedy del operador EN MEMORIA del proceso
(nunca en la cookie firmada ni en disco) para poder re-loguear de forma
transparente cuando el token JWT esta por vencer.

Modelo de deploy: cada operador corre el server en su propia PC sobre
localhost. El dict vive solo en ese proceso, muere al reiniciar el server
y nunca sale de la maquina. Por eso es aceptable retener la password aca y
NO en la sesion Flask (que es una cookie firmada pero legible).

No importa Flask. La capa de routes pasa el user_id del tracker y actualiza
la sesion con el token nuevo.
"""
import threading

from Backend.integraciones.remedy import client

# user_id (tracker) -> (remedy_username, remedy_password)
_CREDS: dict[str, tuple[str, str]] = {}
_lock = threading.Lock()


def store_creds(user_id: str, remedy_username: str, password: str) -> None:
    """Retiene las credenciales Remedy del operador para renovacion automatica."""
    if not user_id or not remedy_username or not password:
        return
    with _lock:
        _CREDS[user_id] = (remedy_username, password)


def clear_creds(user_id: str) -> None:
    """Olvida las credenciales (logout de Remedy o del tracker)."""
    with _lock:
        _CREDS.pop(user_id, None)


def has_creds(user_id: str) -> bool:
    with _lock:
        return user_id in _CREDS


def get_active_user_ids() -> list[str]:
    """Retorna una lista con los IDs de usuarios con credenciales activas, de forma thread-safe."""
    with _lock:
        return list(_CREDS.keys())


def renew(user_id: str) -> tuple[str | None, str | None]:
    """Re-loguea a Remedy con las credenciales retenidas y devuelve un token nuevo.

    Returns:
        (token, None) en exito.
        (None, mensaje_error) si no hay credenciales o el login fallo.
    """
    with _lock:
        creds = _CREDS.get(user_id)
    if not creds:
        return None, "Sin credenciales retenidas para renovar"

    username, password = creds
    token, err = client.remedy_login(username, password)
    if err or not token:
        # Credenciales ya no validas (cambio de password, cuenta bloqueada):
        # descartarlas para no reintentar en loop.
        clear_creds(user_id)
        return None, err or "Login de renovacion fallo"
    return token, None
