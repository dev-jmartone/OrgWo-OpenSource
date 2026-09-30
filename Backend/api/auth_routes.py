"""Rutas Flask de autenticacion. Thin: parsean request, llaman a logica
con get_db / hash_password / session, devuelven jsonify.

TODO: extraer logica embedded a Backend/servicios/auth.py cuando se
estabilice. Por ahora rutas tienen lectura/escritura directa de DB para
no perder coherencia con la version original durante el split.
"""
import sqlite3
from flask import Blueprint, jsonify, request, session

from Backend.config import DB_PATH
from Backend.base_datos.connection import get_db
from Backend.utils import hash_password, check_password, new_id, current_user_id
from Backend.servicios import remedy_session

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/api/auth/register", methods=["POST"])
def route_register():
    # Alta de usuarios cerrada al publico: solo un dispatcher (role 2) logueado
    # puede crear cuentas. Antes cualquier request desde loopback podia
    # auto-registrarse en cualquier organization (con HOST=0.0.0.0 eso quedaba
    # expuesto a la red). El alta normal va por /api/secret/users.
    if session.get("role_id") != 2:
        return jsonify({"error": "Creación de usuarios restringida a administradores."}), 403

    data = request.json or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    org = (data.get("organization") or "").strip()
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    role = (data.get("role") or "").strip() or "tecnico"

    if not (username and password and org and name and email):
        return jsonify({"error": "Todos los campos son obligatorios"}), 400

    role_id = 2 if role.lower() == "dispatcher" else 1

    hashed = hash_password(password)
    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO users (id, username, password, organization, name, email, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (new_id(), username, hashed, org, name, email, role_id),
            )
            db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "El usuario ya existe"}), 400

    return jsonify({"ok": True}), 201


@auth_bp.route("/api/auth/login", methods=["POST"])
def route_login():
    data = request.json or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if not (username and password):
        return jsonify({"error": "Usuario y contraseña requeridos"}), 400

    with get_db() as db:
        row = db.execute(
            """SELECT u.*, r.name as role_name 
               FROM users u
               LEFT JOIN roles r ON u.role = r.id
               WHERE u.username = ?""",
            (username,),
        ).fetchone()

    if not row or not check_password(password, row["password"]):
        from Backend.utils import log_action
        log_action("LOGIN_FAILED", f"Intento de inicio de sesión fallido para el usuario '{username}'")
        return jsonify({"error": "Credenciales inválidas"}), 401

    session["user_id"] = row["id"]
    session["username"] = row["username"]
    session["organization"] = row["organization"]
    session["name"] = row["name"]
    session["email"] = row["email"]
    session["role_id"] = int(row["role"]) if row["role"] else 1
    session["role"] = row["role_name"] or "tecnico"
    session.pop("remedy_explicit_logout", None)

    from Backend.utils import log_action
    log_action("LOGIN", f"Usuario '{row['username']}' inició sesión.")

    return jsonify({
        "id": row["id"],
        "username": row["username"],
        "organization": row["organization"],
        "name": row["name"],
        "email": row["email"],
        "role_id": int(row["role"]) if row["role"] else 1,
        "role": row["role_name"] or "tecnico",
    })


@auth_bp.route("/api/auth/logout", methods=["POST"])
def route_logout():
    from Backend.utils import log_action
    log_action("LOGOUT", "Usuario cerró sesión.")
    remedy_session.clear_creds(current_user_id())
    session.clear()
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/me", methods=["GET"])
def route_me():
    if "user_id" not in session:
        return jsonify({"authenticated": False}), 200
    
    # Validar que el usuario exista en la base de datos actual (previene bugs por cambio de base de datos o ambiente)
    user_id = session["user_id"]
    with get_db() as db:
        user = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            from Backend.utils import log_action
            log_action("SESSION_INVALIDATED", f"Sesión inválida para ID '{user_id}' (usuario inexistente en base de datos actual). Limpiando sesión.")
            remedy_session.clear_creds(user_id)
            session.clear()
            return jsonify({"authenticated": False}), 200

    return jsonify({
        "authenticated": True,
        "id": session["user_id"],
        "username": session["username"],
        "organization": session["organization"],
        "name": session["name"],
        "email": session["email"],
        "role_id": session.get("role_id") or 1,
        "role": session.get("role") or "tecnico",
    })


@auth_bp.route("/api/auth/profile", methods=["PUT"])
def route_update_profile():
    """Actualiza nombre, email, organizacion y/o contraseña del usuario actual."""
    if "user_id" not in session:
        return jsonify({"error": "No autorizado"}), 401

    data = request.json or {}
    user_id = session["user_id"]

    updates = {}

    if "name" in data and data["name"].strip():
        updates["name"] = data["name"].strip()
    if "email" in data and data["email"].strip():
        updates["email"] = data["email"].strip()
    if "newPassword" in data and data["newPassword"].strip():
        current_pw = (data.get("currentPassword") or "").strip()
        if not current_pw:
            return jsonify({"error": "Debes ingresar tu contraseña actual para cambiarla"}), 400
        with get_db() as db:
            row = db.execute("SELECT password FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row or not check_password(current_pw, row["password"]):
            return jsonify({"error": "La contraseña actual es incorrecta"}), 401
        updates["password"] = hash_password(data["newPassword"].strip())

    if not updates:
        return jsonify({"error": "No hay datos para actualizar"}), 400

    set_clause = ", ".join(f"{col} = ?" for col in updates)
    values = list(updates.values()) + [user_id]

    with get_db() as db:
        db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
        db.commit()

    if "name" in updates:
        session["name"] = updates["name"]
    if "email" in updates:
        session["email"] = updates["email"]

    return jsonify({
        "ok": True,
        "name": session.get("name"),
        "email": session.get("email"),
        "organization": session.get("organization"),
    })
