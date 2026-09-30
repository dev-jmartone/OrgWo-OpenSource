import sqlite3
import json
import random
import datetime
import hashlib
from pathlib import Path
from werkzeug.security import generate_password_hash

FIRST_NAMES = [
    "Alejandro", "Agustin", "Camila", "Carlos", "Carolina", "Diego", "Eduardo",
    "Esteban", "Facundo", "Federico", "Florencia", "Gabriel", "Gonzalo", "Guillermo",
    "Ignacio", "Javier", "Joaquin", "Juan", "Julian", "Laura", "Leonardo",
    "Lucia", "Manuel", "Marcos", "Maria Belen", "Mariana", "Martin", "Matias",
    "Maximiliano", "Nicolas", "Pablo", "Patricio", "Paula", "Ramiro", "Rocio",
    "Rodrigo", "Santiago", "Sebastian", "Sofia", "Tomas", "Valeria", "Victoria"
]

LAST_NAMES = [
    "Alvarez", "Benitez", "Castro", "Diaz", "Dominguez", "Fernandez", "Flores",
    "Garcia", "Gimenez", "Gomez", "Gonzalez", "Gutierrez", "Herrera", "Lopez",
    "Marino", "Martinez", "Medina", "Molina", "Morales", "Navarro", "Nuñez",
    "Pereyra", "Perez", "Ramirez", "Rios", "Rodriguez", "Romero", "Rossi",
    "Ruiz", "Sanchez", "Silva", "Sosa", "Suarez", "Torres", "Vazquez", "Vega"
]

COMPANIES = ["Empresa Principal", "Subsidiaria", "Servicios Operativos", "Proveedor TI"]
COMPANY_DOMAINS = {
    "Empresa Principal": "empresa.com",
    "Subsidiaria": "subsidiaria.com",
    "Servicios Operativos": "servicios.com",
    "Proveedor TI": "proveedor.com"
}

ROLES = [
    "Analista Funcional", "Desarrollador Backend", "Desarrollador Frontend",
    "Líder Técnico", "Project Manager", "Especialista de Soporte TI",
    "Analista de Ciberseguridad", "Administrador de Redes", "Diseñador UX/UI",
    "Responsable de Finanzas", "Analista de Operaciones", "Coordinador de Logística"
]

LAPTOP_OLD_MODELS = ["Dell Latitude 5400", "Dell Latitude 5410", "Lenovo ThinkPad T480", "Lenovo ThinkPad T490", "HP ProBook 440 G6"]
LAPTOP_NEW_MODELS = ["Dell Latitude 5430", "Dell Latitude 5440", "Lenovo ThinkPad T14 Gen 3", "Lenovo ThinkPad T14 Gen 4", "HP EliteBook 840 G9"]
CEL_OLD_MODELS = ["Samsung Galaxy A32", "Samsung Galaxy A52", "Motorola Moto G60", "iPhone 11"]
CEL_NEW_MODELS = ["Samsung Galaxy A54 5G", "Samsung Galaxy S23", "Motorola Edge 40", "iPhone 14"]
KIT_MODELS = ["Logitech MK270 Inalámbrico", "Dell Pro KM5221W Inalámbrico", "HP 230 Wireless Combo"]
HEADSET_MODELS = ["Jabra Evolve 20 USB", "Jabra Evolve2 40", "Logitech H390 USB", "Plantronics Blackwire 3220"]
CHARGER_MODELS = ["Dell USB-C 65W Original", "Lenovo USB-C 65W AC Adapter", "HP 65W USB-C Slim"]
MONITOR_MODELS = ["Dell P2419H 24\" FHD", "Dell P2422H 24\" IPS", "Lenovo ThinkVision T24i-20", "HP E24 G4 FHD"]

TIPIFICACIONES = [
    ("Notebook - Renovación de Equipo", "pc"),
    ("Notebook - Falla de Hardware / Cambio", "pc"),
    ("Alta / Cambio de Celular Corporativo", "cel"),
    ("Kit Inalámbrico (Teclado y Mouse)", "kit"),
    ("Vincha / Headset para Reuniones", "vincha"),
    ("Cargador / Fuente de Alimentación", "cargador"),
    ("Solicitud de Monitor Adicional", "monitor"),
    ("Configuración de Software / VPN", "pc")
]

ESTADOS = [
    "remedy_inc_assigned", "remedy_wo_assigned", "contact", "wait",
    "userpass", "data", "config", "coord", "req", "appr", "wipe", "scan", "done"
]

REMEDY_GROUPS = ["MESA DE AYUDA TI", "SOPORTE TECNICO", "COMUNICACIONES MOVILES"]

def create_schema(db_path: Path):
    if db_path.exists():
        db_path.unlink()
    
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    cur.executescript("""
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
        updated_at TEXT NOT NULL,
        sla_date TEXT,
        sla_status TEXT,
        snooze_until TEXT,
        fecha_retiro TEXT,
        priority TEXT DEFAULT 'normal',
        brand TEXT,
        imei1 TEXT,
        imei2 TEXT,
        fecha_asignacion TEXT,
        fecha_asignacion_new TEXT,
        organization TEXT DEFAULT 'DefaultOrg',
        movimiento TEXT,
        action TEXT,
        reason TEXT,
        logistics TEXT DEFAULT 'presencial',
        items_json TEXT,
        prestamo_devuelto INTEGER DEFAULT 0,
        prestamo_devolucion_at TEXT,
        tipificacion TEXT,
        outlook_event_id TEXT,
        nivel_requerido INTEGER DEFAULT 1
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
        role_id INTEGER DEFAULT 1,
        nivel INTEGER DEFAULT 1,
        disponible INTEGER DEFAULT 1,
        column_settings TEXT DEFAULT '{}'
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
        archived_at TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_users_directory_email ON users_directory(email);
    CREATE INDEX IF NOT EXISTS idx_users_directory_company ON users_directory(company);

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
    CREATE INDEX IF NOT EXISTS idx_rgt_month ON remedy_group_tickets(submit_month);
    CREATE INDEX IF NOT EXISTS idx_rgt_client ON remedy_group_tickets(client_name);
    CREATE INDEX IF NOT EXISTS idx_rgt_email ON remedy_group_tickets(client_email);

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
    conn.commit()
    return conn

def seed_database(conn: sqlite3.Connection):
    cur = conn.cursor()
    random.seed(42)  # Deterministic seed for reproducible testing
    
    # 1. Roles
    cur.execute("INSERT OR IGNORE INTO roles (id, name) VALUES (1, 'Tecnico')")
    cur.execute("INSERT OR IGNORE INTO roles (id, name) VALUES (2, 'Dispatcher')")

    # 2. Settings
    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_purged_remedy_live', '1')")
    cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('checklist_kit_vincha_migrated', '1')")

    # 3. Org Settings (Checklist templates)
    checklist_json = json.dumps({
        "default": [
            {"id": "user_pass", "label": "Usuario y Contraseña confirmados", "required_for_state": "userpass", "order": 10},
            {"id": "coord_date", "label": "Fecha y horario acordado con usuario", "required_for_state": "coord", "order": 20},
            {"id": "autopilot_ok", "label": "Equipo configurado / Autopilot OK", "required_for_state": "config", "order": 30},
            {"id": "template_sent", "label": "Template de entrega enviado por correo", "required_for_state": "req", "order": 40},
            {"id": "template_appr", "label": "Aprobación de jefatura recibida", "required_for_state": "appr", "order": 50},
            {"id": "delivered", "label": "Entrega de equipo nuevo realizada", "required_for_state": "wipe", "order": 60},
            {"id": "old_returned", "label": "Equipo anterior recibido y wipeado", "required_for_state": "scan", "order": 70},
            {"id": "scanned", "label": "Remito firmado escaneado y adjunto", "required_for_state": "scan", "order": 80},
            {"id": "wo_closed", "label": "Ticket resuelto y cerrado en Remedy", "required_for_state": "done", "order": 90}
        ],
        "Kit Inalambrico": [
            {"id": "retiro_deposito", "label": "Retirado de depósito (Marca, Modelo, S/N)", "required_for_state": "config", "order": 10},
            {"id": "contact_coord", "label": "Contacto con usuario y confirmación", "required_for_state": "coord", "order": 20},
            {"id": "ready_notice", "label": "Entrega del elemento al usuario", "required_for_state": "appr", "order": 50},
            {"id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70}
        ],
        "Vincha": [
            {"id": "retiro_deposito", "label": "Retirado de depósito (Marca, Modelo, S/N)", "required_for_state": "config", "order": 10},
            {"id": "contact_coord", "label": "Contacto con usuario y confirmación", "required_for_state": "coord", "order": 20},
            {"id": "ready_notice", "label": "Entrega del elemento al usuario", "required_for_state": "appr", "order": 50},
            {"id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70}
        ]
    })
    cur.execute("INSERT OR REPLACE INTO org_settings (organization, key, value) VALUES ('DefaultOrg', 'checklist_templates', ?)", (checklist_json,))
    cur.execute("INSERT OR REPLACE INTO org_settings (organization, key, value) VALUES ('EmpresaDemo', 'checklist_templates', ?)", (checklist_json,))

    # 4. Users
    column_settings_demo = json.dumps({
        "enabled_widgets": ["inc-open", "wo-open", "inc-closed", "kits-today", "vinchas-today", "closed-typifications-all", "kits-all", "vinchas-all"],
        "kanban_groups": [
            {"color": "var(--st-assigned, #038387)", "estados": ["remedy_inc_assigned"], "id": "fase-inc", "label": "Asignados INC", "locked": True},
            {"color": "var(--st-assigned-wo, #0099BC)", "estados": ["remedy_wo_assigned"], "id": "fase-wo", "label": "Asignados WO", "locked": True},
            {"color": "var(--st-wait, #C19C00)", "estados": ["contact", "wait", "userpass", "data"], "id": "fase-esperando", "label": "Esperando"},
            {"color": "var(--st-turno, #CA5010)", "estados": ["config", "coord"], "id": "fase-turno", "label": "Tu turno"},
            {"color": "var(--st-rafa, #8764B8)", "estados": ["req", "appr"], "id": "fase-aprobacion", "label": "En Aprobación"},
            {"color": "var(--st-cierre, #107C10)", "estados": ["wipe", "scan", "done"], "id": "fase-cierre", "label": "Cierre / Resuelto"}
        ],
        "list_groups": [
            {"id": "default-inc", "isDefault": True, "label": "Incidentes"},
            {"id": "default-wo", "isDefault": True, "label": "Work Orders"}
        ]
    })

    demo_users = [
        ("u_admin", "admin", generate_password_hash("admin123"), "DefaultOrg", "Administrador Dispatcher", "admin@empresa.com", 2, 2, 2, 1),
        ("u_tech1", "tecnico1", generate_password_hash("tecnico123"), "DefaultOrg", "Carlos Gomez", "cgomez@empresa.com", 1, 1, 1, 1),
        ("u_tech2", "tecnico2", generate_password_hash("tecnico123"), "DefaultOrg", "Laura Martinez", "lmartinez@empresa.com", 1, 1, 2, 1),
        ("u_tech3", "tecnico3", generate_password_hash("tecnico123"), "DefaultOrg", "Diego Fernandez", "dfernandez@empresa.com", 1, 1, 1, 1)
    ]
    for uid, usr, pw, org, nm, em, r, rid, niv, disp in demo_users:
        cur.execute(
            "INSERT INTO users (id, username, password, organization, name, email, role, role_id, nivel, disponible, column_settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (uid, usr, pw, org, nm, em, r, rid, niv, disp, column_settings_demo)
        )

    # 5. Generate Cases, Directory and Events (120 records)
    now = datetime.datetime.now(datetime.timezone.utc)
    cases_count = 120
    
    assigned_owners = ["u_tech1", "u_tech2", "u_tech3", "u_admin"]
    
    print(f"Generating {cases_count} cases, events, and directory entries...")
    
    used_names = set()
    directory_records = []
    
    for i in range(1, cases_count + 1):
        # Pick unique or semi-unique name
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        full_name = f"{first} {last}"
        
        comp = random.choice(COMPANIES)
        domain = COMPANY_DOMAINS[comp]
        email_user = f"{first[0].lower()}{last.lower().replace(' ', '')}@{domain}"
        
        # Directory
        name_key = full_name.lower().strip()
        if name_key not in used_names:
            used_names.add(name_key)
            created_ts = (now - datetime.timedelta(days=random.randint(10, 60))).isoformat()
            cur.execute(
                "INSERT INTO users_directory (name_key, name, email, company, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (name_key, full_name, email_user, comp, created_ts, created_ts)
            )

        # Case attributes
        tipif, tipo = random.choice(TIPIFICACIONES)
        estado = random.choice(ESTADOS)
        is_inc = random.choice([True, False])
        ticket_id = f"INC{8000000 + i:07d}" if is_inc else f"WO{1000000 + i:07d}"
        case_id = ticket_id
        
        puesto = random.choice(ROLES)
        owner = random.choice(assigned_owners)
        
        created_delta = datetime.timedelta(days=random.randint(1, 45), hours=random.randint(1, 23))
        case_created_dt = now - created_delta
        case_updated_dt = case_created_dt + datetime.timedelta(days=random.randint(0, 3), hours=random.randint(1, 8))
        if case_updated_dt > now:
            case_updated_dt = now
            
        created_iso = case_created_dt.isoformat()
        updated_iso = case_updated_dt.isoformat()
        
        svc_tag = f"ST-{random.randint(10000, 99999):05d}"
        old_m = random.choice(LAPTOP_OLD_MODELS if tipo == 'pc' else CEL_OLD_MODELS if tipo == 'cel' else ["N/A"])
        new_m = random.choice(LAPTOP_NEW_MODELS if tipo == 'pc' else CEL_NEW_MODELS if tipo == 'cel' else KIT_MODELS if tipo == 'kit' else HEADSET_MODELS if tipo == 'vincha' else CHARGER_MODELS if tipo == 'cargador' else MONITOR_MODELS)
        new_svc = f"NEW-{random.randint(10000, 99999):05d}"
        
        checks = {
            "user_pass": estado in ["userpass", "config", "coord", "req", "appr", "wipe", "scan", "done"],
            "coord_date": estado in ["coord", "req", "appr", "wipe", "scan", "done"],
            "autopilot_ok": estado in ["config", "coord", "req", "appr", "wipe", "scan", "done"],
            "template_sent": estado in ["req", "appr", "wipe", "scan", "done"],
            "template_appr": estado in ["appr", "wipe", "scan", "done"],
            "delivered": estado in ["wipe", "scan", "done"],
            "old_returned": estado in ["scan", "done"],
            "scanned": estado in ["scan", "done"],
            "wo_closed": estado == "done"
        }
        
        notes = f"Solicitud de recambio tecnológico gestionada para {full_name}. Elemento: {new_m}."
        zona = random.choice(["Sede Central Piso 2", "Sede Norte", "Sucursal Rosario", "Envío a Domicilio", "Retiro por Soporte"])
        priority = random.choice(["normal", "normal", "normal", "high", "urgent"])
        
        fecha_retiro = (now + datetime.timedelta(days=random.randint(0, 7))).strftime("%Y-%m-%d") if estado in ["coord", "config", "req"] else None

        cur.execute("""
            INSERT INTO cases (
                id, owner_id, name, email, company, puesto, svc_tag, old_model,
                tipo, estado, wo, new_model, new_svc, apps, zona, notes, checks,
                created_at, updated_at, fecha_retiro, priority, organization,
                logistics, tipificacion, nivel_requerido
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            case_id, owner, full_name, email_user, comp, puesto, svc_tag, old_m,
            tipo, estado, ticket_id, new_m, new_svc, "Office 365, Teams, VPN, Navegadores",
            zona, notes, json.dumps(checks), created_iso, updated_iso, fecha_retiro,
            priority, "DefaultOrg", "presencial", tipif, 1
        ))

        # Events for this case
        cur.execute("INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)",
                    (case_id, created_iso, f"Caso creado desde ticket {ticket_id} ({tipif})"))
        if checks["coord_date"]:
            coord_time = (case_created_dt + datetime.timedelta(hours=4)).isoformat()
            cur.execute("INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)",
                        (case_id, coord_time, "Coordinación realizada con el usuario para entrega"))
        if checks["autopilot_ok"]:
            config_time = (case_created_dt + datetime.timedelta(hours=8)).isoformat()
            cur.execute("INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)",
                        (case_id, config_time, f"Equipo configurado exitosamente: {new_m} ({new_svc})"))
        if checks["wo_closed"]:
            done_time = (case_created_dt + datetime.timedelta(hours=24)).isoformat()
            cur.execute("INSERT INTO events (case_id, at, text) VALUES (?, ?, ?)",
                        (case_id, done_time, "Proceso finalizado. Equipo entregado y ticket cerrado en Remedy."))

    # 6. Remedy Group Tickets for Group Stats & Dashboard (150 records)
    print("Generating 150 remedy_group_tickets for metrics...")
    months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
    
    for j in range(1, 151):
        t_id = f"INC{9100000 + j:07d}" if j % 2 == 0 else f"WO{2100000 + j:07d}"
        t_type = "INC" if t_id.startswith("INC") else "WO"
        grp = random.choice(REMEDY_GROUPS)
        
        status_raw, status_mapped = random.choice([
            ("Assigned", "1"),
            ("In Progress", "2"),
            ("Pending", "3"),
            ("Resolved", "4"),
            ("Closed", "4")
        ])
        
        tipif, tipo = random.choice(TIPIFICACIONES)
        elem_type = "Equipo" if tipo == "pc" else "Celular" if tipo == "cel" else "Kit" if tipo == "kit" else "Vincha" if tipo == "vincha" else "Cargador" if tipo == "cargador" else "Monitor"
        
        cl_first = random.choice(FIRST_NAMES)
        cl_last = random.choice(LAST_NAMES)
        cl_name = f"{cl_first} {cl_last}"
        cl_comp = random.choice(COMPANIES)
        cl_email = f"{cl_first[0].lower()}{cl_last.lower()}@{COMPANY_DOMAINS[cl_comp]}"
        
        tech_assigned = random.choice([("cgomez", "Carlos Gomez"), ("lmartinez", "Laura Martinez"), ("dfernandez", "Diego Fernandez")])
        
        m_chosen = random.choice(months)
        day_chosen = random.randint(1, 28)
        hour_chosen = random.randint(8, 18)
        submit_str = f"{m_chosen}-{day_chosen:02d}T{hour_chosen:02d}:30:00.000+0000"
        
        summary = f"Solicitud de {elem_type} - {tipif}"
        desc = f"Ticket cargado para el colaborador {cl_name}. Empresa: {cl_comp}. Requerimiento: {summary}."
        sla_stat = random.choice(["Within the Service Target", "Within the Service Target", "Within the Service Target", "SLM Warning", "Breached"])
        
        cur.execute("""
            INSERT INTO remedy_group_tickets (
                id, ticket_type, group_name, status_raw, status_mapped, summary,
                description, client_name, client_email, assignee_login, assignee_name,
                remedy_company, is_jarvis, user_company, element_type, tipificacion,
                sla_status, submit_date, submit_month, last_modified_date, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            t_id, t_type, grp, status_raw, status_mapped, summary, desc,
            cl_name, cl_email, tech_assigned[0], tech_assigned[1],
            "EMPRESA", random.choice([0, 1]), cl_comp, elem_type, tipif,
            sla_stat, submit_str, m_chosen, submit_str, now.isoformat()
        ))

    conn.commit()
    print("Database seeding completed successfully.")

if __name__ == "__main__":
    base_dir = Path(__file__).parent.resolve()
    db_target = base_dir / "data.db"
    print(f"Target DB: {db_target}")
    conn = create_schema(db_target)
    seed_database(conn)
    conn.close()

    # Also generate data_qa.db
    db_target_qa = base_dir / "data_qa.db"
    print(f"Target QA DB: {db_target_qa}")
    conn_qa = create_schema(db_target_qa)
    seed_database(conn_qa)
    conn_qa.close()
    
    print("Both data.db and data_qa.db generated successfully!")
