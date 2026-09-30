// ============================================================
// AGENDA — Sistema de snooze y alertas por fecha
// ============================================================
// Funciones para posponer tickets con recordatorio y disparar
// notificaciones del navegador cuando el snooze vence o se acerca.
//
// Dependencias: API (api_client.js), refresh(), renderKanban(),
//               toast(), formatDate(), cases[] (state.js)
// ============================================================

// ── Snooze ────────────────────────────────────────────────────────────────────

/**
 * Pospone un ticket: guarda snooze_until, registra evento, refresca UI.
 * @param {string} caseId
 * @param {string} untilDateISO  — formato YYYY-MM-DD o ISO completo
 * @param {string} reason        — motivo de posposición (se guarda en notas)
 */
async function snoozeCase(caseId, untilDateISO, reason) {
    if (!caseId || !untilDateISO) return;
    try {
        const payload = {
            snoozeUntil: untilDateISO,
            logEvent: `Pospuesto hasta: ${formatDate(untilDateISO)}${reason ? ` — Motivo: ${reason}` : ''}`,
        };
        if (reason) {
            payload.notes = reason;
        }
        await API.update(caseId, payload);
        toast(`Caso pospuesto hasta ${formatDate(untilDateISO)}`, 'success');
        await refresh();
        if (typeof renderKanban === 'function') renderKanban();
        if (typeof renderToday === 'function') renderToday();
    } catch (e) {
        toast('Error al posponer caso', 'error');
    }
}

/**
 * Levanta el snooze de un ticket manualmente.
 * @param {string} caseId
 * @param {string} logText       — texto opcional para el log de eventos
 */
async function clearSnoozeCase(caseId, logText = 'Snooze levantado manualmente') {
    if (!caseId) return;
    try {
        await API.update(caseId, {
            snoozeUntil: null,
            logEvent: logText,
        });
        // Actualizar UI del drawer si está abierto para el mismo caso
        const fldSnooze = document.getElementById('fldSnooze');
        if (fldSnooze) fldSnooze.value = '';
        const btnClear = document.getElementById('btnClearSnooze');
        if (btnClear) btnClear.style.display = 'none';
        await refresh();
        if (typeof renderKanban === 'function') renderKanban();
        if (typeof renderToday === 'function') renderToday();
    } catch (e) {
        console.error('Error al eliminar recordatorio:', e);
    }
}

// ── Helpers de clasificación ──────────────────────────────────────────────────

function getPersistentSnoozeAlerts() {
    try {
        return JSON.parse(localStorage.getItem('recambios_snooze_alerts') || '[]');
    } catch(e) {
        return [];
    }
}

function savePersistentSnoozeAlerts(alerts) {
    localStorage.setItem('recambios_snooze_alerts', JSON.stringify(alerts));
}

window.dismissSnoozeAlert = function(alertKey) {
    let alerts = getPersistentSnoozeAlerts();
    alerts = alerts.map(a => a.key === alertKey ? { ...a, dismissed: true } : a);
    savePersistentSnoozeAlerts(alerts);
    if (typeof window.checkUpcomingDeliveries === 'function') {
        window.checkUpcomingDeliveries();
    }
};

/**
 * Casos cuya fecha de retiro ya pasó (el recordatorio "venció" — deben atenderse).
 */
/**
 * Casos cuya fecha de retiro ya pasó (el recordatorio "venció" — deben atenderse).
 */
function getExpiredSnoozes(caseList) {
    const now = Date.now();
    return (caseList || []).filter(c => {
        if (!c.fechaRetiro) return false;
        const targetTime = c.fechaRetiro.length === 10
            ? new Date(c.fechaRetiro + 'T00:00:00').getTime()
            : new Date(c.fechaRetiro).getTime();
        return !isNaN(targetTime) && targetTime <= now;
    });
}

// ── Notificaciones del navegador + Auto Wakeup ──────────────────────────────────────

/**
 * Revisa la lista de casos y dispara notificaciones push del navegador
 * para los retiros vencidos o próximos a vencer (30 min).
 * Registra las alertas en localStorage de forma persistente.
 */
async function checkAndNotifySnoozes(caseList) {
    const now = Date.now();
    let alerts = getPersistentSnoozeAlerts();
    let changed = false;

    for (const c of caseList) {
        if (!c.fechaRetiro) continue;

        // Excluir casos ya resueltos de las alarmas activas
        const isResolved = ['done', 'reject', 'not_accepted'].includes(c.estado);

        // Obtener el timestamp de la fecha de retiro
        let targetTime;
        if (c.fechaRetiro.length === 10) {
            // Formato antiguo de solo fecha: asumimos el inicio del día
            targetTime = new Date(c.fechaRetiro + 'T00:00:00').getTime();
        } else {
            targetTime = new Date(c.fechaRetiro).getTime();
        }

        if (isNaN(targetTime)) continue;

        // Si el caso está resuelto o su nueva fecha programada está en el futuro,
        // removemos las alarmas previas vencidas asociadas a este caso.
        if (isResolved || targetTime > now) {
            const originalLength = alerts.length;
            alerts = alerts.filter(a => a.caseId !== c.id);
            if (alerts.length !== originalLength) {
                changed = true;
            }
            continue;
        }

        // Si ya pasó la fecha/hora programada y no está resuelto
        if (targetTime <= now) {
            const alertKey = `expired_${c.id}_${c.fechaRetiro}`;
            if (!alerts.some(a => a.key === alertKey)) {
                alerts.push({
                    key: alertKey,
                    caseId: c.id,
                    wo: c.wo || '',
                    name: c.name || 'Sin nombre',
                    type: 'expired',
                    time: c.fechaRetiro,
                    dismissed: false
                });
                changed = true;

                // Notificación push nativa con requireInteraction para mayor persistencia
                if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                    try {
                        new Notification('OrgWo — Alarma de Retiro Programado', {
                            body: `${c.name || 'Ticket'} — ${c.tipificacion || c.wo || 'Sin tipificación'}\nSe ha cumplido la fecha/hora de retiro programada.`,
                            icon: '/favicon.ico',
                            tag: `expired-${c.id}`,
                            requireInteraction: true
                        });
                    } catch (e) {}
                }
                
                // Reproducir un sonido de alerta de forma nativa (beep sutil)
                try {
                    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator = audioCtx.createOscillator();
                    const gainNode = audioCtx.createGain();
                    oscillator.connect(gainNode);
                    gainNode.connect(audioCtx.destination);
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // La5
                    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
                    oscillator.start();
                    oscillator.stop(audioCtx.currentTime + 0.15); // 150ms duration
                } catch (soundErr) {}

                toast(`Alarma de retiro activada: ${c.wo || c.name}`, 'info');
            }
        }
    }

    if (changed) {
        savePersistentSnoozeAlerts(alerts);
        if (typeof window.checkUpcomingDeliveries === 'function') {
            window.checkUpcomingDeliveries();
        }
    }
}

// ── Controladores del Modal de Snooze (Vanilla JS) ──────────────────────────────────

let activeSnoozeCaseId = null;

window.openSnoozeModal = function(caseId) {
    activeSnoozeCaseId = caseId;
    
    // Configura valores por defecto (hoy a las 09:00)
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('snoozeDate').value = today;
    document.getElementById('snoozeTime').value = "09:00";
    document.getElementById('snoozeReason').value = "";
    
    document.getElementById('snoozeModal').classList.add('open');
};

window.closeSnoozeModal = function() {
    document.getElementById('snoozeModal').classList.remove('open');
    activeSnoozeCaseId = null;
};

window.setQuickSnooze = function(hours) {
    const target = new Date();
    target.setHours(target.getHours() + hours);
    
    const dateStr = target.toISOString().split('T')[0];
    const timeStr = target.toTimeString().slice(0, 5);
    
    document.getElementById('snoozeDate').value = dateStr;
    document.getElementById('snoozeTime').value = timeStr;
};

window.submitSnoozeForm = async function() {
    const dateVal = document.getElementById('snoozeDate').value;
    const timeVal = document.getElementById('snoozeTime').value;
    const reasonVal = document.getElementById('snoozeReason').value.trim();
    
    if (!dateVal || !timeVal || !activeSnoozeCaseId) {
        toast('Por favor, selecciona fecha y hora', 'error');
        return;
    }
    
    const isoStr = new Date(`${dateVal}T${timeVal}`).toISOString();
    const confirmBtn = document.getElementById('snoozeModalConfirm');
    
    confirmBtn.disabled = true;
    try {
        await snoozeCase(activeSnoozeCaseId, isoStr, reasonVal);
        closeSnoozeModal();
    } catch (e) {
        console.error(e);
    } finally {
        confirmBtn.disabled = false;
    }
};

// Inicialización de Listeners
function initSnoozeListeners() {
    const closeBtn = document.getElementById('snoozeModalClose');
    const cancelBtn = document.getElementById('snoozeModalCancel');
    const confirmBtn = document.getElementById('snoozeModalConfirm');
    
    if (closeBtn) closeBtn.addEventListener('click', closeSnoozeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeSnoozeModal);
    if (confirmBtn) confirmBtn.addEventListener('click', submitSnoozeForm);
    
    // Botón "X" para limpiar snooze desde el drawer
    const btnClearSnooze = document.getElementById('btnClearSnooze');
    if (btnClearSnooze) {
        btnClearSnooze.addEventListener('click', async () => {
            if (typeof currentCaseId !== 'undefined' && currentCaseId) {
                await clearSnoozeCase(currentCaseId);
                toast('Recordatorio eliminado', 'success');
            }
        });
    }
}

// Ejecución inmediata
initSnoozeListeners();


// Expose to window for global module compatibility
window.snoozeCase = snoozeCase;
window.clearSnoozeCase = clearSnoozeCase;
window.getPersistentSnoozeAlerts = getPersistentSnoozeAlerts;
window.savePersistentSnoozeAlerts = savePersistentSnoozeAlerts;
window.getExpiredSnoozes = getExpiredSnoozes;
window.checkAndNotifySnoozes = checkAndNotifySnoozes;
window.initSnoozeListeners = initSnoozeListeners;
