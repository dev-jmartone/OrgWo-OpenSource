// ============================================================
// ES6 MODULE IMPORTS
// ============================================================
import '../core/api_client.js';
import '../core/constants.js';
import '../core/state.js';
import '../core/utils.js';
import '../core/toast.js';

import '../domain/templates/template_registries.js';
import '../domain/templates/message_templates.js';
import '../domain/templates/teams_template.js';
import '../domain/templates/planilla_template.js';
import '../domain/templates/factory.js';

import '../ui/_shared_state.js';

import '../ui/view_switching.js';
import '../ui/vista_hoy.js';
import '../ui/agenda.js';
import '../ui/calendar.js';
import '../ui/vista_lista.js';
import '../ui/drawer.js';
import '../ui/attachments.js';

import '../ui/shortcuts.js';
import '../ui/auth.js';
import '../ui/profile.js';
import '../ui/cartelera/view.js';
import '../ui/cartelera/create_ticket.js';


import '../ui/planilla.js';
import '../ui/notifications.js';
import '../ui/transfer.js';

// ============================================================
// INIT
// ============================================================
async function init() {
    try {
        const authed = await window.checkAuth();
        if (!authed) {
            document.getElementById('loadingOverlay').classList.add('hidden');
            return;
        }
        
        await window.refresh();
        try {
            await window.updateRemedyStatusUI();
        } catch (e) {
            console.error("Error cargando estado de Remedy:", e);
        }
        
        document.getElementById('loadingOverlay').classList.add('hidden');
        if (typeof window.switchView === 'function') window.switchView('list');
        if (typeof window.renderIcons === 'function') window.renderIcons();
        if (typeof window.checkUpcomingDeliveries === 'function') window.checkUpcomingDeliveries();
        initializeSSE();

        // Carga tickets Remedy en background (si la sesion Remedy esta
        // activa) y dispara backfill de emails cuando termine. Asi
        // myOpenTickets/remedyTickets ya estan poblados cuando llamamos
        // al backend con los clientName.
        if (window.remedyConnected && typeof window.loadRemedyTickets === 'function') {
            window.loadRemedyTickets()
                .then(() => _hoyBackfillEmails())
                .catch(err => console.warn('remedy load + backfill fallo:', err));
        } else {
            // Sin Remedy: igual hace seed/backfill local solo.
            _hoyBackfillEmails();
        }
    } catch(err) {
        document.getElementById('loadingOverlay').innerHTML = `
            <div style="text-align:center; padding: 2rem;">
                <div style="font-size: 1.4rem; margin-bottom: 1rem; color: var(--danger); font-weight: 600;">Sin conexión</div>
                <h2 style="margin-bottom: 0.5rem;">No puedo conectar con el servidor</h2>
                <p style="color: var(--text-muted); max-width: 400px;">
                    Verificá que el servidor (<code>iniciar_prod.bat</code>) esté corriendo y refrescá la página.
                </p>
            </div>
        `;
    }

    // Local-only checks timer (runs purely in memory, zero network requests)
    setInterval(() => {
        try {
            if (window.currentUser) {
                if (typeof window.checkUpcomingDeliveries === 'function') window.checkUpcomingDeliveries();
                if (typeof window.checkAndNotifySnoozes === 'function') {
                    window.checkAndNotifySnoozes(window.cases);
                }
            }
        } catch(e) {}
    }, 60000);
}

// Client-side EventSource to handle dynamic pushes from Flask backend
function initializeSSE() {
    if (window.AppEventSource) {
        window.AppEventSource.close();
    }
    const source = new EventSource("/api/stream");
    window.AppEventSource = source;

    source.addEventListener("cases_updated", async () => {
        console.log("[SSE] Petición de refresco recibida desde el servidor.");
        try {
            await window.refresh();
            if (typeof window.renderList === 'function') window.renderList();
            if (typeof window.checkAndNotifySnoozes === 'function') {
                window.checkAndNotifySnoozes(window.cases);
            }
            if (typeof window.checkUpcomingDeliveries === 'function') window.checkUpcomingDeliveries();
        } catch (e) {
            console.error("[SSE] Error al procesar evento de actualización de casos:", e);
        }
    });

    source.addEventListener("tech_status_updated", async () => {
        console.log("[SSE] Estado de técnicos actualizado en el servidor.");
        try {
            if (typeof window.loadSelfAvailability === 'function') {
                await window.loadSelfAvailability();
            }
            const viewDisp = document.getElementById('view-dispatcher');
            if (viewDisp && viewDisp.classList.contains('active')) {
                if (typeof window.loadDispatcherDashboard === 'function') {
                    window.loadDispatcherDashboard(true);
                }
            }
        } catch (e) {
            console.error("[SSE] Error al procesar evento de estado de técnicos:", e);
        }
    });

    source.addEventListener("connected", () => {
        console.log("[SSE] Conectado al canal de eventos en vivo.");
    });

    source.onerror = (err) => {
        console.warn("[SSE] Error en canal de eventos, reconectando automáticamente...", err);
    };
}

// Backfill de emails para Remedy tickets live + cases locales sin email.
// Recolecta nombres de myOpenTickets/remedyTickets que no tienen email
// cacheado, manda al backend, aplica resultado en memoria + refresh.
async function _hoyBackfillEmails() {
    // Solo tickets abiertos + cartelera sin asignar. Excluye cerrados
    // (no necesitamos resolver mails para tickets ya resueltos — ahorra
    // recursos del Outlook GAL y del backend).
    const collect = arr => Array.isArray(arr) ? arr : [];
    const all = [
        ...collect(window.myOpenTickets),
        ...collect(window.remedyTickets),
    ];
    
    // Extraer solo nombres de tickets que NO tienen email resuelto
    const names = [...new Set(
        all.filter(t => !t.email)
           .map(t => (t.clientName || t.name || '').trim())
           .filter(Boolean)
    )];

    if (names.length === 0) return;

    try {
        const res = await fetch('/api/users/directory/backfill', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ names }),
        });
        const body = await res.json();
        console.log('[users_directory backfill]', body);

        // Aplicar emails resueltos a los tickets en memoria.
        const resolved = body?.resolved || {};
        let applied = 0;
        for (const t of all) {
            const n = (t.clientName || t.name || '').trim();
            if (!n) continue;
            const hit = resolved[n];
            if (hit && hit.email && !t.email) {
                t.email = hit.email;
                if (!t.company && hit.company) t.company = hit.company;
                applied++;
            }
        }

        const total = (body?.stats?.found || 0) + applied;
        if (total > 0) {
            if (typeof window.toast === 'function') window.toast(`Directorio: ${total} email(s) resueltos`, 'success');
            if (typeof refresh === 'function') refresh();
            if (typeof refreshCurrentView === 'function') refreshCurrentView();
        }
    } catch (err) {
        console.warn('backfill fallo:', err);
    }
}
window._hoyBackfillEmails = _hoyBackfillEmails;

init();
