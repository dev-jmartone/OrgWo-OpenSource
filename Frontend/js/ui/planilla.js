// ============================================================
// PLANILLA — composable template spec
// State + wizard nav + spec engine + Outlook submit.
// Extraido de system_enhancements.js (refactor fase 2).
// ============================================================
let activePlanillaCaseId = null;
let planillaSpec = null;          // spec actual: action, reason, logistics, items[], persona, etc.
let planillaCurrentItemIdx = 0;

// ---------- DATALISTS desde la DB en memoria ----------
function populatePlanillaDatalists() {
    const marcas = new Set(), modelos = new Set(), empresas = new Set(), tickets = new Set();
    for (const c of window.cases) {
        if (c.brand)    marcas.add(c.brand);
        if (c.newModel) modelos.add(c.newModel);
        if (c.oldModel) modelos.add(c.oldModel);
        if (c.company)  empresas.add(c.company);
        if (c.wo)       tickets.add(c.wo);
        if (Array.isArray(c.items)) {
            for (const it of c.items) {
                if (it.marca)  marcas.add(it.marca);
                if (it.modelo) modelos.add(it.modelo);
            }
        }
    }
    const fill = (id, set) => {
        const dl = document.getElementById(id);
        if (!dl) return;
        dl.innerHTML = [...set].sort().map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
    };
    fill('dlMarca', marcas);
    fill('dlModelo', modelos);
    fill('dlEmpresa', empresas);
    fill('dlTicket', tickets);
}

// ---------- DROPDOWNS Acción/Razón ----------
// primaryType (opcional) = tipo principal del caso. Filtra para ocultar
// acciones/razones que no aplican a ese tipo (ej. Renuncia para Kit).
function actionAppliesTo(action, primaryType) {
    if (!primaryType) return true;
    const reasons = ACTION_RULES[action]?.reasons || {};
    return Object.values(reasons).some(r => !r.validItemTypes || r.validItemTypes.includes(primaryType));
}

function reasonAppliesTo(action, reasonKey, primaryType) {
    if (!primaryType) return true;
    const r = ACTION_RULES[action]?.reasons[reasonKey];
    return !r?.validItemTypes || r.validItemTypes.includes(primaryType);
}

// Cuando el select tiene una sola opción real, ocultarlo y mostrar un
// label estático con un mini-toggle "(cambiar)" que el operador puede usar
// para revelar el select si tiene que elegir otra cosa. Antes el select
// quedaba oculto sin escape: si el operador se equivocaba no podía verlo.
function applySingleOptionLook(selectId, optionsCount, labelText) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const parent = sel.parentElement;
    parent.querySelectorAll('.field-locked-label').forEach(n => n.remove());
    if (optionsCount <= 1 && labelText) {
        sel.style.display = 'none';
        const wrap = document.createElement('div');
        wrap.className = 'field-locked-label';
        wrap.innerHTML = `<span>${escapeHtml(labelText)}</span>` +
            `<button type="button" class="field-locked-toggle" title="Cambiar opción">cambiar</button>`;
        wrap.querySelector('.field-locked-toggle').addEventListener('click', (e) => {
            e.preventDefault();
            sel.style.display = '';
            wrap.remove();
            sel.focus();
        });
        parent.appendChild(wrap);
    } else {
        sel.style.display = '';
    }
}

function populateActionDropdown(primaryType) {
    const opts = Object.entries(ACTION_RULES).filter(([k]) => actionAppliesTo(k, primaryType));
    document.getElementById('planAction').innerHTML = opts
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    applySingleOptionLook('planAction', opts.length, opts[0]?.[1].label);
}

function populateReasonDropdown(action, primaryType) {
    const sel = document.getElementById('planReason');
    const rules = ACTION_RULES[action];
    if (!rules) { sel.innerHTML = ''; applySingleOptionLook('planReason', 0, null); return; }
    const opts = Object.entries(rules.reasons)
        .filter(([k, r]) => !r.hidden && reasonAppliesTo(action, k, primaryType));
    sel.innerHTML = opts.map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    applySingleOptionLook('planReason', opts.length, opts[0]?.[1].label);
}

// ---------- Ítem helpers ----------
function deriveItemType(tipo) { return TIPO_TO_ITEM_TYPE[tipo] || 'PC'; }

// Marcas conocidas para inferir "marca / modelo" cuando el case trae el
// modelo concatenado con la marca (caso típico del Excel maestro).
const KNOWN_BRANDS = [
    'HP', 'Dell', 'Lenovo', 'Apple', 'Samsung', 'Motorola', 'Xiaomi',
    'Logitech', 'Jabra', 'Microsoft', 'Asus', 'Acer',
];

function splitBrandModel(text) {
    const raw = String(text || '').trim();
    if (!raw) return { marca: '', modelo: '' };
    for (const brand of KNOWN_BRANDS) {
        const re = new RegExp(`^${brand}\\s+`, 'i');
        if (re.test(raw)) {
            return { marca: brand, modelo: raw.replace(re, '').trim() };
        }
    }
    return { marca: '', modelo: raw };
}

// Title case ligero para strings que vienen en mayúsculas (típico de imports).
// No toca strings que ya tienen mezcla de mayús/minús.
function smartCase(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    if (t !== t.toUpperCase()) return t;
    return t.toLowerCase().replace(
        /(^|[\s\-_/])([a-záéíóúñ])/g,
        (_, sep, ch) => sep + ch.toUpperCase()
    );
}

// Resuelve marca + modelo desde el case según el role del mov. role='new'
// lee solo c.newModel; role='old' lee solo c.oldModel. Sin fallback
// cruzado: si falta el dato, el recuadro queda vacío para que el operador
// lo cargue. Pisar con datos del equipo equivocado falsea el template
// firmado.
function deriveMarcaModelo(c, typeDef, role = 'new') {
    const raw = role === 'old' ? (c?.oldModel || '') : (c?.newModel || '');
    if (c?.brand && role === 'new') {
        return {
            marca: smartCase(c.brand),
            modelo: smartCase(raw || typeDef.defaultModelo || ''),
        };
    }
    if (raw) {
        const split = splitBrandModel(raw);
        if (split.marca) return { marca: split.marca, modelo: smartCase(split.modelo) };
        return { marca: typeDef.defaultMarca || '', modelo: smartCase(raw) };
    }
    return {
        marca: typeDef.defaultMarca || '',
        modelo: typeDef.defaultModelo || '',
    };
}

// Si el caso reporta un solo IMEI, dejar constancia con "No tiene" en el
// segundo. Para casos celulares el campo svcTag (heredado de la fila del
// Excel / Remedy) contiene el IMEI del equipo viejo, no un service tag.
// Si no hay imei1 explícito y el caso es celular, fallback a svcTag.
//
// role='new' → siempre devuelve IMEIs vacíos. El IMEI del equipo nuevo
// no se conoce hasta que el operador lo prepara desde depósito y lo
// carga a mano. Heredar el IMEI del viejo en el item nuevo era el bug
// que mareaba el template firmado.
function deriveImeis(c, role = 'old') {
    if (role === 'new') return { imei1: '', imei2: '' };
    let i1 = (c?.imei1 || '').trim();
    let i2 = (c?.imei2 || '').trim();
    if (!i1 && c?.tipo === 'cel') {
        i1 = (c?.svcTag || '').trim();
    }
    if (i1 && !i2) i2 = 'No tiene';
    return { imei1: i1, imei2: i2 };
}

// Serie esperada para (type, role) según el case. CEL nunca hereda svcTag
// al campo serie (ahí va el IMEI); no-CEL usa newSvc para 'new' y svcTag
// para 'old'.
function expectedSerieFor(type, role, c) {
    if (type === 'CEL') return role === 'new' ? (c?.newSvc || '') : '';
    return role === 'old' ? (c?.svcTag || '') : (c?.newSvc || '');
}

// fechaAsignacion es DEL EQUIPO, no del trámite. Cada equipo (viejo/nuevo)
// tiene la suya. role='old' lee c.fechaAsignacion (validada en TCC/
// Racktables/Intune); role='new' lee c.fechaAsignacionNew (cuándo se
// configuró el reemplazo). Vacío si falta — nunca defaultear a "hoy", para
// no falsear el historial que valida derechos como el beneficio de 3 años.
function expectedFechaAsignacionFor(role, c) {
    const raw = role === 'old' ? (c?.fechaAsignacion || '') : (c?.fechaAsignacionNew || '');
    return raw ? String(raw).slice(0, 10) : '';
}

function makeEmptyItem(type, mov, c, action, reason, logistics) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const def = ITEM_TYPES[type] || {};
    const role = MOV_TYPES[mov]?.equipmentRole || 'new';
    const { marca, modelo } = deriveMarcaModelo(c, def, role);
    const { imei1, imei2 } = deriveImeis(c, role);
    return {
        type,
        mov,
        marca,
        modelo,
        serie: expectedSerieFor(type, role, c),
        imei1,
        imei2,
        ticket: planillaSpec?.ticket || c?.id || '',
        // fechaAsignacion vacía si no se conoce. NO defaultear a hoy: esta
        // fecha es del equipo (cuándo se asignó originalmente al usuario),
        // no del trámite.
        fechaAsignacion: expectedFechaAsignacionFor(role, c),
        fechaMovimiento: todayStr,
        obs: defaultObsFor(type, mov, action, reason, logistics),
        cantidad: 1,
    };
}

// Re-deriva marca/modelo/serie/fechaAsignacion de un item persistido si
// detecta autofill corrupto de versiones anteriores del autollenado
// (cuando el item con role='new' venía cargado con datos del equipo
// viejo). Solo toca los campos derivables del case; preserva obs/cantidad/
// imei (cosas que el operador edita). Si los valores actuales no matchean
// el patrón corrupto, el item se devuelve sin cambios.
function rederiveIfCorrupt(item, c) {
    const role = MOV_TYPES[item.mov]?.equipmentRole || 'new';
    const def = ITEM_TYPES[item.type] || {};
    const wrongRole = role === 'new' ? 'old' : 'new';
    const wrong = deriveMarcaModelo(c, def, wrongRole);
    const wrongSerie = expectedSerieFor(item.type, wrongRole, c);
    const looksCorrupt =
        item.marca === wrong.marca &&
        item.modelo === wrong.modelo &&
        (item.serie || '') === wrongSerie;
    if (!looksCorrupt) return item;
    const correct = deriveMarcaModelo(c, def, role);
    const correctImeis = deriveImeis(c, role);
    return {
        ...item,
        marca: correct.marca,
        modelo: correct.modelo,
        serie: expectedSerieFor(item.type, role, c),
        fechaAsignacion: expectedFechaAsignacionFor(role, c),
        imei1: correctImeis.imei1,
        imei2: correctImeis.imei2,
    };
}

// Para recambio.beneficio / recambio.tecnologico, el orden de las tablas
// del template debe ser BENEFICIO (equipo viejo que sale al usuario)
// primero, ASIGNACION (equipo nuevo) despues. Aplica tanto a items
// recien creados como a items persistidos. Agrupa por tipo para
// mantener juntas las parejas PC y CEL en casos 'both'.
function reorderBeneficioItems(items) {
    if (!items.length) return items;
    const rolePrio = it => (MOV_TYPES[it.mov]?.equipmentRole === 'old' ? 0 : 1);
    const groups = new Map();
    for (const it of items) {
        if (!groups.has(it.type)) groups.set(it.type, []);
        groups.get(it.type).push(it);
    }
    const out = [];
    for (const arr of groups.values()) {
        arr.sort((a, b) => rolePrio(a) - rolePrio(b));
        out.push(...arr);
    }
    return out;
}

function initialItemsForCase(c, action, reason, logistics) {
    const needsBeneficioOrder = action === 'recambio' && (reason === 'beneficio' || reason === 'tecnologico');

    // Si el caso ya tiene items persistidos, reusarlos (deep clone) y
    // pasarlos por rederiveIfCorrupt para limpiar autofill heredado del
    // bug previo donde role='new' caía a oldModel.
    if (Array.isArray(c.items) && c.items.length > 0) {
        const clone = JSON.parse(JSON.stringify(c.items));
        const rederived = clone.map(it => rederiveIfCorrupt(it, c));
        return needsBeneficioOrder ? reorderBeneficioItems(rederived) : rederived;
    }
    // Si no, derivar slot(s) iniciales según la matriz acción×razón.
    const rule = ACTION_RULES[action]?.reasons[reason];
    let baseType = deriveItemType(c.tipo);
    if (!rule) return [makeEmptyItem(baseType, 'egreso', c, action, reason, logistics)];

    // Si el tipo del caso no aplica a esta razón, fallback al primer tipo válido.
    if (rule.validItemTypes && !rule.validItemTypes.includes(baseType)) {
        baseType = rule.validItemTypes[0];
    }

    const items = effectiveMovsFor(rule, baseType).map(mov => makeEmptyItem(baseType, mov, c, action, reason, logistics));
    // Caso especial: tipo histórico 'both' (PC + Cel) en recambio → duplico para CEL.
    if (c.tipo === 'both' && action === 'recambio' && rule.validItemTypes?.includes('CEL')) {
        for (const mov of effectiveMovsFor(rule, 'CEL')) items.push(makeEmptyItem('CEL', mov, c, action, reason, logistics));
    }
    return needsBeneficioOrder ? reorderBeneficioItems(items) : items;
}

// Mapas input → data-fk del td en el preview. Cada campo del wizard
// se conecta a la celda que muestra ese dato. Foco en input → tinta la
// celda matching. Multiples campos pueden compartir una fk (marca y
// serie van a la misma fila "Marca y serie").
const ITEM_FIELD_TO_FK = {
    type:            'tipo-modelo',
    modelo:          'marca-modelo',
    marca:           'marca-modelo',
    serie:           'serie',
    imei1:           'imei',
    imei2:           'imei',
    fechaAsignacion: 'fecha-asig',
    fechaMovimiento: 'fecha-mov',
    mov:             'tipo-modelo',
    obs:             'obs',
    ticket:          'ticket',
};
const GLOBAL_INPUT_TO_FK = {
    planTicket:        'ticket',
    planEmpresa:       'empresa',
    planPersonaRetira: 'pers-retira',
    planEmailRetira:   'email-usuario',
    planTecnico:       'tecnico',
};

// Item fields → highlight solo en el item activo (esa edicion afecta
// solo a ese bloque del template). Globals → highlight en todos los
// items (el dato aparece en cada bloque, son spec-level).
function highlightItemFk(fk, on) {
    const previewBody = document.getElementById('planPreviewBody');
    if (!previewBody || !fk) return;
    const scope = previewBody.querySelector('.preview-item.active') || previewBody;
    scope.querySelectorAll(`td[data-fk="${fk}"]`).forEach(td => td.classList.toggle('fk-active', on));
}
function highlightGlobalFk(fk, on) {
    const previewBody = document.getElementById('planPreviewBody');
    if (!previewBody || !fk) return;
    previewBody.querySelectorAll(`td[data-fk="${fk}"]`).forEach(td => td.classList.toggle('fk-active', on));
}
// Tras cada updatePreview el innerHTML se regenera y se pierde la clase
// fk-active. Si el operador sigue tipeando en un input, reaplica el
// highlight al td que corresponde al input enfocado.
function reapplyFocusedFkHighlight() {
    const focused = document.activeElement;
    if (!focused) return;
    if (focused.dataset?.itemfield) {
        highlightItemFk(ITEM_FIELD_TO_FK[focused.dataset.itemfield], true);
    } else if (focused.id && GLOBAL_INPUT_TO_FK[focused.id]) {
        highlightGlobalFk(GLOBAL_INPUT_TO_FK[focused.id], true);
    }
}

// Diff en años calendario completos entre dos fechas yyyy-mm-dd. Devuelve
// null si alguna es inválida. Cuenta como "3 años cumplidos" recién a
// partir del mismo día (5/jun/2023 → 5/jun/2026 = 3, no 4/jun/2026).
function diffYearsAR(d1, d2) {
    if (!d1 || !d2) return null;
    const a = new Date(d1), b = new Date(d2);
    if (isNaN(a) || isNaN(b)) return null;
    let yrs = b.getFullYear() - a.getFullYear();
    const mDiff = b.getMonth() - a.getMonth();
    if (mDiff < 0 || (mDiff === 0 && b.getDate() < a.getDate())) yrs--;
    return yrs;
}

// Chequeo "Beneficio 3 años". Solo devuelve algo cuando aplica y
// faltan años. No marca el caso OK — el operador no necesita feedback
// positivo, solo aviso cuando el requisito no se cumple.
function beneficioCheckFor(item) {
    if (!planillaSpec) return null;
    if (planillaSpec.action !== 'recambio') return null;
    if (planillaSpec.reason !== 'beneficio' && planillaSpec.reason !== 'tecnologico') return null;
    const role = MOV_TYPES[item.mov]?.equipmentRole;
    if (role !== 'old') return null;
    const paired = planillaSpec.items.find(it =>
        it !== item && it.type === item.type && MOV_TYPES[it.mov]?.equipmentRole === 'new'
    );
    if (!paired) return null;
    if (!item.fechaAsignacion || !paired.fechaAsignacion) return null;
    const years = diffYearsAR(item.fechaAsignacion, paired.fechaAsignacion);
    if (years == null || years >= 3) return null;
    return { years };
}

// ---------- Helper LocalStorage & Autocomplete ----------
function savePlanillaToLocalStorage() {
    if (!planillaSpec) return;
    const key = `planilla_spec_${activePlanillaCaseId || 'blank'}`;
    localStorage.setItem(key, JSON.stringify(planillaSpec));
}

function loadPlanillaFromLocalStorage(caseId) {
    const key = `planilla_spec_${caseId || 'blank'}`;
    const saved = localStorage.getItem(key);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error('Error parsing saved planilla spec', e);
        }
    }
    return null;
}

function clearPlanillaFromLocalStorage(caseId) {
    const key = `planilla_spec_${caseId || 'blank'}`;
    localStorage.removeItem(key);
}

function lookupFechaAsignacionBySerial(serial) {
    if (!serial) return null;
    const cleanSerial = String(serial).trim().toUpperCase();
    if (!cleanSerial) return null;
    for (const c of window.cases || []) {
        if (c.svcTag && String(c.svcTag).trim().toUpperCase() === cleanSerial) {
            if (c.fechaAsignacion) return c.fechaAsignacion;
        }
        if (c.newSvc && String(c.newSvc).trim().toUpperCase() === cleanSerial) {
            if (c.fechaAsignacionNew) return c.fechaAsignacionNew;
        }
        if (Array.isArray(c.items)) {
            for (const it of c.items) {
                if (it.serie && String(it.serie).trim().toUpperCase() === cleanSerial) {
                    if (it.fechaAsignacion) return it.fechaAsignacion;
                }
            }
        }
    }
    return null;
}

// ---------- Render vertical collapsible items list ----------
function renderPlanillaItems() {
    const container = document.getElementById('planItemsContainer');
    if (!container || !planillaSpec) return;

    if (!planillaSpec.items || planillaSpec.items.length === 0) {
        container.innerHTML = '<div style="padding: 10px; color: var(--text-muted); font-size: 12px; text-align: center;">Sin ítems. Agregá uno con el botón "+ Agregar ítem".</div>';
        return;
    }

    const currentYear = new Date().getFullYear();

    container.innerHTML = planillaSpec.items.map((item, idx) => {
        const typeDef = ITEM_TYPES[item.type] || ITEM_TYPES.PC;
        const movDef  = MOV_TYPES[item.mov]   || MOV_TYPES.egreso;

        const currentRule = ACTION_RULES[planillaSpec.action]?.reasons[planillaSpec.reason];
        const validTypes  = currentRule?.validItemTypes || Object.keys(ITEM_TYPES);
        const effectiveValidTypes = validTypes;
        const validMovs   = effectiveMovsFor(currentRule, item.type);
        const allowedMovs  = [...new Set([...validMovs, 'ingreso', 'egreso'])];

        const typeOptions = Object.entries(ITEM_TYPES)
            .filter(([k]) => effectiveValidTypes.includes(k))
            .map(([k, v]) => `<option value="${k}"${k === item.type ? ' selected' : ''}>${v.label}</option>`).join('');
        const movOptions  = Object.entries(MOV_TYPES)
            .filter(([k]) => allowedMovs.includes(k))
            .map(([k, v]) => `<option value="${k}"${k === item.mov ? ' selected' : ''}>${v.label}</option>`).join('');

        const typeFieldHTML = effectiveValidTypes.length <= 1
            ? `<div class="field-locked-label">${escapeHtml(ITEM_TYPES[item.type]?.label || item.type)}</div>`
            : `<select data-itemfield="type" data-item-idx="${idx}">${typeOptions}</select>`;
        const movFieldHTML = allowedMovs.length <= 1
            ? `<div class="field-locked-label">${escapeHtml(MOV_TYPES[item.mov]?.label || item.mov)}</div>`
            : `<select data-itemfield="mov" data-item-idx="${idx}">${movOptions}</select>`;

        const showSerie = typeDef.fields.includes('serie');
        const showImei  = typeDef.fields.includes('imei1');

        const obsTemplates = (window.userTemplateObs || []).filter(obs => obs.action === planillaSpec.action);
        const tabsHTML = obsTemplates.map((obs, obsIdx) => `
            <button type="button" class="obs-template-tab" data-obs-idx="${obsIdx}" data-item-idx="${idx}">${escapeHtml(obs.title)}</button>
        `).join('');

        const isCollapsedClass = item.collapsed ? ' collapsed' : '';
        const summaryText = `(${item.marca || '—'} - ${item.modelo || '—'})`;

        const deleteButtonHTML = planillaSpec.items.length > 1
            ? `<button type="button" class="btn-item-delete" data-item-idx="${idx}" title="Eliminar ítem"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>`
            : '';

        return `
            <div class="planilla-item-card${isCollapsedClass}" data-item-idx="${idx}">
                <div class="planilla-item-card-header">
                    <div class="header-info">
                        <span class="mov-pill ${item.mov}">${escapeHtml(movDef.short)}</span>
                        <strong style="font-size: 12.5px;">${escapeHtml(typeDef.label)}</strong>
                        <span class="brand-model-summary">${escapeHtml(summaryText)}</span>
                    </div>
                    <div class="header-actions">
                        ${deleteButtonHTML}
                        <i data-lucide="chevron-down" class="chevron-icon"></i>
                    </div>
                </div>
                <div class="planilla-item-card-body">
                    <div class="field-grid">
                        <div class="field">
                            <label>Tipo</label>
                            ${typeFieldHTML}
                        </div>
                        <div class="field">
                            <label>Movimiento</label>
                            ${movFieldHTML}
                        </div>
                        <div class="field">
                            <label>Nro de Ticket</label>
                            <input type="text" data-itemfield="ticket" data-item-idx="${idx}" value="${escapeHtml(item.ticket || '')}" placeholder="Ticket / Incidente">
                        </div>
                        <div class="field">
                            <label>Marca</label>
                            <input type="text" data-itemfield="marca" data-item-idx="${idx}" list="dlMarca" value="${escapeHtml(item.marca || '')}" placeholder="Ej: HP">
                        </div>
                        <div class="field">
                            <label>Modelo</label>
                            <input type="text" data-itemfield="modelo" data-item-idx="${idx}" list="dlModelo" value="${escapeHtml(item.modelo || '')}" placeholder="Ej: ProBook">
                        </div>
                        ${showSerie ? `
                        <div class="field field-full">
                            <label>N° de serie / Service Tag</label>
                            <input type="text" data-itemfield="serie" data-item-idx="${idx}" value="${escapeHtml(item.serie || '')}" placeholder="Ej: ABC123XYZ">
                        </div>` : ''}
                        ${showImei ? `
                        <div class="field">
                            <label>IMEI 1</label>
                            <input type="text" data-itemfield="imei1" data-item-idx="${idx}" value="${escapeHtml(item.imei1 || '')}">
                        </div>
                        <div class="field">
                            <label>IMEI 2</label>
                            <input type="text" data-itemfield="imei2" data-item-idx="${idx}" value="${escapeHtml(item.imei2 || '')}">
                        </div>` : ''}
                        <div class="field">
                            <label>Fecha asignación</label>
                            <input type="date" data-itemfield="fechaAsignacion" data-item-idx="${idx}" value="${escapeHtml(item.fechaAsignacion || '')}" min="2015-01-01" max="${currentYear}-12-31"${beneficioCheckFor(item) ? ' class="benefit-warn"' : ''}>
                        </div>
                        <div class="field">
                            <label>Fecha del movimiento</label>
                            <input type="date" data-itemfield="fechaMovimiento" data-item-idx="${idx}" value="${escapeHtml(item.fechaMovimiento || '')}" min="${currentYear}-01-01" max="${currentYear}-12-31">
                        </div>
                        <div class="field field-full">
                            <label>Observaciones de este ítem</label>
                            <div class="obs-template-tabs">
                                ${tabsHTML}
                            </div>
                            <textarea data-itemfield="obs" data-item-idx="${idx}" rows="2" style="min-height: 48px;" placeholder="Ej: Se entrega en su caja con cargador">${escapeHtml(item.obs || '')}</textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Wire up events
    container.querySelectorAll('.planilla-item-card').forEach(card => {
        const idx = parseInt(card.dataset.itemIdx, 10);
        const item = planillaSpec.items[idx];

        const header = card.querySelector('.planilla-item-card-header');
        header.addEventListener('click', (e) => {
            if (e.target.closest('.btn-item-delete')) return;
            const isCollapsed = card.classList.toggle('collapsed');
            item.collapsed = isCollapsed;
            savePlanillaToLocalStorage();
        });

        const delBtn = card.querySelector('.btn-item-delete');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                planillaSpec.items.splice(idx, 1);
                renderPlanillaItems();
                savePlanillaToLocalStorage();
                updatePreview();
            });
        }

        card.querySelectorAll('[data-itemfield]').forEach(el => {
            const field = el.dataset.itemfield;

            el.addEventListener('focus', () => {
                highlightItemFk(ITEM_FIELD_TO_FK[field], true);
                syncPreviewToItem(idx);
            });

            el.addEventListener('blur', () => {
                highlightItemFk(ITEM_FIELD_TO_FK[field], false);
            });

            el.addEventListener('input', e => {
                let val = e.target.value;
                item[field] = val;

                if (field === 'marca' || field === 'modelo') {
                    const summaryEl = card.querySelector('.brand-model-summary');
                    if (summaryEl) {
                        summaryEl.textContent = `(${item.marca || '—'} - ${item.modelo || '—'})`;
                    }
                }

                if (field === 'type') {
                    const newDef = ITEM_TYPES[val] || {};
                    if (!item.marca  && newDef.defaultMarca)  item.marca  = newDef.defaultMarca;
                    if (!item.modelo && newDef.defaultModelo) item.modelo = newDef.defaultModelo;
                    const currentRule = ACTION_RULES[planillaSpec.action]?.reasons[planillaSpec.reason];
                    const validMovs = effectiveMovsFor(currentRule, val);
                    const allowedMovs = [...new Set([...validMovs, 'ingreso', 'egreso'])];
                    if (!allowedMovs.includes(item.mov)) item.mov = allowedMovs[0];
                    if (isDefaultObs(item.obs)) {
                        item.obs = defaultObsFor(item.type, item.mov, planillaSpec.action, planillaSpec.reason, planillaSpec.logistics);
                    }
                    renderPlanillaItems();
                } else if (field === 'mov') {
                    if (isDefaultObs(item.obs)) {
                        item.obs = defaultObsFor(item.type, item.mov, planillaSpec.action, planillaSpec.reason, planillaSpec.logistics);
                    }
                    renderPlanillaItems();
                }

                savePlanillaToLocalStorage();
                updatePreview();
            });

            if (el.type === 'date') {
                el.addEventListener('blur', e => {
                    const clamped = clampDateValue(field, e.target.value);
                    if (clamped !== e.target.value) {
                        e.target.value = clamped;
                        item[field] = clamped;
                    }
                    if (field === 'fechaAsignacion') {
                        const warn = beneficioCheckFor(item);
                        el.classList.toggle('benefit-warn', !!warn);
                    }
                    savePlanillaToLocalStorage();
                    updatePreview();
                });
            }

            if (field === 'serie') {
                el.addEventListener('blur', e => {
                    const val = e.target.value;
                    if (val && !item.fechaAsignacion) {
                        const suggestedDate = lookupFechaAsignacionBySerial(val);
                        if (suggestedDate) {
                            const yyyymmdd = String(suggestedDate).slice(0, 10);
                            item.fechaAsignacion = yyyymmdd;
                            const dateInput = card.querySelector(`[data-itemfield="fechaAsignacion"]`);
                            if (dateInput) {
                                dateInput.value = yyyymmdd;
                                const warn = beneficioCheckFor(item);
                                dateInput.classList.toggle('benefit-warn', !!warn);
                            }
                            savePlanillaToLocalStorage();
                            updatePreview();
                            toast('Se sugirió fecha de asignación basada en el número de serie', 'info');
                        }
                    }
                });
            }
        });

        card.querySelectorAll('.obs-template-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const obsIdx = parseInt(tab.dataset.obsIdx, 10);
                const obsTemplates = (window.userTemplateObs || []).filter(obs => obs.action === planillaSpec.action);
                const obs = obsTemplates[obsIdx];
                if (!obs) return;

                const equipoTxt = (ITEM_TYPES[item.type]?.label || 'equipo').split(' / ')[0].toLowerCase();
                let text = obs.text.replace(/{equipo}/g, equipoTxt);

                if (planillaSpec.logistics === 'correo_interno' && !text.includes(CORREO_INTERNO_SUFFIX)) {
                    text = `${text}\n${CORREO_INTERNO_SUFFIX}`;
                }

                item.obs = text;
                const textarea = card.querySelector('textarea[data-itemfield="obs"]');
                if (textarea) {
                    textarea.value = text;
                }
                savePlanillaToLocalStorage();
                updatePreview();
            });
        });
    });

    if (window.lucide) lucide.createIcons();
}

function clampDateValue(field, val) {
    const currentYear = new Date().getFullYear();
    if (!val) return val;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
    if (!m) return val;
    const yr = parseInt(m[1], 10);
    if (field === 'fechaMovimiento' && yr !== currentYear) return `${currentYear}-${m[2]}-${m[3]}`;
    if (field === 'fechaAsignacion' && (yr < 2015 || yr > currentYear)) return '';
    return val;
}

function planAddItem() {
    if (!planillaSpec) return;
    const c = casesById(activePlanillaCaseId);
    const last = planillaSpec.items[planillaSpec.items.length - 1];
    const newType = last?.type || deriveItemType(c?.tipo);
    const newMov  = last?.mov  || 'egreso';
    
    const motherTicket = (planillaSpec.ticket || c?.id || '').trim();
    
    const addAndRender = (ticketVal) => {
        planillaSpec.items.forEach(it => {
            it.collapsed = true;
        });

        const newItem = makeEmptyItem(newType, newMov, c, planillaSpec.action, planillaSpec.reason);
        newItem.ticket = ticketVal;
        newItem.collapsed = false;
        planillaSpec.items.push(newItem);

        renderPlanillaItems();
        savePlanillaToLocalStorage();
        updatePreview();
    };

    if (motherTicket) {
        Swal.fire({
            title: '¿Mismo número de ticket?',
            text: `¿Este ítem pertenece al mismo nro de ticket (${motherTicket})?`,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: 'Sí',
            denyButtonText: 'No (Ingresar nuevo)',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--primary)',
            denyButtonColor: 'var(--accent)'
        }).then((result) => {
            if (result.isConfirmed) {
                addAndRender(motherTicket);
            } else if (result.isDenied) {
                Swal.fire({
                    title: 'Nuevo número de ticket/incidente',
                    input: 'text',
                    inputPlaceholder: 'INC00000XXXXXXXX o WO00000XXXXXXX',
                    showCancelButton: true,
                    confirmButtonText: 'Aceptar',
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: 'var(--primary)',
                    inputValidator: (value) => {
                        if (!value || !value.trim()) {
                            return 'Debés ingresar un número de ticket';
                        }
                    }
                }).then((inputResult) => {
                    if (inputResult.isConfirmed) {
                        addAndRender(inputResult.value.trim());
                    }
                });
            }
        });
    } else {
        Swal.fire({
            title: 'Ingresar número de ticket/incidente',
            input: 'text',
            inputPlaceholder: 'INC00000XXXXXXXX o WO00000XXXXXXX',
            showCancelButton: true,
            confirmButtonText: 'Aceptar',
            cancelButtonText: 'Cancelar (dejar vacío)',
            confirmButtonColor: 'var(--primary)',
        }).then((inputResult) => {
            if (inputResult.isDismissed && inputResult.dismiss === Swal.DismissReason.backdrop) {
                return;
            }
            const ticketVal = (inputResult.isConfirmed && inputResult.value) ? inputResult.value.trim() : '';
            addAndRender(ticketVal);
        });
    }
}

// ---------- OPEN / CLOSE ----------
// Smart defaults: el case trae pistas para inferir acción + razón a partir
// de la tipificación del ticket Remedy (guardada en c.puesto), evitando
// que el operador tenga que tocar los dropdowns en el 80% de los casos.
//
// Heurística por keyword en la tipificación (uppercase para match):
//  - "NOTEBOOK BAJA" / "TEL. MOVIL BAJA" / cualquier "BAJA" en equipo:
//    recambio.beneficio (genera 2 items: egreso_wipe del viejo + egreso
//    del nuevo).
//  - "REPARACION" / "FALLA" / "DEFECTUOSO":
//    recambio.defectuoso (genera egreso del nuevo + ingreso del viejo).
//  - Caso vino del Excel maestro (legacy, excelStatus no vacío) →
//    recambio.beneficio.
//  - Default: asignación.normal (lo más común para altas, vinchas, kits).
function defaultActionForCase(c) {
    return defaultActionReasonForCase(c).action;
}
function defaultReasonForCase(c) {
    return defaultActionReasonForCase(c).reason;
}
function defaultActionReasonForCase(c) {
    const tipo = c?.tipo || '';
    const equipo = ['pc','cel','both','monitor'].includes(tipo);
    const ticketText = String(c?.puesto || '').toUpperCase();

    if (equipo && /\bBAJA\b/.test(ticketText)) {
        return { action: 'recambio', reason: 'beneficio' };
    }
    if (equipo && /\b(REPARACION|REPARACIÓN|FALLA|DEFECTUOSO)\b/.test(ticketText)) {
        return { action: 'recambio', reason: 'defectuoso' };
    }
    const hasExcel = !!(c?.excelStatus && String(c.excelStatus).trim());
    if (hasExcel && equipo) {
        return { action: 'recambio', reason: 'beneficio' };
    }
    return { action: 'asignacion', reason: 'normal' };
}

// Legacy — call sites que no tienen el case.
function defaultReasonForAction(action) {
    return Object.keys(ACTION_RULES[action]?.reasons || { normal: {} })[0];
}

// Normaliza nombres de empresa del Remedy ("EMPRESA" → "Empresa Principal"). El
// equipo usa el nombre corto en templates firmados, no la razón social
// corporativa. Sincronizado con Backend.normalize_company en remedy.py.
const _COMPANY_NORMALIZE = {
    'EMPRESA':           'Empresa Principal',
    'EMPRESA PRINCIPAL': 'Empresa Principal',
    'SUBSIDIARIA':       'Subsidiaria',
    'SUBSIDIARIA B':     'Subsidiaria B',
    'PROVEEDOR TI':      'Proveedor TI',
};
function normalizeCompanyName(name) {
    if (!name) return '';
    const s = String(name).trim();
    return _COMPANY_NORMALIZE[s.toUpperCase()] || s;
}

function openPlanillaModal(caseId, opts = {}) {
    const c = casesById(caseId);
    if (!c) return;
    activePlanillaCaseId = caseId;

    const primaryType = deriveItemType(c.tipo);

    populatePlanillaDatalists();
    populateActionDropdown(primaryType);

    // Try to load from localStorage first
    const savedSpec = loadPlanillaFromLocalStorage(caseId);
    if (savedSpec) {
        planillaSpec = savedSpec;
        planillaSpec.tecnico = currentUser ? currentUser.name : '';
    } else {
        const smart = defaultActionReasonForCase(c);
        let action = c.action || smart.action;
        if (!actionAppliesTo(action, primaryType)) {
            action = Object.keys(ACTION_RULES).find(a => actionAppliesTo(a, primaryType)) || 'asignacion';
        }
        let reason = c.reason || (action === smart.action ? smart.reason : defaultReasonForAction(action));
        if (!reasonAppliesTo(action, reason, primaryType)) {
            const valid = Object.keys(ACTION_RULES[action].reasons).filter(r => reasonAppliesTo(action, r, primaryType));
            reason = valid[0] || Object.keys(ACTION_RULES[action].reasons)[0];
        }

        const normalizedCompany = normalizeCompanyName(c.company || '');
        const todayStr = new Date().toISOString().slice(0, 10);

        planillaSpec = {
            action, reason,
            logistics: c.logistics || 'presencial',
            ticket: c.wo || '',
            empresa: normalizedCompany,
            tecnico: currentUser ? currentUser.name : '',
            personaRetira: c.name  || '',
            emailRetira:   c.email || '',
            fechaMovimiento: todayStr,
            obsGenerales: opts.obsGenerales || '',
            saludoOverride: '',
            items: initialItemsForCase(c, action, reason, c.logistics || 'presencial'),
        };

        if (planillaSpec.items.length > 0) {
            planillaSpec.items.forEach((it, idx) => {
                it.collapsed = idx > 0;
            });
        }

        if (opts.obsFirstItem && planillaSpec.items.length > 0) {
            planillaSpec.items[0].obs = opts.obsFirstItem;
        }
    }

    document.getElementById('planAction').value    = planillaSpec.action;
    populateReasonDropdown(planillaSpec.action, primaryType);
    document.getElementById('planReason').value    = planillaSpec.reason;
    document.getElementById('planLogistics').value = planillaSpec.logistics;
    document.getElementById('planTicket').value    = planillaSpec.ticket || '';
    document.getElementById('planEmpresa').value   = planillaSpec.empresa || '';
    document.getElementById('planTecnico').value   = planillaSpec.tecnico || '';
    document.getElementById('planPersonaRetira').value = planillaSpec.personaRetira || '';
    document.getElementById('planEmailRetira').value   = planillaSpec.emailRetira || '';

    const saludoEl = document.getElementById('planSaludo');
    if (saludoEl) saludoEl.value = planillaSpec.saludoOverride || '';
    const greets = (window.userTemplateGreetings || []).filter(g => g.action === planillaSpec.action);
    const isCustom = !!planillaSpec.saludoOverride && !greets.some(g => g.text.trim() === planillaSpec.saludoOverride.trim());
    const wrap = document.getElementById('planSaludoEditorWrap');
    if (wrap) wrap.style.display = isCustom ? 'flex' : 'none';
    refreshSaludoStatus();

    applyEmpresaFromEmail();
    renderPlanillaItems();
    updatePreview();

    if (!planillaSpec.emailRetira && activePlanillaCaseId) {
        const lookupCaseId = activePlanillaCaseId;
        API.lookupUserEmailForCase(lookupCaseId).then(res => {
            if (!res || !res.email) return;
            if (lookupCaseId !== activePlanillaCaseId) return;
            if (planillaSpec?.emailRetira) return;
            planillaSpec.emailRetira = res.email;
            const el = document.getElementById('planEmailRetira');
            if (el) el.value = res.email;
            const cc = casesById(lookupCaseId);
            if (cc && !cc.email) cc.email = res.email;
            applyEmpresaFromEmail();
            savePlanillaToLocalStorage();
            updatePreview();
        }).catch(err => console.warn('email lookup falló:', err));
    }

    document.getElementById('planillaModal').classList.add('open');
}

function openPlanillaModalBlank() {
    activePlanillaCaseId = null;

    populatePlanillaDatalists();
    populateActionDropdown(null);

    const savedSpec = loadPlanillaFromLocalStorage(null);
    if (savedSpec) {
        planillaSpec = savedSpec;
        planillaSpec.tecnico = currentUser ? currentUser.name : '';
    } else {
        const action = 'asignacion';
        const reason = 'normal';
        const todayStr = new Date().toISOString().slice(0, 10);

        planillaSpec = {
            action, reason,
            logistics: 'presencial',
            ticket: '',
            empresa: '',
            tecnico: currentUser ? currentUser.name : '',
            personaRetira: '',
            emailRetira: '',
            fechaMovimiento: todayStr,
            obsGenerales: '',
            saludoOverride: '',
            items: [makeEmptyItem('PC', 'egreso', undefined, action, reason, 'presencial')],
        };
        planillaSpec.items[0].collapsed = false;
    }

    document.getElementById('planAction').value    = planillaSpec.action;
    populateReasonDropdown(planillaSpec.action, null);
    document.getElementById('planReason').value    = planillaSpec.reason;
    document.getElementById('planLogistics').value = planillaSpec.logistics;
    document.getElementById('planTicket').value    = planillaSpec.ticket || '';
    document.getElementById('planEmpresa').value   = planillaSpec.empresa || '';
    document.getElementById('planTecnico').value   = planillaSpec.tecnico || '';
    document.getElementById('planPersonaRetira').value = planillaSpec.personaRetira || '';
    document.getElementById('planEmailRetira').value   = planillaSpec.emailRetira || '';

    const saludoEl = document.getElementById('planSaludo');
    if (saludoEl) saludoEl.value = planillaSpec.saludoOverride || '';
    const greets = (window.userTemplateGreetings || []).filter(g => g.action === planillaSpec.action);
    const isCustom = !!planillaSpec.saludoOverride && !greets.some(g => g.text.trim() === planillaSpec.saludoOverride.trim());
    const wrap = document.getElementById('planSaludoEditorWrap');
    if (wrap) wrap.style.display = isCustom ? 'flex' : 'none';
    refreshSaludoStatus();

    const warnEl = document.getElementById('planExternalWarning');
    if (warnEl) warnEl.style.display = 'none';

    const { isExternal } = inferEmpresaFromEmail(planillaSpec.emailRetira || '');
    const btnAgregar = document.getElementById('btnAgregarConsultora');
    if (btnAgregar) {
        btnAgregar.style.display = isExternal ? 'inline-block' : 'none';
    }

    renderPlanillaItems();
    updatePreview();

    document.getElementById('planillaModal').classList.add('open');
}

async function autosavePlanillaSpec(caseId, spec) {
    if (!caseId || !spec) return;
    try {
        const newItem = spec.items.find(it => MOV_TYPES[it.mov]?.equipmentRole === 'new');
        const oldItem = spec.items.find(it => MOV_TYPES[it.mov]?.equipmentRole === 'old');
        const updates = {
            action: spec.action,
            reason: spec.reason,
            logistics: spec.logistics,
            items: spec.items,
            wo: spec.ticket,
            company: spec.empresa,
        };
        if (newItem) {
            updates.newModel = newItem.modelo || '';
            updates.newSvc   = newItem.serie  || '';
            updates.fechaAsignacionNew = newItem.fechaAsignacion || '';
        }
        if (oldItem) {
            updates.oldModel = oldItem.modelo || '';
            updates.svcTag   = oldItem.serie  || '';
            updates.fechaAsignacion = oldItem.fechaAsignacion || '';
        }
        await API.update(caseId, updates);
        if (typeof refresh === 'function') refresh();
    } catch (err) {
        console.warn('autosave planilla failed', err);
    }
}

function closePlanillaModal() {
    const caseId = activePlanillaCaseId;
    const spec = planillaSpec;
    document.getElementById('planillaModal').classList.remove('open');
    activePlanillaCaseId = null;
    planillaSpec = null;
    autosavePlanillaSpec(caseId, spec);
}

// ---------- Top-level listeners ----------
document.getElementById('planAction').addEventListener('change', e => {
    if (!planillaSpec) return;
    const c = casesById(activePlanillaCaseId);
    const primaryType = deriveItemType(c?.tipo);
    planillaSpec.action = e.target.value;
    populateReasonDropdown(e.target.value, primaryType);
    const reasons = Object.keys(ACTION_RULES[e.target.value].reasons)
        .filter(r => reasonAppliesTo(e.target.value, r, primaryType));
    const firstReason = reasons[0] || Object.keys(ACTION_RULES[e.target.value].reasons)[0];
    planillaSpec.reason = firstReason;
    document.getElementById('planReason').value = firstReason;
    planillaSpec.items = initialItemsForCase({ ...c, items: null }, planillaSpec.action, planillaSpec.reason, planillaSpec.logistics);
    
    if (planillaSpec.items.length > 0) {
        planillaSpec.items.forEach((it, idx) => {
            it.collapsed = idx > 0;
        });
    }

    // Resetear saludo override al cambiar de accion
    planillaSpec.saludoOverride = '';
    const saludoEl = document.getElementById('planSaludo');
    if (saludoEl) saludoEl.value = '';
    const wrapEl = document.getElementById('planSaludoEditorWrap');
    if (wrapEl) wrapEl.style.display = 'none';
    refreshSaludoStatus();

    renderPlanillaItems();
    savePlanillaToLocalStorage();
    updatePreview();
});

document.getElementById('planReason').addEventListener('change', e => {
    if (!planillaSpec) return;
    planillaSpec.reason = e.target.value;
    const c = casesById(activePlanillaCaseId);
    planillaSpec.items = initialItemsForCase({ ...c, items: null }, planillaSpec.action, planillaSpec.reason, planillaSpec.logistics);
    
    if (planillaSpec.items.length > 0) {
        planillaSpec.items.forEach((it, idx) => {
            it.collapsed = idx > 0;
        });
    }

    renderPlanillaItems();
    savePlanillaToLocalStorage();
    updatePreview();
});

// Devuelve los valores actuales para los tokens del saludo. {saludo}
// cambia por hora del dia; {fecha} y {elemento} salen del primer item;
// {persona} del spec. Centralizado para que default + override usen
// exactamente los mismos valores.
function saludoTokenValues(spec) {
    const hour = new Date().getHours();
    let greeting = 'Buen día';
    if (hour >= 9 && hour < 12) greeting = 'Buenos días';
    else if (hour >= 12 && hour < 18) greeting = 'Buenas tardes';
    const firstItem = spec.items[0];
    const firstTypeDef = firstItem ? (ITEM_TYPES[firstItem.type] || ITEM_TYPES.PC) : {};
    const elementoTxt = (firstTypeDef.label || 'equipo').split(' / ')[0].toLowerCase();
    const prefix = (elementoTxt.includes('vincha')) ? 'de la ' : 'del ';
    return {
        saludo:    greeting,
        fecha:     formatDateAR(firstItem?.fechaMovimiento) || formatDateAR(spec.fechaMovimiento) || '',
        elemento:  `${prefix}${elementoTxt}`,
        persona:   spec.personaRetira || '',
    };
}

// Reemplaza tokens {saludo}|{fecha}|{elemento}|{persona} con los valores
// actuales del spec. Tokens desconocidos se dejan tal cual para que el
// operador los vea y los corrija. Sirve para que el override pueda tener
// prosa custom + datos dinamicos que sigan sincronizados con el resto
// del form.
function renderSaludoTokens(text, spec) {
    const vals = saludoTokenValues(spec);
    return String(text || '').replace(/\{(saludo|fecha|elemento|persona)\}/g, (_, k) => vals[k] ?? '');
}

// Texto plano que se carga al textarea con "Cargar default". Si el
// usuario tiene saludo default en Preferencias, usa ese; sino la
// plantilla hardcoded. Trae los tokens crudos (no interpolados) para
// que el operador edite la prosa y los datos dinamicos sigan vivos.
function buildSaludoPlainAuto(spec) {
    if (!spec) return '';
    const actionGreets = (window.userTemplateGreetings || []).filter(g => g.action === spec.action);
    if (actionGreets.length > 0) {
        return actionGreets[0].text;
    }
    // Fallback hardcoded defaults if list is completely empty
    const defaults = {
        asignacion: '{saludo}\n\nSaludos Rafael\n\nSe notifica que el día {fecha} se realizará la entrega {elemento} al usuario {persona}.\n\nDetalle {elemento}',
        recambio: '{saludo}\n\nSaludos Rafael\n\nSe realiza el recambio del día {fecha} {elemento} de {persona}.',
        prestamo: '{saludo}\n\nSaludos Rafael\n\nSe realiza el préstamo del día {fecha} {elemento} de {persona}.',
        renuncia: '{saludo}\n\nSaludos Rafael\n\nSe recibe el {elemento} por renuncia de {persona} el día {fecha}.',
        reemplazo: '{saludo}\n\nSaludos Rafael\n\nSe realiza el reemplazo de {elemento} de {persona} el día {fecha}.'
    };
    return defaults[spec.action] || defaults.asignacion;
}

function populateGreetingDropdown() {
    const sel = document.getElementById('planSaludoSelect');
    if (!sel || !planillaSpec) return;

    const greets = (window.userTemplateGreetings || []).filter(g => g.action === planillaSpec.action);
    
    let optionsHtml = `<option value="">Predeterminado (auto)</option>`;
    greets.forEach((g, idx) => {
        optionsHtml += `<option value="${idx}">${escapeHtml(g.title)}</option>`;
    });

    const currentOverride = (planillaSpec.saludoOverride || '').trim();
    if (currentOverride) {
        // Buscar si coincide exactamente con alguno de los saludos de esta accion
        const foundIdx = greets.findIndex(g => g.text.trim() === currentOverride);
        if (foundIdx >= 0) {
            sel.innerHTML = optionsHtml;
            sel.value = String(foundIdx);
        } else {
            optionsHtml += `<option value="custom" selected>Personalizado (manual)</option>`;
            sel.innerHTML = optionsHtml;
            sel.value = "custom";
        }
    } else {
        sel.innerHTML = optionsHtml;
        sel.value = "";
    }
}

function refreshSaludoStatus() {
    if (!planillaSpec) return;
    
    populateGreetingDropdown();

    const wrap = document.getElementById('planSaludoEditorWrap');
    const btn = document.getElementById('planBtnEditSaludo');
    if (wrap && btn) {
        const isVisible = wrap.style.display === 'flex' || wrap.style.display === 'block';
        btn.textContent = isVisible ? 'Ocultar editor' : 'Personalizar saludo';
    }
}

document.getElementById('planBtnEditSaludo')?.addEventListener('click', () => {
    const wrap = document.getElementById('planSaludoEditorWrap');
    if (!wrap) return;
    const isVisible = wrap.style.display === 'flex' || wrap.style.display === 'block';
    wrap.style.display = isVisible ? 'none' : 'flex';
    
    // Si se abre y no hay override, pre-cargar el auto para editarlo
    if (!isVisible && !planillaSpec.saludoOverride) {
        const txt = buildSaludoPlainAuto(planillaSpec);
        planillaSpec.saludoOverride = txt;
        const el = document.getElementById('planSaludo');
        if (el) el.value = txt;
        savePlanillaToLocalStorage();
        updatePreview();
    }
    refreshSaludoStatus();
});

document.getElementById('planSaludoSelect')?.addEventListener('change', e => {
    if (!planillaSpec) return;
    const val = e.target.value;
    const greets = (window.userTemplateGreetings || []).filter(g => g.action === planillaSpec.action);
    if (val === '') {
        planillaSpec.saludoOverride = '';
        const el = document.getElementById('planSaludo');
        if (el) el.value = '';
    } else if (val === 'custom') {
        // Queda manual
    } else {
        const idx = parseInt(val, 10);
        const greet = greets[idx];
        if (greet) {
            planillaSpec.saludoOverride = greet.text;
            const el = document.getElementById('planSaludo');
            if (el) el.value = greet.text;
        }
    }
    refreshSaludoStatus();
    savePlanillaToLocalStorage();
    updatePreview();
});

document.getElementById('planSaludo')?.addEventListener('focus', () => {
    const content = document.querySelector('.planilla-preview-content');
    if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
});
document.getElementById('planSaludo')?.addEventListener('blur', () => {
    // Focus default/cleanup logic
});
document.getElementById('planSaludo')?.addEventListener('input', e => {
    if (!planillaSpec) return;
    planillaSpec.saludoOverride = e.target.value;
    refreshSaludoStatus();
    savePlanillaToLocalStorage();
    updatePreview();
});

document.getElementById('planSaludoFill')?.addEventListener('click', () => {
    if (!planillaSpec) return;
    const txt = buildSaludoPlainAuto(planillaSpec);
    const el = document.getElementById('planSaludo');
    if (el) el.value = txt;
    planillaSpec.saludoOverride = txt;
    refreshSaludoStatus();
    savePlanillaToLocalStorage();
    updatePreview();
});

document.getElementById('planSaludoReset')?.addEventListener('click', () => {
    if (!planillaSpec) return;
    const el = document.getElementById('planSaludo');
    if (el) el.value = '';
    planillaSpec.saludoOverride = '';
    refreshSaludoStatus();
    savePlanillaToLocalStorage();
    updatePreview();
});

// Focus/blur en inputs globales del template (ticket, empresa, persona).
// Tinta la celda matching en TODOS los items del preview (los globals
// se repiten en cada bloque).
Object.entries(GLOBAL_INPUT_TO_FK).forEach(([id, fk]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('focus', () => highlightGlobalFk(fk, true));
    el.addEventListener('blur',  () => highlightGlobalFk(fk, false));
});

['planLogistics','planTicket','planEmpresa','planPersonaRetira','planEmailRetira'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
        if (!planillaSpec) return;
        const map = {
            planLogistics:'logistics', planTicket:'ticket', planEmpresa:'empresa',
            planPersonaRetira:'personaRetira', planEmailRetira:'emailRetira',
        };
        const oldTicket = planillaSpec.ticket;
        const newTicket = e.target.value;
        planillaSpec[map[id]] = newTicket;

        if (id === 'planTicket' && planillaSpec.items) {
            planillaSpec.items.forEach((item, index) => {
                if (item.ticket === oldTicket || !item.ticket) {
                    item.ticket = newTicket;
                    const itemInputs = document.querySelectorAll(`[data-itemfield="ticket"][data-item-idx="${index}"]`);
                    itemInputs.forEach(input => {
                        input.value = newTicket;
                    });
                }
            });
        }
        if (id === 'planEmailRetira') applyEmpresaFromEmail();
        if (id === 'planLogistics') {
            // Recalcular obs default para items que aún tenían el default —
            // agrega o quita la línea de "envío por correo interno".
            for (const it of planillaSpec.items) {
                if (isDefaultObs(it.obs)) {
                    it.obs = defaultObsFor(it.type, it.mov, planillaSpec.action, planillaSpec.reason, planillaSpec.logistics);
                }
            }
            renderPlanillaItems();
        }
        savePlanillaToLocalStorage();
        updatePreview();
    });
});

// Auto-llena empresa propietaria desde dominio del mail. Solo sobreescribe
// si el campo está vacío o tiene un valor de empresa "conocida" (Empresa Principal /
// Subsidiaria / Proveedor TI / Subsidiaria B) — no pisa nada custom que el operador haya
// tipeado manualmente. Si el dominio es serv.externos.* dispara el aviso.
function applyEmpresaFromEmail() {
    const emailEl   = document.getElementById('planEmailRetira');
    const empresaEl = document.getElementById('planEmpresa');
    const warnEl    = document.getElementById('planExternalWarning');
    const btnAgregar = document.getElementById('btnAgregarConsultora');
    if (!emailEl || !empresaEl) return;

    const { empresa, isExternal } = inferEmpresaFromEmail(emailEl.value);
    const knownCompanies = new Set(Object.values(EMAIL_DOMAIN_TO_COMPANY));
    const current = (empresaEl.value || '').trim();
    const canAutoFill = !current || knownCompanies.has(current);

    if (isExternal) {
        if (canAutoFill) {
            empresaEl.value = '';
            if (planillaSpec) planillaSpec.empresa = '';
        }
    } else if (empresa && canAutoFill) {
        empresaEl.value = empresa;
        if (planillaSpec) planillaSpec.empresa = empresa;
    }
    if (warnEl) warnEl.style.display = 'none';
    if (btnAgregar) {
        btnAgregar.style.display = isExternal ? 'inline-block' : 'none';
    }
}

document.getElementById('planAddItem')?.addEventListener('click', planAddItem);

document.getElementById('btnAgregarConsultora')?.addEventListener('click', () => {
    Swal.fire({
        title: 'Nombre de la Consultora',
        input: 'text',
        inputPlaceholder: 'Ej: Accenture, Globant, etc.',
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--primary)',
    }).then((result) => {
        if (result.isConfirmed && result.value) {
            const consultora = result.value.trim();
            let baseEmpresa = 'Externos Empresa';
            const emailVal = (document.getElementById('planEmailRetira')?.value || '').toLowerCase();
            if (emailVal.includes('subsidiaria')) {
                baseEmpresa = 'Externos Subsidiaria';
            } else if (planillaSpec && planillaSpec.empresa && planillaSpec.empresa.startsWith('Externos')) {
                baseEmpresa = planillaSpec.empresa.split(' (')[0];
            }
            
            const finalEmpresa = `${baseEmpresa} (${consultora})`;
            if (planillaSpec) planillaSpec.empresa = finalEmpresa;
            const input = document.getElementById('planEmpresa');
            if (input) {
                input.value = finalEmpresa;
            }
            savePlanillaToLocalStorage();
            updatePreview();
        }
    });
});

document.getElementById('planillaClose').addEventListener('click',  closePlanillaModal);
document.getElementById('planillaCancel').addEventListener('click', closePlanillaModal);

document.getElementById('planillaClear')?.addEventListener('click', () => {
    if (!planillaSpec) return;
    if (!confirm('Esto vacía todos los items del template para empezar de cero. Los datos del caso (nombre, mail, ticket) no se tocan. ¿Continuar?')) return;
    const c = activePlanillaCaseId ? casesById(activePlanillaCaseId) : null;
    planillaSpec.items = c
        ? initialItemsForCase({ ...c, items: null }, planillaSpec.action, planillaSpec.reason, planillaSpec.logistics)
        : [makeEmptyItem('PC', 'egreso', undefined, planillaSpec.action, planillaSpec.reason, planillaSpec.logistics)];
    planillaSpec.saludoOverride = '';
    const saludoEl = document.getElementById('planSaludo');
    if (saludoEl) saludoEl.value = '';
    refreshSaludoStatus();
    
    if (planillaSpec.items.length > 0) {
        planillaSpec.items.forEach((it, idx) => {
            it.collapsed = idx > 0;
        });
    }

    renderPlanillaItems();
    savePlanillaToLocalStorage();
    updatePreview();
});

// ---------- Subject generator ----------
function buildPlanillaSubject(spec) {
    const c = activePlanillaCaseId ? casesById(activePlanillaCaseId) : null;
    const rawTip = c ? resolveTipificacion(c) : '';
    
    const labelOf = it => (ITEM_TYPES[it.type]?.label || it.type).split(' ')[0];
    const uniq = [...new Set(spec.items.map(labelOf))];
    const itemsSummary = uniq.join(' + ') || '—';
    
    const classification = (rawTip || itemsSummary)
        .replace(/ \(INC\)$/, '')
        .replace(/ \(WO\)$/, '')
        .trim();
        
    const ticket = spec.ticket || 'SIN-TICKET';
    const persona = spec.personaRetira || 'Usuario';
    
    return `${ticket} | ${classification} | ${persona}`.trim();
}

// ---------- HTML body engine ----------
function formatDateAR(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// documentTitle por (action, reason, mov) — replica los titulos del
// Generador original (Actualizar_Generador). Estos titulos los reconocen
// los companieros del equipo por costumbre, no inventar variantes nuevas.
function documentTitleFor(item, actionId, reasonId) {
    const role = MOV_TYPES[item.mov]?.equipmentRole || 'new';
    const baseMov = String(item.mov || '').replace(/_wipe$/, '');

    // recambio.beneficio / recambio.tecnologico: egreso_wipe = viejo
    // que sale al user (BENEFICIO), egreso = nuevo (ASIGNACION).
    if (actionId === 'recambio' && (reasonId === 'beneficio' || reasonId === 'tecnologico')) {
        return role === 'old' ? 'EGRESA POR BENEFICIO' : 'EGRESA POR ASIGNACIÓN';
    }
    // recambio.defectuoso: egreso = nuevo prestamo, ingreso = viejo falla.
    if (actionId === 'recambio' && reasonId === 'defectuoso') {
        return role === 'old' ? 'INGRESA EQUIPO EN FALLA' : 'EGRESA EQUIPO PRÉSTAMO';
    }
    // recambio.garantia: egreso = reemplazo, ingreso = a garantia.
    if (actionId === 'recambio' && reasonId === 'garantia') {
        return role === 'old' ? 'INGRESA EQUIPO POR GARANTÍA' : 'EGRESA EQUIPO REEMPLAZO';
    }
    // recambio.robo_perdida: solo egreso del nuevo (el viejo no vuelve).
    if (actionId === 'recambio' && reasonId === 'robo_perdida') return 'EGRESA POR REPOSICIÓN';
    // recambio.sector / reemplazo.sector: egreso = nuevo, ingreso = viejo.
    if ((actionId === 'recambio' && reasonId === 'sector') ||
        (actionId === 'reemplazo' && reasonId === 'sector')) {
        return role === 'old' ? 'INGRESA EQUIPO POR REEMPLAZO' : 'EGRESA POR REEMPLAZO';
    }
    // asignacion.* — siempre egreso del nuevo.
    if (actionId === 'asignacion') return 'EGRESA POR ASIGNACIÓN';
    // prestamo.normal — egreso temporal.
    if (actionId === 'prestamo') return 'EGRESA EQUIPO PRÉSTAMO';
    // renuncia.normal — ingreso a deposito wipeado.
    if (actionId === 'renuncia') return 'INGRESA EQUIPO POR RENUNCIA';
    // Fallback: mov base en mayusculas.
    return baseMov === 'ingreso' ? 'INGRESA' : 'EGRESA';
}

function generateBarcodeHtml(text, dataUri) {
    if (!text) return '';
    const clean = String(text).trim().toUpperCase().replace(/[^A-Z0-9\-.$/+% ]/g, '');
    if (!clean) return '';
    // Si se pasó un data URI pre-fetched (para email), lo usamos directamente.
    // Si no, usamos URL relativa al servidor (para preview en browser).
    const src = dataUri || `/api/barcode?text=${encodeURIComponent(clean)}`;
    return `<img src="${src}" height="18" style="display:inline-block;vertical-align:middle;border:none;" alt="${escapeHtml(text)}">`;
}

// Pre-fetchea el PNG del servidor y lo convierte a data URI base64.
// Usado antes de armar el payload para Outlook — el destinatario recibe
// la imagen embebida (no depende de que su Outlook llegue a 127.0.0.1).
async function generateBarcodeDataUri(text) {
    if (!text) return '';
    const clean = String(text).trim().toUpperCase().replace(/[^A-Z0-9\-.$/+% ]/g, '');
    if (!clean) return '';
    try {
        const resp = await fetch(`/api/barcode?text=${encodeURIComponent(clean)}`);
        if (!resp.ok) return '';
        const blob = await resp.blob();
        return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        return '';
    }
}

function buildPlanillaHtmlBody(spec, barcodeDataUri) {
    const action = ACTION_RULES[spec.action];
    const reason = action?.reasons[spec.reason];
    const motivoLabel = reason?.motivoLabel || (action?.label || '');

    // ───── Estilos compartidos (replica Generador: Arial 13px, tablas 600px) ─────
    const tableStyle = `width: 600px; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 13px; color: #000;`;
    const tdK = `border: 1px solid #a3a3a3; padding: 6px; width: 220px; font-weight: bold;`;
    const tdV = `border: 1px solid #a3a3a3; padding: 6px; width: 380px;`;
    const tdVTicket = `border: 1px solid #a3a3a3; padding: 6px; width: 380px; font-weight: bold;`;
    const tdSig = `border: 1px solid #a3a3a3; padding: 15px 6px;`;
    const titleStyle = `font-family: Arial, sans-serif; font-weight: bold; font-size: 14px; margin-bottom: 20px; color: #000;`;

    // Tokens centralizados (los mismos que reconoce el override).
    const tokens = saludoTokenValues(spec);
    const greetingTok = tokens.saludo;
    const fechaSaludo = tokens.fecha;
    const elementoFull = tokens.elemento; // ya viene con prefix "del " / "de la "

    // Precedencia del saludo:
    //   1) Override per-case (textarea del modal) si tiene contenido.
    //   2) Saludo preconfigurado / default de la accion.
    const overrideTxt = (spec.saludoOverride || '').trim();
    const effectiveTpl = overrideTxt || buildSaludoPlainAuto(spec);
    const saludo = `
        <div style="font-family: Arial, sans-serif; font-size: 13px; color: #000; margin-bottom: 20px; white-space: pre-wrap;">${escapeHtml(renderSaludoTokens(effectiveTpl, spec))}</div>
    `;

    // ───── Item blocks (title + tabla + firma usuario) ─────
    const itemsHtml = spec.items.map((item, idx) => {
        const typeDef = ITEM_TYPES[item.type] || ITEM_TYPES.PC;
        const movDef  = MOV_TYPES[item.mov]   || MOV_TYPES.egreso;
        const docTitle = documentTitleFor(item, spec.action, spec.reason);

        const tipoLabel = (typeDef.label || '').split(' / ')[0]; // "Notebook / PC" -> "Notebook"
        const movLabel = (item.mov === 'ingreso' || item.mov === 'ingreso_wipe') ? 'Ingreso' : 'Egreso';
        const tipoYMovimiento  = `${tipoLabel} - ${movLabel}`;

        const marcaModelo = `${item.marca || ''} ${item.modelo || ''}`.trim();
        const fechaAsig    = formatDateAR(item.fechaAsignacion);
        const fechaMov = formatDateAR(item.fechaMovimiento || spec.fechaMovimiento);

        const tecnicoAsignado = `${spec.tecnico || ''}${window.currentUser && window.currentUser.email ? ' (' + window.currentUser.email + ')' : ''}`;

        const obsCelda     = item.obs || spec.obsGenerales || '';

        // IMEI row solo para celulares con algún IMEI cargado.
        const imeiRow = (item.type === 'CEL' && (item.imei1 || item.imei2))
            ? `
                <tr>
                    <td style="${tdK}">IMEI's Del dispositivo móvil</td>
                    <td style="${tdV}" data-fk="imei">
                        ${item.imei1 ? `<div>${escapeHtml(item.imei1)}</div>` : ''}
                        ${item.imei2 ? `<div>${escapeHtml(item.imei2)}</div>` : ''}
                    </td>
                </tr>`
            : '';

        return `
            <div class="preview-item" data-item-idx="${idx}">
            <div style="${titleStyle}">${escapeHtml(docTitle)}</div>
            <table style="${tableStyle}">
                <tbody>
                    <tr>
                        <td style="${tdK}">Elemento y Tipo de Movimiento</td>
                        <td style="${tdV}" data-fk="tipo-modelo">${escapeHtml(tipoYMovimiento)}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Marca y Modelo del equipo</td>
                        <td style="${tdV}" data-fk="marca-modelo">${escapeHtml(marcaModelo)}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Número de serie del equipo</td>
                        <td style="${tdV}" data-fk="serie">${escapeHtml(item.serie || '')}</td>
                    </tr>
                    ${imeiRow}
                    <tr>
                        <td style="${tdK}">Fecha asignación</td>
                        <td style="${tdV}" data-fk="fecha-asig">${escapeHtml(fechaAsig)}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Nro de Ticket</td>
                        <td style="${tdVTicket}" data-fk="ticket">${escapeHtml(item.ticket || spec.ticket || '')}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Cod Barra</td>
                        <td style="${tdV}">${(item.ticket || spec.ticket) ? generateBarcodeHtml(item.ticket || spec.ticket, (item.ticket || spec.ticket) === spec.ticket ? barcodeDataUri : null) : ''}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Empresa Propietaria</td>
                        <td style="${tdV}" data-fk="empresa">${escapeHtml(spec.empresa || '')}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Fecha del movimiento</td>
                        <td style="${tdV}" data-fk="fecha-mov">${escapeHtml(fechaMov)}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Técnico asignado</td>
                        <td style="${tdV}" data-fk="tecnico">${escapeHtml(tecnicoAsignado)}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Quien recibe/entrega</td>
                        <td style="${tdV}" data-fk="pers-retira">${escapeHtml(spec.personaRetira || '')}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Email del usuario</td>
                        <td style="${tdV}" data-fk="email-usuario">${escapeHtml(spec.emailRetira || '')}</td>
                    </tr>
                    <tr>
                        <td style="${tdK}">Estado general y observaciones</td>
                        <td style="${tdV}" data-fk="obs">${escapeHtml(obsCelda)}</td>
                    </tr>
                </tbody>
            </table>

            ${spec.action === 'prestamo' ? `
            <div style="font-family: Arial, sans-serif; font-size: 13px; color: #000; margin-top: 20px;">
                <div style="font-weight: bold; margin-bottom: 10px;">Datos a completar por el usuario</div>
                <table style="${tableStyle}">
                    <tbody>
                        <tr>
                            <td colspan="2" style="${tdSig} font-weight: bold; background: #f0f0f0; text-align: center;">Entrega</td>
                        </tr>
                        <tr>
                            <td style="${tdSig} width: 220px; font-weight: bold;">Fecha:</td>
                            <td style="${tdSig} width: 380px;"></td>
                        </tr>
                        <tr>
                            <td style="${tdSig} font-weight: bold;">Firma:</td>
                            <td style="${tdSig}"></td>
                        </tr>
                        <tr>
                            <td style="${tdSig} font-weight: bold;">Aclaracion:</td>
                            <td style="${tdSig}"></td>
                        </tr>
                        <tr>
                            <td colspan="2" style="${tdSig} font-weight: bold; background: #f0f0f0; text-align: center;">Devolucion</td>
                        </tr>
                        <tr>
                            <td style="${tdSig} font-weight: bold;">Fecha:</td>
                            <td style="${tdSig}"></td>
                        </tr>
                        <tr>
                            <td style="${tdSig} font-weight: bold;">Firma:</td>
                            <td style="${tdSig}"></td>
                        </tr>
                        <tr>
                            <td style="${tdSig} font-weight: bold;">Aclaracion:</td>
                            <td style="${tdSig}"></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            ` : `
            <div style="font-family: Arial, sans-serif; font-size: 13px; color: #000; margin-top: 20px;">
                <div style="font-weight: bold; margin-bottom: 10px;">Datos a completar por el usuario</div>
                <table style="${tableStyle}">
                    <tbody>
                        <tr>
                            <td style="${tdSig} width: 220px; font-weight: bold;">Fecha de Entrega:</td>
                            <td style="${tdSig} width: 380px;"></td>
                        </tr>
                        <tr>
                            <td style="${tdSig} font-weight: bold;">Firma:</td>
                            <td style="${tdSig}"></td>
                        </tr>
                        <tr>
                            <td style="${tdSig} font-weight: bold;">Aclaracion:</td>
                            <td style="${tdSig}"></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            `}
            <br>
            </div>
        `;
    }).join('');

    // ───── Firma genérica del técnico al final ─────
    const firmaGenerica = `
        <div style="font-family: Arial, sans-serif; font-size: 13px; color: #000; margin-top: 2px;">
            <span style="font-weight: bold;">${escapeHtml(spec.tecnico || '')}</span><br>
            Soporte a Usuarios
        </div>
    `;

    return `<div style="font-family: Arial, sans-serif; color: #000;">${saludo}${itemsHtml}${firmaGenerica}</div>`;
}

function updatePreview() {
    if (!planillaSpec) return;
    document.getElementById('planPreviewSubject').textContent = buildPlanillaSubject(planillaSpec);
    document.getElementById('planPreviewBody').innerHTML = buildPlanillaHtmlBody(planillaSpec);
    syncPreviewToCurrentItem();
    reapplyFocusedFkHighlight();
}

function syncPreviewToCurrentItem() {
    const previewBody = document.getElementById('planPreviewBody');
    if (!previewBody || !planillaSpec) return;
    const content = previewBody.closest('.planilla-preview-content');
    previewBody.querySelectorAll('.preview-item.active').forEach(el => el.classList.remove('active'));
    
    if (document.activeElement?.id === 'planSaludo') {
        if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    
    const expandedIdx = planillaSpec.items.findIndex(it => !it.collapsed);
    const activeIdx = expandedIdx >= 0 ? expandedIdx : 0;
    
    const active = previewBody.querySelector(`[data-item-idx="${activeIdx}"]`);
    if (!active) return;
    active.classList.add('active');
    if (!content) return;
    const contentRect = content.getBoundingClientRect();
    const activeRect  = active.getBoundingClientRect();
    const offset = activeRect.top - contentRect.top + content.scrollTop - 16;
    content.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
}

function syncPreviewToItem(idx) {
    const previewBody = document.getElementById('planPreviewBody');
    if (!previewBody || !planillaSpec) return;
    const content = previewBody.closest('.planilla-preview-content');
    previewBody.querySelectorAll('.preview-item.active').forEach(el => el.classList.remove('active'));
    
    const active = previewBody.querySelector(`[data-item-idx="${idx}"]`);
    if (!active) return;
    active.classList.add('active');
    if (!content) return;
    const contentRect = content.getBoundingClientRect();
    const activeRect  = active.getBoundingClientRect();
    const offset = activeRect.top - contentRect.top + content.scrollTop - 16;
    content.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
}

// ---------- Validation ----------
function validatePlanillaSpec(spec) {
    const errors = [];
    const isPrestamo = spec.action === 'prestamo';
    const isCorreoInterno = spec.logistics === 'correo_interno';
    if (!spec.ticket && !isPrestamo) {
        errors.push({ field: 'planTicket', msg: 'Falta el ticket (WO / INC / REQ).' });
    }
    if (!spec.personaRetira && !isCorreoInterno) {
        errors.push({ field: 'planPersonaRetira', msg: 'Falta la persona que retira.' });
    }
    if (!spec.items || spec.items.length === 0) {
        errors.push({ field: 'planItemsList', msg: 'Agregá al menos un ítem al template.' });
    }
    return errors;
}

function clearPlanillaErrors() {
    document.querySelectorAll('#planillaForm .is-invalid').forEach(el => el.classList.remove('is-invalid'));
    document.querySelectorAll('#planillaForm .field-error').forEach(el => { el.textContent = ''; el.style.display = 'none'; });
}

function showPlanillaErrors(errors) {
    clearPlanillaErrors();
    if (!errors.length) return;
    for (const { field, msg } of errors) {
        const input = document.getElementById(field);
        if (input) input.classList.add('is-invalid');
        const errSlot = document.querySelector(`[data-field-error="${field}"]`);
        if (errSlot) { errSlot.textContent = msg; errSlot.style.display = ''; }
    }
    const first = document.getElementById(errors[0].field);
    if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try { first.focus(); } catch (e) {}
    }
    toast(`Revisá ${errors.length} campo${errors.length === 1 ? '' : 's'} antes de enviar.`, 'error');
}

// Al editar un campo con error, limpia su highlight (feedback inmediato).
['planTicket', 'planPersonaRetira'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
        if (!el.classList.contains('is-invalid')) return;
        el.classList.remove('is-invalid');
        const slot = document.querySelector(`[data-field-error="${id}"]`);
        if (slot) { slot.textContent = ''; slot.style.display = 'none'; }
    });
});

// ---------- Submit ----------
document.getElementById('planillaSubmit').addEventListener('click', async (e) => {
    if (!planillaSpec) return;

    const errors = validatePlanillaSpec(planillaSpec);
    if (errors.length) { showPlanillaErrors(errors); return; }
    clearPlanillaErrors();

    const isBlank = !activePlanillaCaseId;
    const c = isBlank ? null : casesById(activePlanillaCaseId);
    if (!isBlank && !c) return;

    let updates = null;
    if (!isBlank) {
        const cc = { ...c };
        cc.checks = cc.checks || {};
        cc.checks.template_sent = true;

        const primary = planillaSpec.items[0];
        const motivoLegacy = ACTION_RULES[planillaSpec.action]?.reasons[planillaSpec.reason]?.motivoLabel
                           || planillaSpec.action;

        const newItem = planillaSpec.items.find(it => MOV_TYPES[it.mov]?.equipmentRole === 'new');
        const oldItem = planillaSpec.items.find(it => MOV_TYPES[it.mov]?.equipmentRole === 'old');

        updates = {
            action: planillaSpec.action,
            reason: planillaSpec.reason,
            logistics: planillaSpec.logistics,
            items: planillaSpec.items,
            wo: planillaSpec.ticket,
            company: planillaSpec.empresa,
            brand:    primary?.marca  || '',
            imei1:    primary?.imei1  || '',
            imei2:    primary?.imei2  || '',
            movimiento: motivoLegacy,
            checks: cc.checks,
            logEvent: `Template enviado: ${planillaSpec.items.length} ítem(s) — ${ACTION_RULES[planillaSpec.action]?.label}`,
        };
        if (newItem) {
            updates.newModel = newItem.modelo || '';
            updates.newSvc   = newItem.serie  || '';
            updates.fechaAsignacionNew = newItem.fechaAsignacion || '';
        }
        if (oldItem) {
            updates.oldModel = oldItem.modelo || '';
            updates.svcTag   = oldItem.serie  || '';
            updates.fechaAsignacion = oldItem.fechaAsignacion || '';
        }
    }

    const caseIdAtSubmit = activePlanillaCaseId;
    const subject    = buildPlanillaSubject(planillaSpec);
    const to         = "rerodriguez@texpert.com.ar";
    const ccList     = "tecnologiausuariosdt@texpert.com.ar";

    // Pre-fetchar el PNG del barcode y convertirlo a data URI embebida,
    // para que el destinatario reciba la imagen sin depender de 127.0.0.1.
    const barcodeDataUri = planillaSpec.ticket ? await generateBarcodeDataUri(planillaSpec.ticket) : '';
    const htmlBody   = buildPlanillaHtmlBody(planillaSpec);
    const emailBody  = buildPlanillaHtmlBody(planillaSpec, barcodeDataUri);
    const fullBody   = `<html><body style="font-family: Arial, sans-serif;">${emailBody}</body></html>`;

    // 1. Guardar la planilla en DB si no es un caso blank
    if (updates && caseIdAtSubmit) {
        try {
            await API.update(caseIdAtSubmit, updates);
            if (typeof refresh === 'function') refresh();
            if (typeof refreshCurrentView === 'function') refreshCurrentView();
            if (typeof currentCaseId !== 'undefined' && currentCaseId === caseIdAtSubmit && typeof openCase === 'function') {
                openCase(currentCaseId);
            }
        } catch (err) {
            console.error('persist planilla fallo', err);
            toast('Error al guardar la planilla en DB', 'error');
        }
    }

    // El draft se abre en la MAQUINA DEL USUARIO via el handler templategen://
    // (corre en el browser del operador). NO se usa COM server-side: con
    // servidor compartido eso abriria Outlook en el server, no en la PC del
    // usuario que carga el template.
    const payload = { To: to, Cc: ccList, Subject: subject, Body: fullBody };
    const base64Str = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = `templategen://${base64Str}`;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 1500);

    clearPlanillaFromLocalStorage(caseIdAtSubmit);
    closePlanillaModal();
    toast('Planilla procesada y Outlook abierto', 'success');
});

// Expose to window for global module compatibility
window.populatePlanillaDatalists = populatePlanillaDatalists;
window.actionAppliesTo = actionAppliesTo;
window.reasonAppliesTo = reasonAppliesTo;
window.applySingleOptionLook = applySingleOptionLook;
window.populateActionDropdown = populateActionDropdown;
window.populateReasonDropdown = populateReasonDropdown;
window.deriveItemType = deriveItemType;
window.splitBrandModel = splitBrandModel;
window.smartCase = smartCase;
window.deriveMarcaModelo = deriveMarcaModelo;
window.deriveImeis = deriveImeis;
window.expectedSerieFor = expectedSerieFor;
window.expectedFechaAsignacionFor = expectedFechaAsignacionFor;
window.makeEmptyItem = makeEmptyItem;
window.rederiveIfCorrupt = rederiveIfCorrupt;
window.reorderBeneficioItems = reorderBeneficioItems;
window.initialItemsForCase = initialItemsForCase;
window.highlightItemFk = highlightItemFk;
window.highlightGlobalFk = highlightGlobalFk;
window.reapplyFocusedFkHighlight = reapplyFocusedFkHighlight;
window.diffYearsAR = diffYearsAR;
window.beneficioCheckFor = beneficioCheckFor;
window.renderPlanillaItems = renderPlanillaItems;
window.planAddItem = planAddItem;
window.defaultActionForCase = defaultActionForCase;
window.defaultReasonForCase = defaultReasonForCase;
window.defaultActionReasonForCase = defaultActionReasonForCase;
window.defaultReasonForAction = defaultReasonForAction;
window.normalizeCompanyName = normalizeCompanyName;
window.openPlanillaModal = openPlanillaModal;
window.openPlanillaModalBlank = openPlanillaModalBlank;
window.autosavePlanillaSpec = autosavePlanillaSpec;
window.closePlanillaModal = closePlanillaModal;
window.saludoTokenValues = saludoTokenValues;
window.renderSaludoTokens = renderSaludoTokens;
window.buildSaludoPlainAuto = buildSaludoPlainAuto;
window.refreshSaludoStatus = refreshSaludoStatus;
window.applyEmpresaFromEmail = applyEmpresaFromEmail;
window.buildPlanillaSubject = buildPlanillaSubject;
window.formatDateAR = formatDateAR;
window.documentTitleFor = documentTitleFor;
window.buildPlanillaHtmlBody = buildPlanillaHtmlBody;
window.updatePreview = updatePreview;
window.syncPreviewToCurrentItem = syncPreviewToCurrentItem;
window.syncPreviewToItem = syncPreviewToItem;
window.validatePlanillaSpec = validatePlanillaSpec;
window.clearPlanillaErrors = clearPlanillaErrors;
window.showPlanillaErrors = showPlanillaErrors;
window.savePlanillaToLocalStorage = savePlanillaToLocalStorage;
window.loadPlanillaFromLocalStorage = loadPlanillaFromLocalStorage;
window.clearPlanillaFromLocalStorage = clearPlanillaFromLocalStorage;
