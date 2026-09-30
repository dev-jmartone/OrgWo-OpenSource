import sys
from pathlib import Path
# Add base workspace folder to path to enable relative Backend namespace imports
sys.path.append(str(Path(__file__).parent.parent.resolve()))

import threading
import webbrowser
from flask import Flask, abort, send_from_directory

from Backend.config import HOST, PORT, SECRET_KEY, ENV, DB_PATH, BACKUP_DIR, BASE_DIR
from Backend.base_datos.schema import init_db
from Backend.servicios.backup import service_auto_backup
from Backend.api.auth_routes import auth_bp
from Backend.api.cases_routes import cases_bp
from Backend.api.attachments_routes import attachments_bp
from Backend.api.settings_routes import settings_bp
from Backend.api.remedy_routes import remedy_bp
from Backend.api.users_lookup import users_lookup_bp

from Backend.api.stream_routes import stream_bp
from Backend.api.metrics_routes import metrics_bp
from Backend.api.admin_stats_routes import admin_stats_bp

FRONTEND_DIR = BASE_DIR / "Frontend"

BACKUP_DIR.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=None)
app.secret_key = SECRET_KEY

# Register Blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(cases_bp)
app.register_blueprint(attachments_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(remedy_bp)
app.register_blueprint(users_lookup_bp)
app.register_blueprint(stream_bp)
app.register_blueprint(metrics_bp)
app.register_blueprint(admin_stats_bp)

@app.route("/")
def route_index():
    resp = send_from_directory(FRONTEND_DIR, "index.html")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp


from flask import request


@app.route("/<path:filename>")
def route_static(filename):
    if filename.startswith(("api/", "backups/")):
        abort(404)
    
    # Intenta servir desde la carpeta Frontend
    full = FRONTEND_DIR / filename
    if full.is_file():
        resp = send_from_directory(FRONTEND_DIR, filename)
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return resp
    abort(404)


from Backend.utils import traffic_telemetry, traffic_lock, record_user_activity
from flask import session

@app.before_request
def record_active_user():
    try:
        username = session.get("username")
        if username:
            ip = request.headers.get("X-Forwarded-For", request.remote_addr) or request.remote_addr
            record_user_activity(username, ip)
    except Exception:
        pass

@app.after_request
def telemetry_after_request(response):
    try:
        # Prevent browser caching on all API endpoints to avoid stale data on login or view change
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"

        # Ignorar archivos estaticos CSS/JS de la telemetria de paths para evitar ruido
        path = request.path
        if not path.endswith((".js", ".css", ".png", ".jpg", ".ico", ".woff", ".woff2", ".svg")):
            with traffic_lock:
                traffic_telemetry["requests_total"] += 1
                code = str(response.status_code)
                traffic_telemetry["status_codes"][code] = traffic_telemetry["status_codes"].get(code, 0) + 1
                if len(traffic_telemetry["paths"]) < 50 or path in traffic_telemetry["paths"]:
                    traffic_telemetry["paths"][path] = traffic_telemetry["paths"].get(path, 0) + 1
            # Registrar 4xx/5xx con el endpoint en los logs del servidor (se ven en
            # el panel de metricas via memory_log_handler, que captura WARNING+).
            if response.status_code >= 400:
                import logging
                logging.getLogger("orgwo.http").warning(
                     f"HTTP {response.status_code} {request.method} {path}"
                )
    except Exception:
        pass
    return response



def _open_browser() -> None:
    # Si el server bindea a 0.0.0.0/:: (ej. dentro de Docker) esa no es una URL
    # navegable; abrir siempre contra loopback.
    display_host = "127.0.0.1" if HOST in ("127.0.0.1", "::") else HOST
    webbrowser.open(f"http://{display_host}:{PORT}/")

# Inicialización al cargar la app (para que Gunicorn también lo ejecute)
init_db()
service_auto_backup()


# Iniciar despachador automático
try:
    from Backend.servicios.dispatcher import start_dispatcher_thread
    start_dispatcher_thread()
except Exception as _err:
    print(f"[dispatcher] no arranco: {_err}")


# Pobla / backfilea el directorio de usuarios:
#  1. Importa al directorio los cases que ya tienen email.
#  2. En background: para cases sin email, hace lookup contra Outlook GAL y
#     actualiza tanto el directorio como el case. No bloquea el arranque.
try:
    from Backend.servicios.users_directory import run_startup_seed_and_backfill
    run_startup_seed_and_backfill(in_background=True)
except Exception as _err:
    print(f"[users_directory] no arranco backfill: {_err}")


if __name__ == "__main__":
    print("=" * 60)
    print(f"  OrgWo — Open Work Orders & Workspace Orchestrator [{ENV}]")
    print("=" * 60)
    print(f"  DB:      {DB_PATH}")
    print(f"  Backups: {BACKUP_DIR}")
    print(f"  URL:     http://{HOST}:{PORT}/")
    print("=" * 60)
    print()
    
    
    threading.Timer(1.0, _open_browser).start()
    try:
        from waitress import serve
        serve(app, host=HOST, port=PORT, threads=32)
    except ImportError:
        app.run(host=HOST, port=PORT, debug=False, use_reloader=False, threaded=True)

