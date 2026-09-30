"""Loguea a Remedy y reporta el TTL real del token JWT.

Uso:
    set ENV=PROD
    python -m Backend.scripts.remedy_token_ttl --username gadamo

Decodifica el claim 'exp' del JWT y lo compara contra 'iat' (emitido) y el
reloj local. Sirve para saber el tiempo exacto de vida del token en este
tenant, sin adivinar. No escribe nada.
"""
import argparse
import base64
import getpass
import json
import sys
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from Backend.config import REMEDY_BASE_URL
from Backend.integraciones.remedy import client


def _decode_payload(token: str) -> dict | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        p = parts[1] + "=" * (4 - len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(p).decode("utf-8"))
    except Exception as e:
        print(f"No se pudo decodificar el JWT: {e}")
        return None


def _fmt(epoch) -> str:
    if not epoch:
        return "(ausente)"
    try:
        return datetime.fromtimestamp(int(epoch)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(epoch)


def main() -> int:
    ap = argparse.ArgumentParser(description="Reporta el TTL real del token JWT de Remedy.")
    ap.add_argument("--username", required=True)
    ap.add_argument("--password")
    args = ap.parse_args()

    password = args.password or getpass.getpass(f"Password Remedy para {args.username}: ")

    print(f"Remedy: {REMEDY_BASE_URL}")
    print("Login...")
    now = int(time.time())
    token, err = client.remedy_login(args.username, password)
    if err or not token:
        print(f"LOGIN FALLO: {err}")
        return 1
    print("Login OK.\n")

    payload = _decode_payload(token)
    if not payload:
        print("El token no es un JWT decodificable (¿formato distinto en este tenant?).")
        print(f"Token crudo (primeros 60 chars): {token[:60]}...")
        return 1

    iat = payload.get("iat")
    exp = payload.get("exp")

    print("Claims del token:")
    for k, v in payload.items():
        extra = f"  -> {_fmt(v)}" if k in ("iat", "exp", "nbf") else ""
        print(f"  {k}: {v}{extra}")

    print("\nResumen:")
    print(f"  Reloj local al loguear : {_fmt(now)}")
    print(f"  Emitido (iat)          : {_fmt(iat)}")
    print(f"  Expira (exp)           : {_fmt(exp)}")

    if exp:
        ttl_total = (int(exp) - int(iat)) if iat else None
        ttl_remaining = int(exp) - now
        if ttl_total is not None:
            print(f"  TTL total (exp - iat)  : {ttl_total} s  = {ttl_total/60:.1f} min")
        print(f"  Restante desde ahora   : {ttl_remaining} s  = {ttl_remaining/60:.1f} min")
    else:
        print("  El token NO trae claim 'exp'. El vencimiento lo decide el server "
              "por inactividad/cache, no hay tiempo fijo embebido.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
