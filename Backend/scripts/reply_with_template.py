"""CLI wrapper de Backend.outlook_reply para uso interactivo.

Uso:
    python -m Backend.scripts.reply_with_template --username gadamo --case-id c_xxx
    python -m Backend.scripts.reply_with_template --username gadamo --wo WO114823

Abre un draft de Outlook como reply al mail de aprobacion de Rafa, con el PDF
template_firmado adjunto. NUNCA envia."""
import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from Backend.base_datos.connection import get_db
from Backend.integraciones.outlook.reply import open_reply_draft, canonical_num


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--case-id")
    parser.add_argument("--wo")
    args = parser.parse_args()

    with get_db() as db:
        user = db.execute(
            "SELECT organization FROM users WHERE username = ?", (args.username,)
        ).fetchone()
    if not user:
        print(f"ERROR: usuario {args.username!r} no existe")
        sys.exit(1)
    org = user["organization"]

    with get_db() as db:
        if args.case_id:
            case = db.execute(
                "SELECT * FROM cases WHERE id = ? AND organization = ?",
                (args.case_id, org),
            ).fetchone()
        elif args.wo:
            target = canonical_num(args.wo) or args.wo
            cases = db.execute(
                "SELECT * FROM cases WHERE organization = ?", (org,)
            ).fetchall()
            case = next(
                (c for c in cases if canonical_num(c["wo"] or "") == canonical_num(target)),
                None,
            )
        else:
            print("ERROR: --case-id o --wo requerido")
            sys.exit(1)

    if not case:
        print("ERROR: case no encontrado")
        sys.exit(1)

    print(f"case: {case['id']} name={case['name']!r} wo={case['wo']!r}")

    with get_db() as db:
        att = db.execute(
            """SELECT * FROM attachments
               WHERE case_id = ? AND kind = 'template_firmado'
               ORDER BY created_at DESC LIMIT 1""",
            (case["id"],),
        ).fetchone()
    if not att:
        print("ERROR: el case no tiene template_firmado adjunto")
        sys.exit(1)

    pdf_path = Path(att["path"])
    print(f"PDF: {att['filename']} ({pdf_path.stat().st_size} bytes)")

    ok, err = open_reply_draft(case["wo"] or "", pdf_path, att["filename"])
    if not ok:
        print(f"ERROR: {err}")
        sys.exit(1)
    print("listo. Revisa Outlook. NO se envio nada.")


if __name__ == "__main__":
    main()
