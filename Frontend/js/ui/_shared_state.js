// ============================================================
// SHARED STATE — Globales compartidos en el objeto window (ES6 Module)
// ============================================================

window.currentUser = null;
window.remedyTickets = [];
window.myOpenTickets = [];
window.myClosedTickets = [];
window.allAssignedTickets = [];
window.currentRemedyFilter = 'INC';
window.remedyConnected = false;
window.remedyEnv = 'QA';
window._resolveCtx = null;

// Exportar interfaz ES6 para compatibilidad con módulos reales
export const sharedState = {
    get currentUser() { return window.currentUser; },
    set currentUser(val) { window.currentUser = val; },
    get remedyTickets() { return window.remedyTickets; },
    set remedyTickets(val) { window.remedyTickets = val; },
    get myOpenTickets() { return window.myOpenTickets; },
    set myOpenTickets(val) { window.myOpenTickets = val; },
    get myClosedTickets() { return window.myClosedTickets; },
    set myClosedTickets(val) { window.myClosedTickets = val; },
    get allAssignedTickets() { return window.allAssignedTickets; },
    set allAssignedTickets(val) { window.allAssignedTickets = val; },
    get currentRemedyFilter() { return window.currentRemedyFilter; },
    set currentRemedyFilter(val) { window.currentRemedyFilter = val; },
    get remedyConnected() { return window.remedyConnected; },
    set remedyConnected(val) { window.remedyConnected = val; },
    get remedyEnv() { return window.remedyEnv; },
    set remedyEnv(val) { window.remedyEnv = val; },
    get _resolveCtx() { return window._resolveCtx; },
    set _resolveCtx(val) { window._resolveCtx = val; }
};
