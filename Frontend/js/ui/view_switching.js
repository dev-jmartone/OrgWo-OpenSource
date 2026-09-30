// ============================================================
// VIEW SWITCHING
// ============================================================
let _metricsInitialized = false;
let _currentView = null;

function switchView(view) {
    // Generador no es una vista: abre directo el modal de planilla en blanco
    // sin tocar la vista activa actual ni la nav-btn marcada. Evita un click
    // extra (operador no tiene que pasar por una landing intermedia).
    if (view === 'generador') {
        try {
            if (typeof window.openPlanillaModalBlank === 'function') {
                window.openPlanillaModalBlank();
            } else {
                console.error("window.openPlanillaModalBlank is not defined");
                if (typeof window.toast === 'function') window.toast('Error: El módulo de planilla no se cargó correctamente', 'error');
            }
        } catch (err) {
            console.error("Error opening blank template generator:", err);
            if (typeof window.toast === 'function') window.toast('Error al abrir generador: ' + err.message, 'error');
        }
        return;
    }

    // Detener auto-refresh de métricas si salimos de esa vista
    if (_currentView === 'metrics' && view !== 'metrics') {
        if (typeof window.stopMetricsAutoRefresh === 'function') window.stopMetricsAutoRefresh();
    }
    if (_currentView === 'dispatcher' && view !== 'dispatcher') {
        if (typeof window.stopDispatcherAutoRefresh === 'function') window.stopDispatcherAutoRefresh();
    }

    _currentView = view;
    window.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));

    if (view === 'today') {
        if (typeof window.renderToday === 'function') window.renderToday();
    }
    if (view === 'list') {
        const activeTab = document.querySelector('#listTabs button.active')?.dataset.listFilter || 'open';
        if (activeTab === 'closed' && window.remedyConnected && (!window.myClosedTickets || window.myClosedTickets.length === 0)) {
            if (typeof window.loadClosedTicketsForList === 'function') window.loadClosedTicketsForList();
        } else {
            if (typeof window.renderList === 'function') window.renderList();
        }
    }
    if (view === 'remedy') {
        if (typeof window.loadRemedyTickets === 'function') window.loadRemedyTickets();
    }
    if (view === 'metrics') {
        // Inicializar handlers la primera vez
        if (!_metricsInitialized) {
            if (typeof window.initMetrics === 'function') {
                window.initMetrics();
                _metricsInitialized = true;
            }
        }
        // Arrancar auto-refresh (fetch + intervalo 15s)
        if (typeof window.startMetricsAutoRefresh === 'function') {
            window.startMetricsAutoRefresh();
        }
    }
    if (view === 'dispatcher') {
        if (typeof window.initDispatcher === 'function') {
            window.initDispatcher();
        }
        if (typeof window.startDispatcherAutoRefresh === 'function') {
            window.startDispatcherAutoRefresh();
        }
    }
    if (view === 'stats') {
        if (typeof window.initAdminStats === 'function') {
            window.initAdminStats();
        }
        if (typeof window.loadAdminStats === 'function') {
            window.loadAdminStats();
        }
    }
}
document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => window.switchView(btn.dataset.view)));


// Expose to window for global module compatibility
window.switchView = switchView;
