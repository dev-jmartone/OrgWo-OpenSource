"""Modulo importable que abre un draft Outlook como reply al mail de aprobacion
de Rafa para un case del tracker, con el PDF template_firmado adjunto.

NUNCA llama Send(). Solo Display(). El usuario revisa y envia manualmente.

Dependencias: pywin32, Outlook desktop abierto en la sesion del proceso.
"""
import os
import re
import shutil
import tempfile
from pathlib import Path


RAFA_EMAIL_HINT = "rerodriguez"

DEFAULT_BODY_LINES = [
    "Hola Rafa,",
    "",
    "Adjunto template firmado correspondiente.",
]

BODY_FONT = "Calibri"
BODY_SIZE = "11.0pt"

SIGNATURES_DIR = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Signatures"

FOLDERS_TO_TRY = [
    ("Bandeja de entrada", "Rafa"),
    ("Bandeja de entrada",),
    ("Inbox", "Rafa"),
    ("Inbox",),
    ("Elementos enviados",),
    ("Sent Items",),
]

MAX_ITEMS_PER_FOLDER = 500
MAX_ITEMS_FAST_PATH  = 50


def canonical_num(wo_value: str) -> str | None:
    if not wo_value:
        return None
    m = re.match(r"\s*(WO|INC|REQ)\s*0*\s*(\d+)\s*$", wo_value, re.IGNORECASE)
    return m.group(2).lstrip("0") if m else None


def _try_restrict_by_subject(items, num: str):
    """Pide a MAPI que filtre items por subject contains num via DASL
    (`ci_phrasematch` usa el indexer de Windows Search, O(log n)). Si el
    store no esta indexado o la query no esta soportada, devuelve None y
    el caller cae al iterado lineal."""
    try:
        filt = f"@SQL=ci_phrasematch(\"urn:schemas:httpmail:subject\", '{num}')"
        return items.Restrict(filt)
    except Exception:
        return None


def resolve_sender_smtp(mail) -> str:
    direct = (getattr(mail, "SenderEmailAddress", "") or "")
    if "@" in direct:
        return direct
    try:
        ex_user = mail.Sender.GetExchangeUser() if mail.Sender else None
        if ex_user:
            smtp = ex_user.PrimarySmtpAddress
            if smtp:
                return smtp
    except Exception:
        pass
    return direct


def load_default_signature_html() -> str:
    if not SIGNATURES_DIR.is_dir():
        return ""
    htms = sorted(SIGNATURES_DIR.glob("*.htm"))
    if not htms:
        return ""
    sig_file = htms[0]
    try:
        html = sig_file.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        try:
            html = sig_file.read_text(encoding="latin-1", errors="ignore")
        except Exception:
            return ""
    m = re.search(r"<body[^>]*>(.*?)</body>", html, re.IGNORECASE | re.DOTALL)
    if m:
        return m.group(1)
    return html


def _get_folder_by_path(store, path_parts):
    f = store
    for part in path_parts:
        try:
            f = f.Folders[part]
        except Exception:
            return None
    return f


def find_approval_mail(ns, case_wo: str):
    target = canonical_num(case_wo)
    if not target:
        return None

    for store in ns.Folders:
        for parts in FOLDERS_TO_TRY:
            folder = _get_folder_by_path(store, parts)
            if folder is None:
                continue
            try:
                items = folder.Items
                try:
                    items.Sort("[ReceivedTime]", True)
                except Exception:
                    pass
            except Exception:
                continue

            # Fast path: pedir al indexer de MAPI que devuelva solo los items
            # cuyo subject contenga el numero canonico. Drop de 500 → <50.
            filtered = _try_restrict_by_subject(items, target)
            if filtered is not None:
                scan_limit = MAX_ITEMS_FAST_PATH
                scan_source = filtered
            else:
                try:
                    scan_limit = min(items.Count, MAX_ITEMS_PER_FOLDER)
                except Exception:
                    scan_limit = MAX_ITEMS_PER_FOLDER
                scan_source = items

            scanned = 0
            for it in scan_source:
                scanned += 1
                if scanned > scan_limit:
                    break
                try:
                    if getattr(it, "Class", 0) != 43:
                        continue
                    subj = it.Subject or ""
                except Exception:
                    continue
                if target not in re.sub(r"\D", "", subj):
                    continue
                smtp = resolve_sender_smtp(it).lower()
                if RAFA_EMAIL_HINT not in smtp:
                    continue
                return it
    return None


def open_reply_draft(case_wo: str, attachment_path: Path, attachment_display_name: str) -> tuple[bool, str]:
    """Abre un draft de Outlook como reply al mail de aprobacion de Rafa para
    el ticket dado. Adjunta el PDF. NO envia.

    Returns:
        (True, '') si abrio el draft.
        (False, mensaje_de_error) si fallo (no se encontro mail, Outlook off, etc).
    """
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return False, "pywin32 no esta instalado"

    if not attachment_path.is_file():
        return False, f"PDF no existe: {attachment_path}"

    # CoInitialize por thread: Flask sirve cada request en un worker thread
    # nuevo y COM (Outlook STA) requiere init explicito por thread. Sin esto
    # Dispatch puede fallar con 0x800401F0 dependiendo del estado del thread.
    co_initialized = False
    try:
        pythoncom.CoInitialize()
        co_initialized = True
    except Exception:
        pass

    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        ns = outlook.GetNamespace("MAPI")
    except Exception as e:
        if co_initialized:
            try: pythoncom.CoUninitialize()
            except Exception: pass
        return False, f"no se pudo conectar a Outlook: {e}"

    try:
        approval = find_approval_mail(ns, case_wo)
        if not approval:
            return False, f"no se encontro mail de aprobacion para {case_wo}"

        reply = approval.Reply()
        try:
            reply.CC = ""
            reply.BCC = ""
        except Exception:
            pass

        original_html = reply.HTMLBody or ""
        paragraphs = "".join(
            f"<p style='margin:0; font-family:{BODY_FONT}; font-size:{BODY_SIZE};'>"
            f"{(line or '&nbsp;')}</p>"
            for line in DEFAULT_BODY_LINES
        )
        signature_html = load_default_signature_html()
        sig_block = f"<br>{signature_html}" if signature_html else ""
        reply.HTMLBody = f"<div>{paragraphs}{sig_block}</div>{original_html}"

        # Adjuntar con nombre canonico (sin att_id prefix del filesystem).
        temp_dir = Path(tempfile.gettempdir()) / "orgwo_reply_attachments"
        temp_dir.mkdir(exist_ok=True)
        temp_pdf = temp_dir / attachment_display_name
        shutil.copy2(attachment_path, temp_pdf)
        reply.Attachments.Add(str(temp_pdf))

        reply.Display(False)
        try:
            reply.GetInspector().Activate()
        except Exception:
            pass
        return True, ""
    except Exception as e:
        return False, f"error al armar reply: {e}"
    finally:
        if co_initialized:
            try: pythoncom.CoUninitialize()
            except Exception: pass
