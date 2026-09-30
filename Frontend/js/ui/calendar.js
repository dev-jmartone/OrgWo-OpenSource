// ============================================================
// CALENDARIO — Vista visual de retiros programados (FullCalendar)
// ============================================================
// Layout dividido: calendario mensual (70%) + panel lateral (30%).
// Las celdas muestran solo indicadores compactos (dots + contador).
// Al clickear un día, el panel lateral muestra la lista detallada
// con buscador integrado. Drag & drop sigue funcionando.
// Fuente de datos: /api/cases
// ============================================================

let calendarInstance = null;
let _allEvents = [];          // cache global de eventos del mes visible
let _selectedDate = null;     // fecha ISO "YYYY-MM-DD" seleccionada actualmente

// ─── Estilos FullCalendar + panel lateral ────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
    .fc {
        font-family: inherit;
        background: var(--surface);
        color: var(--text);
    }
    .fc .fc-toolbar {
        margin-bottom: 12px !important;
        flex-wrap: wrap;
        gap: 8px;
    }
    .fc .fc-toolbar-title {
        font-size: 15px !important;
        font-weight: 700;
        color: var(--text);
    }
    .fc .fc-button-primary {
        background-color: var(--surface-2) !important;
        border-color: var(--border) !important;
        color: var(--text) !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        text-transform: capitalize;
        padding: 6px 12px !important;
        box-shadow: none !important;
        border-radius: var(--radius) !important;
    }
    .fc .fc-button-primary:hover {
        background-color: var(--surface-3) !important;
        border-color: var(--border-soft) !important;
    }
    .fc .fc-button-primary:disabled {
        background-color: var(--surface) !important;
        color: var(--text-faint) !important;
        border-color: var(--border) !important;
        opacity: 0.5;
    }
    .fc .fc-button-primary:not(:disabled).fc-button-active {
        background-color: var(--primary) !important;
        border-color: var(--primary) !important;
        color: #ffffff !important;
    }
    .fc td, .fc th {
        border-color: var(--border) !important;
    }
    .fc-theme-standard .fc-scrollgrid {
        border-color: var(--border) !important;
    }
    .fc .fc-col-header-cell-cushion {
        font-size: 11.5px;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--text-muted);
        padding: 8px 4px;
        display: block;
        text-decoration: none !important;
    }
    .fc .fc-daygrid-day-number {
        font-size: 12px;
        font-weight: 700;
        color: var(--text-muted);
        padding: 6px;
        text-decoration: none !important;
    }
    .fc .fc-day-today {
        background-color: rgba(0, 120, 212, 0.06) !important;
    }
    /* Día seleccionado en el calendario */
    .fc .fc-day.fc-cal-day-selected {
        background-color: rgba(0, 120, 212, 0.10) !important;
    }
    .fc .fc-day.fc-cal-day-selected .fc-daygrid-day-number {
        color: var(--primary) !important;
    }

    /* Eventos compactos: solo dots, sin texto largo */
    .fc-event {
        cursor: pointer;
        border-radius: var(--radius-sm) !important;
        padding: 1px 4px !important;
        font-size: 0 !important;        /* oculta el texto nativo */
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        pointer-events: none;           /* el click lo captura fc-day */
    }
    /* Ocultar los eventos nativos — la celda solo muestra el badge contador */
    .fc .fc-daygrid-event-harness {
        height: 0 !important;
        overflow: hidden !important;
        margin: 0 !important;
    }
    .fc .fc-daygrid-event {
        visibility: hidden !important;
    }
    /* Badge contador inyectado por dayCellDidMount */
    .cal-day-counter {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 2px 4px 5px;
        pointer-events: none;
    }
    .cal-day-counter-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.4;
        pointer-events: none;
    }
    .cal-day-counter-chip.active {
        background: rgba(0, 120, 212, 0.15);
        color: #0078D4;
    }
    .cal-day-counter-chip.resolved {
        background: rgba(16, 124, 16, 0.12);
        color: #107C10;
    }
    .cal-day-counter-chip.total {
        background: rgba(0, 120, 212, 0.10);
        color: var(--primary);
    }
    /* Lista del panel lateral */
    .cal-panel-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 9px 14px;
        cursor: pointer;
        transition: background 0.15s;
        border-bottom: 1px solid var(--border);
    }
    .cal-panel-item:last-child {
        border-bottom: none;
    }
    .cal-panel-item:hover {
        background: var(--surface-3);
    }
    .cal-panel-item-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
        margin-top: 3px;
    }
    .cal-panel-item-body {
        min-width: 0;
        flex: 1;
    }
    .cal-panel-item-wo {
        font-size: 12.5px;
        font-weight: 700;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .cal-panel-item-client {
        font-size: 11.5px;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 1px;
    }
    .cal-panel-item-meta {
        font-size: 11px;
        color: var(--text-faint);
        margin-top: 2px;
    }
    .cal-panel-item-hora {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted);
        flex-shrink: 0;
        min-width: 36px;
        text-align: right;
    }
    /* Botón abrir caso */
    .cal-panel-item-open {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--primary);
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
    }
    .cal-panel-item-open:hover {
        text-decoration: underline;
    }

    /* Botones agrupados */
    .fc .fc-button-group .fc-button {
        border-radius: 0 !important;
    }
    .fc .fc-button-group .fc-button:first-child {
        border-top-left-radius: var(--radius) !important;
        border-bottom-left-radius: var(--radius) !important;
    }
    .fc .fc-button-group .fc-button:last-child {
        border-top-right-radius: var(--radius) !important;
        border-bottom-right-radius: var(--radius) !important;
    }

    /* Scrollbar del panel */
    #calendarPanelList::-webkit-scrollbar { width: 5px; }
    #calendarPanelList::-webkit-scrollbar-track { background: transparent; }
    #calendarPanelList::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

    /* Buscador focus */
    #calendarPanelSearchInput:focus {
        border-color: var(--primary) !important;
        box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.15);
    }
`;
document.head.appendChild(style);

// ─── Lucide helper ───────────────────────────────────────────────────────────
function lucideIcon(name, size = 12) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="${name}" style="display:inline-block;vertical-align:middle;"></svg>`;
}

/**
 * Carga la libreria FullCalendar v6 desde CDN de forma dinamica.
 */
export async function ensureFullCalendarLoaded() {
    if (window.FullCalendar) {
        return true;
    }
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.error('[FullCalendar] Tiempo de espera agotado al cargar la libreria desde CDN.');
            resolve(false);
        }, 8000);

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js';
        script.onload = () => {
            clearTimeout(timeout);
            resolve(true);
        };
        script.onerror = () => {
            clearTimeout(timeout);
            console.error('[FullCalendar] Error al cargar la libreria.');
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

/**
 * Trae los casos con fecha de retiro en el rango y los mapea a eventos.
 */
async function fetchRetiroEvents(startIso, endIso) {
    let cases = [];
    try {
        const res = await fetch('/api/cases');
        if (res.ok) {
            cases = await res.json();
        }
    } catch (err) {
        console.error('[Calendar] Error al consultar casos:', err);
        if (typeof window.toast === 'function') {
            window.toast('Error al consultar casos', 'error');
        }
        return [];
    }

    const events = [];
    for (const c of cases) {
        const fr = c.fechaRetiro;
        if (!fr) continue;
        const day = String(fr).slice(0, 10);
        if (day < startIso || day > endIso) continue;

        let endStr = fr;
        try {
            const dt = new Date(String(fr).replace(' ', 'T'));
            endStr = new Date(dt.getTime() + 30 * 60 * 1000).toISOString();
        } catch (e) {}

        const isResolved = c.estado === 'done'
            || c.excelStatus === '4' || c.excelStatus === 'Resolved' || c.excelStatus === 'Completed';

        const hm = String(fr).match(/[T ](\d{2}:\d{2})/);
        const hora = hm ? hm[1] : '';

        events.push({
            id: `case_${c.id}`,
            title: `${c.wo || c.id} - ${c.name || 'Sin nombre'}`,
            start: String(fr).slice(0, 10),   // all-day para que la celda no se estire
            allDay: true,
            color: isResolved ? '#107C10' : '#0078D4',
            extendedProps: {
                caseId: c.id,
                wo: c.wo || c.id,
                clientName: c.name || 'Sin nombre',
                tipificacion: c.tipificacion || '',
                hora: hora,
                isResolved,
                dateKey: String(fr).slice(0, 10),
            }
        });
    }
    return events;
}

// ─── Panel lateral ────────────────────────────────────────────────────────────

function _getEventsForDate(dateKey) {
    return _allEvents.filter(ev => ev.extendedProps.dateKey === dateKey);
}

function _formatDateLabel(dateKey) {
    if (!dateKey) return 'Sin fecha';
    const d = new Date(dateKey + 'T00:00:00');
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    const label = d.toLocaleDateString('es-AR', opts);
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function _renderPanelItems(events, filter = '') {
    const list = document.getElementById('calendarPanelList');
    if (!list) return;

    const filtered = filter
        ? events.filter(ev => {
            const q = filter.toLowerCase();
            const p = ev.extendedProps;
            return (p.wo || '').toLowerCase().includes(q)
                || (p.clientName || '').toLowerCase().includes(q)
                || (p.tipificacion || '').toLowerCase().includes(q);
          })
        : events;

    if (!filtered.length) {
        list.innerHTML = `
            <div style="padding: 28px 16px; text-align: center;">
                <p style="font-size: 12px; color: var(--text-faint); margin: 0;">
                    ${filter ? 'Sin coincidencias.' : 'Sin retiros programados para este día.'}
                </p>
            </div>
        `;
        return;
    }

    // Ordenar por hora
    const sorted = [...filtered].sort((a, b) => {
        const ha = a.extendedProps.hora || '00:00';
        const hb = b.extendedProps.hora || '00:00';
        return ha.localeCompare(hb);
    });

    list.innerHTML = sorted.map(ev => {
        const p = ev.extendedProps;
        const color = p.isResolved ? '#107C10' : '#0078D4';
        const statusLabel = p.isResolved
            ? '<span style="font-size:10px;font-weight:700;color:#107C10;">✓ Resuelto</span>'
            : '<span style="font-size:10px;font-weight:700;color:#0078D4;">● Activo</span>';

        return `
            <div class="cal-panel-item" data-case-id="${p.caseId}">
                <span class="cal-panel-item-dot" style="background:${color};"></span>
                <div class="cal-panel-item-body">
                    <div class="cal-panel-item-wo">${p.wo || '—'}</div>
                    <div class="cal-panel-item-client">${p.clientName}</div>
                    <div class="cal-panel-item-meta">
                        ${statusLabel}
                        ${p.tipificacion ? `<span style="color:var(--text-faint)"> · ${p.tipificacion}</span>` : ''}
                    </div>
                    <button class="cal-panel-item-open" data-case-id="${p.caseId}">
                        Abrir caso →
                    </button>
                </div>
                <span class="cal-panel-item-hora">${p.hora || ''}</span>
            </div>
        `;
    }).join('');

    // Clicks: abrir caso
    list.querySelectorAll('.cal-panel-item-open, .cal-panel-item').forEach(el => {
        el.addEventListener('click', (e) => {
            const caseId = e.currentTarget.dataset.caseId;
            if (caseId && typeof window.openCase === 'function') {
                window.openCase(caseId);
            }
        });
    });
}

// ─── Badge contador por celda ─────────────────────────────────────────────────

/**
 * Inyecta (o actualiza) el badge contador en una celda del calendario.
 * Muestra: "N activos" en azul y/o "N resueltos" en verde.
 * Si el día no tiene eventos, no renderiza nada.
 */
function _attachDayCounter(cellEl, dateKey) {
    // Remover badge previo si existe
    const prev = cellEl.querySelector('.cal-day-counter');
    if (prev) prev.remove();

    const eventsForDay = _getEventsForDate(dateKey);
    if (!eventsForDay.length) return;

    const active   = eventsForDay.filter(ev => !ev.extendedProps.isResolved).length;
    const resolved = eventsForDay.filter(ev => ev.extendedProps.isResolved).length;

    const wrapper = document.createElement('div');
    wrapper.className = 'cal-day-counter';

    // Solo activos, solo resueltos, o ambos
    if (active > 0) {
        const chip = document.createElement('span');
        chip.className = 'cal-day-counter-chip active';
        chip.textContent = active === eventsForDay.length
            ? `${active} retiro${active !== 1 ? 's' : ''}`
            : `${active} activo${active !== 1 ? 's' : ''}`;
        wrapper.appendChild(chip);
    }
    if (resolved > 0) {
        const chip = document.createElement('span');
        chip.className = 'cal-day-counter-chip resolved';
        chip.textContent = `${resolved} resuelt${resolved !== 1 ? 'os' : 'o'}`;
        wrapper.appendChild(chip);
    }

    // Insertar después del número del día
    const frame = cellEl.querySelector('.fc-daygrid-day-frame');
    if (frame) {
        frame.appendChild(wrapper);
    } else {
        cellEl.appendChild(wrapper);
    }
}

/** Refresca los badges de todas las celdas visibles del calendario. */
function _refreshAllDayCounters() {
    document.querySelectorAll('.fc-daygrid-day').forEach(cellEl => {
        const dateKey = cellEl.getAttribute('data-date');
        if (dateKey) _attachDayCounter(cellEl, dateKey);
    });
}

function _selectDay(dateKey) {
    _selectedDate = dateKey;
    const events = _getEventsForDate(dateKey);

    // Header del panel
    const dateEl = document.getElementById('calendarPanelDate');
    const countEl = document.getElementById('calendarPanelCount');
    if (dateEl) dateEl.textContent = _formatDateLabel(dateKey);
    if (countEl) countEl.textContent = events.length ? `${events.length} retiro${events.length !== 1 ? 's' : ''}` : '';

    // Buscador: mostrar solo si hay eventos
    const searchBox = document.getElementById('calendarPanelSearch');
    const searchInput = document.getElementById('calendarPanelSearchInput');
    if (searchBox) {
        searchBox.style.display = events.length > 1 ? 'block' : 'none';
    }
    if (searchInput) {
        searchInput.value = '';
    }

    // Renderizar lista
    _renderPanelItems(events);

    // Resaltar día seleccionado en el calendario
    document.querySelectorAll('.fc-day.fc-cal-day-selected').forEach(el => {
        el.classList.remove('fc-cal-day-selected');
    });
    const dayCell = document.querySelector(`.fc-day[data-date="${dateKey}"]`);
    if (dayCell) dayCell.classList.add('fc-cal-day-selected');
}

// ─── Inicialización del calendario ───────────────────────────────────────────

/**
 * Inicializa y renderiza el calendario en el contenedor.
 */
export async function renderCalendar() {
    const container = document.getElementById('fullCalendarContainer');
    if (!container) return;

    const loaded = await ensureFullCalendarLoaded();
    if (!loaded) {
        container.innerHTML = `
            <div style="padding: 24px; text-align: center; color: var(--danger); font-weight: 600;">
                No se pudo cargar el componente de calendario. Verifica tu conexion a internet.
            </div>
        `;
        return;
    }

    if (calendarInstance) {
        calendarInstance.destroy();
    }

    _allEvents = [];
    _selectedDate = null;

    calendarInstance = new window.FullCalendar.Calendar(container, {
        initialView: 'dayGridMonth',
        locale: 'es',
        firstDay: 1,
        height: '100%',
        expandRows: true,

        // Drag & drop: mover evento cambia fecha de retiro (mantiene hora)
        editable: true,
        eventStartEditable: true,
        eventDurationEditable: false,

        buttonText: {
            today: 'Hoy',
            month: 'Mes',
            week: 'Semana',
            day: 'Dia',
            list: 'Agenda'
        },
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth'
        },

        // Limitar eventos visibles en celda → muestra dots compactos
        dayMaxEvents: false,      // desactivado: eventContent lo maneja
        displayEventTime: false,

        events: async function(info, successCallback, failureCallback) {
            const startIso = info.startStr.split('T')[0];
            const endIso   = info.endStr.split('T')[0];
            try {
                const evs = await fetchRetiroEvents(startIso, endIso);
                _allEvents = evs;
                successCallback(evs);

                // Refrescar badges y panel después de que FC monte las celdas
                requestAnimationFrame(() => {
                    _refreshAllDayCounters();
                    if (_selectedDate) {
                        _selectDay(_selectedDate);
                    }
                });
            } catch (err) {
                failureCallback(err);
            }
        },

        // Los eventos se ocultan via CSS; el badge se inyecta en dayCellDidMount
        eventContent: function() {
            return { domNodes: [] };
        },

        // Inyectar badge contador en la celda después de renderizar
        dayCellDidMount: function(info) {
            const dateKey = info.date.toISOString().slice(0, 10);
            _attachDayCounter(info.el, dateKey);
        },

        // Click en un día → abrir panel lateral
        dateClick: function(info) {
            _selectDay(info.dateStr);
        },

        // Click en el número del día → también selecciona
        navLinks: false,

        // Drag & drop: actualiza la fecha de retiro al nuevo día
        eventDrop: async function(info) {
            const caseId = info.event.extendedProps.caseId;
            const d = info.event.start;
            if (!caseId || !d) { info.revert(); return; }

            const pad = n => String(n).padStart(2, '0');
            const hora = info.event.extendedProps.hora || '09:00';
            const nuevaFecha = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hora}:00`;

            // Auto-agrupación por fecha programada al mover en el calendario
            const groupLabel = `Programados para el dia ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
            let autoGroupMoved = false;

            if (typeof window.loadListGroupingConfig === 'function') {
                await window.loadListGroupingConfig();
            }

            const existingGroup = window.listGroups ? window.listGroups.find(g => g.label === groupLabel) : null;
            if (existingGroup) {
                const confirmed = await Swal.fire({
                    title: `¿Mover al grupo existente?`,
                    text: `Detectamos el cambio de fecha. ¿Querés mover este ticket al grupo "${groupLabel}"?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, mover',
                    cancelButtonText: 'No, dejar donde está',
                    confirmButtonColor: 'var(--primary)',
                });
                if (confirmed.isConfirmed) {
                    window.listTicketAssignments[caseId] = existingGroup.id;
                    autoGroupMoved = true;
                }
            } else {
                const confirmed = await Swal.fire({
                    title: `¿Crear grupo?`,
                    text: `¿Querés crear un nuevo grupo "${groupLabel}" y mover este ticket a él automáticamente?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, crear y mover',
                    cancelButtonText: 'No, solo mover en calendario',
                    confirmButtonColor: 'var(--primary)',
                });
                if (confirmed.isConfirmed) {
                    const newGroupId = 'group_' + Date.now();
                    if (!window.listGroups) window.listGroups = [];
                    window.listGroups.push({ id: newGroupId, label: groupLabel, isDefault: false });
                    if (!window.listTicketAssignments) window.listTicketAssignments = {};
                    window.listTicketAssignments[caseId] = newGroupId;
                    autoGroupMoved = true;
                }
            }

            if (autoGroupMoved && typeof window.saveListGroupingConfig === 'function') {
                await window.saveListGroupingConfig();
            }

            try {
                const res = await fetch(`/api/cases/${caseId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fechaRetiro: nuevaFecha }),
                });
                if (!res.ok) throw new Error('PUT fallo');

                // Actualizar dateKey en cache local
                info.event.setExtendedProp('dateKey', String(nuevaFecha).slice(0, 10));
                if (typeof window.toast === 'function') window.toast('Fecha de retiro actualizada', 'success');

                // Refrescar panel si el día sigue seleccionado
                if (_selectedDate) _selectDay(_selectedDate);
            } catch (err) {
                if (typeof window.toast === 'function') window.toast('No se pudo actualizar la fecha de retiro', 'error');
                info.revert();
            }
        },
    });

    calendarInstance.render();

    // Buscador: filtrar lista al escribir
    const searchInput = document.getElementById('calendarPanelSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (_selectedDate) {
                _renderPanelItems(_getEventsForDate(_selectedDate), searchInput.value.trim());
            }
        });
    }

    // Re-inicializar lucide si está disponible
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        setTimeout(() => window.lucide.createIcons(), 100);
    }
}

// ─── Botón de refresco ────────────────────────────────────────────────────────
document.body.addEventListener('click', (e) => {
    if (e.target.closest('#btnRefreshCalendar')) {
        if (calendarInstance) {
            calendarInstance.refetchEvents();
            if (typeof window.toast === 'function') {
                window.toast('Calendario actualizado', 'success');
            }
        }
    }
});

// ─── Hook sobre switchView ────────────────────────────────────────────────────
const originalSwitchView = window.switchView;
window.switchView = function(view) {
    if (view === 'calendar') {
        renderCalendar();
    }
    if (typeof originalSwitchView === 'function') {
        originalSwitchView(view);
    }
};
