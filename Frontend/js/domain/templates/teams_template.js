// ============================================================
// TEAMS TEMPLATE — wrapper de MSG_TEMPLATES + custom messages.
// Resuelve render + dispatch contra el chat de Teams del usuario.
// Contrato compartido con planilla_template + factory:
//   { kind, subject, body, validate(), dispatch() }
// ============================================================

// Render lazy para no requerir MSG_TEMPLATES disponible en construct time.
// Permite que el factory se invoque antes de que message_templates.js ejecute
// su top-level (improbable en la practica, pero defensivo).
function _renderTeamsQuick(msgKey, c) {
    const fn = (typeof MSG_TEMPLATES === 'object' && MSG_TEMPLATES) ? MSG_TEMPLATES[msgKey] : null;
    if (typeof fn !== 'function') {
        throw new Error('MSG_TEMPLATES sin entry: ' + msgKey);
    }
    return fn(c);
}

// Reemplazo de tokens para mensajes custom del operador (los que vienen del
// modal "Mensajes Rapidos" de Profile). Tokens soportados: {nombre},
// {ticket}, {empresa}, {equipo}. Tokens desconocidos quedan literales.
function _renderTeamsCustom(rawText, c) {
    const tipoLbl = (typeof tipoInfo === 'function')
        ? (tipoInfo(c.tipo)?.label || c.tipo || '')
        : (c.tipo || '');
    const company = (typeof getCompanyForCase === 'function')
        ? (getCompanyForCase(c) || 'Empresa Principal')
        : (c.company || 'Empresa Principal');
    return String(rawText || '')
        .replace(/\{nombre\}/g,  c.name || 'Sin nombre')
        .replace(/\{ticket\}/g,  c.wo || '—')
        .replace(/\{empresa\}/g, company)
        .replace(/\{equipo\}/g,  String(tipoLbl).toLowerCase());
}

// ctx.kind: 'teams_quick' | 'teams_custom'.
// ctx.case: case completo (name, email, wo, company, tipo, etc).
// ctx.msgKey (quick only): id en MSG_TEMPLATES (msg-rt, msg-pc, etc).
// ctx.rawText (custom only): texto con tokens sin resolver.
// ctx.title (opcional): titulo del fallback modal cuando no hay email.
function createTeamsTemplate(ctx) {
    if (!ctx || !ctx.case) throw new Error('teams template requiere ctx.case');
    const c = ctx.case;
    const isQuick = ctx.kind === 'teams_quick';

    return {
        kind: ctx.kind || 'teams_quick',
        subject: '',
        get body() {
            return isQuick
                ? _renderTeamsQuick(ctx.msgKey, c)
                : _renderTeamsCustom(ctx.rawText, c);
        },

        validate() {
            const errors = [];
            try {
                const b = this.body;
                if (!b || !b.trim()) errors.push({ field: 'body', msg: 'Texto del mensaje vacio' });
            } catch (e) {
                errors.push({ field: 'body', msg: e.message || 'Error al renderizar' });
            }
            return { ok: errors.length === 0, errors };
        },

        // Despacho:
        //   1) Si hay email en el case, abre chat de Teams pre-cargado.
        //   2) Si no hay email, fallback a modal con boton "Copiar".
        // No envia: el usuario apreta Enter en Teams o Copiar en el modal.
        dispatch() {
            const email = (c.email || '').trim();
            const text = this.body;
            if (!email) {
                if (typeof openMessageModal === 'function') {
                    openMessageModal(ctx.title || 'Mensaje', text);
                }
                return { opened: false, reason: 'sin email — fallback modal' };
            }
            if (typeof openTeamsChat !== 'function') {
                throw new Error('openTeamsChat no disponible (cargar message_templates.js antes)');
            }
            openTeamsChat(email, text);
            return { opened: true };
        },
    };
}


// Expose to window for global module compatibility
window._renderTeamsQuick = _renderTeamsQuick;
window._renderTeamsCustom = _renderTeamsCustom;
window.createTeamsTemplate = createTeamsTemplate;
