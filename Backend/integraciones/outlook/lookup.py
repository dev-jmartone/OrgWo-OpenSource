"""
Outlook user lookup — resuelve nombre → email primario consultando el
GAL del Outlook abierto en la PC del operador.

Implementacion via pywin32 (in-process COM). Antes spawneaba PowerShell
por cada lookup: ~1-2s de startup + reconexion a Outlook. Ahora reutiliza
el COM client del proceso Flask (Outlook ya esta cacheado en la primera
conexion) → ~50-200ms por hit.

Limitación: Outlook tiene que estar abierto. Si no, falla silencioso.
"""

import re
import threading
import time
import unicodedata


def _strip_accents(s: str) -> str:
    """Quita tildes/acentos para comparacion fuzzy (Martín vs Martin)."""
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()

# Cache en memoria: nombre normalizado → (email, timestamp). Evita
# llamar a Outlook si el operador abre/cierra el mismo case. TTL 1h.
_cache: dict[str, tuple[str, float]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 3600  # seconds

# Cap defensivo para iteracion del GAL en fallback wildcard.
_GAL_ITER_CAP = 20000


def _normalize(name: str) -> str:
    return " ".join((name or "").strip().lower().split())


def _build_candidates(name: str) -> list[str]:
    """Cadena de candidatos a probar contra el GAL — del mas estricto al
    mas laxo. Replica la heuristica del script PowerShell anterior."""
    cands: list[str] = []
    if not name:
        return cands
    cands.append(name)

    # "Apellido, Nombre" → "Nombre Apellido"
    m = re.match(r"^([^,]+),\s*(.+)$", name)
    if m:
        cands.append(f"{m.group(2)} {m.group(1)}".strip())

    words = [w for w in re.split(r"\s+", name) if w]
    if len(words) >= 3:
        cands.append(f"{words[0]} {words[1]}")
        cands.append(f"{words[0]} {words[-1]}")
    if len(words) >= 4:
        cands.append(f"{words[0]} {words[2]}")
    return cands


def _email_from_address_entry(addr_entry) -> str | None:
    """Extrae el SMTP primario de un AddressEntry. Type 0 = Exchange user
    (necesita GetExchangeUser para el SMTP real, Address es DN X500)."""
    if not addr_entry:
        return None
    try:
        if addr_entry.AddressEntryUserType == 0:
            eu = addr_entry.GetExchangeUser()
            if eu and eu.PrimarySmtpAddress:
                return eu.PrimarySmtpAddress
    except Exception:
        pass
    try:
        addr = addr_entry.Address or ""
        if "@" in addr:
            return addr
    except Exception:
        pass
    return None


def _is_name_match(search_name: str, resolved_name: str) -> bool:
    """Verifica si el nombre resuelto por Outlook es un match razonable para la búsqueda."""
    s_norm = _normalize(search_name)
    r_norm = _normalize(resolved_name)
    if not s_norm or not r_norm:
        return False
        
    if s_norm == r_norm:
        return True
        
    s_clean = _strip_accents(s_norm)
    r_clean = _strip_accents(r_norm)
    if s_clean == r_clean:
        return True
        
    if "," in resolved_name:
        parts = [p.strip() for p in resolved_name.split(",")]
        if len(parts) == 2:
            inverted = f"{parts[1]} {parts[0]}"
            inv_clean = _strip_accents(_normalize(inverted))
            if s_clean == inv_clean:
                return True
                
    s_words = [w for w in re.sub(r'[^\w\s]', '', s_clean).split() if len(w) > 2]
    r_words = [w for w in re.sub(r'[^\w\s]', '', r_clean).split() if len(w) > 2]
    if s_words and r_words:
        first_word_s = s_words[0]
        # El primer nombre de la búsqueda debe estar en el nombre resuelto
        if first_word_s not in r_words:
            return False
            
        # Extraer el apellido principal del nombre resuelto de Outlook
        resolved_surname = ""
        if "," in resolved_name:
            resolved_surname = resolved_name.split(",")[0].strip()
        else:
            resolved_surname = r_words[-1]
            
        resolved_surname_clean = _strip_accents(_normalize(resolved_surname))
        resolved_surname_words = [w for w in re.sub(r'[^\w\s]', '', resolved_surname_clean).split() if len(w) > 2]
        
        # Al menos una palabra del apellido resuelto de Outlook debe estar en la búsqueda original
        for w in resolved_surname_words:
            if w in s_words:
                return True
                
    return False


def lookup_user_email(name: str, timeout: float = 8.0) -> str | None:
    """Resuelve un nombre contra el GAL de Outlook via pywin32.

    Returns:
        email primario si se encontro, None si no se encontro o si
        Outlook no esta disponible / hubo error. Nunca tira excepcion.
    """
    key = _normalize(name)
    if not key:
        return None

    # Cache check
    with _cache_lock:
        cached = _cache.get(key)
        if cached and (time.time() - cached[1]) < _CACHE_TTL:
            return cached[0] or None

    result_holder: list[str | None] = [None]
    done_event = threading.Event()

    def _do_lookup():
        try:
            import pythoncom
            import win32com.client
        except ImportError:
            done_event.set()
            return

        co_initialized = False
        try:
            pythoncom.CoInitialize()
            co_initialized = True
        except Exception:
            pass

        try:
            outlook = win32com.client.Dispatch("Outlook.Application")
            ol_session = outlook.Session
        except Exception as e:
            if co_initialized:
                try: pythoncom.CoUninitialize()
                except Exception: pass
            print(f"[outlook lookup] no se pudo conectar: {e}")
            done_event.set()
            return

        found_email: str | None = None
        try:
            # Paso 1: probar cada candidato con CreateRecipient + Resolve.
            # Esto usa el ANR (Ambiguous Name Resolution) de Exchange — rapido.
            for cand in _build_candidates(name):
                try:
                    rcp = ol_session.CreateRecipient(cand)
                    rcp.Resolve()
                    if rcp.Resolved:
                        resolved_name = rcp.AddressEntry.Name or ""
                        if _is_name_match(name, resolved_name):
                            email = _email_from_address_entry(rcp.AddressEntry)
                            if email:
                                found_email = email
                                break
                except Exception:
                    continue

            # Paso 2: fallback wildcard sobre GAL completo si no hubo hit.
            # Estrategia multi-nivel:
            #   2a) starts-with(first) AND ends-with(last)   [strict, last = ultima palabra]
            #   2b) contains(first) AND contains(any_other_word)  [loose, prueba cada palabra]
            # Todo con accents stripped. Asi nombres como "Hector Jose Herrera
            # Villanueva" → GAL "Hector Herrera" matchean porque probamos
            # tambien "Hector" + "Herrera" (palabra media), no solo first+last.
            if not found_email:
                words = [w for w in re.split(r"\s+", name) if w]
                if len(words) >= 2:
                    first = _strip_accents(words[0])
                    last = _strip_accents(words[-1])
                    # Candidatos de "last name" en orden de prioridad: ultima
                    # palabra (caso normal), luego cualquier otra (apellidos
                    # compuestos / segundos nombres / orden invertido).
                    last_candidates = [_strip_accents(w) for w in words[1:]]
                    # Dedup mantiene orden
                    seen = set()
                    last_candidates = [w for w in last_candidates if not (w in seen or seen.add(w))]

                    strict_match = None
                    loose_match = None
                    try:
                        gal = ol_session.GetGlobalAddressList()
                        if gal:
                            entries = gal.AddressEntries
                            count = min(entries.Count, _GAL_ITER_CAP)
                            for i in range(1, count + 1):
                                try:
                                    entry = entries.Item(i)
                                    ename = _strip_accents(entry.Name or "")
                                    if not ename or first not in ename:
                                        continue
                                    # 2a strict: empieza con first, termina con
                                    # la ultima palabra del nombre Remedy.
                                    if strict_match is None and ename.startswith(first) and ename.endswith(last):
                                        strict_match = entry
                                        break  # mejor match posible, salir
                                    # 2b loose: contiene first + cualquier otra palabra.
                                    if loose_match is None:
                                        for lc in last_candidates:
                                            if lc and lc in ename:
                                                loose_match = entry
                                                break
                                except Exception:
                                    continue
                    except Exception:
                        pass

                    pick = strict_match or loose_match
                    if pick:
                        email = _email_from_address_entry(pick)
                        if email:
                            found_email = email

        except Exception as e:
            print(f"[outlook lookup] error inesperado: {e}")
        finally:
            if co_initialized:
                try: pythoncom.CoUninitialize()
                except Exception: pass

        result_holder[0] = found_email
        done_event.set()

    t = threading.Thread(target=_do_lookup, daemon=True, name="outlook-gal-lookup")
    t.start()
    completed = done_event.wait(timeout=timeout)
    if not completed:
        print(f"[outlook lookup] timeout ({timeout}s) para: {name!r}")
        return None

    found_email = result_holder[0]

    if found_email:
        from Backend.utils import is_valid_corporate_email
        if not is_valid_corporate_email(found_email):
            print(f"[outlook lookup] descartando email de dominio invalido: {found_email}")
            found_email = None

    # Solo cachear hits. Cachear misses bloqueaba reintentos por 1h cuando
    # Outlook estaba cerrado en el primer intento.
    if found_email:
        with _cache_lock:
            _cache[key] = (found_email, time.time())
    return found_email



def backfill_case_emails(db, org: str) -> int:
    """Recorre cases sin email del org y los completa via Outlook GAL.
    Deduce también la empresa a partir del dominio del correo resuelto +
    persiste el usuario en el directorio canonico (`users_directory`).
    Devuelve cantidad actualizada. Pensado para correr al final del
    sync_assigned_remedy_tickets."""
    # Import lazy para evitar ciclo en lookup → directory → lookup.
    from Backend.servicios.users_directory import (
        infer_company_from_email, repo_upsert_user, repo_get_user,
    )
    rows = db.execute(
        "SELECT id, name FROM cases WHERE organization = ? AND (email IS NULL OR email = '')",
        (org,),
    ).fetchall()
    updated = 0
    for r in rows:
        # Hit directorio first → evita llamar a Outlook si ya lo conocemos.
        cached = repo_get_user(r["name"])
        if cached:
            email = cached["email"]
            company = cached["company"]
        else:
            email = lookup_user_email(r["name"])
            if not email:
                continue
            company = infer_company_from_email(email)
            repo_upsert_user(r["name"], email, company)

        if company:
            db.execute("UPDATE cases SET email = ?, company = ? WHERE id = ?", (email, company, r["id"]))
        else:
            db.execute("UPDATE cases SET email = ? WHERE id = ?", (email, r["id"]))
        updated += 1
    if updated:
        db.commit()
    return updated
