// ============================================================
// VISTA HOY
// ============================================================
// Grupos del día, en orden de prioridad para el operador:
// 1) Para retirar hoy   — fecha_retiro = hoy y estado en (appr, coord)
// 2) Para retirar esta semana — fecha_retiro entre mañana y +7 días
// 3) Configurando — estado = config
// 4) Pendientes de cierre — estado = scan
// 5) Urgentes — priority = alta en cualquier estado activo
function renderToday() {
    document.getElementById('todayGreeting').textContent = 'Resumen';

    const active = window.cases.filter(isActive);

    // Stats strip: counts globales clickeables (cada chip lleva a Lista o
    // Resumen según corresponda). Sirve como "qué pasa con mi cartera hoy"
    // antes de bajar a las listas accionables.
    const stalledWait = active.filter(c => c.estado === 'wait' && daysSince(c.updatedAt) >= 3);
    const retiroHoyItems = active.filter(c => isRetiroHoy(c) && (c.estado === 'appr' || c.estado === 'coord'));
    const summary = [
        { id: 's-activos',   label: 'Activos',         value: active.length,                                       tone: 'primary', target: 'list' },
        { id: 's-hoy',       label: 'Retiran hoy',     value: retiroHoyItems.length,                               tone: 'success', target: 'today' },
        { id: 's-sinresp',   label: 'Sin respuesta +3d', value: stalledWait.length,                                tone: 'warn',    target: 'list' },
        { id: 's-config',    label: 'Configurando',    value: active.filter(c => c.estado === 'config').length,    tone: 'primary', target: 'list' },
        { id: 's-listos',    label: 'Listos p/entregar', value: active.filter(c => c.estado === 'appr').length,    tone: 'success', target: 'list' },
        { id: 's-cerrar',    label: 'Por cerrar',      value: active.filter(c => c.estado === 'scan').length,      tone: 'warn',    target: 'list' },
        { id: 's-urgentes',  label: 'Urgentes',        value: active.filter(c => c.priority === 'alta').length,    tone: 'danger',  target: 'today' },
    ];
    document.getElementById('summaryStats').innerHTML = summary.map(s => `
        <div class="summary-chip" data-tone="${s.tone}" data-target="${s.target}" data-id="${s.id}">
            <div>
                <div class="summary-chip-label">${s.label}</div>
            </div>
            <div class="summary-chip-value">${s.value}</div>
        </div>
    `).join('');
    document.querySelectorAll('.summary-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const target = chip.dataset.target;
            if (target === 'today') return; // ya está en Resumen
            switchView(target);
        });
    });

    const groups = [
        {
            id: 'retiro-hoy',
            icon: 'calendar-clock',
            title: 'Para retirar hoy',
            empty: 'Sin retiros agendados para hoy.',
            items: retiroHoyItems,
        },
        {
            id: 'retiro-semana',
            icon: 'calendar-days',
            title: 'Para retirar esta semana',
            empty: 'Sin retiros agendados en los próximos 7 días.',
            items: active.filter(c => isRetiroEstaSemana(c) && (c.estado === 'appr' || c.estado === 'coord')),
        },
        {
            id: 'a-configurar',
            icon: 'settings',
            title: 'Configurando',
            empty: 'Sin equipos en configuración.',
            items: active.filter(c => c.estado === 'config'),
        },
        {
            id: 'pendientes-cierre',
            icon: 'file-check-2',
            title: 'Pendientes de cierre',
            empty: 'Sin escaneos pendientes.',
            items: active.filter(c => c.estado === 'scan'),
        },
        {
            id: 'urgentes',
            icon: 'alert-triangle',
            title: 'Urgentes',
            empty: 'Sin casos marcados como urgentes.',
            items: active.filter(c => c.priority === 'alta'),
        },
    ];

    const totalAccion = groups.reduce((s, g) => s + g.items.length, 0);
    const sub = document.getElementById('todaySubtitle');
    sub.textContent = totalAccion === 0
        ? 'No tenés acciones urgentes ahora mismo.'
        : `${totalAccion} caso${totalAccion === 1 ? '' : 's'} con acción pendiente.`;

    document.getElementById('todayGrid').innerHTML = groups.map(g => {
        const showFechaRetiro = g.id === 'retiro-semana';
        const sorter = showFechaRetiro
            ? (a, b) => new Date(a.fechaRetiro || 0) - new Date(b.fechaRetiro || 0)
            : (a, b) => daysSince(b.updatedAt) - daysSince(a.updatedAt);
        return `
        <div class="today-group">
            <div class="today-group-header">
                <h3><i data-lucide="${g.icon}"></i> ${g.title}</h3>
                <span class="count">${g.items.length}</span>
            </div>
            <div class="today-group-body">
                ${g.items.length === 0
                    ? `<div class="today-empty">${g.empty}</div>`
                    : g.items
                        .sort(sorter)
                        .map(c => renderTaskItem(c, { showFechaRetiro }))
                        .join('')}
            </div>
        </div>
        `;
    }).join('');
    renderIcons();
}


window.renderToday = renderToday;

window.addEventListener('state:refreshed', () => {
    if (window.currentView === 'today' && typeof window.renderToday === 'function') {
        window.renderToday();
    }
});

