// ============================================================
// TEMPLATE FACTORY — dispatcher unico para crear templates.
// Devuelve instancia con contrato { kind, subject, body, validate(), dispatch() }.
// Permite agregar nuevos kinds (SMS, push, mail generico) sin tocar callers.
// ============================================================

const TEMPLATE_KINDS = {
    teams_quick:      (ctx) => createTeamsTemplate({ ...ctx, kind: 'teams_quick' }),
    teams_custom:     (ctx) => createTeamsTemplate({ ...ctx, kind: 'teams_custom' }),
    planilla_outlook: (ctx) => createPlanillaTemplate(ctx),
};

// kind: string registrado en TEMPLATE_KINDS.
// ctx: contexto especifico del kind (ver teams_template.js / planilla_template.js).
// Devuelve instancia con contrato comun.
//
// Ejemplo Teams quick:
//   const t = createTemplate('teams_quick', { case: c, msgKey: 'msg-pc' });
//   const v = t.validate(); if (!v.ok) return showErrors(v.errors);
//   t.dispatch();
//
// Ejemplo Planilla:
//   const t = createTemplate('planilla_outlook', { spec: planillaSpec });
//   if (!t.validate().ok) return;
//   t.dispatch();
function createTemplate(kind, ctx) {
    const f = TEMPLATE_KINDS[kind];
    if (!f) throw new Error('Template kind desconocido: ' + kind);
    return f(ctx);
}

// Helper diagnostico: lista los kinds registrados.
function listTemplateKinds() {
    return Object.keys(TEMPLATE_KINDS);
}


// Expose to window for global module compatibility
window.createTemplate = createTemplate;
window.listTemplateKinds = listTemplateKinds;
