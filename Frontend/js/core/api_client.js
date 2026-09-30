// ============================================================
// API CLIENT
// ============================================================

/**
 * Wrapper para fetch en endpoints de Remedy.
 * Si el servidor devuelve 401 con remedy_error=TOKEN_EXPIRED,
 * dispara el evento global 'remedy:session-expired' para que la UI
 * muestre el aviso de re-autenticación, y retorna null.
 */
async function _remedyFetch(url, options = {}) {
    const r = await fetch(url, options);
    if (r.status === 401) {
        const body = await r.json().catch(() => ({}));
        if (body.remedy_error === 'TOKEN_EXPIRED') {
            window.dispatchEvent(new CustomEvent('remedy:session-expired', {
                detail: { message: body.error || 'Sesión de Remedy expirada' }
            }));
            return null; // El caller debe manejar null
        }
    }
    return r;
}

const API = {
    async authMe() {
        const r = await fetch('/api/auth/me');
        if (!r.ok) throw new Error('Auth query failed');
        return r.json();
    },
    async login(username, password) {
        const r = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username, password})
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Credenciales inválidas');
        return body;
    },
    async register(username, password, organization, name, email, role = 'tecnico') {
        const r = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username, password, organization, name, email, role})
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al registrarse');
        return body;
    },
    async logout() {
        const r = await fetch('/api/auth/logout', { method: 'POST' });
        return r.json();
    },
    async updateProfile(data) {
        const r = await fetch('/api/auth/profile', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al actualizar perfil');
        return body;
    },
    async getUserSettings() {
        const r = await fetch('/api/user/settings');
        if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.error || 'Error al obtener configuraciones');
        }
        return r.json();
    },
    async saveUserSettings(settings) {
        const r = await fetch('/api/user/settings', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(settings)
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al guardar configuraciones');
        return body;
    },
    async getOrgSetting(key) {
        const r = await fetch(`/api/org/settings/${key}`);
        if (!r.ok) return { value: null };
        return r.json();
    },
    async saveOrgSetting(key, value) {
        const r = await fetch(`/api/org/settings/${key}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ value })
        });
        return r.json();
    },

    // ── Remedy ────────────────────────────────────────────────────────────────
    async remedyLogin(username, password) {
        const r = await fetch('/api/remedy/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password })
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || 'Autenticación en Remedy falló');
        }
        return r.json();
    },
    async remedyLogout() {
        const r = await fetch('/api/remedy/logout', { method: 'POST' });
        return r.json();
    },
    async remedyStatus() {
        const r = await fetch('/api/remedy/status');
        if (!r.ok) return { connected: false };
        return r.json();
    },
    async listRemedyTickets() {
        // Usa _remedyFetch: si el token expiró, dispara 'remedy:session-expired'
        const r = await _remedyFetch('/api/remedy/tickets');
        if (!r) return [];  // token expirado → evento ya disparado
        if (!r.ok) throw new Error('Remedy query failed');
        return r.json();
    },
    async listAssignedRemedyTickets() {
        const r = await _remedyFetch('/api/remedy/tickets/assigned');
        if (!r) return [];
        if (!r.ok) throw new Error('Remedy query assigned failed');
        return r.json();
    },
    async takeRemedyTicket(ticketId, ticketType, assigneeName, assigneeUsername) {
        const r = await _remedyFetch(`/api/remedy/tickets/${ticketId}/take`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ type: ticketType, assigneeName, assigneeUsername })
        });
        if (!r) return null;
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al tomar ticket en Remedy');
        return body;
    },
    async changeRemedyStatus(ticketId, ticketType, status, resolutionNote, file) {
        const options = { method: 'PUT' };
        
        if (file) {
            const fd = new FormData();
            fd.append('type', ticketType);
            fd.append('status', status);
            fd.append('resolutionNote', resolutionNote || '');
            fd.append('file', file);
            options.body = fd;
            // No seteamos Content-Type para FormData; el navegador inyecta automáticamente el multipart boundary.
        } else {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify({ type: ticketType, status, resolutionNote: resolutionNote || '' });
        }

        const r = await _remedyFetch(`/api/remedy/tickets/${ticketId}/status`, options);
        if (!r) return null;
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al cambiar estado en Remedy');
        return body;
    },
    async addRemedyComment(ticketId, ticketType, comment) {
        const r = await _remedyFetch(`/api/remedy/tickets/${ticketId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: ticketType, comment })
        });
        if (!r) return null;
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al agregar comentario en Remedy');
        return body;
    },
    async createRemedyTicket(ticketType, payload) {
        const r = await _remedyFetch(`/api/remedy/tickets/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: ticketType, ...payload })
        });
        if (!r) return null;
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al crear ticket en Remedy');
        return body;
    },
    async listMyRemedyTickets(statusFilter, query = '') {
        const url = `/api/remedy/my-tickets?status=${statusFilter || 'open'}` + (query ? `&q=${encodeURIComponent(query)}` : '');
        const r = await _remedyFetch(url);
        if (!r) return [];
        const body = await r.json().catch(() => ([]));
        if (!r.ok) throw new Error(body.error || 'Error al obtener mis tickets');
        return body;
    },
    async importClosedHistory(days = 60, group = false) {
        const r = await _remedyFetch('/api/remedy/import-closed', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ days, group })
        });
        if (!r) return { imported: 0, total: 0 };
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al importar historial');
        return body;
    },


    // ── Cases ─────────────────────────────────────────────────────────────────
    async list(allCases = false) {
        const r = await fetch('/api/cases' + (allCases ? '?all=true' : ''));
        if (!r.ok) throw new Error('Fetch failed');
        return r.json();
    },
    async update(id, data) {
        const r = await fetch(`/api/cases/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
        if (!r.ok) throw new Error('Update failed');
        return r.json();
    },
    async remove(id) {
        const r = await fetch(`/api/cases/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error('Delete failed');
        return r.json();
    },
    async addEvent(id, text) {
        const r = await fetch(`/api/cases/${id}/event`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({text}) });
        if (!r.ok) throw new Error('Event failed');
        return r.json();
    },
    async listAttachments(caseId) {
        const r = await fetch(`/api/cases/${caseId}/attachments`);
        if (!r.ok) return [];
        return r.json();
    },
    async uploadAttachment(caseId, file, kind) {
        const fd = new FormData();
        fd.append('file', file);
        if (kind) fd.append('kind', kind);
        const r = await fetch(`/api/cases/${caseId}/attachments`, { method: 'POST', body: fd });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al subir adjunto');
        return body;
    },
    async deleteAttachment(attachmentId) {
        const r = await fetch(`/api/attachments/${attachmentId}`, { method: 'DELETE' });
        if (!r.ok) throw new Error('Delete failed');
        return r.json();
    },
    attachmentFileUrl(attachmentId, inline) {
        return `/api/attachments/${attachmentId}/file${inline ? '?inline=1' : ''}`;
    },
    // Lookup de email contra el GAL de Outlook (PowerShell COM). Persiste
    // en c.email si encuentra match. Si Outlook no esta disponible (server
    // sin cliente), el endpoint devuelve email:null sin tirar 500 — no
    // bloquea ni tira excepcion. Pensado para autollenar el campo "Email
    // que retira" del template cuando el case no tiene email cacheado.
    // Reconcilia cases locales con el estado actual de Remedy. Endpoint
    // backend pide los tickets cerrados del operador en Remedy y marca como
    // done todos los cases del org cuya WO matchee. Para detectar cierres
    // hechos manualmente en Remedy sin que el tracker se entere.
    async reconcileRemedyCases() {
        const r = await _remedyFetch('/api/remedy/reconcile-cases', { method: 'POST' });
        if (!r) return null;
        if (!r.ok) return null;
        return r.json().catch(() => null);
    },
    async lookupUserEmailForCase(caseId) {
        const r = await fetch(`/api/users/lookup/${caseId}`, { method: 'POST' });
        if (!r.ok) return null;
        return r.json().catch(() => null);
    },
    async closeRemedyFromCase(caseId, resolutionNote) {
        const r = await _remedyFetch(`/api/cases/${caseId}/remedy-close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolutionNote: resolutionNote || '' }),
        });
        if (!r) return null;
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al cerrar en Remedy');
        return body;
    },
    async listOrgUsers() {
        const r = await fetch('/api/users/org');
        if (!r.ok) throw new Error('Error listando técnicos');
        return r.json();
    },
    async transferCase(caseId, targetUserId) {
        const r = await fetch(`/api/cases/${caseId}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_user_id: targetUserId })
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al transferir');
        return body;
    },
    async getTicketComments(tid) {
        const r = await _remedyFetch(`/api/remedy/tickets/${encodeURIComponent(tid)}/comments`);
        if (!r) return [];
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al obtener comentarios');
        return body;
    },
    async getAdminStats(params = {}) {
        const q = new URLSearchParams(params).toString();
        const r = await fetch(`/api/admin/stats/data?${q}`);
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al cargar estadísticas');
        return body;
    },
    async startAdminStatsSync(options = {}) {
        const r = await fetch('/api/admin/stats/sync/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options)
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al iniciar sincronización');
        return body;
    },
    async getAdminStatsSyncStatus() {
        const r = await fetch('/api/admin/stats/sync/status');
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al consultar estado de sincronización');
        return body;
    },
    async cancelAdminStatsSync() {
        const r = await fetch('/api/admin/stats/sync/cancel', { method: 'POST' });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al cancelar sincronización');
        return body;
    },
    async clearAdminStats() {
        const r = await fetch('/api/admin/stats/clear', { method: 'POST' });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al limpiar datos');
        return body;
    },
    async resolveAdminStatsGal() {
        const r = await fetch('/api/admin/stats/resolve-gal', { method: 'POST' });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al resolver con Outlook GAL');
        return body;
    },
    async getAdminStatsReport(params = {}) {
        const q = new URLSearchParams(params).toString();
        const r = await fetch(`/api/admin/stats/report?${q}`);
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Error al generar reporte de empresa');
        return body;
    }
};

function formatErrorMessage(errStr) {
    if (!errStr) return 'Error desconocido';
    if (typeof errStr !== 'string') return String(errStr);
    
    try {
        let cleanStr = errStr;
        let prefix = "";
        if (errStr.includes("HTTP ") && errStr.includes(":")) {
            const parts = errStr.split(":", 2);
            prefix = parts[0].trim() + ": ";
            cleanStr = parts[1].trim();
        }
        const data = JSON.parse(cleanStr);
        if (Array.isArray(data)) {
            const msgs = data.map(item => {
                let msg = item.messageText || '';
                if (item.messageAppendedText) {
                    msg += ` (${item.messageAppendedText})`;
                }
                return msg;
            }).filter(Boolean);
            if (msgs.length > 0) {
                return prefix + msgs.join(" | ");
            }
        } else if (data && typeof data === 'object') {
            const msg = data.messageText || data.error || data.message;
            if (msg) return prefix + msg;
        }
    } catch (e) {
        // Not a JSON string or parsing failed
    }
    return errStr;
}

// Wrap all API functions to automatically format their thrown errors
for (const key of Object.keys(API)) {
    if (typeof API[key] === 'function' && key !== 'attachmentFileUrl') {
        const originalFunc = API[key];
        API[key] = async function(...args) {
            try {
                return await originalFunc.apply(this, args);
            } catch (err) {
                if (err && err.message) {
                    err.message = formatErrorMessage(err.message);
                }
                throw err;
            }
        };
    }
}

export { API };
window.API = API;




// Expose to window for global module compatibility
window._remedyFetch = _remedyFetch;
window.formatErrorMessage = formatErrorMessage;
