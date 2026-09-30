"""Renombra adjuntos existentes (kind='template_firmado') al patron derivado
del subject del template parseado por OCR. Renombra archivo en disco + actualiza
DB. Idempotente: si ya tiene el nombre canonico, no toca."""
import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from Backend.base_datos.connection import get_db
from Backend.scripts.process_scans import build_pdf_filename


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    with get_db() as db:
        rows = db.execute(
            "SELECT id, case_id, filename, path, ocr_text FROM attachments WHERE kind = 'template_firmado'"
        ).fetchall()

    print(f"adjuntos kind=template_firmado: {len(rows)}\n")
    for r in rows:
        current = r["filename"]
        new_name = build_pdf_filename(r["ocr_text"] or "", current)
        if new_name == current:
            print(f"  - {r['id']}: ya canonico ({current!r})")
            continue

        old_path = Path(r["path"])
        if not old_path.is_file():
            print(f"  - {r['id']}: archivo no existe en disco ({old_path})")
            continue

        new_filename_on_disk = f"{r['id']}__{new_name}"
        new_path = old_path.parent / new_filename_on_disk
        print(f"  - {r['id']}: {current!r}  ->  {new_name!r}")

        if args.dry_run:
            continue

        old_path.rename(new_path)
        with get_db() as db:
            db.execute(
                "UPDATE attachments SET filename = ?, path = ? WHERE id = ?",
                (new_name, str(new_path), r["id"]),
            )
            db.commit()

    print("\nlisto.")


if __name__ == "__main__":
    main()
