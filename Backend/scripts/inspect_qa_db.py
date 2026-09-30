"""Inspector de la base SQLite para debug en QA.

Reemplaza los scripts sueltos de scratch/ (que tenian nombres/credenciales
reales hardcodeados) por una herramienta generica y limpia.

Uso (desde la raiz del repo):
    set ENV=QA && python Backend/scripts/inspect_qa_db.py
    set ENV=QA && python Backend/scripts/inspect_qa_db.py cases

Sin argumento: lista todas las tablas con conteo de filas + schema.
Con nombre de tabla: ademas vuelca las primeras 50 filas de esa tabla.
"""
import sqlite3
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent.parent.resolve()))
from Backend.config import DB_PATH, ENV


def main() -> None:
    if not DB_PATH.exists():
        print(f"DB no existe: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    print(f"ENV={ENV}  DB={DB_PATH}\n")

    # Nombres de tabla salen de sqlite_master (fuente confiable), no de input
    # del usuario, asi que interpolarlos en el COUNT/PRAGMA es seguro.
    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()]

    for t in tables:
        count = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"== {t} ({count} filas)")
        for col in cur.execute(f"PRAGMA table_info({t})").fetchall():
            print(f"   {col['name']} ({col['type']})")
        print()

    target = sys.argv[1] if len(sys.argv) > 1 else None
    if target:
        if target not in tables:
            print(f"Tabla '{target}' no existe.")
        else:
            print(f"---- Filas de {target} (max 50) ----")
            for row in cur.execute(f"SELECT * FROM {target} LIMIT 50").fetchall():
                print(dict(row))

    conn.close()


if __name__ == "__main__":
    main()
