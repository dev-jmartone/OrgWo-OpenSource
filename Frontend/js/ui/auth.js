// ============================================================
// AUTH — login/register tabs + Remedy login modal + session expired.
// Extraido de system_enhancements.js (refactor fase 2).
// ============================================================

// Mapeos y listeners de inicio de sesión
document.getElementById('loginSubmitBtn').addEventListener('click', async () => {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    
    if (!username || !password) {
        toast('Usuario y contraseña requeridos', 'error');
        return;
    }
    
    try {
        const user = await API.login(username, password);
        toast('Bienvenido ' + user.name, 'success');
        
        // Recargar para reiniciar todo el estado del frontend de forma limpia
        window.location.reload();
    } catch (e) {
        toast(e.message, 'error');
    }
});

// ============================================================
// REMEDY LOGIN MODAL (custom, reemplaza SweetAlert2)
// ============================================================
function showRemedyLoginModal() {
    const errEl = document.getElementById('remedyLoginError');
    errEl.style.display = 'none';
    const defaultUser = (window.currentUser && window.currentUser.username) ? window.currentUser.username.toUpperCase() : 'ADMIN';
    document.getElementById('remedyLoginUser').value = defaultUser;
    document.getElementById('remedyLoginPass').value = 'demo123';
    document.getElementById('remedyLoginModal').classList.add('open');
    setTimeout(() => document.getElementById('remedyLoginUser').focus(), 80);
}

function hideRemedyLoginModal() {
    document.getElementById('remedyLoginModal').classList.remove('open');
}

document.getElementById('remedyLoginClose').addEventListener('click', hideRemedyLoginModal);
document.getElementById('remedyLoginCancel').addEventListener('click', hideRemedyLoginModal);

// Forzar uppercase mientras el usuario escribe
document.getElementById('remedyLoginUser').addEventListener('input', function() {
    const pos = this.selectionStart;
    this.value = this.value.toUpperCase();
    this.setSelectionRange(pos, pos);
});

document.getElementById('remedyLoginSubmit').addEventListener('click', async () => {
    const userInput = document.getElementById('remedyLoginUser');
    const passInput = document.getElementById('remedyLoginPass');
    const errEl = document.getElementById('remedyLoginError');
    const submitLabel = document.getElementById('remedyLoginSubmitLabel');
    const username = userInput.value.trim().toUpperCase(); // siempre en mayúsculas
    const password = passInput.value;

    if (!username || !password) {
        errEl.textContent = 'Completá ambos campos';
        errEl.style.display = 'block';
        return;
    }

    submitLabel.textContent = 'Conectando...';
    document.getElementById('remedyLoginSubmit').disabled = true;
    errEl.style.display = 'none';

    try {
        await API.remedyLogin(username, password);
        _remedyExpiredShown = false;
        const balloon = document.getElementById('remedyExpiredBalloon');
        if (balloon) balloon.remove();
        hideRemedyLoginModal();
        toast('Conectado a Remedy como ' + username, 'success');
        updateRemedyStatusUI();
        loadRemedyTickets();
    } catch (e) {
        errEl.textContent = e.message || 'No se pudo conectar a Remedy';
        errEl.style.display = 'block';
    } finally {
        submitLabel.textContent = 'Conectar';
        document.getElementById('remedyLoginSubmit').disabled = false;
    }
});

// Enter en el campo contraseña dispara submit
document.getElementById('remedyLoginPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('remedyLoginSubmit').click();
});

// ============================================================
// REMEDY SESSION EXPIRED — listener global
// ============================================================
// Disparado desde _remedyFetch() en api_client.js cuando el backend
// devuelve HTTP 401 con remedy_error=TOKEN_EXPIRED.
// Muestra una notificacion no bloqueante con boton para reconectar.

let _remedyExpiredShown = false;

window.addEventListener('remedy:session-expired', (event) => {
    // Actualizar UI del navbar de inmediato
    window.remedyConnected = false;
    updateRemedyStatusUI();

    // Solo mostrar un aviso por expiración (hasta que se reconecte)
    if (_remedyExpiredShown) return;
    _remedyExpiredShown = true;

    // Remover globo existente si lo hay
    const existing = document.getElementById('remedyExpiredBalloon');
    if (existing) existing.remove();

    const wrapper = document.getElementById('remedyNavbarWrapper');
    if (!wrapper) return;

    // Crear el globo de advertencia sobre el botón del navbar
    const balloon = document.createElement('div');
    balloon.id = 'remedyExpiredBalloon';
    balloon.style.cssText = `
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 250px;
        background: var(--surface);
        border: 1px solid var(--warn);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-floating);
        padding: 10px 12px;
        z-index: 200;
        font-size: 11.5px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        text-align: left;
    `;
    
    balloon.innerHTML = `
        <!-- Flecha apuntando hacia arriba -->
        <div style="position: absolute; bottom: 100%; right: 20px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 6px solid var(--warn);"></div>
        <div style="position: absolute; bottom: 100%; right: 20px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 6px solid var(--surface); margin-bottom: -1px;"></div>
        
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--warn);">
                <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i>
                <span>Sesión de Remedy expirada</span>
            </div>
            <button id="closeRemedyBalloon" style="background: transparent; border: none; padding: 0; color: var(--text-muted); cursor: pointer; display: flex; align-items: center;">
                <i data-lucide="x" style="width: 13px; height: 13px;"></i>
            </button>
        </div>
        <p style="margin: 0; color: var(--text-muted); line-height: 1.3;">Tu sesión de Remedy ha vencido. Por favor, reconectate.</p>
        <button id="reconnectRemedyBalloonBtn" style="
            width: 100%;
            padding: 6px;
            background: var(--primary);
            color: #fff;
            border: none;
            border-radius: var(--radius);
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        ">
            <i data-lucide="key-round" style="width: 12px; height: 12px;"></i> Reconectar
        </button>
    `;

    wrapper.appendChild(balloon);
    renderIcons();

    // Eventos del globo
    document.getElementById('closeRemedyBalloon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        balloon.remove();
    });

    document.getElementById('reconnectRemedyBalloonBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        balloon.remove();
        showRemedyLoginModal();
    });
});

document.getElementById('btnLogout').addEventListener('click', async () => {
    await API.logout();
    toast('Sesión cerrada', 'success');
    setTimeout(() => window.location.reload(), 800);
});

// Verificación inicial de sesión
async function checkAuth() {
    try {
        const user = await API.authMe();
        if (user.authenticated) {
            window.currentUser = user;
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('userInitials').textContent = initials(user.name);
            document.getElementById('userProfileName').textContent = user.name;
            document.getElementById('userProfileEmail').textContent = user.email;
            document.getElementById('userProfileOrg').textContent = user.organization;
            
            const isDispatcher = (user.role || '').toLowerCase() === 'dispatcher';
            // Mostrar botón de métricas si es dispatcher
            const btnMetrics = document.getElementById('btnSidebarMetrics');
            if (btnMetrics) {
                btnMetrics.style.display = isDispatcher ? 'inline-flex' : 'none';
            }
            // Mostrar botón de dispatcher si es dispatcher
            const btnDispatcher = document.getElementById('btnSidebarDispatcher');
            if (btnDispatcher) {
                btnDispatcher.style.display = isDispatcher ? 'inline-flex' : 'none';
            }
            // Mostrar botón de estadísticas de grupos si es dispatcher (solo admin)
            const btnStats = document.getElementById('btnSidebarStats');
            if (btnStats) {
                btnStats.style.display = isDispatcher ? 'inline-flex' : 'none';
            }
            // Cargar estado de disponibilidad
            if (typeof window.loadSelfAvailability === 'function') {
                window.loadSelfAvailability();
            }
            if (typeof window.initSelfAvailabilitySelectListener === 'function') {
                window.initSelfAvailabilitySelectListener();
            }
            // Mostrar pestaña "Todos los casos" si es dispatcher (Oculta por pedido del usuario)
            const tabAllCases = document.getElementById('btnTabAllCases');
            if (tabAllCases) {
                tabAllCases.style.display = 'none';
            }
            // Boton TEMPORAL de exportar mensajes rapidos: solo dispatcher.
            const btnExportQM = document.getElementById('btnExportQuickMsgs');
            if (btnExportQM) {
                btnExportQM.style.display = isDispatcher ? 'flex' : 'none';
            }
            // Asignar técnico por defecto en la planilla
            document.getElementById('planTecnico').value = user.name;
            
            // Cargar plantillas de checklists por organización
            try {
                const res = await API.getOrgSetting('checklist_templates');
                if (res && res.value) {
                    const parsed = JSON.parse(res.value);
                    window.CHECKLIST_TEMPLATES = { ...window.CHECKLIST_TEMPLATES, ...parsed };
                }
            } catch (e) {
                console.error("Error cargando plantillas de checklists:", e);
            }
            
            try {
                const settings = await API.getUserSettings();
                if (settings && !Array.isArray(settings)) {
                    window.customQuickMessages = (settings.quick_messages && settings.quick_messages.length > 0) ? settings.quick_messages : (window.DEFAULT_QUICK_MESSAGES || []);
                    window.userDefaultSaludo = settings.default_saludo || '';
                    window.userTemplateObs = (settings.template_obs && settings.template_obs.length > 0) ? settings.template_obs : (window.DEFAULT_TEMPLATE_OBS || []);
                    window.userTemplateGreetings = (settings.template_greetings && settings.template_greetings.length > 0) ? settings.template_greetings : (window.DEFAULT_TEMPLATE_GREETINGS || []);
                } else {
                    window.customQuickMessages = window.DEFAULT_QUICK_MESSAGES || [];
                    window.userTemplateObs = window.DEFAULT_TEMPLATE_OBS || [];
                    window.userTemplateGreetings = window.DEFAULT_TEMPLATE_GREETINGS || [];
                    const newSettings = {
                        quick_messages: window.customQuickMessages,
                        template_obs: window.userTemplateObs,
                        template_greetings: window.userTemplateGreetings
                    };
                    await API.saveUserSettings(newSettings);
                    window.userDefaultSaludo = '';
                }
            } catch (e) {
                console.error("Error loading user settings", e);
                window.customQuickMessages = window.DEFAULT_QUICK_MESSAGES || [];
                window.userTemplateObs = window.DEFAULT_TEMPLATE_OBS || [];
                window.userTemplateGreetings = window.DEFAULT_TEMPLATE_GREETINGS || [];
                window.userDefaultSaludo = '';
            }
            
            // Solicitar permisos de notificaciones del navegador
            if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                Notification.requestPermission();
            }
            return true;
        } else {
            document.getElementById('loginScreen').style.display = 'flex';
            return false;
        }
    } catch (e) {
        document.getElementById('loginScreen').style.display = 'flex';
        return false;
    }
}


// Expose to window for global module compatibility
window.showRemedyLoginModal = showRemedyLoginModal;
window.hideRemedyLoginModal = hideRemedyLoginModal;
window.checkAuth = checkAuth;
