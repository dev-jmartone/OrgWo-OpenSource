import os
import secrets as _secrets
from pathlib import Path

# Base Directories
BASE_DIR = Path(__file__).parent.parent.resolve()

# ── Cargar .env si existe (desarrollo local) ──────────────────────────────────
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    with open(_env_file, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _key, _, _val = _line.partition("=")
                os.environ.setdefault(_key.strip(), _val.strip())

# ── Server ────────────────────────────────────────────────────────────────────
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 5000))

# ── Secret Key ────────────────────────────────────────────────────────────────
def _get_or_create_secret_key():
    env_key = os.environ.get("FLASK_SECRET_KEY")
    if env_key:
        return env_key
    key_file = BASE_DIR / ".flask_secret"
    if key_file.exists():
        existing = key_file.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    new_key = _secrets.token_hex(32)
    try:
        key_file.write_text(new_key, encoding="utf-8")
    except OSError:
        pass
    return new_key

SECRET_KEY = _get_or_create_secret_key()

# ── Entorno y Base de Datos ───────────────────────────────────────────────────
ENV = os.environ.get("ENV", "QA").upper()
IS_DOCKER = os.environ.get("DOCKER_ENV") == "1"
DATA_DIR = BASE_DIR / "database"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── BMC Remedy ITSM Configuration ─────────────────────────────────────────────
# URLs de endpoints configurables por variables de entorno
REMEDY_BASE_URL_PROD = os.environ.get("REMEDY_BASE_URL_PROD", "https://remedy.yourcompany.com")
REMEDY_BASE_URL_QA   = os.environ.get("REMEDY_BASE_URL_QA", "https://remedy-qa.yourcompany.com")
REMEDY_MOCK_MODE     = os.environ.get("REMEDY_MOCK_MODE", "true").lower() in ("true", "1", "yes")

if ENV == "PROD":
    DB_PATH = DATA_DIR / "data.db"
    BACKUP_DIR = BASE_DIR / "backups"
    REMEDY_BASE_URL = REMEDY_BASE_URL_PROD
else:
    DB_PATH = DATA_DIR / "data_qa.db"
    BACKUP_DIR = BASE_DIR / "backups_qa"
    REMEDY_BASE_URL = REMEDY_BASE_URL_QA

# Valores por defecto para tickets de Remedy
REMEDY_DEFAULT_COMPANY = os.environ.get("REMEDY_DEFAULT_COMPANY", "EMPRESA")
REMEDY_DEFAULT_SERVICE_CI = os.environ.get("REMEDY_DEFAULT_SERVICE_CI", "Servicios TI Corporativos")
REMEDY_DEFAULT_SERVICE_RECON_ID = os.environ.get("REMEDY_DEFAULT_SERVICE_RECON_ID", "")
REMEDY_ASSIGNED_GROUPS = [g.strip() for g in os.environ.get(
    "REMEDY_ASSIGNED_GROUPS", 
    "MESA DE AYUDA TI, SOPORTE TECNICO, COMUNICACIONES MOVILES"
).split(",") if g.strip()]

# ── Almacenamiento de Adjuntos ────────────────────────────────────────────────
ATTACH_DIR = BASE_DIR / "attachments"
ATTACH_DIR.mkdir(exist_ok=True)

INBOX_SCANS_DIR = BASE_DIR / "Backend" / "inbox_scans"
INBOX_SCANS_DIR.mkdir(parents=True, exist_ok=True)
