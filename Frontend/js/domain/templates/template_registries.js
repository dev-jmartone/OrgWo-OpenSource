// ============================================================
// TEMPLATE SPEC REGISTRIES
// ============================================================
// Tipos de item que el template puede listar. Cada uno declara:
//   - label: texto humano para selects
//   - fields: subset de [marca, modelo, serie, imei1, imei2] que pide ese tipo
//   - labelTipo: texto que va en la fila "Tipo y modelo de {labelTipo}" del template
//   - labelTicket: texto adicional para la fila "Ticket correspondiente {labelTicket}"
//   - labelRetira: texto para la fila "Nombre de persona que retira {labelRetira}"
const ITEM_TYPES = {
    PC:        { label: 'Notebook / PC',     fields: ['marca','modelo','serie'],                   labelTipo: 'máquina',            labelTicket: 'a la configuración de la PC', labelRetira: 'el equipo' },
    CEL:       { label: 'Celular',           fields: ['marca','modelo','serie','imei1','imei2'],   labelTipo: 'celular',            labelTicket: '',                            labelRetira: 'el celular' },
    MONITOR:   { label: 'Monitor',           fields: ['marca','modelo','serie'],                   labelTipo: 'monitor',            labelTicket: '',                            labelRetira: 'el monitor' },
    KIT:       { label: 'Kit Inalámbrico',   fields: ['marca','modelo','serie'],                   labelTipo: 'kit inalámbrico',    labelTicket: 'del kit',                     labelRetira: 'el kit',     defaultMarca: 'Logitech', defaultModelo: 'MK235' },
    VINCHA:    { label: 'Vincha',            fields: ['marca','modelo','serie'],                   labelTipo: 'vincha',             labelTicket: 'de la vincha',                labelRetira: 'la vincha',  defaultMarca: 'Jabra',    defaultModelo: 'Evolve 20' },
    CARGADOR:  { label: 'Cargador',          fields: ['marca','modelo','serie'],                   labelTipo: 'cargador',           labelTicket: '',                            labelRetira: 'el cargador' },
    ADAPTADOR: { label: 'Adaptador',         fields: ['marca','modelo'],                           labelTipo: 'adaptador',          labelTicket: '',                            labelRetira: 'el adaptador' },
    HDMI:      { label: 'Cable HDMI',        fields: ['marca'],                                    labelTipo: 'cable HDMI',         labelTicket: '',                            labelRetira: 'el cable' },
    PARLANTE:  { label: 'Parlante',          fields: ['marca','modelo','serie'],                   labelTipo: 'parlante',           labelTicket: '',                            labelRetira: 'el parlante' },
};

// Tipos de movimiento que cada item puede tener. Mapean al texto que va
// en la fila "Fecha y tipo de movimiento" del template HTML.
// equipmentRole declara a qué equipo del case refiere el mov: 'new' lee de
// newModel/newSvc/fechaAsignacionNew, 'old' lee de oldModel/svcTag/
// fechaAsignacion. Lo consume deriveMarcaModelo/makeEmptyItem para
// autollenar el item correcto. Variantes wipe aluden al equipo viejo
// (sale al usuario en beneficio, entra a depósito en renuncia). egreso a
// secas siempre es equipo nuevo (asignación, préstamo, lado nuevo del
// recambio).
const MOV_TYPES = {
    egreso:        { label: 'Egreso',                  short: 'Egreso',     templateLabel: 'Egreso',                       equipmentRole: 'new' },
    ingreso:       { label: 'Ingreso',                 short: 'Ingreso',    templateLabel: 'Ingreso',                      equipmentRole: 'old' },
    egreso_wipe:   { label: 'Egreso (wipe presencial)', short: 'Egreso w.', templateLabel: 'Wipe Presencial - Egreso',     equipmentRole: 'old' },
    ingreso_wipe:  { label: 'Ingreso (wipe presencial)',short: 'Ingreso w.',templateLabel: 'Ingreso Wipe Presencial',      equipmentRole: 'old' },
};

// Tipos periféricos. En recambio.defectuoso el viejo se desecha (no entra
// a depósito) → la regla aplica peripheralMovs en vez de movs para estos.
const PERIPHERAL_TYPES = ['KIT','VINCHA','CARGADOR','ADAPTADOR','HDMI','PARLANTE'];
const EQUIPMENT_TYPES  = ['PC','CEL','MONITOR'];
const ALL_ITEM_TYPES   = [...EQUIPMENT_TYPES, ...PERIPHERAL_TYPES];

// Matriz acción × razón. Cada reason declara:
//   - label, motivoLabel (texto humano)
//   - movs: movimientos esperados para los items iniciales
//   - peripheralMovs (opcional): override de movs cuando el item es periférico
//     (ej. defectuoso: PC va egreso+ingreso, cargador va solo egreso porque se desecha)
//   - validItemTypes: tipos de item que aplican para esta razón. Filtra el
//     select de tipos en el wizard y los dropdowns de acción/razón si la
//     razón no aplica al tipo del caso.
//   - allowMulti: el operador puede agregar más items del mismo tipo
// Tipos válidos para Recambio (cualquier razón) y Préstamo: todos menos KIT.
// El Kit viene en caja sellada → solo se entrega nuevo (Asignación).
const RECAMBIO_VALID_TYPES = ['PC','CEL','MONITOR','VINCHA','CARGADOR','ADAPTADOR','HDMI','PARLANTE'];
const PRESTAMO_VALID_TYPES = ['PC','CEL','MONITOR','VINCHA','CARGADOR','ADAPTADOR','HDMI','PARLANTE'];

const ACTION_RULES = {
    asignacion: {
        label: 'Asignación',
        reasons: {
            // Una sola razón visible: cubre asignación simple Y alta de empleado
            // nuevo (notebook+kit+vincha combo). Template HTML es idéntico —
            // solo cambia la cantidad de ítems que el operador agrega.
            normal: { label: 'Asignación', movs: ['egreso'], allowMulti: true, motivoLabel: 'Nuevo Ingreso', validItemTypes: ALL_ITEM_TYPES },
            // hidden=true → no aparece en el dropdown pero el código puede
            // referenciarlo desde otros flujos (imports, automatizaciones).
            empleado_nuevo: { label: 'Empleado nuevo (alta)', movs: ['egreso'], allowMulti: true, motivoLabel: 'Nuevo Ingreso', validItemTypes: ['PC','CEL','MONITOR','KIT','VINCHA','CARGADOR'], hidden: true },
        },
    },
    recambio: {
        label: 'Recambio',
        reasons: {
            beneficio:    { label: 'Beneficio (3 años)',  movs: ['egreso_wipe','egreso'],               motivoLabel: 'Recambio Tecnologico', validItemTypes: ['PC','CEL'] },
            tecnologico:  { label: 'Recambio tecnológico',movs: ['egreso_wipe','egreso'],               motivoLabel: 'Recambio Tecnologico', validItemTypes: ['PC','CEL'] },
            defectuoso:   { label: 'Defectuoso',          movs: ['egreso','ingreso'], peripheralMovs: ['egreso'], motivoLabel: 'Cambio por defectuoso', validItemTypes: RECAMBIO_VALID_TYPES },
            garantia:     { label: 'Gestión de garantía', movs: ['egreso','ingreso'],                   motivoLabel: 'Gestión de garantía',  validItemTypes: ['PC','CEL','MONITOR'] },
            robo_perdida: { label: 'Robo / pérdida',      movs: ['egreso'],                             motivoLabel: 'Robo / pérdida — viejo no ingresa', validItemTypes: ['PC','CEL'] },
            sector:       { label: 'Sector completo',     movs: ['egreso','ingreso'], allowMulti: true, motivoLabel: 'Reemplazo de sector',  validItemTypes: ['PC','CEL','MONITOR'] },
        },
    },
    prestamo: {
        label: 'Préstamo',
        reasons: {
            // Kit no entra: vienen en caja sellada. Vincha y cargador sí
            // (tenemos sueltos en depósito).
            normal: { label: 'Préstamo (devuelve mismo día 17hs)', movs: ['egreso'], devuelveHoy: '17:00', motivoLabel: 'Préstamo', validItemTypes: PRESTAMO_VALID_TYPES },
        },
    },
    renuncia: {
        label: 'Renuncia',
        reasons: {
            normal: { label: 'Ingreso a depósito por renuncia', movs: ['ingreso_wipe'], allowMulti: true, motivoLabel: 'Renuncia', validItemTypes: ['PC','CEL','MONITOR'] },
            beneficio: { label: 'Renuncia con Beneficio (compra de equipo)', movs: ['egreso_wipe'], allowMulti: true, motivoLabel: 'Renuncia con Beneficio', validItemTypes: ['PC','CEL'] },
        },
    },
    reemplazo: {
        label: 'Reemplazo',
        reasons: {
            sector: { label: 'Reemplazo en sector', movs: ['egreso','ingreso'], allowMulti: true, motivoLabel: 'Reemplazo', validItemTypes: ['PC','CEL','MONITOR'] },
        },
    },
};

// Movs efectivos para una regla + tipo de item. Aplica peripheralMovs cuando
// el tipo es periférico y la regla lo declara (caso típico: defectuoso).
function effectiveMovsFor(rule, itemType) {
    if (rule?.peripheralMovs && PERIPHERAL_TYPES.includes(itemType)) {
        return rule.peripheralMovs;
    }
    return rule?.movs || ['egreso'];
}

// Logística. Si correo_interno, el operador no toca datos de envío (los pone
// el área que recibe la solicitud) — solo agrega el sufijo al subject + obs.
const LOGISTICS = {
    presencial:     { label: 'Presencial',     subjectSuffix: '' },
    correo_interno: { label: 'Correo interno', subjectSuffix: ' + Correo Interno' },
};

// Mapeo del case.tipo histórico al item type del registry. Usado para
// derivar el primer item al abrir la planilla por primera vez en un caso.
const TIPO_TO_ITEM_TYPE = {
    pc: 'PC',
    cel: 'CEL',
    both: 'PC',         // both lleva 2 items: PC + CEL — se manejan en init
    monitor: 'MONITOR',
    kit: 'KIT',
    vincha: 'VINCHA',
    cargador: 'CARGADOR',
};

// Mapeo dominio de mail → empresa propietaria. Usado para auto-llenar
// la planilla cuando el operador ingresa el email del usuario que retira.
const EMAIL_DOMAIN_TO_COMPANY = {
    'subsidiaria.com': 'Subsidiaria',
    'proveedor.com': 'Proveedor TI',
    'empresa.com': 'Empresa Principal',
    'subsidiaria.com': 'Subsidiaria',
};

// Dominios que indican que el usuario es externo a la empresa.
// La empresa NO se autocompleta (no aplica) y la UI muestra un aviso.
const EXTERNAL_EMAIL_PATTERNS = [
    /^serv\.externos\./i,
];

// Observaciones por defecto por combinación type/mov/action/reason.
// Sembradas a partir de patrones reales en los mails de la carpeta del equipo.
// Si el operador edita el campo, no se pisa (ver lógica en renderPlanillaItem).
const DEFAULT_OBS = {
    // KIT — solo se cambia cuando el del usuario está dañado.
    // Condición: el usuario debe traer (o intentar traer) el defectuoso.
    'KIT/egreso/asignacion/normal':         'Se entrega Kit Inalámbrico nuevo al usuario para desempeñar sus labores.',
    'KIT/egreso/recambio/defectuoso':       'Se entrega Kit Inalámbrico nuevo. Se recibe el kit defectuoso del usuario como condición para la entrega.',

    // VINCHA — misma condición que KIT
    'VINCHA/egreso/asignacion/normal':      'Se entrega la vincha al usuario para desarrollar sus labores.',
    'VINCHA/egreso/recambio/defectuoso':    'Se entrega vincha nueva. Se recibe la vincha defectuosa del usuario como condición para la entrega.',
    'VINCHA/egreso/prestamo/normal':        'Préstamo de vincha — devuelve el mismo día a las 17:00.',

    // CARGADOR — misma condición. Si solo es egreso (peripheral), la
    // observación documenta la recepción del defectuoso aunque no haya
    // movimiento formal de ingreso a depósito.
    'CARGADOR/egreso/asignacion/normal':    'Se entrega cargador nuevo al usuario para desempeñar sus labores.',
    'CARGADOR/egreso/recambio/defectuoso':  'Se entrega cargador nuevo. Se recibe el cargador defectuoso del usuario; las pruebas confirman la falla.',
    'CARGADOR/ingreso/recambio/defectuoso': 'Ingresa el cargador defectuoso del usuario.',
    'CARGADOR/egreso/prestamo/normal':      'Préstamo de cargador — devuelve el mismo día a las 17:00.',

    // ADAPTADOR / HDMI / PARLANTE — genéricos
    'ADAPTADOR/egreso/asignacion/normal':   'Se entrega adaptador al usuario para desempeñar sus labores.',
    'ADAPTADOR/egreso/recambio/defectuoso': 'Se entrega adaptador nuevo. Se recibe el adaptador defectuoso del usuario como condición para la entrega.',
    'HDMI/egreso/asignacion/normal':        'Se entrega cable HDMI al usuario para desempeñar sus labores.',
    'HDMI/egreso/recambio/defectuoso':      'Se entrega cable HDMI nuevo. Se recibe el cable defectuoso del usuario como condición para la entrega.',
    'PARLANTE/egreso/asignacion/normal':    'Se entrega parlante al usuario para desempeñar sus labores.',
    'PARLANTE/egreso/recambio/defectuoso':  'Se entrega parlante nuevo. Se recibe el parlante defectuoso del usuario como condición para la entrega.',
    'PARLANTE/egreso/prestamo/normal':      'Préstamo de parlante — devuelve el mismo día a las 17:00.',

    // PC
    'PC/egreso_wipe/recambio/beneficio':    'Beneficio. No ingresa al depósito, se decomisa en el día y se entrega al usuario.',
    'PC/egreso/recambio/beneficio':         'Se entrega en su caja con cargador.',
    'PC/egreso_wipe/recambio/tecnologico':  'Beneficio. No ingresa al depósito, se decomisa en el día y se entrega al usuario.',
    'PC/egreso/recambio/tecnologico':       'Se entrega en su caja con cargador.',
    'PC/egreso/asignacion/normal':          'Se entrega notebook nueva al usuario para desempeñar sus labores.',
    'PC/ingreso_wipe/renuncia/normal':      'Ingresa al depósito wipeada por renuncia del usuario.',
    'PC/egreso/recambio/defectuoso':        'Se entrega notebook nueva por equipo defectuoso del usuario.',
    'PC/ingreso/recambio/defectuoso':       'Ingresa al depósito la notebook defectuosa del usuario.',
    'PC/egreso/recambio/garantia':          'Se entrega notebook por gestión de garantía del fabricante.',
    'PC/ingreso/recambio/garantia':         'Ingresa al depósito la notebook que va a garantía.',

    // CEL
    'CEL/egreso_wipe/recambio/beneficio':   'Beneficio. El celular anterior queda en posesión del usuario.',
    'CEL/egreso/recambio/beneficio':        'Se entrega celular nuevo al usuario por beneficio recambio tecnológico.',
    'CEL/egreso/asignacion/normal':         'Se entrega celular nuevo al usuario para desempeñar sus labores.',
    'CEL/egreso/recambio/robo_perdida':     'Reposición por pérdida o robo del celular anterior. El equipo viejo no ingresa al depósito.',
    'CEL/ingreso_wipe/renuncia/normal':     'Ingresa al depósito wipeado por renuncia del usuario.',

    // MONITOR
    'MONITOR/egreso/asignacion/normal':     'Se entrega monitor nuevo al usuario para desempeñar sus labores.',
    'MONITOR/egreso/recambio/defectuoso':   'Se entrega monitor nuevo por falla del anterior.',
    'MONITOR/ingreso/recambio/defectuoso':  'Ingresa al depósito monitor defectuoso del usuario.',
    'MONITOR/egreso/recambio/garantia':     'Se entrega monitor por gestión de garantía.',
    'MONITOR/ingreso/recambio/garantia':    'Ingresa al depósito el monitor que va a garantía.',
    'MONITOR/ingreso_wipe/renuncia/normal': 'Ingresa al depósito monitor por renuncia del usuario.',
};
const DEFAULT_OBS_VALUES = new Set(Object.values(DEFAULT_OBS));
const CORREO_INTERNO_SUFFIX = 'Se realiza el envío por correo interno ya que el usuario no puede acercarse a DT.';

function defaultObsFor(type, mov, action, reason, logistics) {
    if (!type || !mov || !action || !reason) {
        return logistics === 'correo_interno' ? CORREO_INTERNO_SUFFIX : '';
    }
    const base = DEFAULT_OBS[`${type}/${mov}/${action}/${reason}`] || '';
    if (logistics === 'correo_interno') {
        return base ? `${base}\n${CORREO_INTERNO_SUFFIX}` : CORREO_INTERNO_SUFFIX;
    }
    return base;
}

// True si la obs actual es uno de los defaults conocidos (con o sin
// sufijo de correo interno) o vacía. Indica que se puede recomputar sin
// pisar texto custom del operador.
function isDefaultObs(text) {
    if (!text) return true;
    if (DEFAULT_OBS_VALUES.has(text)) return true;
    if (text === CORREO_INTERNO_SUFFIX) return true;
    const tail = '\n' + CORREO_INTERNO_SUFFIX;
    if (text.endsWith(tail)) {
        const base = text.slice(0, -tail.length);
        if (DEFAULT_OBS_VALUES.has(base)) return true;
    }
    return false;
}

function inferEmpresaFromEmail(email) {
    if (!email) return { empresa: '', isExternal: false };
    const at = email.lastIndexOf('@');
    if (at < 0) return { empresa: '', isExternal: false };
    const domain = email.slice(at + 1).toLowerCase().trim();
    if (!domain) return { empresa: '', isExternal: false };
    if (domain.startsWith('serv.externos.subsidiaria')) {
        return { empresa: 'Externos Subsidiaria', isExternal: true };
    }
    if (domain.startsWith('serv.externos.empresa') || domain.startsWith('serv.externos')) {
        return { empresa: 'Externos Empresa', isExternal: true };
    }
    if (EXTERNAL_EMAIL_PATTERNS.some(re => re.test(domain))) {
        return { empresa: '', isExternal: true };
    }
    return { empresa: EMAIL_DOMAIN_TO_COMPANY[domain] || '', isExternal: false };
}


// Expose to window for global module compatibility
window.effectiveMovsFor = effectiveMovsFor;
window.defaultObsFor = defaultObsFor;
window.isDefaultObs = isDefaultObs;
window.inferEmpresaFromEmail = inferEmpresaFromEmail;
window.ITEM_TYPES = ITEM_TYPES;
window.MOV_TYPES = MOV_TYPES;
window.PERIPHERAL_TYPES = PERIPHERAL_TYPES;
window.EQUIPMENT_TYPES = EQUIPMENT_TYPES;
window.ALL_ITEM_TYPES = ALL_ITEM_TYPES;
window.RECAMBIO_VALID_TYPES = RECAMBIO_VALID_TYPES;
window.PRESTAMO_VALID_TYPES = PRESTAMO_VALID_TYPES;
window.ACTION_RULES = ACTION_RULES;
window.LOGISTICS = LOGISTICS;
window.TIPO_TO_ITEM_TYPE = TIPO_TO_ITEM_TYPE;
window.EMAIL_DOMAIN_TO_COMPANY = EMAIL_DOMAIN_TO_COMPANY;
window.EXTERNAL_EMAIL_PATTERNS = EXTERNAL_EMAIL_PATTERNS;
window.DEFAULT_OBS = DEFAULT_OBS;
