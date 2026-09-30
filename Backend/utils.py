import re
import hashlib
import secrets
from datetime import datetime, timezone
from flask import session

from werkzeug.security import generate_password_hash, check_password_hash

def hash_password(password: str) -> str:
    return generate_password_hash(password)

def check_password(password: str, hashed: str) -> bool:
    if hashed.startswith("scrypt:") or hashed.startswith("pbkdf2:"):
        return check_password_hash(hashed, password)
    # Fallback to bare sha256 for legacy accounts
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest() == hashed

def current_user_id() -> str:
    return session.get("user_id", "local")

def current_user_org() -> str:
    return session.get("organization", "local")

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id() -> str:
    return "c_" + secrets.token_urlsafe(8)[:10]

import os

_COMPANY_PATTERNS: list[tuple[str, str]] = [
    ("serv.externos",        "Externos"),
    ("externos",             "Externos"),
    ("empresa",              "Empresa Principal"),
    ("subsidiaria",          "Subsidiaria"),
    ("corporativo",          "Corporativo"),
    ("tech",                 "Tecnologia"),
    ("demo",                 "Empresa Demo"),
]

def parse_company_from_email(email: str) -> str | None:
    if not email or "@" not in email:
        return None
    domain = email.split("@", 1)[1].lower().strip()
    for needle, company in _COMPANY_PATTERNS:
        if needle in domain:
            return company
    # Extraer nombre amigable del dominio si no está mapeado
    try:
        parts = domain.split(".")
        if len(parts) >= 2:
            return parts[-2].capitalize()
    except Exception:
        pass
    return "Corporativo"


def is_valid_corporate_email(email: str) -> bool:
    """Valida formato de correo y verifica dominios permitidos (si están configurados)."""
    if not email or "@" not in email:
        return False
    domain = email.split("@", 1)[1].lower().strip()
    allowed = os.environ.get("ALLOWED_EMAIL_DOMAINS", "").strip()
    if allowed:
        keywords = [k.strip().lower() for k in allowed.split(",") if k.strip()]
        return any(k in domain for k in keywords)
    # Por defecto, validación sintáctica estándar
    import re
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))



import threading
import queue
from typing import List

event_listeners: List[queue.Queue] = []
event_listeners_lock = threading.Lock()

def announce_event(event_name: str) -> None:
    with event_listeners_lock:
        queues = list(event_listeners)
    for q in queues:
        q.put(event_name)


def log_action(action: str, details: str = None) -> None:
    from flask import request, session
    from Backend.base_datos.connection import get_db
    try:
        user_id = session.get("user_id", "system")
        username = session.get("username", "system")
        ip = "127.0.0.1"
        try:
            if request:
                ip = request.headers.get("X-Forwarded-For", request.remote_addr) or request.remote_addr
        except RuntimeError:
            pass  # Fuera de contexto de request
        with get_db() as db:
            db.execute(
                "INSERT INTO audit_logs (user_id, username, action, details, ip, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, username, action, details, ip, now_iso())
            )
    except Exception as e:
        print(f"[log_action] error: {e}")


# Registro global de actividad de usuarios (en memoria) para ver quiénes están en línea
online_users = {}
online_users_lock = threading.Lock()

def record_user_activity(username: str, ip: str) -> None:
    with online_users_lock:
        online_users[username.lower().strip()] = {
            "last_seen": now_iso(),
            "ip": ip
        }


traffic_telemetry = {
    "requests_total": 0,
    "status_codes": {},
    "paths": {}
}
traffic_lock = threading.Lock()

import logging
from collections import deque

class MemoryLogHandler(logging.Handler):
    def __init__(self, capacity=100):
        super().__init__()
        self.log_queue = deque(maxlen=capacity)
    def emit(self, record):
        try:
            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "level": record.levelname,
                "message": self.format(record),
                "logger": record.name
            }
            self.log_queue.append(log_entry)
        except Exception:
            pass

memory_log_handler = MemoryLogHandler()
memory_log_handler.setLevel(logging.WARNING)
memory_log_handler.setFormatter(logging.Formatter('%(message)s'))
logging.getLogger().addHandler(memory_log_handler)


# ── Nombres y Parseo de Meses en Español ───────────────────────────────────────
SPANISH_MONTHS = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
]


def format_month_label(month_key: str | None) -> str:
    """Convierte una clave 'YYYY-MM' al formato legible 'NombreMes AAAA'.

    Ejemplo:
        '2026-01' -> 'Enero 2026'
        '2025-11' -> 'Noviembre 2025'
    """
    if not month_key:
        return ""
    try:
        parts = str(month_key).strip().split("-")
        if len(parts) >= 2:
            y = int(parts[0])
            m = int(parts[1])
            if 1 <= m <= 12:
                return f"{SPANISH_MONTHS[m]} {y}"
    except Exception:
        pass
    return str(month_key)


def parse_submit_month(date_val: str | int | float | None) -> tuple[str, str] | None:
    """Extrae (clave_mes, label_mes) de una fecha de ticket Remedy.

    Maneja con tolerancia:
      - Fechas ISO: '2026-01-15T14:30:00.000+0000' -> ('2026-01', 'Enero 2026')
      - Formato YYYY-MM: '2026-02' -> ('2026-02', 'Febrero 2026')
      - Timestamps Epoch en segundos: '1736942400' -> ('2025-01', 'Enero 2025')
      - Timestamps Epoch en milisegundos: '1736942400000' -> ('2025-01', 'Enero 2025')
      - Formatos regionales: '15/01/2026' -> ('2026-01', 'Enero 2026')

    Returns:
        Tupla ('YYYY-MM', 'Mes YYYY') o None si no es válida.
    """
    if not date_val:
        return None
    s = str(date_val).strip()
    if not s or s.lower() in ("null", "none", "0"):
        return None

    dt = None

    # 1. Si es puramente numérico (Epoch timestamp en segundos o ms)
    if s.isdigit():
        try:
            num = int(s)
            if num > 100000000000:  # Epoch en milisegundos
                num = num / 1000
            if num > 0:
                dt = datetime.fromtimestamp(num, tz=timezone.utc)
        except Exception:
            pass

    # 2. Formato estándar ISO o 'YYYY-MM...'
    if not dt:
        m = re.match(r"^(\d{4})[-/](\d{1,2})", s)
        if m:
            try:
                y = int(m.group(1))
                mo = int(m.group(2))
                if 1 <= mo <= 12 and 1990 <= y <= 2100:
                    return f"{y:04d}-{mo:02d}", f"{SPANISH_MONTHS[mo]} {y}"
            except Exception:
                pass

    # 3. Formato 'DD/MM/YYYY'
    if not dt:
        m2 = re.match(r"^\d{1,2}[-/](\d{1,2})[-/](\d{4})", s)
        if m2:
            try:
                mo = int(m2.group(1))
                y = int(m2.group(2))
                if 1 <= mo <= 12 and 1990 <= y <= 2100:
                    return f"{y:04d}-{mo:02d}", f"{SPANISH_MONTHS[mo]} {y}"
            except Exception:
                pass

    # 4. Fallback ISO parser
    if not dt:
        try:
            clean_s = s.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_s)
        except Exception:
            pass

    if dt and 1 <= dt.month <= 12:
        return f"{dt.year:04d}-{dt.month:02d}", f"{SPANISH_MONTHS[dt.month]} {dt.year}"

    return None

