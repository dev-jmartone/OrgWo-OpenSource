// ============================================================
// PLANILLA TEMPLATE — wrapper de buildPlanillaSubject + buildPlanillaHtmlBody
// + validatePlanillaSpec + dispatch al protocolo templategen://.
// Contrato compartido con teams_template + factory:
//   { kind, subject, body, validate(), dispatch() }
// ============================================================

const _DEFAULT_PLANILLA_TO = 'rerodriguez@texpert.com.ar';
const _DEFAULT_PLANILLA_CC = 'tecnologiausuariosdt@texpert.com.ar';

// ctx.spec: planillaSpec completo (action, reason, logistics, ticket, empresa,
//           personaRetira, emailRetira, items[], etc).
// ctx.to (opcional): destinatario. Default _DEFAULT_PLANILLA_TO.
// ctx.cc (opcional): copia. Default _DEFAULT_PLANILLA_CC.
//
// subject / body son getters lazy: se computan al accederlos, lo que permite
// crear el template antes de que planilla.js cargue (no probable hoy, pero
// defensivo si en el futuro la factory se invoca temprano en el ciclo).
function createPlanillaTemplate(ctx) {
    if (!ctx || !ctx.spec) throw new Error('planilla template requiere ctx.spec');
    const spec = ctx.spec;
    const to = ctx.to || _DEFAULT_PLANILLA_TO;
    const cc = ctx.cc || _DEFAULT_PLANILLA_CC;

    return {
        kind: 'planilla_outlook',
        get subject() {
            if (typeof buildPlanillaSubject !== 'function') {
                throw new Error('buildPlanillaSubject no disponible (cargar planilla.js antes)');
            }
            return buildPlanillaSubject(spec);
        },
        get body() {
            if (typeof buildPlanillaHtmlBody !== 'function') {
                throw new Error('buildPlanillaHtmlBody no disponible (cargar planilla.js antes)');
            }
            return buildPlanillaHtmlBody(spec);
        },

        validate() {
            if (typeof validatePlanillaSpec !== 'function') {
                return { ok: false, errors: [{ field: '_', msg: 'validatePlanillaSpec no disponible' }] };
            }
            const errors = validatePlanillaSpec(spec);
            return { ok: errors.length === 0, errors };
        },

        // Despacho: arma payload base64 + lanza protocolo templategen://
        // que activa el cliente Outlook desktop con el draft pre-rellenado.
        // No envia: el operador revisa y manda manualmente.
        dispatch() {
            const payload = {
                To: to,
                Cc: cc,
                Subject: this.subject,
                Body: '<html><body style="font-family: Arial, sans-serif;">' + this.body + '</body></html>',
            };
            const base64Str = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
            const frame = document.createElement('iframe');
            frame.style.display = 'none';
            frame.src = 'templategen://' + base64Str;
            document.body.appendChild(frame);
            setTimeout(() => frame.remove(), 1500);
            return { opened: true };
        },
    };
}


// Expose to window for global module compatibility
window.createPlanillaTemplate = createPlanillaTemplate;
