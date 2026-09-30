"""Conexion a SQLite con PRAGMAs de WAL + busy_timeout + foreign_keys."""
import sqlite3
from Backend.config import DB_PATH


def get_db() -> sqlite3.Connection:
    """Devuelve una conexion a SQLite con WAL + FK on + rows como dict.

    - timeout=10: espera hasta 10s si el archivo DB esta bloqueado al conectar.
    - busy_timeout=5000: SQLite esperara hasta 5000ms antes de lanzar
      'database is locked' en operaciones de escritura concurrentes.
    - synchronous=NORMAL: mejor rendimiento sin comprometer integridad en WAL.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn
