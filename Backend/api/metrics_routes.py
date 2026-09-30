import os
import time
import sqlite3
import threading
import secrets
from datetime import datetime, timedelta, timezone
from flask import Blueprint, jsonify, session, abort, render_template_string, request

from Backend.base_datos.connection import get_db
from Backend.config import DB_PATH, ENV, BACKUP_DIR
from Backend.utils import traffic_telemetry, traffic_lock, memory_log_handler

metrics_bp = Blueprint("metrics", __name__)

STARTUP_TIME = time.time()

# ── Estado de Outlook cacheado (evita colgar el endpoint de metricas) ─────────
# El Dispatch a Outlook COM puede tardar o colgarse. Como /api/secret/metrics se
# refresca cada pocos segundos, se cachea el estado (TTL) y se sondea con timeout
# en un worker dedicado: el request nunca se bloquea mas de ~2s por Outlook.
import concurrent.futures as _futures
_outlook_cache = {"status": "No verificado", "gal_latency_ms": -1.0, "ts": 0.0}
_outlook_lock = threading.Lock()
_outlook_executor = _futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="outlook-probe")
_OUTLOOK_TTL = 60.0


def _probe_outlook_status() -> tuple:
    try:
        import pythoncom
        import win32com.client
        co_init = False
        try:
            pythoncom.CoInitialize()
            co_init = True
        except Exception:
            pass
        try:
            outlook = win32com.client.Dispatch("Outlook.Application")
            ns = outlook.GetNamespace("MAPI")
            user_name = ns.CurrentUser.Name if ns.CurrentUser else "Desconocido"
            
            # Medir latencia de consulta al GAL (crear recipient y resolver)
            start_gal = time.perf_counter()
            try:
                recip = ns.CreateRecipient("a")
                recip.Resolve()
            except Exception:
                pass
            gal_latency = (time.perf_counter() - start_gal) * 1000
            
            return f"Activo ({user_name})", round(gal_latency, 1)
        except Exception:
            return "Inactivo (Outlook cerrado)", -1.0
        finally:
            if co_init:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass
    except Exception as e:
        return f"Inactivo / Error: {e}", -1.0


def get_outlook_status() -> tuple:
    """Estado de Outlook cacheado (TTL) + sondeo con timeout corto. Nunca bloquea
    el request mas de ~2s; entre sondeos devuelve el ultimo valor conocido."""
    now = time.time()
    with _outlook_lock:
        if now - _outlook_cache["ts"] < _OUTLOOK_TTL:
            return _outlook_cache["status"], _outlook_cache["gal_latency_ms"]
        last_status = _outlook_cache["status"]
        last_latency = _outlook_cache["gal_latency_ms"]
    try:
        status, gal_latency = _outlook_executor.submit(_probe_outlook_status).result(timeout=2.0)
    except Exception:
        status, gal_latency = last_status, last_latency
    with _outlook_lock:
        _outlook_cache["status"] = status
        _outlook_cache["gal_latency_ms"] = gal_latency
        _outlook_cache["ts"] = now
    return status, gal_latency


# ── Integridad SQLite Programada (PRAGMA integrity_check de fondo) ───────────
_db_integrity_status = {"status": "Verificando...", "last_checked": None}
_integrity_lock = threading.Lock()

def _run_scheduled_integrity_check():
    """Worker de fondo para ejecutar PRAGMA integrity_check de forma periódica."""
    global _db_integrity_status
    # Retardo inicial corto para no enlentecer el inicio de la app
    time.sleep(10)
    while True:
        try:
            from Backend.base_datos.connection import get_db
            with get_db() as db:
                row = db.execute("PRAGMA integrity_check").fetchone()
                status = row[0] if row else "Error"
            with _integrity_lock:
                _db_integrity_status["status"] = status
                _db_integrity_status["last_checked"] = datetime.now(timezone.utc).isoformat()
        except Exception as e:
            with _integrity_lock:
                _db_integrity_status["status"] = f"Error: {e}"
                _db_integrity_status["last_checked"] = datetime.now(timezone.utc).isoformat()
        # Esperar 6 horas
        time.sleep(21600)

_integrity_thread = threading.Thread(target=_run_scheduled_integrity_check, daemon=True, name="db-integrity-check")
_integrity_thread.start()


def _run_telemetry_history_collector():
    """Worker de fondo para guardar tendencias de CPU, RAM, Latencia y Disco cada 15m (900s).
    Pruge registros con antigüedad superior a 24 horas.
    """
    # Retardo inicial de 20s
    time.sleep(20)
    while True:
        try:
            import psutil
            import shutil
            # 1. CPU & RAM
            cpu = psutil.cpu_percent(interval=None) or 0.0
            ram = psutil.virtual_memory().percent
            
            # 2. Disco
            total, used, free = shutil.disk_usage(DB_PATH.parent)
            disk_free_gb = round(free / (1024**3), 1)
            
            # 3. Latencia DB
            db_latency = -1.0
            start_t = time.perf_counter()
            from Backend.base_datos.connection import get_db
            try:
                with get_db() as db:
                    db.execute("SELECT 1").fetchone()
                    db_latency = round((time.perf_counter() - start_t) * 1000, 2)
            except Exception:
                pass
            
            # 4. Insertar en tabla telemetry_history
            now = datetime.now(timezone.utc).isoformat()
            with get_db() as db:
                db.execute(
                    """INSERT INTO telemetry_history (timestamp, cpu_percent, ram_percent, db_latency, disk_free_gb) 
                       VALUES (?, ?, ?, ?, ?)""",
                    (now, cpu, ram, db_latency, disk_free_gb)
                )
                # Purgar datos viejos (más de 24 horas)
                limit = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
                db.execute("DELETE FROM telemetry_history WHERE timestamp < ?", (limit,))
                db.commit()
                
        except Exception as e:
            print(f"[metrics] Error collecting history telemetry: {e}")
        
        # Esperar 15 minutos (900 segundos)
        time.sleep(900)

_telemetry_thread = threading.Thread(target=_run_telemetry_history_collector, daemon=True, name="telemetry-history-collector")
_telemetry_thread.start()


def get_uptime_str():
    uptime_seconds = int(time.time() - STARTUP_TIME)
    days = uptime_seconds // 86400
    hours = (uptime_seconds % 86400) // 3600
    minutes = (uptime_seconds % 3600) // 60
    
    parts = []
    if days > 0:
        parts.append(f"{days}d")
    if hours > 0 or days > 0:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    return " ".join(parts)


def get_os_uptime_str():
    try:
        import psutil
        uptime_seconds = int(time.time() - psutil.boot_time())
        days = uptime_seconds // 86400
        hours = (uptime_seconds % 86400) // 3600
        minutes = (uptime_seconds % 3600) // 60
        parts = []
        if days > 0:
            parts.append(f"{days}d")
        if hours > 0 or days > 0:
            parts.append(f"{hours}h")
            parts.append(f"{minutes}m")
        return " ".join(parts)
    except Exception:
        return "—"


@metrics_bp.route("/api/secret/metrics", methods=["GET"])
def get_metrics():
    if "user_id" not in session or session.get("role_id") != 2:
        return abort(404)

    # 1. CPU & RAM (psutil)
    cpu_percent = 0.0
    cpu_cores = []
    ram_percent = 0.0
    ram_rss_mb = 0.0
    ram_total_gb = 0.0
    ram_used_gb = 0.0
    process_cpu_percent = 0.0
    top_processes = []
    try:
        import psutil
        process = psutil.Process()
        cpu_percent = psutil.cpu_percent(interval=None) or 0.0
        cpu_cores = psutil.cpu_percent(interval=None, percpu=True) or []
        
        virtual_mem = psutil.virtual_memory()
        ram_percent = virtual_mem.percent
        ram_total_gb = round(virtual_mem.total / (1024**3), 1)
        ram_used_gb = round((virtual_mem.total - virtual_mem.available) / (1024**3), 1)
        
        ram_rss_mb = process.memory_info().rss / (1024 * 1024)
        process_cpu_percent = process.cpu_percent(interval=None) or 0.0
        
        # Obtener los top 5 procesos por consumo de RAM para ver qué consume recursos
        for proc in psutil.process_iter(['pid', 'name', 'memory_info', 'cpu_percent']):
            try:
                rss = (proc.info['memory_info'].rss or 0) / (1024 * 1024)
                p_cpu = proc.info['cpu_percent'] or 0.0
                top_processes.append({
                    "pid": proc.info['pid'],
                    "name": proc.info['name'] or "Unknown",
                    "cpu": round(p_cpu, 1),
                    "ram_mb": round(rss, 1)
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
        top_processes.sort(key=lambda x: x['ram_mb'], reverse=True)
        top_processes = top_processes[:5]
    except Exception:
        pass

    # Disk Space
    import shutil
    disk_total_gb = 0.0
    disk_free_gb = 0.0
    disk_free_percent = 0.0
    try:
        total, used, free = shutil.disk_usage(DB_PATH.parent)
        disk_total_gb = round(total / (1024**3), 1)
        disk_free_gb = round(free / (1024**3), 1)
        disk_free_percent = round((free / total) * 100, 1)
    except Exception:
        pass

    # 2. Hilos activos
    active_threads = threading.active_count()

    # 3. Usuarios activos (últimos 15 minutos)
    limit_time = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    active_users_map = {}
    try:
        with get_db() as db:
            rows = db.execute(
                """SELECT DISTINCT username, MAX(timestamp) as last_seen, ip 
                   FROM audit_logs 
                   WHERE timestamp >= ? 
                   GROUP BY username""",
                (limit_time,)
            ).fetchall()
            for r in rows:
                active_users_map[r["username"].lower().strip()] = {
                    "username": r["username"],
                    "last_seen": r["last_seen"],
                    "ip": r["ip"]
                }
    except Exception:
        pass

    try:
        from Backend.utils import online_users, online_users_lock
        limit_dt = datetime.now(timezone.utc) - timedelta(minutes=15)
        with online_users_lock:
            for username, data in list(online_users.items()):
                try:
                    last_seen_dt = datetime.fromisoformat(data["last_seen"])
                    if last_seen_dt >= limit_dt:
                        user_key = username.lower().strip()
                        if user_key not in active_users_map or data["last_seen"] > active_users_map[user_key]["last_seen"]:
                            active_users_map[user_key] = {
                                "username": username,
                                "last_seen": data["last_seen"],
                                "ip": data["ip"]
                            }
                    else:
                        if last_seen_dt < (datetime.now(timezone.utc) - timedelta(hours=1)):
                            online_users.pop(username, None)
                except Exception:
                    pass
    except Exception as e:
        print(f"[metrics] Error merging online users: {e}")

    # Enriquecer usuarios activos con detalles del registro (users & roles) y su última acción
    try:
        with get_db() as db:
            db_users = db.execute(
                """SELECT LOWER(u.username) as username_lower, u.name, u.email, u.organization, r.name as role_name
                   FROM users u
                   LEFT JOIN roles r ON u.role = r.id"""
            ).fetchall()
            user_details = {}
            for u in db_users:
                user_details[u["username_lower"].strip()] = {
                    "name": u["name"],
                    "email": u["email"],
                    "organization": u["organization"],
                    "role": u["role_name"] or "tecnico"
                }
            
            for user_key, udata in active_users_map.items():
                details = user_details.get(user_key, {
                    "name": udata["username"],
                    "email": "—",
                    "organization": "—",
                    "role": "—"
                })
                udata.update(details)
                
                last_act = db.execute(
                    """SELECT action, details 
                       FROM audit_logs 
                       WHERE LOWER(username) = ? 
                       ORDER BY timestamp DESC LIMIT 1""",
                    (user_key,)
                ).fetchone()
                if last_act:
                    udata["last_action"] = last_act["action"]
                    udata["last_action_details"] = last_act["details"]
                else:
                    udata["last_action"] = None
                    udata["last_action_details"] = None
    except Exception as e:
        print(f"[metrics] Error enriching active users: {e}")

    active_users = list(active_users_map.values())

    # 4. Registro de acciones por usuario (últimas 50)
    action_logs = []
    try:
        with get_db() as db:
            rows = db.execute(
                """SELECT username, action, details, ip, timestamp 
                   FROM audit_logs 
                   ORDER BY timestamp DESC 
                   LIMIT 50"""
                ).fetchall()
            for r in rows:
                action_logs.append({
                    "username": r["username"],
                    "action": r["action"],
                    "details": r["details"],
                    "ip": r["ip"],
                    "timestamp": r["timestamp"]
                })
    except Exception:
        pass

    # 5. Telemetría de tráfico
    with traffic_lock:
        traffic = {
            "requests_total": traffic_telemetry["requests_total"],
            "status_codes": dict(traffic_telemetry["status_codes"]),
            "paths": dict(traffic_telemetry["paths"])
        }
    
    # Calcular tasa y cantidad de errores 5xx en tráfico
    requests_total = traffic["requests_total"]
    errors_5xx = 0
    for code, count in traffic["status_codes"].items():
        if code.startswith("5"):
            errors_5xx += count
    rate_5xx = 0.0
    if requests_total > 0:
        rate_5xx = round((errors_5xx / requests_total) * 100, 2)
    traffic["rate_5xx"] = rate_5xx
    traffic["errors_5xx"] = errors_5xx

    # 6. Estado de Outlook (cacheado + timeout: nunca bloquea el endpoint).
    outlook_status, outlook_gal_latency_ms = get_outlook_status()

    # 7. Base de datos rendimiento y flujo
    db_size_kb = 0
    if os.path.exists(DB_PATH):
        db_size_kb = os.path.getsize(DB_PATH) / 1024

    db_latency_ms = -1
    cases_count = 0
    events_count = 0
    start_time = time.perf_counter()
    try:
        with get_db() as db:
            db.execute("SELECT 1").fetchone()
            db_latency_ms = (time.perf_counter() - start_time) * 1000
            cases_count = db.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
            events_count = db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    except Exception:
        pass

    # Integridad de fondo y rápida
    with _integrity_lock:
        db_integrity = _db_integrity_status["status"]
        db_integrity_last_checked = _db_integrity_status["last_checked"]

    db_integrity_quick = "Desconocido"
    try:
        with get_db() as db:
            row = db.execute("PRAGMA quick_check").fetchone()
            db_integrity_quick = row[0] if row else "Error"
    except Exception as e:
        db_integrity_quick = f"Error: {e}"

    wal_size_kb = 0.0
    try:
        wal_path = DB_PATH.parent / f"{DB_PATH.name}-wal"
        if wal_path.exists():
            wal_size_kb = round(os.path.getsize(wal_path) / 1024, 1)
    except Exception:
        pass

    # Backup status
    last_backup_info = {"date": "Ninguno", "size_mb": 0.0, "status": "Inactivo"}
    try:
        backups = sorted(BACKUP_DIR.glob("data_*.db"))
        if backups:
            last_backup = backups[-1]
            stat = last_backup.stat()
            last_backup_info = {
                "date": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "status": "Exitoso"
            }
        else:
            last_backup_info["status"] = "Sin copias"
    except Exception as e:
        last_backup_info["status"] = f"Error: {e}"

    # Inbox Scans count
    inbox_files_count = 0
    try:
        from Backend.config import INBOX_SCANS_DIR
        inbox_files_count = len([f for f in INBOX_SCANS_DIR.iterdir() if f.is_file()])
    except Exception:
        pass

    # Failed logins 24h
    failed_logins_24h = 0
    limit_time_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    try:
        with get_db() as db:
            row = db.execute(
                "SELECT COUNT(*) FROM audit_logs WHERE action = 'LOGIN_FAILED' AND timestamp >= ?",
                (limit_time_24h,)
            ).fetchone()
            failed_logins_24h = row[0] if row else 0
    except Exception:
        pass

    # Failed logins grouped by IP in the last 24h
    failed_logins_by_ip = []
    try:
        with get_db() as db:
            rows = db.execute(
                """SELECT ip, COUNT(*) as count 
                   FROM audit_logs 
                   WHERE action = 'LOGIN_FAILED' AND timestamp >= ? 
                   GROUP BY ip 
                   ORDER BY count DESC""",
                (limit_time_24h,)
            ).fetchall()
            for r in rows:
                failed_logins_by_ip.append({
                    "ip": r["ip"],
                    "count": r["count"]
                })
    except Exception:
        pass

    # Concurrent active sessions (multiple IPs for the same user in the last 15 minutes)
    concurrent_sessions = []
    limit_time_15m = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    try:
        with get_db() as db:
            rows = db.execute(
                """SELECT username, COUNT(DISTINCT ip) as ip_count, GROUP_CONCAT(DISTINCT ip) as ips
                   FROM audit_logs
                   WHERE timestamp >= ? AND username IS NOT NULL AND username != ''
                   GROUP BY username
                   HAVING ip_count > 1""",
                (limit_time_15m,)
            ).fetchall()
            for r in rows:
                concurrent_sessions.append({
                    "username": r["username"],
                    "ip_count": r["ip_count"],
                    "ips": list(set(r["ips"].split(","))) # remover duplicados si hay
                })
    except Exception:
        pass

    # 8. Logs de error / Warnings en memoria
    latest_logs = list(memory_log_handler.log_queue)
    latest_logs.reverse() # Más nuevos primero

    # 9. Historial de telemetría (últimas 24h)
    telemetry_history = []
    try:
        with get_db() as db:
            rows = db.execute(
                """SELECT timestamp, cpu_percent, ram_percent, db_latency, disk_free_gb 
                   FROM telemetry_history 
                   ORDER BY timestamp ASC"""
            ).fetchall()
            for r in rows:
                telemetry_history.append({
                    "timestamp": r["timestamp"],
                    "cpu_percent": r["cpu_percent"],
                    "ram_percent": r["ram_percent"],
                    "db_latency": r["db_latency"],
                    "disk_free_gb": r["disk_free_gb"]
                })
    except Exception:
        pass

    return jsonify({
        "environment": ENV,
        "cpu_percent": round(cpu_percent, 1),
        "cpu_cores": cpu_cores,
        "ram_percent": round(ram_percent, 1),
        "ram_rss_mb": round(ram_rss_mb, 1),
        "ram_total_gb": ram_total_gb,
        "ram_used_gb": ram_used_gb,
        "process_cpu_percent": round(process_cpu_percent, 1),
        "top_processes": top_processes,
        "active_threads": active_threads,
        "active_users": active_users,
        "action_logs": action_logs,
        "traffic": traffic,
        "outlook_status": outlook_status,
        "outlook_gal_latency_ms": outlook_gal_latency_ms,
        "uptime": get_uptime_str(),
        "os_uptime": get_os_uptime_str(),
        "disk": {
            "total_gb": disk_total_gb,
            "free_gb": disk_free_gb,
            "free_percent": disk_free_percent
        },
        "database": {
            "size_kb": round(db_size_kb, 1),
            "latency_ms": round(db_latency_ms, 2) if db_latency_ms >= 0 else "Error",
            "cases_count": cases_count,
            "events_count": events_count,
            "integrity": db_integrity,
            "integrity_last_checked": db_integrity_last_checked,
            "integrity_quick": db_integrity_quick,
            "wal_size_kb": wal_size_kb
        },
        "backup": last_backup_info,
        "inbox": {
            "files_count": inbox_files_count
        },
        "security": {
            "failed_logins_24h": failed_logins_24h,
            "failed_logins_by_ip": failed_logins_by_ip,
            "concurrent_sessions": concurrent_sessions
        },
        "latest_logs": latest_logs,
        "telemetry_history": telemetry_history
    })


@metrics_bp.route("/api/secret/metrics/export-logs", methods=["GET"])
def export_logs():
    if "user_id" not in session or session.get("role_id") != 2:
        return abort(404)
        
    try:
        output = []
        output.append("=== REPORTE DE AUDITORÍA Y METRICAS ===")
        output.append(f"Fecha: {datetime.now(timezone.utc).isoformat()}")
        output.append("")
        
        output.append("=== LOGS DEL SERVIDOR EN MEMORIA ===")
        for log in list(memory_log_handler.log_queue):
            output.append(f"[{log.get('timestamp')}] [{log.get('level')}] {log.get('message')}")
        output.append("")
        
        output.append("=== HISTORIAL DE AUDITORÍA (ÚLTIMOS 200 REGISTROS) ===")
        output.append("Fecha,Usuario,Acción,Detalles,IP")
        with get_db() as db:
            rows = db.execute(
                """SELECT timestamp, username, action, details, ip 
                   FROM audit_logs 
                   ORDER BY timestamp DESC 
                   LIMIT 200"""
            ).fetchall()
            for r in rows:
                details_esc = (r["details"] or "").replace('"', '""')
                output.append(f'"{r["timestamp"]}","{r["username"]}","{r["action"]}","{details_esc}","{r["ip"]}"')
                
        from flask import Response
        return Response(
            "\n".join(output),
            mimetype="text/plain",
            headers={"Content-disposition": "attachment; filename=server_audit_logs.txt"}
        )
    except Exception as e:
        return jsonify({"error": f"Error al exportar logs: {e}"}), 500


# ── CRUD USUARIOS ─────────────────────────────────────────────────────────────

@metrics_bp.route("/api/secret/users", methods=["GET"])
def list_users():
    if "user_id" not in session or session.get("role_id") != 2:
        return abort(404)
    with get_db() as db:
        rows = db.execute(
            """SELECT u.id, u.username, u.organization, u.name, u.email, CAST(u.role AS INTEGER) as role_id, r.name as role, u.nivel 
               FROM users u
               LEFT JOIN roles r ON u.role = r.id
               ORDER BY u.username"""
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@metrics_bp.route("/api/secret/users", methods=["POST"])
def create_user():
    if "user_id" not in session or session.get("role_id") != 2:
        return abort(404)
    data = request.json or {}
    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()
    org = (data.get("organization") or "").strip()
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    role_id = int(data.get("role_id") or 1)
    nivel = int(data.get("nivel") or 1)

    if not (username and password and org and name and email):
        return jsonify({"error": "Todos los campos son obligatorios"}), 400
    if role_id not in (1, 2):
        role_id = 1
    if nivel not in (1, 2):
        nivel = 1

    from Backend.utils import hash_password, new_id, log_action
    hashed = hash_password(password)
    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO users (id, username, password, organization, name, email, role, nivel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (new_id(), username, hashed, org, name, email, role_id, nivel)
            )
            db.commit()
        log_action("CREATE_USER", f"Creado usuario '{username}' con rol '{role_id}', nivel '{nivel}'")
        return jsonify({"ok": True})
    except sqlite3.IntegrityError:
        return jsonify({"error": "El nombre de usuario ya existe"}), 400


@metrics_bp.route("/api/secret/users/<user_id>", methods=["PUT"])
def update_user(user_id):
    if "user_id" not in session or session.get("role_id") != 2:
        return abort(404)
    data = request.json or {}
    org = (data.get("organization") or "").strip()
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    role_id = int(data.get("role_id") or 1)
    nivel = int(data.get("nivel") or 1)

    if not (org and name and email and role_id):
        return jsonify({"error": "Todos los campos son obligatorios"}), 400
    if role_id not in (1, 2):
        return jsonify({"error": "Rol inválido"}), 400
    if nivel not in (1, 2):
        nivel = 1

    from Backend.utils import log_action
    with get_db() as db:
        db.execute(
            "UPDATE users SET organization = ?, name = ?, email = ?, role = ?, nivel = ? WHERE id = ?",
            (org, name, email, role_id, nivel, user_id)
        )
        # Cambio de contraseña opcional
        new_pw = (data.get("password") or "").strip()
        if new_pw:
            from Backend.utils import hash_password
            db.execute("UPDATE users SET password = ? WHERE id = ?", (hash_password(new_pw), user_id))
        db.commit()
    log_action("UPDATE_USER", f"Actualizado perfil de usuario ID '{user_id}' (Rol ID: '{role_id}', Nivel: '{nivel}')")
    return jsonify({"ok": True})


@metrics_bp.route("/api/secret/users/<user_id>/reset-password", methods=["POST"])
def reset_user_password(user_id):
    if "user_id" not in session or session.get("role_id") != 2:
        return abort(404)
    
    # Genera contraseña temporal de 8 caracteres
    temp_pw = "Temp" + secrets.token_urlsafe(6)[:8]
    from Backend.utils import hash_password, log_action
    hashed = hash_password(temp_pw)

    with get_db() as db:
        user = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return jsonify({"error": "Usuario no encontrado"}), 404
        db.execute("UPDATE users SET password = ? WHERE id = ?", (hashed, user_id))
        db.commit()
    
    log_action("RESET_PASSWORD", f"Blanqueada contraseña de usuario '{user['username']}'")
    return jsonify({"ok": True, "temporary_password": temp_pw})


@metrics_bp.route("/api/secret/users/<user_id>", methods=["DELETE"])
def delete_user(user_id):
    if "user_id" not in session or session.get("role_id") != 2:
        return abort(404)
    if user_id == session.get("user_id"):
        return jsonify({"error": "No puedes eliminar tu propio usuario"}), 400

    from Backend.utils import log_action
    with get_db() as db:
        user = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return jsonify({"error": "Usuario no encontrado"}), 404
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        db.commit()

    log_action("DELETE_USER", f"Eliminado usuario '{user['username']}'")
    return jsonify({"ok": True})


# ── DASHBOARD HTML ────────────────────────────────────────────────────────────

@metrics_bp.route("/secret-metrics", methods=["GET"])
def view_metrics_dashboard():
    if "user_id" not in session or session.get("role_id") != 2:
        return abort(404)

    html = """<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OrgWo Server Telemetry & Admin</title>
    <script src="https://cdn.jsdelivr.net/npm/lucide@0.453.0/dist/umd/lucide.min.js"></script>
    <style>
        :root {
            --bg: #0b0b0e;
            --surface: #13131a;
            --surface-2: #1c1c24;
            --border: rgba(255, 255, 255, 0.06);
            --border-hover: rgba(255, 255, 255, 0.12);
            --text: #f3f3f5;
            --text-muted: #8e8e9c;
            --primary: #0078d4;
            --primary-glow: rgba(0, 120, 212, 0.15);
            --success: #107c10;
            --warning: #ffaa00;
            --danger: #d13438;
            --radius: 8px;
            --font: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: var(--bg);
            color: var(--text);
            font-family: var(--font);
            padding: 24px;
            line-height: 1.5;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 16px;
        }

        h1 { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .env-badge {
            background: var(--primary-glow);
            color: var(--primary);
            font-size: 11px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 99px;
            text-transform: uppercase;
        }

        .controls { display: flex; align-items: center; gap: 12px; }
        .btn {
            background: var(--surface-2);
            border: 1px solid var(--border);
            color: var(--text);
            padding: 6px 12px;
            border-radius: var(--radius);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .btn:hover { border-color: var(--border-hover); background: #23232e; }
        .btn-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
        .btn-primary:hover { background: #005a9e; }
        .btn-danger { background: rgba(209, 52, 56, 0.15); border-color: rgba(209, 52, 56, 0.3); color: var(--danger); }
        .btn-danger:hover { background: rgba(209, 52, 56, 0.25); }

        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transition: transform 0.22s ease;
        }
        .card:hover { transform: translateY(-2px); }
        .card.alert-success {
            border-color: rgba(16, 124, 16, 0.4);
            background: linear-gradient(135deg, var(--surface) 0%, rgba(16, 124, 16, 0.05) 100%);
        }
        .card.alert-warning {
            border-color: rgba(255, 170, 0, 0.4);
            background: linear-gradient(135deg, var(--surface) 0%, rgba(255, 170, 0, 0.05) 100%);
        }
        .card.alert-danger {
            border-color: rgba(209, 52, 56, 0.4);
            background: linear-gradient(135deg, var(--surface) 0%, rgba(209, 52, 56, 0.05) 100%);
        }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: var(--text-muted);
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .card-val { font-size: 24px; font-weight: 700; color: #fff; }
        
        .progress-container {
            width: 100%;
            height: 6px;
            background: var(--surface-2);
            border-radius: 99px;
            overflow: hidden;
            margin-top: 4px;
        }
        .progress-bar {
            height: 100%;
            background: var(--primary);
            width: 0%;
            transition: width 0.5s ease;
        }

        .section-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 24px;
        }
        @media(max-width: 900px) { .section-grid { grid-template-columns: 1fr; } }

        .panel {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            max-height: 400px;
            overflow: hidden;
        }

        .panel-title {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            color: var(--text-muted);
            border-bottom: 1px solid var(--border);
            padding-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .scroll-area {
            flex: 1;
            overflow-y: auto;
            font-size: 12px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }
        th, td {
            padding: 8px;
            border-bottom: 1px solid var(--border);
            vertical-align: middle;
        }
        th { color: var(--text-muted); font-weight: 600; }
        
        .log-item {
            padding: 8px;
            border-bottom: 1px solid var(--border);
            font-family: monospace;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .log-meta { display: flex; justify-content: space-between; font-size: 10px; }
        .log-lvl { font-weight: 700; padding: 1px 4px; border-radius: 4px; }
        .lvl-WARNING { background: rgba(255, 170, 0, 0.15); color: var(--warning); }
        .lvl-ERROR { background: rgba(209, 52, 56, 0.15); color: var(--danger); }

        .role-badge {
            font-size: 10px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            text-transform: uppercase;
        }
        .role-tecnico { background: rgba(255,255,255,0.08); color: var(--text-muted); }
        .role-dispatcher { background: var(--primary-glow); color: var(--primary); }

        /* MODAL */
        .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.65);
            backdrop-filter: blur(2px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease;
        }
        .modal-overlay.open {
            opacity: 1;
            pointer-events: auto;
        }
        .modal {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 20px;
            width: 90%;
            max-width: 400px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
            padding-bottom: 10px;
        }
        .modal-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .modal-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .modal-field label {
            font-size: 11px;
            color: var(--text-muted);
            font-weight: 600;
        }
        .modal-field input, .modal-field select {
            background: var(--surface-2);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 8px 10px;
            color: var(--text);
            font-family: inherit;
            font-size: 13px;
        }
        .modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            border-top: 1px solid var(--border);
            padding-top: 12px;
        }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 99px; }
    </style>
</head>
<body>

    <header>
        <h1><i data-lucide="activity"></i> OrgWo Telemetría & Administración <span class="env-badge" id="envBadge">...</span></h1>
        <div class="controls">
            <button class="btn" id="btnRefresh" onclick="refreshAll()"><i data-lucide="refresh-cw"></i> Refrescar</button>
            <label style="font-size:12px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" id="chkAuto" checked> Auto 3s
            </label>
        </div>
    </header>

    <div class="dashboard-grid">
        <div class="card">
            <div class="card-header">CPU Uso <i data-lucide="cpu"></i></div>
            <div class="card-val" id="valCpu">0%</div>
            <div class="progress-container"><div class="progress-bar" id="barCpu"></div></div>
        </div>
        <div class="card">
            <div class="card-header">RAM Consumo <i data-lucide="database"></i></div>
            <div class="card-val" id="valRam">0%</div>
            <div class="progress-container"><div class="progress-bar" id="barRam"></div></div>
            <div style="font-size:10px; color:var(--text-muted);" id="valRamRss">Proceso: 0 MB</div>
        </div>
        <div class="card">
            <div class="card-header">Hilos de Servidor <i data-lucide="git-branch"></i></div>
            <div class="card-val" id="valThreads">0</div>
        </div>
        <div class="card">
            <div class="card-header">Latencia Base de Datos <i data-lucide="clock"></i></div>
            <div class="card-val" id="valDbLatency">0 ms</div>
            <div style="font-size:10px; color:var(--text-muted);" id="valDbMeta">Casos: 0 | Eventos: 0</div>
        </div>
        <div class="card" id="cardOutlook">
            <div class="card-header">Outlook GAL Servicio <i data-lucide="mail"></i></div>
            <div class="card-val" id="valOutlook" style="font-size:14px; word-break:break-all;">...</div>
        </div>
        <div class="card" id="cardDisk">
            <div class="card-header">Almacenamiento <i data-lucide="hard-drive"></i></div>
            <div class="card-val" id="valDisk">0 GB lib</div>
            <div class="progress-container"><div class="progress-bar" id="barDisk"></div></div>
            <div style="font-size:10px; color:var(--text-muted);" id="valDiskSub">0 GB total</div>
        </div>
        <div class="card">
            <div class="card-header">Uptime Servidor <i data-lucide="clock"></i></div>
            <div class="card-val" id="valUptime">0m</div>
        </div>
        <div class="card" id="cardIntegrity">
            <div class="card-header">Integridad & WAL <i data-lucide="shield-check"></i></div>
            <div class="card-val" id="valDbIntegrity">...</div>
            <div style="font-size:10px; color:var(--text-muted);" id="valWalSize">WAL: 0 KB</div>
        </div>
        <div class="card" id="cardBackup">
            <div class="card-header">Copia de Seguridad & Inbox <i data-lucide="archive"></i></div>
            <div class="card-val" id="valBackupStatus" style="font-size:14px;">...</div>
            <div style="font-size:10px; color:var(--text-muted);" id="valBackupSub">Sin info</div>
        </div>
        <div class="card" id="cardSecurity">
            <div class="card-header">Seguridad (24h) <i data-lucide="shield-alert"></i></div>
            <div class="card-val" id="valSecurityAlerts">0 intentos fallidos</div>
        </div>
    </div>

    <!-- PANEL GESTION DE USUARIOS (CRUD) -->
    <div class="section-grid" style="grid-template-columns: 1fr; margin-bottom: 24px;">
        <div class="panel" style="max-height: 500px;">
            <div class="panel-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span><i data-lucide="users"></i> Gestión de Usuarios</span>
                <button class="btn btn-primary" onclick="openCreateModal()"><i data-lucide="user-plus"></i> Crear Nuevo Usuario</button>
            </div>
            <div class="scroll-area">
                <table id="tblManageUsers">
                    <thead>
                        <tr>
                            <th>Usuario</th>
                            <th>Nombre Completo</th>
                            <th>Email</th>
                            <th>Organización</th>
                            <th>Rol</th>
                            <th style="text-align: right;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="section-grid">
        <div class="panel">
            <div class="panel-title"><i data-lucide="users"></i> Usuarios Activos (15m)</div>
            <div class="scroll-area">
                <table id="tblUsers">
                    <thead>
                        <tr><th>Usuario</th><th>Último Acceso</th><th>IP</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>

        <div class="panel">
            <div class="panel-title"><i data-lucide="globe"></i> Tráfico de Red y Rutas</div>
            <div class="scroll-area">
                <table id="tblTraffic">
                    <thead>
                        <tr><th>Ruta / Endpoint</th><th>Peticiones</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="section-grid">
        <div class="panel" style="grid-column: span 2; max-height: 450px;">
            <div class="panel-title"><i data-lucide="clipboard-list"></i> Registro de Acciones por Usuario</div>
            <div class="scroll-area">
                <table id="tblAudit">
                    <thead>
                        <tr><th>Hora</th><th>Usuario</th><th>Acción</th><th>Detalles</th><th>IP</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="section-grid">
        <div class="panel" style="grid-column: span 2; max-height: 400px; border-color: rgba(209,52,56,0.2);">
            <div class="panel-title" style="color:var(--danger); border-color:rgba(209,52,56,0.1);"><i data-lucide="alert-triangle"></i> Logs de Error y Advertencias (Memory Buffer)</div>
            <div class="scroll-area" id="logContainer"></div>
        </div>
    </div>

    <!-- MODAL CREAR USUARIO -->
    <div class="modal-overlay" id="modalCreate">
        <div class="modal">
            <div class="modal-header">
                <h3>Crear Nuevo Usuario</h3>
                <button class="btn" style="padding:2px 6px;" onclick="closeModal('modalCreate')"><i data-lucide="x"></i></button>
            </div>
            <div class="modal-body">
                <div class="modal-field">
                    <label>Nombre de Usuario</label>
                    <input type="text" id="cUser" placeholder="Ej: jperez">
                </div>
                <div class="modal-field">
                    <label>Contraseña Inicial</label>
                    <input type="password" id="cPass" placeholder="Contraseña">
                </div>
                <div class="modal-field">
                    <label>Nombre Completo</label>
                    <input type="text" id="cName" placeholder="Ej: Juan Pérez">
                </div>
                <div class="modal-field">
                    <label>Email</label>
                    <input type="email" id="cEmail" placeholder="Ej: jperez@empresa.com">
                </div>
                <div class="modal-field">
                    <label>Organización / Empresa</label>
                    <input type="text" id="cOrg" placeholder="Ej: Empresa Principal">
                </div>
                <div class="modal-field">
                    <label>Rol</label>
                    <select id="cRole">
                        <option value="1">Técnico</option>
                        <option value="2">Dispatcher (Jefe)</option>
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="closeModal('modalCreate')">Cancelar</button>
                <button class="btn btn-primary" onclick="submitCreateUser()">Crear Usuario</button>
            </div>
        </div>
    </div>

    <!-- MODAL EDITAR USUARIO -->
    <div class="modal-overlay" id="modalEdit">
        <div class="modal">
            <div class="modal-header">
                <h3>Editar Usuario</h3>
                <input type="hidden" id="eId">
                <button class="btn" style="padding:2px 6px;" onclick="closeModal('modalEdit')"><i data-lucide="x"></i></button>
            </div>
            <div class="modal-body">
                <div class="modal-field">
                    <label>Nombre de Usuario (Solo lectura)</label>
                    <input type="text" id="eUser" disabled>
                </div>
                <div class="modal-field">
                    <label>Nombre Completo</label>
                    <input type="text" id="eName">
                </div>
                <div class="modal-field">
                    <label>Email</label>
                    <input type="email" id="eEmail">
                </div>
                <div class="modal-field">
                    <label>Organización / Empresa</label>
                    <input type="text" id="eOrg">
                </div>
                <div class="modal-field">
                    <label>Rol</label>
                    <select id="eRole">
                        <option value="1">Técnico</option>
                        <option value="2">Dispatcher (Jefe)</option>
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="closeModal('modalEdit')">Cancelar</button>
                <button class="btn btn-primary" onclick="submitEditUser()">Guardar Cambios</button>
            </div>
        </div>
    </div>

    <script>
        lucide.createIcons();

        function openModal(id) {
            document.getElementById(id).classList.add('open');
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('open');
        }

        function refreshAll() {
            refreshMetrics();
            refreshUsers();
        }

        function refreshMetrics() {
            const btn = document.getElementById('btnRefresh');
            btn.disabled = true;
            fetch('/api/secret/metrics')
                .then(res => res.json())
                .then(data => {
                    document.getElementById('envBadge').textContent = data.environment;
                    
                    // CPU
                    document.getElementById('valCpu').textContent = data.cpu_percent + '%';
                    document.getElementById('barCpu').style.width = data.cpu_percent + '%';
                    
                    // RAM
                    document.getElementById('valRam').textContent = data.ram_percent + '%';
                    document.getElementById('barRam').style.width = data.ram_percent + '%';
                    document.getElementById('valRamRss').textContent = 'Proceso: ' + data.ram_rss_mb + ' MB';
                    
                    // Hilos
                    document.getElementById('valThreads').textContent = data.active_threads;
                    
                    // DB
                    document.getElementById('valDbLatency').textContent = typeof data.database.latency_ms === 'number' ? data.database.latency_ms.toFixed(2) + ' ms' : data.database.latency_ms;
                    document.getElementById('valDbMeta').textContent = 'Casos: ' + data.database.cases_count + ' | Eventos: ' + data.database.events_count + ' | Tam: ' + (data.database.size_kb).toFixed(1) + ' KB';
                    
                    // Outlook
                    document.getElementById('valOutlook').textContent = data.outlook_status;
                    const cardOutlook = document.getElementById('cardOutlook');
                    cardOutlook.className = 'card';
                    if (data.outlook_status.startsWith('Activo')) {
                        cardOutlook.classList.add('alert-success');
                    } else {
                        cardOutlook.classList.add('alert-warning');
                    }

                    // Disk
                    const diskFreePct = data.disk.free_percent;
                    const diskUsedPct = 100 - diskFreePct;
                    document.getElementById('valDisk').textContent = data.disk.free_gb + ' GB (' + diskFreePct + '%)';
                    document.getElementById('barDisk').style.width = diskUsedPct + '%';
                    document.getElementById('valDiskSub').textContent = 'Total: ' + data.disk.total_gb + ' GB';
                    
                    const cardDisk = document.getElementById('cardDisk');
                    cardDisk.className = 'card';
                    if (diskFreePct < 10) {
                        cardDisk.classList.add('alert-danger');
                    } else if (diskFreePct < 20) {
                        cardDisk.classList.add('alert-warning');
                    } else {
                        cardDisk.classList.add('alert-success');
                    }
                    
                    // Uptime
                    document.getElementById('valUptime').textContent = data.uptime;
                    
                    // Integrity
                    document.getElementById('valDbIntegrity').textContent = data.database.integrity;
                    document.getElementById('valWalSize').textContent = 'WAL: ' + data.database.wal_size_kb + ' KB';
                    const cardIntegrity = document.getElementById('cardIntegrity');
                    cardIntegrity.className = 'card';
                    if (data.database.integrity === 'ok') {
                        cardIntegrity.classList.add('alert-success');
                    } else {
                        cardIntegrity.classList.add('alert-danger');
                    }
                    
                    // Backup & Inbox
                    document.getElementById('valBackupStatus').textContent = 'Último: ' + data.backup.date;
                    document.getElementById('valBackupSub').textContent = 'Backup: ' + data.backup.size_mb + ' MB | Inbox: ' + data.inbox.files_count + ' archivos';
                    const cardBackup = document.getElementById('cardBackup');
                    cardBackup.className = 'card';
                    if (data.backup.status === 'Exitoso') {
                        cardBackup.classList.add('alert-success');
                    } else {
                        cardBackup.classList.add('alert-danger');
                    }
                    
                    // Security
                    const failedLogins = data.security.failed_logins_24h;
                    document.getElementById('valSecurityAlerts').textContent = failedLogins + ' intentos fallidos';
                    const cardSecurity = document.getElementById('cardSecurity');
                    cardSecurity.className = 'card';
                    if (failedLogins > 5) {
                        cardSecurity.classList.add('alert-danger');
                    } else if (failedLogins > 0) {
                        cardSecurity.classList.add('alert-warning');
                    } else {
                        cardSecurity.classList.add('alert-success');
                    }

                    // Tbl Usuarios Activos
                    const userBody = document.getElementById('tblUsers').querySelector('tbody');
                    userBody.innerHTML = '';
                    data.active_users.forEach(u => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `<td><b>${u.username}</b></td><td>${u.last_seen.split('T')[1].substring(0,8)}</td><td>${u.ip}</td>`;
                        userBody.appendChild(tr);
                    });
                    if (data.active_users.length === 0) {
                        userBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Sin actividad en los últimos 15 min</td></tr>';
                    }

                    // Tbl Tráfico
                    const trafficBody = document.getElementById('tblTraffic').querySelector('tbody');
                    trafficBody.innerHTML = '';
                    const paths = Object.entries(data.traffic.paths).sort((a,b) => b[1] - a[1]).slice(0, 10);
                    paths.forEach(([path, count]) => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `<td><code>${path}</code></td><td><b>${count}</b></td>`;
                        trafficBody.appendChild(tr);
                    });
                    if (paths.length === 0) {
                        trafficBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-muted)">Sin tráfico registrado</td></tr>';
                    }

                    // Tbl Auditoría
                    const auditBody = document.getElementById('tblAudit').querySelector('tbody');
                    auditBody.innerHTML = '';
                    data.action_logs.forEach(l => {
                        const tr = document.createElement('tr');
                        const time = l.timestamp.split('T')[1].substring(0,8);
                        tr.innerHTML = `<td>${time}</td><td><b>${l.username}</b></td><td><span style="color:var(--primary);font-weight:700">${l.action}</span></td><td>${l.details || ''}</td><td>${l.ip}</td>`;
                        auditBody.appendChild(tr);
                    });
                    if (data.action_logs.length === 0) {
                        auditBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No hay logs de acciones</td></tr>';
                    }

                    // Log Buffer
                    const logContainer = document.getElementById('logContainer');
                    logContainer.innerHTML = '';
                    data.latest_logs.forEach(l => {
                        const div = document.createElement('div');
                        div.className = 'log-item';
                        const time = l.timestamp.split('T')[1].substring(0,8);
                        div.innerHTML = `
                            <div class="log-meta">
                                <span>${time} - <b>${l.logger}</b></span>
                                <span class="log-lvl lvl-${l.level}">${l.level}</span>
                            </div>
                            <div style="margin-top:2px;">${l.message}</div>
                        `;
                        logContainer.appendChild(div);
                    });
                    if (data.latest_logs.length === 0) {
                        logContainer.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px;">Todo limpio, no se han registrado advertencias ni errores en memoria.</div>';
                    }

                    btn.disabled = false;
                })
                .catch(() => { btn.disabled = false; });
        }

        // --- GESTION DE USUARIOS (CRUD) ---

        let allUsers = [];

        function refreshUsers() {
            fetch('/api/secret/users')
                .then(res => res.json())
                .then(users => {
                    allUsers = users;
                    const body = document.getElementById('tblManageUsers').querySelector('tbody');
                    body.innerHTML = '';
                    users.forEach(u => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td><b>${u.username}</b></td>
                            <td>${u.name}</td>
                            <td>${u.email}</td>
                            <td>${u.organization}</td>
                            <td><span class="role-badge role-${u.role}">${parseInt(u.role_id) === 2 ? 'Dispatcher' : 'Técnico'}</span></td>
                            <td style="text-align: right; display:flex; justify-content:flex-end; gap:6px;">
                                <button class="btn" style="padding:2px 8px;" onclick="openEditModal('${u.id}')" title="Editar datos"><i data-lucide="edit-2" style="width:12px;height:12px;"></i> Editar</button>
                                <button class="btn" style="padding:2px 8px; color:var(--warning); border-color:rgba(255,170,0,0.2);" onclick="resetPassword('${u.id}')" title="Blanquear Contraseña"><i data-lucide="key" style="width:12px;height:12px;"></i> Blanquear</button>
                                <button class="btn btn-danger" style="padding:2px 8px;" onclick="deleteUser('${u.id}')" title="Eliminar"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
                            </td>
                        `;
                        body.appendChild(tr);
                    });
                    lucide.createIcons();
                });
        }

        function openCreateModal() {
            document.getElementById('cUser').value = '';
            document.getElementById('cPass').value = '';
            document.getElementById('cName').value = '';
            document.getElementById('cEmail').value = '';
            document.getElementById('cOrg').value = '';
            document.getElementById('cRole').value = '1';
            openModal('modalCreate');
        }

        function submitCreateUser() {
            const username = document.getElementById('cUser').value.trim();
            const password = document.getElementById('cPass').value;
            const name = document.getElementById('cName').value.trim();
            const email = document.getElementById('cEmail').value.trim();
            const organization = document.getElementById('cOrg').value.trim();
            const role_id = parseInt(document.getElementById('cRole').value);

            if (!username || !password || !name || !email || !organization) {
                alert("Todos los campos son obligatorios");
                return;
            }

            fetch('/api/secret/users', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, password, name, email, organization, role_id})
            })
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    alert(data.error);
                } else {
                    closeModal('modalCreate');
                    refreshAll();
                }
            });
        }

        function openEditModal(userId) {
            const user = allUsers.find(u => u.id === userId);
            if (!user) return;
            document.getElementById('eId').value = user.id;
            document.getElementById('eUser').value = user.username;
            document.getElementById('eName').value = user.name;
            document.getElementById('eEmail').value = user.email;
            document.getElementById('eOrg').value = user.organization;
            document.getElementById('eRole').value = user.role_id;
            openModal('modalEdit');
        }

        function submitEditUser() {
            const id = document.getElementById('eId').value;
            const name = document.getElementById('eName').value.trim();
            const email = document.getElementById('eEmail').value.trim();
            const organization = document.getElementById('eOrg').value.trim();
            const role_id = parseInt(document.getElementById('eRole').value);

            if (!name || !email || !organization || !role_id) {
                alert("Todos los campos son obligatorios");
                return;
            }

            fetch('/api/secret/users/' + id, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name, email, organization, role_id})
            })
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    alert(data.error);
                } else {
                    closeModal('modalEdit');
                    refreshAll();
                }
            });
        }

        function resetPassword(userId) {
            const user = allUsers.find(u => u.id === userId);
            if (!user) return;
            if (!confirm(`¿Confirmas blanquear la contraseña del usuario ${user.username}? Se creará una clave temporal.`)) return;

            fetch('/api/secret/users/' + userId + '/reset-password', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.error) {
                        alert(data.error);
                    } else {
                        alert(`Contraseña restablecida exitosamente.\\n\\nClave temporal de inicio: ${data.temporary_password}\\n\\nPor favor, cópiala y compártela de forma segura.`);
                        refreshAll();
                    }
                });
        }

        function deleteUser(userId) {
            const user = allUsers.find(u => u.id === userId);
            if (!user) return;
            if (!confirm(`¿Estás seguro de eliminar permanentemente al usuario ${user.username}? Esta acción no se puede deshacer.`)) return;

            fetch('/api/secret/users/' + userId, { method: 'DELETE' })
                .then(res => res.json())
                .then(data => {
                    if (data.error) {
                        alert(data.error);
                    } else {
                        refreshAll();
                    }
                });
        }

        // Init
        refreshAll();
        setInterval(() => {
            if (document.getElementById('chkAuto').checked) {
                refreshMetrics();
            }
        }, 3000);
    </script>
</body>
</html>"""
    return render_template_string(html)
