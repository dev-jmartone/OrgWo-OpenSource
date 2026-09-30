"""Cleanup one-shot: archiva los template_firmado de cases que ya estan
done/reject/not_accepted. Borra el binario en disco + marca archived_at,
preservando la metadata como registro auditable.

Pensado para correr una sola vez tras introducir el archive flow, para
recuperar disco ocupado por PDFs viejos que ya no son necesarios.

Uso:
    python -m Backend.scripts.archive_done_attachments
    python -m Backend.scripts.archive_done_attachments --dry-run

Idempotente: corre cuantas veces quieras, solo archiva lo que falta.
"""
import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent.parent.resolve()))

from Backend.base_datos.connection import get_db  # noqa: E402
from Backend.base_datos.repository.attachments import repo_attach_list_archivable  # noqa: E402
from Backend.servicios.attachments import service_archive_attachment  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Archiva template_firmado de cases cerrados.")
    parser.add_argument("--dry-run", action="store_true", help="Lista candidatos sin tocar nada.")
    args = parser.parse_args()

    rows = repo_attach_list_archivable("template_firmado")
    if not rows:
        print("Nada para archivar. Salida limpia.")
        return 0

    total_bytes = 0
    for r in rows:
        p = Path(r["path"]) if r["path"] else None
        size = p.stat().st_size if (p and p.is_file()) else 0
        total_bytes += size
        flag = "(dry-run)" if args.dry_run else ""
        print(
            f"  [{r['organization']}] case={r['case_id']} wo={r['wo'] or '-'} "
            f"file={r['filename']} size={size} bytes {flag}"
        )

    print(f"\nCandidatos: {len(rows)} adjuntos / {total_bytes/1024/1024:.2f} MB")
    if args.dry_run:
        return 0

    archived = 0
    failed = 0
    for r in rows:
        ok = service_archive_attachment(r["id"], org=None)
        if ok:
            archived += 1
        else:
            failed += 1
            print(f"  ! no se pudo archivar att={r['id']} (ya archivado o no existe)")

    print(f"\nArchivados: {archived}. Fallaron: {failed}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
