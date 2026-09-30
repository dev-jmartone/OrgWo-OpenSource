// ============================================================
// CONSTANTS
// ============================================================

// ── Tipificaciones Webcenter ──────────────────────────────────────────────────
// Catálogo completo de tipificaciones de Webcenter bajo responsabilidad del equipo.
// INC = Incidentes (21) | WO = Work Orders (6)
const TIPIFICACIONES_INC = [
    'Software - Instalacion',
    'Software - Configuracion',
    'Software - Inconveniente / Mensaje de Error',
    'Outlook - Inconvenientes con Correo',
    'Equipo - Configuracion de VPN',
    'Kit Inalambrico',
    'Vincha',
    'Cargador',
    'Maquina Virtual',
    'Correo Configuracion',
    'Equipo - Reparacion',
    'Red - Sin Acceso',
    'PC Virtual No Funciona',
    'Inconveniente Periferico',
    'Adaptador/Cable',
    'Chat Corporativo',
    'Conexion Oficina Virtual',
    'Configuracion Red WIFI',
    'Expuesto de seguridad',
    'Externos Maquina Virtual',
    'Impresora Configuracion',
    'Sin Acceso /Error',
    'GENERALES',
    'SOFTWARE - INSTALACIÓN',
    'SOFTWARE - INCONVENIENTE / MENSAJE DE ERROR',
    'EQUIPO - REPARACION',
    'SOFTWARE - CONFIGURACIÓN',
    'RED - SIN ACCESO',
    'CONEXION OFICINA VIRTUAL',
    'KIT INALAMBRICO',
    'OUTLOOK - INCONVENIENTES CON CORREO',
    'ADAPTADOR / CABLE',
    'VINCHA',
    'MAQUINA VIRTUAL',
    'INTERNET - SIN ACCESO / ERROR',
    'EXTERNOS MAQUINA VIRTUAL',
    'PC VIRTUAL NO FUNCIONA',
    'CORREO - CONFIGURACIÓN',
    'EQUIPO - CONFIGURACIÓN DE VPN',
    'IMPRESORA - CONFIGURACIÓN',
    'CHAT CORPORATIVO',
    'IMPRESORA - INCONVENIENTE (ERROR, MALA CALIDAD, ETC)',
    'INCONVENIENTE PERIFERICO',
    'MAQUINAS VIRTUALES IPA',
    'EQUIPO - CONFIGURACIÓN DE RED WIFI',
];

const TIPIFICACIONES_WO = [
    'Externos Instalacion Imagen Corporativa',
    'Equipo Nuevo o Actualizacion',
    'Notebook Baja',
    'Alta/cambio Equipo Celular',
    'Solicitud de Monitor',
    'Ampliar Memoria RAM',
    'Tel. Movil Baja Celular',
    'NOTEBOOK ALTA EMPLEADO SUBSIDIARIA',
    'NOTEBOOK BAJA',
    'EQUIPO NUEVO O ACTUALIZACION',
    'INSTALACION SOFTWARE DEPLOY',
    'ALTA/CAMBIO EQUIPO CELULAR',
    'SELF SERVICE - CELULAR Y LINEA',
    'TEL. MOVIL BAJA CELULAR',
    'SOLICITUD DE MONITOR',
    'SELF SERVICE - NOTEBOOK',
    'EXTERNOS INSTALACION IMAGEN CORPORATIVA',
    'NOTEBOOK BAJA SUBSIDIARIA',
    'SHAREPOINT ONLINE (SPO) - ONEDRIVE',
    'LICENCIAS',
    'SELF SERVICE - MONITOR',
    'EQUIPO - REPARACION',
    'AMPLIAR MEMORIA RAM',
    'DESBLOQUEO DE USUARIO EN APLICATIVOS',
    'INTUNE - DESPLIEGUE MASIVO DE APLICACION',
    'MAQUINAS VIRTUALES IPA',
    'PERMISOS DE ACCESO PLATAFORMA/APLICACIÓN - ABM PERFIL',
    'TABLET BAJA',
];

// Clave canónica para comparar/deduplicar tipificaciones: minúsculas, sin
// espacios extra y sin acentos. Los catálogos crudos traen la misma
// tipificación en mayúsculas y en title-case (ej "KIT INALAMBRICO (INC)" y
// "Kit Inalambrico (INC)"); esto permite colapsarlas en una sola.
function tipKey(t) {
    // Clave canónica: minúsculas, sin acentos (NFD + \p{Diacritic}) y sin
    // espacios ni puntuación. También removemos los sufijos (INC) y (WO) al final.
    // Así "Adaptador/Cable (INC)" y "ADAPTADOR / CABLE (INC)" colapsan en una sola.
    return (t || '')
        .replace(/\s*\((INC|WO)\)$/i, '')
        .toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '');
}

// Lista unificada: una entrada por tipificación. Se conserva la primera
// aparición como etiqueta canónica; las variantes de mayúsculas/acentos se
// descartan para no duplicar tabs/opciones en Mensajes Rápidos.
const ALL_TIPIFICACIONES = (() => {
    const seen = new Set();
    const out = [];
    for (const t of [...TIPIFICACIONES_INC, ...TIPIFICACIONES_WO]) {
        const k = tipKey(t);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(t);
    }
    return out;
})();
window.tipKey = tipKey;

// IDs de estados que NO pueden reasignarse de sus columnas fijas
const LOCKED_ESTADOS = ['remedy_inc_assigned', 'remedy_wo_assigned'];
let ESTADOS = [
    { id: 'remedy_inc_assigned', label: 'Remedy INC Asignados', color: 'var(--st-assigned)' },
    { id: 'remedy_wo_assigned', label: 'Remedy WO Asignados', color: 'var(--st-assigned-wo)' },
    { id: 'contact',  label: 'Por contactar',          color: 'var(--st-contact)' },
    { id: 'wait',     label: 'Esperando respuesta',    color: 'var(--st-wait)' },
    { id: 'userpass', label: 'User y pass',            color: 'var(--st-userpass)' },
    { id: 'data',     label: 'Datos completos',        color: 'var(--st-data)' },
    { id: 'config',   label: 'Configurando',           color: 'var(--st-config)' },
    { id: 'coord',    label: 'Coordinando retiro',     color: 'var(--st-coord)' },
    { id: 'req',      label: 'Salida solicitada',      color: 'var(--st-req)' },
    { id: 'appr',     label: 'Aprobada / Lista',       color: 'var(--st-appr)' },
    { id: 'wipe',     label: 'Wipe', color: 'var(--st-wipe)' },
    { id: 'scan',     label: 'Por escanear template',  color: 'var(--st-scan)' },
    { id: 'done',     label: 'Cerrada',                color: 'var(--st-done)' },
    { id: 'not_accepted', label: 'No aceptó beneficio', color: 'var(--st-noacc)' },
    { id: 'reject',   label: 'No aplica / Rechazado',  color: 'var(--st-reject)' }
];

// KANBAN_GROUPS — 5 columnas operativas planas. Cada grupo agrupa varios
// estados internos para reducir cognitive load. Color y orden importan:
// el operador escanea de izquierda a derecha como un proceso.
//
// reject queda fuera (no aparece en el tablero, accesible vía filtro
// "Cerrados" o desde la Lista).
// KANBAN_GROUPS — 6 columnas operativas.
// Las dos primeras (fase-inc y fase-wo) son INAMOVIBLES (locked: true):
// actúan como punto de entrada del flujo según el tipo de ticket de Remedy.
// Las restantes son columnas de estado, configurables por el usuario.
let KANBAN_GROUPS = [
    { id: 'fase-inc',      label: 'Asignados INC', estados: ['remedy_inc_assigned'],                      color: 'var(--st-assigned, #038387)',    locked: true },
    { id: 'fase-wo',       label: 'Asignados WO',  estados: ['remedy_wo_assigned'],                       color: 'var(--st-assigned-wo, #0099BC)', locked: true },
    { id: 'fase-esperando',label: 'Esperando',     estados: ['contact', 'wait', 'userpass', 'data'],      color: 'var(--st-wait, #C19C00)'                     },
    { id: 'fase-turno',    label: 'Tu turno',       estados: ['config', 'coord'],                          color: 'var(--st-turno, #CA5010)'                    },
    { id: 'fase-rafa',     label: 'Con Rafa',       estados: ['req', 'appr'],                              color: 'var(--st-rafa, #8764B8)'                     },
    { id: 'fase-cierre',   label: 'Cierre',         estados: ['wipe', 'scan', 'done', 'not_accepted'],     color: 'var(--st-cierre, #107C10)'                   },
];

function loadKanbanConfig() {
    // v3: columnas INC/WO separadas y bloqueadas. Configs anteriores (v2)
    // se descartan para garantizar la estructura correcta.
    const saved = localStorage.getItem('recambios_kanban_config_v3');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Sanity check: debe tener las columnas fijas INC y WO
            const hasInc = parsed.some(g => g.id === 'fase-inc');
            const hasWo  = parsed.some(g => g.id === 'fase-wo');
            if (hasInc && hasWo) {
                // Reaplica locked:true a las columnas fijas por si se guardó sin el flag
                KANBAN_GROUPS = parsed.map(g =>
                    LOCKED_ESTADOS.some(s => g.estados.includes(s))
                        ? { ...g, locked: true }
                        : g
                );
            }
        } catch (e) {}
    }
}
loadKanbanConfig();

// Categorías de tipo para el checklist. EQUIPMENT = lo que lleva template
// firmado + autopilot (pc/cel/monitor). PERIPHERAL = lo que se retira de
// depósito sin firma (vincha/kit/cargador/adaptador/hdmi/parlante). El
// refactor declarativo dejó atrás la whitelist hardcoded de vincha/kit
// dentro de checkAppliesTo — ahora cada CHECKLIST_ITEM declara explícita-
// mente qué tipos lo necesitan. Para agregar un check nuevo o cambiar a
// qué tipos aplica, editar item.tipos. No hay que tocar checkAppliesTo.
const EQUIPMENT_TIPOS  = ['pc', 'cel', 'both', 'monitor'];
const PERIPHERAL_TIPOS = ['vincha', 'kit', 'cargador', 'adaptador', 'hdmi', 'parlante'];
const ALL_TIPOS        = [...EQUIPMENT_TIPOS, ...PERIPHERAL_TIPOS];
const RECAMBIO_TIPOS   = ['pc', 'cel', 'both']; // legacy alias — algunos checks lo usan

// CHECKLIST_ITEMS: cada item declara `tipos` (a qué tipos aplica) y
// `order` (posición en el flujo operativo). Sort at render time. El
// campo `order` está pensado para que las dos categorías (equipo y
// periférico) se intercalen coherentemente — items que comparten paso
// del proceso comparten número:
//
//   10 — preparación inicial (recibir clave / sacar del depósito)
//   20 — coordinar fecha con el usuario
//   30 — preparar equipo (autopilot / avisar listo)
//   40 — enviar template a Rafa
//   50 — template aprobado
//   60 — entrega + 1ª firma  (solo equipo)
//   70 — vieja wipeada + 2ª firma  (solo equipo)
//   80 — escanear template
//   90 — cerrar WO / ticket
//
// Quitados: 'contacted' (usuario abre el ticket en Remedy y ya aparece),
// 'wo_received' (viene del ticket), 'not_yet'/'not_accepted' (no aplican
// al flujo Remedy — todo case en el tracker es porque el usuario inició).
window.CHECKLIST_TEMPLATES = {
    "default": [
        { "id": "user_pass", "label": "Usuario y pass", "required_for_state": "userpass", "order": 10 },
        { "id": "coord_date", "label": "Fecha de retiro coordinada con usuario", "required_for_state": "coord", "order": 20 },
        { "id": "autopilot_ok", "label": "Configurando Autopilot", "required_for_state": "config", "order": 30 },
        { "id": "template_sent", "label": "Enviar template", "required_for_state": "req", "order": 40 },
        { "id": "template_appr", "label": "Template aprobado", "required_for_state": "appr", "order": 50 },
        { "id": "delivered", "label": "Entrega de equipo nuevo + vieja recibida + 1ª firma", "required_for_state": "wipe", "order": 60 },
        { "id": "old_returned", "label": "Vieja wipeada retirada + 2ª firma", "required_for_state": "scan", "order": 70 },
        { "id": "scanned", "label": "Template escaneado", "required_for_state": "scan", "order": 80 },
        { "id": "wo_closed", "label": "WO cerrada con template adjunto", "required_for_state": "done", "order": 90 }
    ],
    "Kit Inalambrico": [
        { "id": "retiro_deposito", "label": "Se retira de depósito (anotar Marca, Modelo, Serial)", "required_for_state": "config", "order": 10 },
        { "id": "contact_coord", "label": "Contacto con usuario con mensaje rápido", "required_for_state": "coord", "order": 20 },
        { "id": "template_sent", "label": "Carga y envío de Template", "required_for_state": "req", "order": 30 },
        { "id": "template_appr", "label": "Recepción de la Aprobación", "required_for_state": "appr", "order": 40 },
        { "id": "ready_notice", "label": "Entrega del elemento", "required_for_state": "appr", "order": 50 },
        { "id": "scanned", "label": "Escaneo del template", "required_for_state": "scan", "order": 60 },
        { "id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70 }
    ],
    "Vincha": [
        { "id": "retiro_deposito", "label": "Se retira de depósito (anotar Marca, Modelo, Serial)", "required_for_state": "config", "order": 10 },
        { "id": "contact_coord", "label": "Contacto con usuario con mensaje rápido", "required_for_state": "coord", "order": 20 },
        { "id": "template_sent", "label": "Carga y envío de Template", "required_for_state": "req", "order": 30 },
        { "id": "template_appr", "label": "Recepción de la Aprobación", "required_for_state": "appr", "order": 40 },
        { "id": "ready_notice", "label": "Entrega del elemento", "required_for_state": "appr", "order": 50 },
        { "id": "scanned", "label": "Escaneo del template", "required_for_state": "scan", "order": 60 },
        { "id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70 }
    ],
    "Cargador": [
        { "id": "retiro_deposito", "label": "Se retira de depósito (anotar Marca, Modelo, Serial)", "required_for_state": "config", "order": 10 },
        { "id": "contact_coord", "label": "Contacto con usuario con mensaje rápido", "required_for_state": "coord", "order": 20 },
        { "id": "template_sent", "label": "Carga y envío de Template", "required_for_state": "req", "order": 30 },
        { "id": "template_appr", "label": "Recepción de la Aprobación", "required_for_state": "appr", "order": 40 },
        { "id": "ready_notice", "label": "Entrega del elemento", "required_for_state": "appr", "order": 50 },
        { "id": "scanned", "label": "Escaneo del template", "required_for_state": "scan", "order": 60 },
        { "id": "wo_closed", "label": "Ticket marcado como Resuelto en Remedy", "required_for_state": "done", "order": 70 }
    ]
};

function getTemplateForCase(c) {
    if (!c) return window.CHECKLIST_TEMPLATES["default"] || [];
    const tip = typeof resolveTipificacion === 'function' ? resolveTipificacion(c) : (c.tipificacion || (typeof autoDetectTipificacion === 'function' ? autoDetectTipificacion(c.puesto) : null));
    if (tip) {
        const tipLower = tip.toLowerCase().trim();
        const foundKey = Object.keys(window.CHECKLIST_TEMPLATES).find(k => k.toLowerCase().trim() === tipLower);
        if (foundKey) {
            return window.CHECKLIST_TEMPLATES[foundKey];
        }
    }
    return window.CHECKLIST_TEMPLATES["default"] || [];
}

function checklistFor(tipo, caseObj) {
    if (caseObj) return getTemplateForCase(caseObj);
    return getTemplateForCase(null);
}

function checkAppliesTo(item, tipo) {
    return true;
}

// El mapeo automático de "no aplica" / "rechazado" desde la columna Status
// del Excel queda deshabilitado: las decisiones de rechazo se toman a mano
// desde el drawer del caso. 'Faltaba wipe' sigue mapeado porque define un
// estado operativo (no es un rechazo).
const STATUS_TO_FLOW = {
    'Faltaba wipe': 'wipe'
};

// CHECKLIST_ITEMS y CHECK_TO_ESTADO: derivados de la union de todos los
// CHECKLIST_TEMPLATES (default + per-tipificacion). estadoFromChecks itera
// sobre CHECK_TO_ESTADO para mapear el set de checks marcados al estado
// del flujo. Si el id de un check aparece en multiples templates con
// distinto required_for_state, gana el primero (orden de keys del objeto).
// Renombrar un check id en CHECKLIST_TEMPLATES requiere regenerar aca.
const CHECKLIST_ITEMS = (() => {
    const seen = new Set();
    const out = [];
    for (const tpl of Object.values(window.CHECKLIST_TEMPLATES || {})) {
        for (const item of tpl) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            out.push(item);
        }
    }
    return out;
})();

const CHECK_TO_ESTADO = Object.fromEntries(
    CHECKLIST_ITEMS
        .filter(i => i.required_for_state)
        .map(i => [i.id, i.required_for_state])
);

window.DEFAULT_QUICK_MESSAGES = [
    { title: 'Pedir Datos Celular', typification: 'Alta/cambio Equipo Celular', text: 'Hola {nombre}, te contacto del sector de tecnología por el cambio/alta de tu equipo celular.\nPara coordinarlo necesito que me pases:\n- Dirección completa (Calle, Altura, Código Postal, Localidad y Provincia).\n- Días y horarios de disponibilidad (Rango mínimo de 4hs por día).\n- Número de teléfono.' },
    { title: 'Kit Inalámbrico', typification: 'Kit Inalambrico', text: 'Hola {nombre}, te contacto por tu ticket de Kit Inalámbrico.\nQuería consultarte si estás por la oficina o si coordinamos el envío/retiro del mismo.' },
    { title: 'Vincha', typification: 'Vincha', text: 'Hola {nombre}, te contacto por tu ticket de Vincha.\nQuería consultarte si estás por la oficina o si coordinamos el envío/retiro de la misma.' },
    { title: 'Cargador', typification: 'Cargador', text: 'Hola {nombre}, te contacto por tu ticket de Cargador.\nQuería consultarte si estás por la oficina o si coordinamos el envío/retiro del mismo.' },
    { title: 'Instalación de Software', typification: 'Software - Instalacion', text: 'Hola {nombre}, te contacto del sector de tecnología por tu ticket de instalación de software.\n¿Podrías confirmarme tu disponibilidad para realizar la conexión remota?' },
    { title: 'Configuración de Software', typification: 'Software - Configuracion', text: 'Hola {nombre}, te contacto del sector de tecnología por tu ticket de configuración de software.\n¿Podrías confirmarme tu disponibilidad para realizar la conexión remota?' },
    { title: 'Notebook Baja', typification: 'Notebook Baja', text: 'Hola {nombre}, te contacto del sector de tecnología por la baja de tu Notebook.\nPor favor, confirmame tu dirección y disponibilidad horaria para programar el retiro del equipo viejo.' },
    { title: 'Solicitud de Monitor', typification: 'Solicitud de Monitor', text: 'Hola {nombre}, te contacto del sector de tecnología por tu solicitud de Monitor.\nPara coordinar el envío, por favor facilitanos tu dirección de entrega y horarios disponibles.' },
    { title: 'Equipo - Reparación', typification: 'Equipo - Reparacion', text: 'Hola {nombre}, te contacto por tu ticket de reparación de equipo.\n¿Podrías indicarnos en qué días y horarios estarás disponible en la oficina o para realizar la revisión?' },
    { title: 'Correo / Outlook', typification: 'Outlook - Inconvenientes con Correo', text: 'Hola {nombre}, te contacto por los inconvenientes con tu correo/Outlook.\n¿Podrías confirmarnos si podemos realizar una sesión remota para verificar la configuración?' },
    { title: 'Configuración de VPN', typification: 'Equipo - Configuracion de VPN', text: 'Hola {nombre}, te contacto por el ticket de configuración de VPN.\n¿Cuándo tendrías disponibilidad para realizar la configuración en conjunto?' },
    { title: 'Máquina Virtual', typification: 'Maquina Virtual', text: 'Hola {nombre}, te contacto por tu ticket de Máquina Virtual.\n¿Cuándo estarías disponible para conectarnos y revisar el inconveniente/configuración?' }
];

window.DEFAULT_TEMPLATE_OBS = [
    { title: 'Asignación Presencial', action: 'asignacion', text: 'Se entrega {equipo} nuevo al usuario para desempeñar sus labores.' },
    { title: 'Asignación Correo', action: 'asignacion', text: 'Se realiza el envío del {equipo} por correo interno ya que el usuario no puede acercarse a DT.' },
    { title: 'Recambio Beneficio', action: 'recambio', text: 'Beneficio. No ingresa al depósito, se decomisa en el día y se entrega al usuario.' },
    { title: 'Defectuoso', action: 'recambio', text: 'Se entrega {equipo} nuevo. Se recibe el {equipo} defectuoso del usuario como condición para la entrega.' },
    { title: 'Préstamo', action: 'prestamo', text: 'Préstamo de {equipo} — devuelve el mismo día a las 17:00.' },
    { title: 'Renuncia', action: 'renuncia', text: 'Ingresa al depósito wipeado por renuncia del usuario.' },
    { title: 'Reemplazo en Sector', action: 'reemplazo', text: 'Se realiza el reemplazo de {equipo} en sector.' }
];

window.DEFAULT_TEMPLATE_GREETINGS = [
    { title: 'Asignación Estándar', action: 'asignacion', text: '{saludo}\n\nSaludos Rafael\n\nSe notifica que el día {fecha} se realizará la entrega {elemento} al usuario {persona}.\n\nDetalle {elemento}' },
    { title: 'Recambio Tecnológico', action: 'recambio', text: '{saludo}\n\nSaludos Rafael\n\nSe realiza el recambio del día {fecha} {elemento} de {persona}.' },
    { title: 'Préstamo Temporal', action: 'prestamo', text: '{saludo}\n\nSaludos Rafael\n\nSe realiza el préstamo del día {fecha} {elemento} de {persona}.' },
    { title: 'Renuncia / Devolución', action: 'renuncia', text: '{saludo}\n\nSaludos Rafael\n\nSe recibe el {elemento} por renuncia de {persona} el día {fecha}.' },
    { title: 'Reemplazo de Equipo', action: 'reemplazo', text: '{saludo}\n\nSaludos Rafael\n\nSe realiza el reemplazo de {elemento} de {persona} el día {fecha}.' }
];

// Expose all to window
window.TIPIFICACIONES_INC = TIPIFICACIONES_INC;
window.TIPIFICACIONES_WO = TIPIFICACIONES_WO;
window.ALL_TIPIFICACIONES = ALL_TIPIFICACIONES;
window.LOCKED_ESTADOS = LOCKED_ESTADOS;
window.ESTADOS = ESTADOS;
window.KANBAN_GROUPS = KANBAN_GROUPS;
window.EQUIPMENT_TIPOS = EQUIPMENT_TIPOS;
window.PERIPHERAL_TIPOS = PERIPHERAL_TIPOS;
window.ALL_TIPOS = ALL_TIPOS;
window.RECAMBIO_TIPOS = RECAMBIO_TIPOS;
window.getTemplateForCase = getTemplateForCase;
window.checklistFor = checklistFor;
window.checkAppliesTo = checkAppliesTo;
window.STATUS_TO_FLOW = STATUS_TO_FLOW;
window.CHECKLIST_ITEMS = CHECKLIST_ITEMS;
window.CHECK_TO_ESTADO = CHECK_TO_ESTADO;

export {
    TIPIFICACIONES_INC,
    TIPIFICACIONES_WO,
    ALL_TIPIFICACIONES,
    LOCKED_ESTADOS,
    ESTADOS,
    KANBAN_GROUPS,
    EQUIPMENT_TIPOS,
    PERIPHERAL_TIPOS,
    ALL_TIPOS,
    RECAMBIO_TIPOS,
    getTemplateForCase,
    checklistFor,
    checkAppliesTo,
    STATUS_TO_FLOW,
    CHECKLIST_ITEMS,
    CHECK_TO_ESTADO
};


// Expose to window for global module compatibility
window.loadKanbanConfig = loadKanbanConfig;
