"""Abre un draft de Outlook nuevo (no reply) con To/Cc/Subject/HTMLBody.

Usado por la planilla embebida del tracker para mostrar el mail al operador
sin pasar por el handler externo `templategen://`. Más rápido que invocar
un .bat externo (ya tenemos pywin32 cargado en el proceso del server) y no
depende de que el handler esté registrado en el equipo.

NUNCA llama Send(). Solo Display(). El usuario revisa y envía manualmente.
"""
from __future__ import annotations


def open_blank_draft(to: str, cc: str, subject: str, html_body: str) -> tuple[bool, str]:
    """Abre un draft nuevo en Outlook con los headers + body provistos.

    Returns:
        (True, '') si abrio el draft.
        (False, mensaje_de_error) si fallo (Outlook off, pywin32 ausente, etc).
    """
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return False, "pywin32 no esta instalado"

    # CoInitialize por thread: Flask sirve cada request en un worker thread
    # nuevo y COM (Outlook STA) requiere init explicito por thread. Sin
    # esto, Dispatch falla con 0x800401F0 "CoInitialize has not been called".
    co_initialized = False
    try:
        pythoncom.CoInitialize()
        co_initialized = True
    except Exception:
        # Si ya esta inicializado (S_FALSE) o falla por otra razon, seguimos:
        # Dispatch nos dira si COM no esta disponible.
        pass

    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
    except Exception as e:
        if co_initialized:
            try: pythoncom.CoUninitialize()
            except Exception: pass
        return False, f"no se pudo conectar a Outlook: {e}"

    try:
        # OlItemType.olMailItem = 0
        mail = outlook.CreateItem(0)
        mail.To = to or ""
        mail.CC = cc or ""
        mail.Subject = subject or ""
        mail.Display(False)
        
        # Preserve default Outlook signature
        signature = mail.HTMLBody or ""
        mail.HTMLBody = (html_body or "") + signature
        # Fuerza foco a la ventana del draft. Sin esto, en algunos equipos
        # el draft abre detras del browser y el operador piensa que no
        # paso nada.
        try:
            mail.GetInspector().Activate()
        except Exception:
            pass
        return True, ""
    except Exception as e:
        return False, f"error al armar draft: {e}"
    finally:
        if co_initialized:
            try: pythoncom.CoUninitialize()
            except Exception: pass
