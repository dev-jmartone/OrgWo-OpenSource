"""Sondea de donde sacar las tipificaciones (Operational Categorization Tier
1/2/3) que rutean a los grupos de soporte del tracker.

Uso:
    set ENV=PROD
    python -m Backend.scripts.probe_classifications --username gadamo
    (la password se pide interactiva si no se pasa --password)

Hace tres cosas, en orden, y loggea el resultado de cada una:

  1) FOUNDATION: intenta leer forms de config de asignacion
     (CFG:Assignment y alternos). Si el login N1 tiene permiso, devuelve
     el mapeo grupo -> categorizacion declarado. Lo mas limpio si existe.

  2) FALLBACK: agrega las categorizaciones reales de tickets recientes
     (HPD:Help Desk + WOI:WorkOrder) ruteados a los grupos. Usa forms que
     el tracker ya consulta, asi que el permiso esta garantizado. Devuelve
     combos Tier1/Tier2/Tier3 distintos con su frecuencia.

  3) RESUMEN: imprime las tipificaciones candidatas ordenadas por uso, en
     el mismo formato que el registry hardcodeado de create_ticket.js.

No escribe nada. Solo lee y loggea.
"""
import argparse
import getpass
import sys
from collections import Counter
from pathlib import Path

# Hace funcionar `import Backend.*` sin instalar paquete.
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from Backend.config import REMEDY_BASE_URL
from Backend.integraciones.remedy import client

GROUPS = ["TECNOLOGIA USUARIOS DT", "CTU DT", "TECNOLOGIA CELULARES"]

# Forms candidatos de config de asignacion. El nombre exacto varia por tenant,
# por eso se prueban varios y se reporta cual respondio.
FOUNDATION_FORMS = [
    "CFG:Assignment",
    "CFG:Assignment Definitions",
    "Assignment Engine",
]

# Campos que esperamos en un form de asignacion. Si el form existe pero no
# tiene estos campos, Remedy devuelve error de field y se loggea para ajustar.
FOUNDATION_FIELDS = (
    "values(Support Group Name, Categorization Tier 1, Categorization Tier 2, "
    "Categorization Tier 3, Process Name)"
)


def _hr(title: str) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def probe_foundation(token: str) -> None:
    """Intenta leer los forms de config de asignacion filtrando por grupo."""
    _hr("1) FOUNDATION  (config de asignacion declarada)")
    group_q = " OR ".join(f"'Support Group Name'=\"{g}\"" for g in GROUPS)

    for form in FOUNDATION_FORMS:
        print(f"\n-> Probando form: {form}")
        entries, err = client.get_entries(
            token, form, f"({group_q})", FOUNDATION_FIELDS, timeout=15, limit=200
        )
        if err:
            print(f"   ERROR: {err}")
            continue
        if not entries:
            print("   form existe pero 0 filas para estos grupos "
                  "(¿el form no scopea por grupo, o filtra distinto?).")
            continue

        print(f"   OK: {len(entries)} filas.")
        seen = set()
        for e in entries:
            v = e.get("values", {})
            combo = (
                v.get("Support Group Name"),
                v.get("Categorization Tier 1"),
                v.get("Categorization Tier 2"),
                v.get("Categorization Tier 3"),
                v.get("Process Name"),
            )
            if combo in seen:
                continue
            seen.add(combo)
            grp, t1, t2, t3, proc = combo
            print(f"     [{grp}] {t1} / {t2} / {t3}   ({proc})")
        return  # primer form que responde con filas, alcanza

    print("\nNingun form foundation devolvio filas utiles. "
          "Probablemente el login N1 no tiene lectura sobre config, "
          "o el nombre del form difiere en este tenant. Usa el FALLBACK.")


def _agg_categorizations(token: str, form: str, group_field: str,
                         fields: str, counter: Counter) -> None:
    """Agrega combos de categorizacion de tickets recientes de los grupos."""
    group_q = " OR ".join(f"'{group_field}'=\"{g}\"" for g in GROUPS)
    entries, err = client.get_entries(
        token, form, f"({group_q})", fields, timeout=20, limit=500
    )
    if err:
        print(f"   {form}: ERROR {err}")
        return
    print(f"   {form}: {len(entries)} tickets leidos.")
    for e in entries:
        v = e.get("values", {})
        t1 = (v.get("Categorization Tier 1") or "").strip()
        t2 = (v.get("Categorization Tier 2") or "").strip()
        t3 = (v.get("Categorization Tier 3") or "").strip()
        if t1 or t2 or t3:
            counter[(t1, t2, t3)] += 1


def probe_fallback(token: str) -> Counter:
    """Deriva tipificaciones de tickets reales recientes (permiso garantizado)."""
    _hr("2) FALLBACK  (tipificaciones derivadas de tickets reales)")
    counter: Counter = Counter()

    # HPD:Help Desk -> grupo en 'Assigned Group'
    _agg_categorizations(
        token, "HPD:Help Desk", "Assigned Group",
        "values(Assigned Group, Categorization Tier 1, "
        "Categorization Tier 2, Categorization Tier 3)",
        counter,
    )
    # WOI:WorkOrder -> grupo en 'Support Group Name'
    _agg_categorizations(
        token, "WOI:WorkOrder", "Support Group Name",
        "values(Support Group Name, Categorization Tier 1, "
        "Categorization Tier 2, Categorization Tier 3)",
        counter,
    )
    return counter


def print_summary(counter: Counter) -> None:
    _hr("3) RESUMEN  (tipificaciones candidatas, ordenadas por uso)")
    if not counter:
        print("Sin datos. Ni foundation ni tickets devolvieron categorizaciones.")
        return
    print(f"{len(counter)} combos distintos encontrados:\n")
    for (t1, t2, t3), n in counter.most_common():
        print(f"  {n:4d}x   {t1} / {t2} / {t3}")

    print("\n--- Formato registry (create_ticket.js) ---")
    for (t1, t2, t3), _ in counter.most_common():
        print("    {")
        print(f"        op_tier_1: '{t1}',")
        print(f"        op_tier_2: '{t2}',")
        print(f"        op_tier_3: '{t3}',")
        print("    },")


def main() -> int:
    ap = argparse.ArgumentParser(description="Sonda tipificaciones por grupo en Remedy.")
    ap.add_argument("--username", required=True, help="login Remedy (ej: gadamo)")
    ap.add_argument("--password", help="password Remedy (si se omite, se pide interactiva)")
    args = ap.parse_args()

    password = args.password or getpass.getpass(f"Password Remedy para {args.username}: ")

    print(f"Remedy: {REMEDY_BASE_URL}")
    print(f"Grupos: {', '.join(GROUPS)}")
    print("Login...")
    token, err = client.remedy_login(args.username, password)
    if err or not token:
        print(f"LOGIN FALLO: {err}")
        return 1
    print("Login OK.")

    probe_foundation(token)
    counter = probe_fallback(token)
    print_summary(counter)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
