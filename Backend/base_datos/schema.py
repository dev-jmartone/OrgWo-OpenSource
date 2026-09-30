"""Schema SQLite + migraciones idempotentes.

init_db() se llama al arrancar el server. Crea las tablas si no existen,
corre _run_migrations (idempotente: cada ALTER chequea si la columna ya
existe antes de aplicar) y ejecuta la purga one-shot que migro la base de
Excel legado a 'Remedy en vivo' al adoptar el flujo nuevo.
"""
import sqlite3
from Backend.base_datos.connection import get_db


def init_db() -> None:
    """Crea tablas si no existen + corre migraciones idempotentes.
    Seguro de ejecutar varias veces.
    """
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            owner_id TEXT,
            name TEXT,
            email TEXT,
            company TEXT,
            puesto TEXT,
            svc_tag TEXT,
            old_model TEXT,
            tipo TEXT DEFAULT 'pc',
            estado TEXT DEFAULT 'contact',
            wo TEXT,
            clave TEXT,
            new_model TEXT,
            new_svc TEXT,
            apps TEXT,
            zona TEXT,
            notes TEXT,
            checks TEXT DEFAULT '{}',
            excel_status TEXT,
            excel_fecha TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT NOT NULL,
            at TEXT NOT NULL,
            text TEXT NOT NULL,
            FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_events_case ON events(case_id);
        CREATE INDEX IF NOT EXISTS idx_cases_email ON cases(email);
        CREATE INDEX IF NOT EXISTS idx_cases_estado ON cases(estado);
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            organization TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            role INTEGER DEFAULT 1,
            nivel INTEGER DEFAULT 1,
            disponible INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            path TEXT NOT NULL,
            mime_type TEXT,
            size_bytes INTEGER,
            kind TEXT,
            source TEXT,
            ocr_text TEXT,
            detected_ids TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_case ON attachments(case_id);

        CREATE TABLE IF NOT EXISTS org_settings (
            organization TEXT,
            key TEXT,
            value TEXT,
            PRIMARY KEY (organization, key)
        );
        CREATE TABLE IF NOT EXISTS users_directory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name_key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            company TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            username TEXT,
            action TEXT NOT NULL,
            details TEXT,
            ip TEXT,
            timestamp TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL
        );
        INSERT OR IGNORE INTO roles (id, name) VALUES (1, 'tecnico');
        INSERT OR IGNORE INTO roles (id, name) VALUES (2, 'dispatcher');
        CREATE INDEX IF NOT EXISTS idx_users_directory_email ON users_directory(email);
        CREATE INDEX IF NOT EXISTS idx_users_directory_company ON users_directory(company);

        CREATE TABLE IF NOT EXISTS telemetry_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            cpu_percent REAL,
            ram_percent REAL,
            db_latency REAL,
            disk_free_gb REAL
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_history_ts ON telemetry_history(timestamp);

        CREATE TABLE IF NOT EXISTS remedy_group_tickets (
            id TEXT PRIMARY KEY,
            ticket_type TEXT NOT NULL,
            group_name TEXT NOT NULL,
            status_raw TEXT,
            status_mapped TEXT,
            summary TEXT,
            description TEXT,
            client_name TEXT,
            client_email TEXT,
            assignee_login TEXT,
            assignee_name TEXT,
            remedy_company TEXT,
            is_jarvis INTEGER DEFAULT 0,
            user_company TEXT,
            element_type TEXT,
            tipificacion TEXT,
            sla_status TEXT,
            submit_date TEXT,
            submit_month TEXT,
            last_modified_date TEXT,
            synced_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rgt_group ON remedy_group_tickets(group_name);
        CREATE INDEX IF NOT EXISTS idx_rgt_jarvis ON remedy_group_tickets(is_jarvis);
        CREATE INDEX IF NOT EXISTS idx_rgt_ucomp ON remedy_group_tickets(user_company);
        CREATE INDEX IF NOT EXISTS idx_rgt_status ON remedy_group_tickets(status_mapped);
        CREATE INDEX IF NOT EXISTS idx_rgt_submit ON remedy_group_tickets(submit_date);

        CREATE TABLE IF NOT EXISTS remedy_group_sync_status (
            id INTEGER PRIMARY KEY,
            last_sync_start TEXT,
            last_sync_end TEXT,
            status TEXT,
            progress_percent INTEGER DEFAULT 0,
            current_step TEXT,
            total_tickets INTEGER DEFAULT 0,
            error_message TEXT,
            params_json TEXT
        );
        """)

        # Eliminar tabla obsoleta
        db.execute("DROP TABLE IF EXISTS unassigned_tickets")

        _run_migrations(db)

        # Purga de una sola vez para migrar a Remedy en Vivo 100% libre de Excel legado.
        purged = db.execute("SELECT value FROM settings WHERE key = 'db_purged_remedy_live'").fetchone()
        if not purged:
            db.execute("DELETE FROM cases")
            db.execute("DELETE FROM events")
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_purged_remedy_live', '1')")

        db.commit()


def _run_migrations(db: sqlite3.Connection) -> None:
    """Migraciones idempotentes. Cada bloque chequea si la columna/tabla ya
    existe antes de aplicar. Se ejecutan dentro del mismo transaction de init_db.
    """
    if not _column_exists(db, "cases", "sla_date"):
        db.execute("ALTER TABLE cases ADD COLUMN sla_date TEXT")
    if not _column_exists(db, "cases", "sla_status"):
        db.execute("ALTER TABLE cases ADD COLUMN sla_status TEXT")
    if not _column_exists(db, "cases", "snooze_until"):
        db.execute("ALTER TABLE cases ADD COLUMN snooze_until TEXT")
    if not _column_exists(db, "cases", "fecha_retiro"):
        db.execute("ALTER TABLE cases ADD COLUMN fecha_retiro TEXT")
    if not _column_exists(db, "cases", "priority"):
        db.execute("ALTER TABLE cases ADD COLUMN priority TEXT DEFAULT 'normal'")
    if not _column_exists(db, "cases", "outlook_event_id"):
        db.execute("ALTER TABLE cases ADD COLUMN outlook_event_id TEXT")

    # New template fields and organization field
    if not _column_exists(db, "cases", "brand"):
        db.execute("ALTER TABLE cases ADD COLUMN brand TEXT")
    if not _column_exists(db, "cases", "imei1"):
        db.execute("ALTER TABLE cases ADD COLUMN imei1 TEXT")
    if not _column_exists(db, "cases", "imei2"):
        db.execute("ALTER TABLE cases ADD COLUMN imei2 TEXT")
    if not _column_exists(db, "cases", "fecha_asignacion"):
        db.execute("ALTER TABLE cases ADD COLUMN fecha_asignacion TEXT")
    # fecha_asignacion_new: cuando se configuro el equipo NUEVO. Va separado
    # de fecha_asignacion (que es del viejo) porque cada equipo tiene su
    # propia fecha de asignacion al usuario.
    if not _column_exists(db, "cases", "fecha_asignacion_new"):
        db.execute("ALTER TABLE cases ADD COLUMN fecha_asignacion_new TEXT")
    if not _column_exists(db, "cases", "organization"):
        db.execute("ALTER TABLE cases ADD COLUMN organization TEXT DEFAULT 'local'")
    if not _column_exists(db, "cases", "movimiento"):
        db.execute("ALTER TABLE cases ADD COLUMN movimiento TEXT")

    # Composable template spec
    if not _column_exists(db, "cases", "action"):
        db.execute("ALTER TABLE cases ADD COLUMN action TEXT")
    if not _column_exists(db, "cases", "reason"):
        db.execute("ALTER TABLE cases ADD COLUMN reason TEXT")
    if not _column_exists(db, "cases", "logistics"):
        db.execute("ALTER TABLE cases ADD COLUMN logistics TEXT DEFAULT 'presencial'")
    if not _column_exists(db, "cases", "items_json"):
        db.execute("ALTER TABLE cases ADD COLUMN items_json TEXT")
    if not _column_exists(db, "cases", "prestamo_devuelto"):
        db.execute("ALTER TABLE cases ADD COLUMN prestamo_devuelto INTEGER DEFAULT 0")
    if not _column_exists(db, "cases", "prestamo_devolucion_at"):
        db.execute("ALTER TABLE cases ADD COLUMN prestamo_devolucion_at TEXT")

    # Owner del case (usuario propietario dentro de la org). Permite filtrar
    # stats por operador individual cuando varios usan la misma organization.
    if not _column_exists(db, "cases", "owner_id"):
        db.execute("ALTER TABLE cases ADD COLUMN owner_id TEXT")

    if not _column_exists(db, "cases", "tipificacion"):
        db.execute("ALTER TABLE cases ADD COLUMN tipificacion TEXT")

    # Configuraciones de columnas de usuario
    if not _column_exists(db, "users", "column_settings"):
        db.execute("ALTER TABLE users ADD COLUMN column_settings TEXT DEFAULT '{}'")

    # Compat: estado 'remedy_assigned' (legacy) -> 'remedy_inc_assigned'.
    db.execute("UPDATE cases SET estado = 'remedy_inc_assigned' WHERE estado = 'remedy_assigned'")

    # archived_at: cuando un attachment de tipo template_firmado se "archiva"
    # (post cierre de WO en Remedy), se setea con timestamp ISO. El binario
    # en disco se borra y el path se anula. Mantenemos la metadata (filename,
    # ocr_text, detected_ids) como registro auditable de que el PDF existio
    # y se procesó. UI usa este flag para mostrar "PDF adjuntado
    # automaticamente — INC X — archivo Y" en lugar del link de descarga.
    if not _column_exists(db, "attachments", "archived_at"):
        db.execute("ALTER TABLE attachments ADD COLUMN archived_at TEXT")

    if not _column_exists(db, "users", "role"):
        db.execute("ALTER TABLE users ADD COLUMN role INTEGER DEFAULT 1")
    else:
        # Migrar valores de texto viejos a enteros
        db.execute("UPDATE users SET role = 1 WHERE role = 'tecnico'")
        db.execute("UPDATE users SET role = 2 WHERE role = 'dispatcher'")
        db.execute("UPDATE users SET role = 1 WHERE role IS NULL OR role NOT IN (1, 2, '1', '2')")

    if not _column_exists(db, "users", "nivel"):
        db.execute("ALTER TABLE users ADD COLUMN nivel INTEGER DEFAULT 1")

    if not _column_exists(db, "cases", "nivel_requerido"):
        db.execute("ALTER TABLE cases ADD COLUMN nivel_requerido INTEGER DEFAULT 1")

    if not _column_exists(db, "users", "disponible"):
        db.execute("ALTER TABLE users ADD COLUMN disponible INTEGER DEFAULT 1")

    # Migración de meses para estadísticas de grupos Remedy
    if not _column_exists(db, "remedy_group_tickets", "submit_month"):
        db.execute("ALTER TABLE remedy_group_tickets ADD COLUMN submit_month TEXT")
    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_rgt_month ON remedy_group_tickets(submit_month)")
    except Exception as ex_idx:
        print(f"[schema] Error creando índice idx_rgt_month: {ex_idx}")

    try:
        from Backend.utils import parse_submit_month
        unmigrated_rows = db.execute(
            "SELECT id, submit_date FROM remedy_group_tickets WHERE (submit_month IS NULL OR submit_month = '') AND submit_date IS NOT NULL AND submit_date != ''"
        ).fetchall()
        for ur in unmigrated_rows:
            parsed_m = parse_submit_month(ur["submit_date"])
            if parsed_m:
                db.execute("UPDATE remedy_group_tickets SET submit_month = ? WHERE id = ?", (parsed_m[0], ur["id"]))
    except Exception as ex_m:
        print(f"[schema] Error en backfill de submit_month: {ex_m}")

    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_rgt_client ON remedy_group_tickets(client_name)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_rgt_email ON remedy_group_tickets(client_email)")
    except Exception as ex_idx2:
        print(f"[schema] Error creando índices en remedy_group_tickets: {ex_idx2}")

    try:
        from Backend.servicios.remedy_stats import enrich_ticket_emails_from_local_db
        enrich_ticket_emails_from_local_db()
    except Exception as ex_enr:
        print(f"[schema] Error en backfill de emails: {ex_enr}")

    _migrate_checklist_templates(db)
    _cleanup_invalid_emails(db)



def _migrate_checklist_templates(db: sqlite3.Connection) -> None:
    """Migración one-shot de los checklist de Vincha, Kit y Cargador en org_settings.

    Corre UNA sola vez (flag en settings). Antes corría en cada arranque y
    pisaba las personalizaciones que el operador hiciera sobre esas tres
    tipificaciones.
    """
    import json
    done = db.execute(
        "SELECT value FROM settings WHERE key = 'checklist_kit_vincha_migrated'"
    ).fetchone()
    if done:
        return
    try:
        rows = db.execute("SELECT organization, value FROM org_settings WHERE key = 'checklist_templates'").fetchall()
        for row in rows:
            org = row["organization"]
            val_str = row["value"]
            if not val_str:
                continue
            try:
                templates = json.loads(val_str)
                updated = False
                for key in ["Kit Inalambrico", "Vincha", "Cargador"]:
                    templates[key] = [
                        {"id": "retiro_deposito", "label": "Se retira de depósito (anotar Marca, Modelo, Serial)", "required_for_state": "config", "order": 10},
                        {"id": "contact_coord", "label": "Contacto con usuario con mensaje rápido", "required_for_state": "coord", "order": 20},
                        {"id": "template_sent", "label": "Carga y envío de Template", "required_for_state": "req", "order": 30},
                        {"id": "template_appr", "label": "Recepción de la Aprobación", "required_for_state": "appr", "order": 40},
                        {"id": "ready_notice", "label": "Entrega del elemento", "required_for_state": "appr", "order": 50},
                        {"id": "scanned", "label": "Escaneo del template", "required_for_state": "scan", "order": 60},
                        {"id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70},
                    ]
                    updated = True
                if updated:
                    db.execute(
                        "UPDATE org_settings SET value = ? WHERE organization = ? AND key = 'checklist_templates'",
                        (json.dumps(templates), org)
                    )
            except Exception as ex:
                print(f"[migration] Error parseando/actualizando checklist para org {org}: {ex}")
    except Exception as e:
        print(f"[migration] Error migrando checklist_templates: {e}")
    # Marca la migracion como hecha aunque haya fallado parcialmente: el objetivo
    # es que NO vuelva a correr en cada arranque pisando personalizaciones.
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('checklist_kit_vincha_migrated', '1')"
    )


def _column_exists(db: sqlite3.Connection, table: str, column: str) -> bool:
    rows = db.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def _cleanup_invalid_emails(db: sqlite3.Connection) -> None:
    """Busca y remueve correos con dominios invalidos de cases y de users_directory."""
    from Backend.utils import is_valid_corporate_email
    
    # 1. Limpiar cases
    rows_cases = db.execute("SELECT id, name, email, company FROM cases WHERE email IS NOT NULL AND email != ''").fetchall()
    updated_cases = 0
    for row in rows_cases:
        email = row["email"]
        if not is_valid_corporate_email(email):
            db.execute("UPDATE cases SET email = NULL, company = NULL, updated_at = datetime('now') WHERE id = ?", (row["id"],))
            updated_cases += 1
            
    # 2. Limpiar users_directory
    table_exists = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users_directory'").fetchone()
    updated_dir = 0
    if table_exists:
        rows_dir = db.execute("SELECT id, name, email FROM users_directory WHERE email IS NOT NULL AND email != '' AND email != 'NOT_FOUND'").fetchall()
        for row in rows_dir:
            email = row["email"]
            if not is_valid_corporate_email(email):
                db.execute("DELETE FROM users_directory WHERE id = ?", (row["id"],))
                updated_dir += 1
                
    if updated_cases or updated_dir:
        print(f"[migration] Correos invalidos limpiados: {updated_cases} cases, {updated_dir} registros en users_directory.")

