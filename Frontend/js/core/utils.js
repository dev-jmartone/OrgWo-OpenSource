// ============================================================
// UTILS
// ============================================================
function nowISO() { return new Date().toISOString(); }
function formatDate(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
function formatDateTime(iso) { if (!iso) return '—'; return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function daysSince(iso) { if (!iso) return 0; return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)); }
function initials(name) { if (!name) return '?'; return name.split(/\s+/).slice(0,2).map(p => p[0]||'').join('').toUpperCase(); }

function formatSLADate(dateStr, isPending) {
    if (!dateStr) return 'Sin SLA';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 'SLA: ' + dateStr;
        
        const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        const dayName = days[d.getDay()];
        
        const hrs = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        
        let dayLabel = dayName;
        if (d.toDateString() === today.toDateString()) {
            dayLabel = 'hoy';
        } else if (d.toDateString() === tomorrow.toDateString()) {
            dayLabel = 'mañana';
        }
        
        const baseMsg = `${dayLabel} a las ${hrs}:${mins}`;
        if (isPending) {
            return `SLA Pausado (Vence ${baseMsg})`;
        }
        return `El siguiente SLA es ${baseMsg}`;
    } catch (e) {
        return 'SLA: ' + dateStr;
    }
}

function getSLAPercentage(createdAt, slaDate, isPending) {
    if (!createdAt || !slaDate) return 10;
    try {
        const start = new Date(createdAt).getTime();
        const end = new Date(slaDate).getTime();
        const now = Date.now();
        if (isNaN(start) || isNaN(end) || end <= start) return 10;
        
        let pct = Math.round(((now - start) / (end - start)) * 100);
        return Math.max(5, Math.min(100, pct));
    } catch (e) {
        return 10;
    }
}

function getSLAColor(status, slaDate, isPending) {
    if (isPending) {
        return '#0078D4'; // Fluent paused blue
    }
    if (slaDate && new Date(slaDate).getTime() < Date.now()) {
        return '#e81123';
    }
    const s = String(status || '').toLowerCase();
    if (s.includes('breached')) return '#e81123';
    if (s.includes('warning')) return '#ffc000';
    return '#107c10';
}

// Reemplaza los placeholders <i data-lucide="..."> por los SVG de Lucide.
// Se llama al final de cada render que inyecta iconos vía innerHTML.
function renderIcons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

// Normaliza un string para búsqueda: minúsculas, sin tildes, sin
// espacios extra. Lo aplicamos tanto al query como a los campos del
// caso para que "MARÍA" matchee "maria" o "Maria".
// Rango de combining diacritical marks (Unicode U+0300..U+036F).
// Construyo el regex desde string para que el código se lea sin tener
// que mostrar caracteres invisibles en el editor.
const _DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');
function normalizeForSearch(s) {
    return (s || '')
        .toString()
        .normalize('NFD')
        .replace(_DIACRITICS_RE, '')
        .toLowerCase()
        .trim();
}

function copyTextToClipboard(text, successMsg = 'Copiado al portapapeles') {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text)
            .then(() => { if (typeof window.toast === 'function') window.toast(successMsg, 'success'); })
            .catch(err => _fallbackCopy(text, successMsg));
    } else {
        _fallbackCopy(text, successMsg);
    }
}

function _fallbackCopy(text, successMsg) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        if (successful && typeof window.toast === 'function') {
            window.toast(successMsg, 'success');
        }
    } catch (err) {
        console.error('Fallback copy failed', err);
        if (typeof window.toast === 'function') window.toast('Error al copiar', 'error');
    }
    document.body.removeChild(textArea);
}

// Filtra una lista de casos por query. El query se separa en palabras
// y CADA palabra tiene que aparecer en alguno de los campos buscables.
// Esto permite buscar "lop mar" y matchear "Maria Lopez Garcia".
const SEARCHABLE_FIELDS = ['name', 'email', 'company', 'puesto', 'svcTag', 'wo', 'tipificacion'];
function searchCases(items, query) {
    const q = normalizeForSearch(query);
    if (!q) return items;
    const tokens = q.split(/\s+/).filter(Boolean);
    return items.filter(c => {
        const hay = SEARCHABLE_FIELDS.map(f => normalizeForSearch(c[f])).join(' ');
        return tokens.every(t => hay.includes(t));
    });
}

// Estado del query del buscador de la vista Lista. Vive fuera de
// renderList para sobrevivir a re-renders disparados por el polling.
let listSearchQuery = '';
window.listSearchQuery = listSearchQuery;

// Devuelve el índice del estado en ESTADOS, o -1 si no está mapeado.
function estadoIndex(eid) {
    return ESTADOS.findIndex(e => e.id === eid);
}

// Información visual por tipo de asignación. Usado por renderCard,
// renderList y cualquier vista que muestre el chip de tipo.
const TIPO_INFO = {
    pc:       { label: 'PC',               short: 'PC',       icon: 'laptop' },
    cel:      { label: 'Celular',          short: 'Cel',      icon: 'smartphone' },
    both:     { label: 'Completo',         short: 'Completo', icon: 'refresh-cw' },
    cargador: { label: 'Cargador',         short: 'Cargador', icon: 'plug' },
    kit:      { label: 'Kit Inalámbrico',  short: 'Kit',      icon: 'keyboard' },
    monitor:  { label: 'Monitor',          short: 'Monitor',  icon: 'monitor' },
    vincha:   { label: 'Vincha',           short: 'Vincha',   icon: 'headphones' },
};
function tipoInfo(t) { return TIPO_INFO[t] || { label: t || '—', short: t || '—', icon: 'circle' }; }

// Etiqueta de estado específica para un caso. El estado 'config' usa el
// tipo de recambio para diferenciar PC, Celular o ambos; el resto cae al
// label genérico definido en ESTADOS.
function estadoLabelFor(c) {
    if (c?.estado === 'config') {
        if (c.tipo === 'cel')  return 'Configurando Celular';
        if (c.tipo === 'both') return 'Configurando Equipos';
        return 'Configurando PC';
    }
    return ESTADOS.find(e => e.id === c?.estado)?.label || c?.estado || '—';
}

// Calcula el estado que le corresponde a un caso a partir de sus checks
// marcados. El estado resultante es el de mayor índice entre los targets de
// los checks marcados (CHECK_TO_ESTADO). Si no hay ninguno marcado, vuelve
// al primer estado del flujo ('contact'). 'reject' se ignora — es decisión
// manual y nunca se entra ni se sale por checks.
function estadoFromChecks(checks, tipo) {
    const order = ESTADOS.map(e => e.id);
    let best = -1;
    if (checks) {
        for (const [chk, st] of Object.entries(CHECK_TO_ESTADO)) {
            if (!checks[chk]) continue;
            const item = CHECKLIST_ITEMS.find(i => i.id === chk);
            // Ignoro checks que no aplican al tipo del caso (autopilot en
            // cargador, por ejemplo) para que un flag legado no atrape al
            // caso en un estado que no le corresponde.
            if (item && !checkAppliesTo(item, tipo)) continue;
            const idx = order.indexOf(st);
            if (idx > best) best = idx;
        }
    }
    return best < 0 ? order[0] : order[best];
}

// Inverso de estadoFromChecks: dado un estado destino (p.ej. al arrastrar
// una tarjeta de columna), devuelve un set de checks coherente con ese
// estado. Marca los checks lineales cuyo target queda en o antes del
// destino y desmarca los posteriores, preservando flags que no participan
// del flujo (cfg_listo, not_yet) y respetando el tipo del caso. Así el
// checklist del drawer "viaja" con la tarjeta al moverla en el tablero.
function checksForEstado(estadoId, tipo, existingChecks) {
    const next = { ...(existingChecks || {}) };
    const targetIdx = estadoIndex(estadoId);
    for (const [chk, st] of Object.entries(CHECK_TO_ESTADO)) {
        // not_accepted es salida lateral, no un paso lineal: no cascadea.
        if (chk === 'not_accepted') continue;
        const item = CHECKLIST_ITEMS.find(i => i.id === chk);
        if (item && !checkAppliesTo(item, tipo)) continue;
        next[chk] = estadoIndex(st) <= targetIdx;
    }
    next.not_accepted = (estadoId === 'not_accepted');
    return next;
}

// Helper: caso activo (cualquier estado salvo cerrado o rechazado).
// No filtra pospuestos: ahora los pospuestos solo se atenúan.
function isActive(c) {
    return c.estado !== 'done' && c.estado !== 'reject';
}

// Comparadores de fecha de retiro: hoy y +7 días en la zona local.
function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
}
function isRetiroHoy(c) {
    if (!c.fechaRetiro) return false;
    const t = new Date(c.fechaRetiro).getTime();
    return t >= startOfToday() && t <= endOfDay(new Date());
}
function isRetiroEstaSemana(c) {
    if (!c.fechaRetiro) return false;
    const t = new Date(c.fechaRetiro).getTime();
    const inSevenDays = startOfToday() + 8 * 24 * 60 * 60 * 1000;
    return t > endOfDay(new Date()) && t < inSevenDays;
}

function getCompanyForCase(c) {
    let company = c.company || '';
    if (c.email) {
        const emailLower = String(c.email).toLowerCase().trim();
        if (emailLower.includes('serv.externos.subsidiaria')) {
            return 'Externos Subsidiaria';
        } else if (emailLower.includes('serv.externos')) {
            return 'Externos Empresa';
        } else if (emailLower.includes('subsidiaria')) {
            return 'Subsidiaria';
        } else if (emailLower.includes('empresa')) {
            return 'Empresa Principal';
        } else if (emailLower.includes('newpay')) {
            return 'Subsidiaria B';
        } else if (emailLower.includes('texpert')) {
            return 'Proveedor TI';
        }
    }
    if (company.toUpperCase() === 'EMPRESA') return 'Empresa Principal';
    return company;
}

// Detección automática de tipificación a partir del resumen de Remedy
function autoDetectTipificacion(summary) {
    if (!summary) return null;
    const normSummary = normalizeForSearch(summary);
    
    // 1. Coincidencia exacta (con o sin sufijo (INC)/(WO))
    for (const tip of ALL_TIPIFICACIONES) {
        const normTipFull = normalizeForSearch(tip);
        const normTipText = normalizeForSearch(tip.replace(/\s*\(INC\)\s*$/i, '').replace(/\s*\(WO\)\s*$/i, ''));
        if (normSummary === normTipFull || normSummary === normTipText) {
            return tip;
        }
    }
    
    // 2. Coincidencia por sub-cadena (ordenando por longitud de mayor a menor)
    const sortedTips = [...ALL_TIPIFICACIONES].sort((a, b) => b.length - a.length);
    for (const tip of sortedTips) {
        const normTipText = normalizeForSearch(tip.replace(/\s*\(INC\)\s*$/i, '').replace(/\s*\(WO\)\s*$/i, ''));
        if (normTipText.length > 3 && normSummary.includes(normTipText)) {
            return tip;
        }
    }
    
    return null;
}

function mapElementTypeToTipificacion(elType) {
    if (!elType) return '';
    const t = elType.toLowerCase().trim();
    if (t === 'vincha') return 'Vincha';
    if (t === 'kit') return 'Kit Inalambrico';
    if (t === 'cargador') return 'Cargador';
    if (t === 'celular' || t === 'cel') return 'Alta/cambio Equipo Celular';
    if (t === 'monitor') return 'Solicitud de Monitor';
    if (t === 'equipo' || t === 'pc') return 'Equipo Nuevo o Actualizacion';
    return elType;
}

function resolveTipificacion(c) {
    if (!c) return null;
    
    let tip = c.tipificacion;
    if (tip) {
        tip = mapElementTypeToTipificacion(tip);
        const detected = autoDetectTipificacion(tip);
        if (detected) return detected;
        return tip;
    }
    
    const detected = autoDetectTipificacion(c.puesto);
    if (detected) return detected;
    
    // Fallback based on tipo for local/manual cases
    if (c.tipo) {
        return mapElementTypeToTipificacion(c.tipo);
    }
    return null;
}


function getStateOrderIndex(stateId) {
    // 1. Intentar buscar en la ordenación de las columnas del Kanban
    const ordered = KANBAN_GROUPS.flatMap(g => g.estados);
    const kanbanIdx = ordered.indexOf(stateId);
    if (kanbanIdx !== -1) return kanbanIdx;
    
    // 2. Si no está en el Kanban (ej: reject), usar el orden estático de ESTADOS
    const staticIdx = ESTADOS.findIndex(e => e.id === stateId);
    if (staticIdx !== -1) return staticIdx + 1000;
    
    return -1;
}

function canTransitionTo(caseObj, targetStateId) {
    if (!caseObj) return { allowed: false, reason: "Objeto de ticket inválido" };
    
    // Las columnas INC/WO fijas son de entrada Remedy, no se puede arrastrar nada allí
    if (LOCKED_ESTADOS.includes(targetStateId)) {
        return { allowed: false, reason: "No se puede mover un ticket a la columna de asignación de Remedy" };
    }

    return { allowed: true };
}

// --- SECURE HTML ESCAPING & TEMPLATING (XSS PROTECTION) ---
window.escapeHtml = function(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

class SafeHtml {
    constructor(val) {
        this.val = String(val);
    }
    toString() {
        return this.val;
    }
}

/**
 * Tagged template literal helper that automatically escapes all interpolated values,
 * preventing XSS vulnerabilities. To bypass escaping for trusted HTML strings,
 * wrap them in safe(value).
 */
window.html = function(strings, ...values) {
    const raw = strings.reduce((result, string, i) => {
        let value = values[i - 1];
        if (value instanceof SafeHtml) {
            value = value.toString();
        } else if (Array.isArray(value)) {
            value = value.map(val => val instanceof SafeHtml ? val.toString() : escapeHtml(String(val))).join('');
        } else if (value !== undefined && value !== null) {
            value = escapeHtml(String(value));
        } else {
            value = '';
        }
        return result + value + string;
    });
    return new SafeHtml(raw);
};

/**
 * Marks a string as safe/trusted HTML to bypass automatic escaping in html`...`.
 */
window.safe = function(val) {
    return new SafeHtml(val);
};

// Expose all to window
window.nowISO = nowISO;
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.daysSince = daysSince;
window.initials = initials;
window.formatSLADate = formatSLADate;
window.getSLAPercentage = getSLAPercentage;
window.getSLAColor = getSLAColor;
window.renderIcons = renderIcons;
window.normalizeForSearch = normalizeForSearch;
window.copyTextToClipboard = copyTextToClipboard;
window.searchCases = searchCases;
window.estadoIndex = estadoIndex;
window.tipoInfo = tipoInfo;
window.estadoLabelFor = estadoLabelFor;
window.estadoFromChecks = estadoFromChecks;
window.checksForEstado = checksForEstado;
window.isActive = isActive;
window.startOfToday = startOfToday;
window.endOfDay = endOfDay;
window.isRetiroHoy = isRetiroHoy;
window.isRetiroEstaSemana = isRetiroEstaSemana;
window.getCompanyForCase = getCompanyForCase;
window.autoDetectTipificacion = autoDetectTipificacion;
window.resolveTipificacion = resolveTipificacion;
window.getStateOrderIndex = getStateOrderIndex;
window.canTransitionTo = canTransitionTo;

export {
    nowISO,
    formatDate,
    formatDateTime,
    daysSince,
    initials,
    formatSLADate,
    getSLAPercentage,
    getSLAColor,
    renderIcons,
    normalizeForSearch,
    copyTextToClipboard,
    searchCases,
    estadoIndex,
    tipoInfo,
    estadoLabelFor,
    estadoFromChecks,
    checksForEstado,
    isActive,
    startOfToday,
    endOfDay,
    isRetiroHoy,
    isRetiroEstaSemana,
    getCompanyForCase,
    autoDetectTipificacion,
    resolveTipificacion,
    getStateOrderIndex,
    canTransitionTo
};



// Expose to window for global module compatibility
window._fallbackCopy = _fallbackCopy;
