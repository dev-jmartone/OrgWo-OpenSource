"""Snapshot diario de la base. Llamado al arrancar el server.

Crea data_YYYY-MM-DD.db en BACKUP_DIR si no existe el de hoy. Mantiene
los ultimos 30 snapshots; los mas viejos se borran.
"""
import shutil
from datetime import datetime
from Backend.config import DB_PATH, BACKUP_DIR


def service_auto_backup() -> None:
    """Snapshot diario en backups/ si no existe el de hoy. Mantiene ultimos 30."""
    today = datetime.now().strftime("%Y-%m-%d")
    backup_path = BACKUP_DIR / f"data_{today}.db"
    if backup_path.exists() or not DB_PATH.exists():
        return
    try:
        shutil.copy2(DB_PATH, backup_path)
        backups = sorted(BACKUP_DIR.glob("data_*.db"))
        for old in backups[:-30]:
            old.unlink()
        print(f"[backup] Snapshot diario creado: {backup_path.name}")
    except Exception as e:
        print(f"[backup] Error: {e}")
