// ============================================================
// NOTIFICATIONS — entregas hoy/manana + recordatorios pospuestos.
// Extraido de system_enhancements.js (refactor fase 2).
// ============================================================

// Centro de notificaciones de entregas para hoy y mañana
// Centro de notificaciones de entregas para hoy y mañana + Recordatorios pospuestos
function checkUpcomingDeliveries() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomStr = tomorrow.toISOString().slice(0, 10);
    
    // 1. Deliveries list: Alerta si es pasado (atrasado), hoy o mañana, hasta que esté resuelto.
    const listos = window.cases.filter(c => {
        if (!c.fechaRetiro) return false;
        const fr = c.fechaRetiro.slice(0, 10);
        
        // Excluir casos ya resueltos
        const isResolved = ['done', 'reject', 'not_accepted'].includes(c.estado);
        if (isResolved) return false;
        
        // Alertar si está en fecha programada (pasado/hoy) o próximo (mañana)
        return fr <= tomStr;
    });

    // Ordenar de forma que los más atrasados (antiguos) aparezcan primero
    listos.sort((a, b) => a.fechaRetiro.localeCompare(b.fechaRetiro));
    
    // 2. Active Snooze Alerts (not dismissed)
    let snoozeAlerts = [];
    try {
        snoozeAlerts = JSON.parse(localStorage.getItem('recambios_snooze_alerts') || '[]')
            .filter(a => !a.dismissed);
    } catch(e) {}

    const totalCount = listos.length + snoozeAlerts.length;
    const badge = document.getElementById('notificationBadge');
    const container = document.getElementById('notificationList');
    
    if (totalCount > 0) {
        badge.textContent = totalCount;
        badge.style.display = 'flex';
        
        // Render Deliveries
        let html = listos.map(c => {
            const frStr = c.fechaRetiro.slice(0, 10);
            const isToday = frStr === todayStr;
            const isTomorrow = frStr === tomStr;
            const isPast = frStr < todayStr;
            
            let dayLabel = '';
            let color = '';
            if (isPast) {
                dayLabel = 'Atrasado';
                color = 'var(--danger)';
            } else if (isToday) {
                dayLabel = 'Hoy';
                color = 'var(--danger)';
            } else if (isTomorrow) {
                dayLabel = 'Mañana';
                color = 'var(--warn)';
            } else {
                dayLabel = 'Próximo';
                color = 'var(--primary)';
            }
            
            let timeFormatted = '—';
            try {
                if (typeof window.formatRetiroShort === 'function') {
                    timeFormatted = window.formatRetiroShort(c.fechaRetiro);
                } else {
                    timeFormatted = frStr;
                }
            } catch(e) {}

            const tipoLabel = (typeof window.tipoInfo === 'function' && window.tipoInfo(c.tipo)?.label) || c.tipo || '—';
            
            return `
                <div class="notif-item" style="border-left: 3px solid ${color};" onclick="openCase('${c.id}'); document.getElementById('notificationDropdown').classList.remove('open');">
                    <div class="notif-title" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>${window.escapeHtml(c.name)}</span>
                        <span style="font-size:10px; font-weight:700; color:${color}; text-transform:uppercase;">${dayLabel}</span>
                    </div>
                    <div class="notif-desc" style="margin-top: 4px;">
                        ${window.escapeHtml(c.company)} · ${window.escapeHtml(tipoLabel)}
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                            Fecha agendada: ${window.escapeHtml(timeFormatted)}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Render Snooze Alerts
        html += snoozeAlerts.map(alert => {
            const isExpired = alert.type === 'expired';
            const label = isExpired ? 'Vencido' : 'Cercano';
            const color = isExpired ? 'var(--danger)' : '#E3A008';
            
            let timeFormatted = '—';
            try {
                if (typeof window.formatRetiroShort === 'function') {
                    timeFormatted = window.formatRetiroShort(alert.time);
                } else {
                    timeFormatted = alert.time.slice(0, 10);
                }
            } catch(e) {}
            
            return `
                <div class="notif-item" style="border-left: 3px solid ${color};" onclick="openCase('${alert.caseId}'); document.getElementById('notificationDropdown').classList.remove('open');">
                    <div class="notif-title" style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 600;">${window.escapeHtml(alert.wo || alert.name)}</span>
                        <span style="font-size:10px; font-weight:700; color:${color}; text-transform:uppercase;">${label}</span>
                    </div>
                    <div class="notif-desc" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 4px;">
                        <span style="font-size: 11.5px; color: var(--text-muted);">Retiro coordinado: ${timeFormatted} · ${window.escapeHtml(alert.name)}</span>
                        <button type="button" class="btn btn-ghost" onclick="event.stopPropagation(); window.dismissSnoozeAlert('${alert.key}');" style="padding: 2px 6px; font-size: 10px; height: auto; min-height: 18px; border-color: var(--border); color: var(--text-muted); cursor: pointer;" title="Descartar recordatorio">
                            Descartar
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
        
        // Native desktop push
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && window.lastNotifCount !== totalCount) {
            new Notification("OrgWo Tracker", {
                body: `Tenés ${totalCount} notificación(es) pendiente(s).`,
                icon: "/favicon.ico"
            });
            window.lastNotifCount = totalCount;
        }
    } else {
        badge.style.display = 'none';
        container.innerHTML = `<div style="padding: 16px; color: var(--text-muted); text-align: center; font-size: 12px;">Sin notificaciones pendientes</div>`;
    }
}


// Expose to window for global module compatibility
window.checkUpcomingDeliveries = checkUpcomingDeliveries;
