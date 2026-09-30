// ============================================================
// CARTELERA REMEDY — view + list tabs + ticket loaders +
// status change handler + resolve modal + ticket details + take.
// Extraido de system_enhancements.js (refactor fase 2).
// ============================================================

// Botón de Remedy en Navbar
document.getElementById('btnRemedyNavbar').addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.remedyConnected) {
        const username = document.getElementById('remedyNavbarLabel').textContent || 'Usuario';
        Swal.fire({
            title: 'Sesión de Remedy Activa',
            text: `Conectado como ${username}`,
            icon: 'info',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: 'Refrescar Sesión',
            denyButtonText: 'Cerrar Sesión',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--primary)',
            denyButtonColor: 'var(--danger)'
        }).then(async (result) => {
            if (result.isConfirmed) {
                showRemedyLoginModal();
            } else if (result.isDenied) {
                await API.remedyLogout();
                toast('Sesión de Remedy cerrada', 'success');
                updateRemedyStatusUI();
                loadRemedyTickets();
            }
        });
    } else {
        showRemedyLoginModal();
    }
});


// Mapeos de los filtros de la lista plana (Abiertos / Cerrados)
// Mapeos de los filtros de la lista plana (Abiertos / Cerrados / Todos)
document.querySelectorAll('#listTabs button').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.querySelectorAll('#listTabs button').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        
        toggleImportButton();
        
        const filter = btn.dataset.listFilter;
        if (filter === 'closed') {
            await loadClosedTicketsForList();
        } else if (filter === 'all') {
            // Mostrar indicador de carga en la tabla plana
            const tbody = document.getElementById('usersTableBody');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 48px; color: var(--text-muted); font-size: 13px;">
                    <i data-lucide="loader" class="spinner" style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;"></i> Cargando todos los casos...
                </td></tr>`;
                if (window.lucide) lucide.createIcons();
            }
            if (typeof window.refresh === 'function') await window.refresh();
            renderList();
        } else {
            // Si veníamos de la solapa 'all', volvemos a cargar sólo los casos propios
            if (window.lastFlatListFilter === 'all') {
                if (typeof window.refresh === 'function') await window.refresh();
            }
            renderList();
        }
        window.lastFlatListFilter = filter;
    });
});

function toggleImportButton() {
    const btnImport = document.getElementById('btnImportHistory');
    if (!btnImport) return;
    const activeTab = document.querySelector('#listTabs button.active')?.dataset.listFilter;
    if ((activeTab === 'closed' || activeTab === 'all') && window.remedyConnected) {
        btnImport.style.display = 'inline-flex';
    } else {
        btnImport.style.display = 'none';
    }
}

// Handler de importación de historial Remedy
const btnImport = document.getElementById('btnImportHistory');
if (btnImport) {
    btnImport.addEventListener('click', async () => {
        const activeTab = document.querySelector('#listTabs button.active')?.dataset.listFilter;
        const isGroupImport = (activeTab === 'all');
        const titleText = isGroupImport ? 'Importar historial de Remedy (Mesa)' : 'Importar historial de Remedy';
        const infoText = isGroupImport
            ? 'Esto buscará todos los tickets cerrados/resueltos de los grupos de soporte de la mesa en Remedy en el rango seleccionado y los guardará localmente.'
            : 'Esto buscará todos tus tickets cerrados/resueltos en Remedy en el rango seleccionado y los guardará localmente en la base de datos.';

        const { value: days, isConfirmed } = await Swal.fire({
            title: titleText,
            html: `
                <div style="text-align: left;">
                    <label style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 6px;">
                        Rango de tiempo a importar
                    </label>
                    <select id="swalImportDays" style="width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 13px; font-family: inherit;">
                        <option value="30">Últimos 30 días</option>
                        <option value="60" selected>Últimos 60 días</option>
                        <option value="90">Últimos 90 días</option>
                        <option value="180">Últimos 180 días</option>
                        <option value="365">Últimos 365 días</option>
                    </select>
                    <p style="font-size: 12px; color: var(--text-muted); margin-top: 10px;">
                        ${infoText}
                    </p>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Importar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--primary)',
            preConfirm: () => {
                return document.getElementById('swalImportDays').value;
            }
        });

        if (!isConfirmed || !days) return;

        Swal.fire({
            title: 'Importando tickets...',
            html: '<p style="font-size: 13px; color: var(--text-muted);">Por favor espera, consultando Remedy y actualizando base de datos local...</p>',
            allowOutsideClick: false,
            allowEscapeKey: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            const res = await API.importClosedHistory(parseInt(days), isGroupImport);
            Swal.close();
            
            await Swal.fire({
                title: 'Importación Completada',
                text: `Se importaron ${res.imported} tickets nuevos/actualizados (Total consultados: ${res.total}).`,
                icon: 'success',
                confirmButtonColor: 'var(--primary)'
            });

            // Refrescar datos
            if (typeof window.refresh === 'function') await window.refresh();
            renderList();
        } catch (err) {
            console.error("Error al importar historial:", err);
            Swal.fire({
                title: 'Error al importar',
                text: err.message || 'Ocurrió un error inesperado al consultar Remedy.',
                icon: 'error',
                confirmButtonColor: 'var(--primary)'
            });
        }
    });
}

async function loadClosedTicketsForList() {
    window.myClosedTickets = [];
    renderList();
}

// Filtros de la cartelera Remedy
document.querySelectorAll('#remedyPills button').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.querySelectorAll('#remedyPills button').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        window.currentRemedyFilter = btn.dataset.remedyFilter;

        // Mostrar indicador de carga en vivo en la tabla
        const tbody = document.getElementById('remedyTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 48px; color: var(--text-muted); font-size: 13px;">
                <i data-lucide="loader" class="spinner" style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;"></i> Cargando tickets...
            </td></tr>`;
            if (window.lucide) lucide.createIcons();
        }

        await loadRemedyTickets();
    });
});


// ------------------------------------------------------------
// Token countdown + refresh — viene de main (commit ef32576).
// Variables y funciones que muestran el tiempo restante de la
// sesion de Remedy y avisan 30s antes del vencimiento.
// ------------------------------------------------------------
let remedyTimerInterval = null;
let hasShownExpirationWarning = false;

function showRemedyExpirationWarning() {
    Swal.fire({
        title: 'Sesión de Remedy por vencer',
        text: 'Tu sesión de Remedy vencerá en 30 segundos. ¿Deseas reconectar ahora?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Reconectar',
        cancelButtonText: 'Ignorar',
        confirmButtonColor: 'var(--primary)',
    }).then((result) => {
        if (result.isConfirmed) {
            showRemedyLoginModal();
        }
    });
}

function startRemedyTokenCountdown(expiresAt) {
    if (remedyTimerInterval) {
        clearInterval(remedyTimerInterval);
        remedyTimerInterval = null;
    }
    hasShownExpirationWarning = false;

    const timerEl = document.getElementById('remedy-token-timer');
    if (timerEl) timerEl.textContent = '';

    if (!expiresAt) return;

    remedyTimerInterval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const remaining = expiresAt - now;

        const timerEl = document.getElementById('remedy-token-timer');
        if (remaining <= 0) {
            if (timerEl) {
                timerEl.textContent = '(Expirado)';
                timerEl.style.color = 'var(--danger)';
                timerEl.style.fontWeight = 'bold';
            }
            clearInterval(remedyTimerInterval);
            window.remedyConnected = false;
            updateRemedyStatusUI();
            window.dispatchEvent(new CustomEvent('remedy:session-expired'));
            return;
        }

        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        if (timerEl) {
            timerEl.textContent = `(${formatted})`;
            if (remaining <= 60) {
                timerEl.style.color = 'var(--danger)';
                timerEl.style.fontWeight = 'bold';
            } else {
                timerEl.style.color = 'var(--text-muted)';
                timerEl.style.fontWeight = 'normal';
            }
        }

        if (remaining <= 30 && !hasShownExpirationWarning) {
            hasShownExpirationWarning = true;
            showRemedyExpirationWarning();
        }
    }, 1000);
}

async function handleRemedyRefresh() {
    if (window.remedyConnected) {
        try {
            toast('Refrescando tickets de Remedy...', 'info');
            await loadRemedyTickets();
            toast('Tickets actualizados', 'success');
        } catch (e) {
            console.error("Error al refrescar tickets:", e);
            toast('Error al refrescar tickets: ' + e.message, 'error');
        }
    } else {
        showRemedyLoginModal();
    }
}
window.handleRemedyRefresh = handleRemedyRefresh;


// Manejo de la Cartelera de Remedy
async function updateRemedyStatusUI() {
    const status = await API.remedyStatus();
    window.remedyUserStatus = status;
    window.remedyConnected = status.connected;
    window.remedyEnv = status.env || 'QA';

    const btnCreate = document.getElementById('btnCreateRemedyTicket');
    if (btnCreate) {
        const isQA = (window.remedyEnv === 'QA');
        btnCreate.style.display = (status.connected && isQA) ? 'inline-flex' : 'none';
    }



    // Actualizar el botón del Navbar
    const dot = document.getElementById('remedyNavbarDot');
    const label = document.getElementById('remedyNavbarLabel');
    const btn = document.getElementById('btnRemedyNavbar');
    if (dot && label && btn) {
        if (status.connected) {
            dot.style.background = '#107C10'; // verde success
            label.textContent = status.username || 'Remedy';
            btn.title = `Conectado como ${status.username}. Clic para ver opciones.`;
            btn.style.borderColor = 'rgba(16,124,16,0.35)';
            btn.style.color = 'var(--text)';
        } else {
            dot.style.background = 'var(--text-faint)';
            label.textContent = 'Remedy';
            btn.title = 'Conectar a Remedy';
            btn.style.borderColor = 'var(--border)';
            btn.style.color = 'var(--text-muted)';
        }
    }

    // Indicador de estado en la cartelera
    const container = document.getElementById('remedyConnectionStatus');
    if (!container) return;
    if (status.connected) {
        container.innerHTML = `
            <span style="color: var(--st-done); display: inline-flex; align-items: center; gap: 4px; font-size: 12px;">
                <span style="width:7px;height:7px;border-radius:50%;background:var(--st-done);display:inline-block;"></span> <strong>${escapeHtml(status.username)}</strong>
                <span style="font-size: 10px; background: var(--surface-2); border: 1px solid var(--border); padding: 1px 6px; border-radius: 99px; color: var(--text-muted); margin-left: 4px;">${escapeHtml(remedyEnv)}</span>
                <button class="btn btn-ghost" onclick="handleRemedyRefresh()" title="Refrescar sesión" style="padding: 2px 6px; font-size: 11px; height: auto; min-height: 22px; display: inline-flex; align-items: center; gap: 4px; margin-left: 6px;">
                    <i data-lucide="refresh-cw" style="width: 11px; height: 11px;"></i> Refrescar
                </button>
                <span id="remedy-token-timer" style="font-size: 11px; margin-left: 6px; color: var(--text-muted);"></span>
            </span>
        `;
    } else {
        container.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">No conectado a Remedy</span>`;
    }
    renderIcons();
    if (typeof renderKanban === 'function') {
        try {
            renderKanban();
        } catch (e) {
            console.error("Error al re-renderizar Kanban:", e);
        }
    }
    if (typeof renderList === 'function') {
        try {
            renderList();
        } catch (e) {
            console.error("Error al re-renderizar Lista:", e);
        }
    }

    if (typeof toggleImportButton === 'function') {
        toggleImportButton();
    }

    if (status.connected && status.expiresAt) {
        startRemedyTokenCountdown(status.expiresAt);
    } else {
        if (remedyTimerInterval) {
            clearInterval(remedyTimerInterval);
            remedyTimerInterval = null;
        }
    }
}


async function showRemedyLoginDialog() {
    const defaultUser = (window.currentUser && window.currentUser.username) ? window.currentUser.username : 'admin';
    const { value: formValues } = await Swal.fire({
        title: 'Conectar con BMC Remedy (ITSM)',
        html:
            '<div style="text-align: left; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; margin-bottom: 14px; font-size: 12px; color: var(--text-muted);">' +
            '⚡ <strong>Modo Demostración Activo:</strong> Podés conectar con cualquier usuario o las credenciales sugeridas para simular la API REST de BMC Remedy.' +
            '</div>' +
            '<div style="text-align: left; margin-bottom: 6px;"><label style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Usuario de Remedy</label></div>' +
            `<input id="remedy-username" class="swal2-input" value="${escapeHtml(defaultUser)}" placeholder="ej: admin" style="margin-top: 0; margin-bottom: 14px; width: 85%;">` +
            '<div style="text-align: left; margin-bottom: 6px;"><label style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Contraseña de Remedy</label></div>' +
            '<input id="remedy-password" type="password" class="swal2-input" value="demo123" placeholder="••••••••" style="margin-top: 0; width: 85%;">',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Conectar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--primary)',
        preConfirm: () => {
            const user = document.getElementById('remedy-username').value;
            const pass = document.getElementById('remedy-password').value;
            if (!user || !pass) {
                Swal.showValidationMessage('Completá ambos campos');
                return false;
            }
            return { user, pass };
        }
    });

    if (formValues) {
        Swal.fire({
            title: 'Conectando...',
            text: 'Obteniendo token de BMC Remedy...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        
        try {
            await API.remedyLogin(formValues.user, formValues.pass);
            Swal.fire({
                icon: 'success',
                title: 'Conexión Exitosa',
                text: `Conectado a Remedy como ${formValues.user}`,
                timer: 2000,
                showConfirmButton: false
            });
            updateRemedyStatusUI();
            if (typeof refresh === 'function') {
                await refresh();
            }
            loadRemedyTickets();
            const activeView = document.querySelector('.view.active')?.id?.replace('view-', '');
            if (activeView === 'list') {
                const activeTab = document.querySelector('#listTabs button.active')?.dataset.listFilter || 'open';
                if (activeTab === 'closed') {
                    await loadClosedTicketsForList();
                } else {
                    renderList();
                }
            }
        } catch (e) {
            Swal.fire({
                icon: 'error',
                title: 'Error de Conexión',
                text: e.message || 'No se pudo conectar a Remedy'
            });
        }
    }
}

async function loadRemedyTickets() {
    try {
        await updateRemedyStatusUI();
        const bInc = document.getElementById('badge-inc');
        const bWo = document.getElementById('badge-wo');
        const sidebarBadge = document.getElementById('badge-sidebar-cartelera');
        
        if (!window.remedyConnected) {
            if (bInc) bInc.style.display = 'none';
            if (bWo) bWo.style.display = 'none';
            if (sidebarBadge) sidebarBadge.style.display = 'none';
            renderRemedyTickets();
            return;
        }
        
        // Carga en paralelo de todos los tickets para mantener la lista y cartelera en sync
        const [tickets, openTickets, closedTickets, allAssignedTickets] = await Promise.all([
            API.listRemedyTickets().catch(() => []),
            API.listMyRemedyTickets('open').catch(() => []),
            API.listMyRemedyTickets('closed').catch(() => []),
            API.listAssignedRemedyTickets().catch(() => [])
        ]);
        
        window.remedyTickets = tickets || [];
        window.myOpenTickets = openTickets || [];
        window.myClosedTickets = closedTickets || [];
        window.allAssignedTickets = allAssignedTickets || [];

        // Reconciliar cases locales con cierres hechos directo en Remedy.
        // Si el operador cierra el ticket en Remedy sin pasar por el
        // tracker, este endpoint actualiza el case a done para que el
        // kanban / vista hoy no queden con info stale. Best-effort: si
        // falla, sigue silencioso, no rompe el load.
        API.reconcileRemedyCases().then(res => {
            if (res && Array.isArray(res.reconciled) && res.reconciled.length > 0) {
                toast(`Sincronizado con Remedy: ${res.reconciled.length} ticket(s) cerrado(s) detectado(s).`, 'success');
                if (typeof refresh === 'function') refresh();
            }
        }).catch(() => {});

        // Calcular conteos de tickets sin asignar
        const incCount = window.remedyTickets.filter(t => t.type === 'INC').length;
        const woCount = window.remedyTickets.filter(t => t.type === 'WO').length;
        const allAssignedCount = window.allAssignedTickets.length;

        const badgeInc = document.getElementById('badge-inc');
        const badgeWo = document.getElementById('badge-wo');
        const badgeAllAssigned = document.getElementById('badge-all-assigned');

        if (badgeInc) {
            if (incCount > 0) {
                badgeInc.textContent = incCount;
                badgeInc.style.display = 'inline-block';
            } else {
                badgeInc.style.display = 'none';
            }
        }
        if (badgeWo) {
            if (woCount > 0) {
                badgeWo.textContent = woCount;
                badgeWo.style.display = 'inline-block';
            } else {
                badgeWo.style.display = 'none';
            }
        }
        if (badgeAllAssigned) {
            if (allAssignedCount > 0) {
                badgeAllAssigned.textContent = allAssignedCount;
                badgeAllAssigned.style.display = 'inline-block';
            } else {
                badgeAllAssigned.style.display = 'none';
            }
        }
        
        // Sumatoria para la opción Cartelera del Sidebar
        if (sidebarBadge) {
            const total = incCount + woCount;
            if (total > 0) {
                sidebarBadge.textContent = total;
                sidebarBadge.style.display = 'inline-block';
            } else {
                sidebarBadge.style.display = 'none';
            }
        }

        renderRemedyTickets();
        if (typeof renderList === 'function') {
            try {
                renderList();
            } catch (e) {
                console.error("Error al renderizar lista en loadRemedyTickets:", e);
            }
        }
        if (typeof _hoyBackfillEmails === 'function') {
            _hoyBackfillEmails();
        }
    } catch (e) {
        console.error(e);
    }
}


// Whitelist de equipos simplificada: todos los tickets se consideran válidos para el tracker.
function isEquipmentElementType(elType) {
    return true;
}

window.remedySortKey = 'createdAt';
window.remedySortDir = 'desc';

window.setRemedySort = function(key) {
    if (window.remedySortKey === key) {
        window.remedySortDir = window.remedySortDir === 'asc' ? 'desc' : 'asc';
    } else {
        window.remedySortKey = key;
        window.remedySortDir = 'desc';
    }
    renderRemedyTickets();
};


function renderRemedyTickets() {
    const tbody = document.getElementById('remedyTableBody');
    if (!window.remedyConnected) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 48px; color: var(--danger); font-size: 14px; font-weight: 600;">
            <i data-lucide="lock" style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;"></i> Debe iniciar sesión en Remedy desde el botón de la barra superior.
        </td></tr>`;
        document.getElementById('remedyCount').textContent = '0 tickets';
        if (window.lucide) lucide.createIcons();
        return;
    }

    const filter = currentRemedyFilter;
    const isMyTickets = (filter === 'MY_OPEN' || filter === 'MY_CLOSED');
    const isAllAssigned = (filter === 'ALL_ASSIGNED');

    let filtered;
    if (filter === 'MY_OPEN') {
        filtered = [...(window.myOpenTickets || [])];
    } else if (filter === 'MY_CLOSED') {
        filtered = [...(window.myClosedTickets || [])];
    } else if (filter === 'ALL_ASSIGNED') {
        filtered = [...(window.allAssignedTickets || [])];
    } else {
        filtered = [...(window.remedyTickets || [])].filter(t => t.type === filter);
    }

    // Aplicar búsqueda (por técnico, por ticket o por usuario)
    const query = (document.getElementById('remedySearch')?.value || '').toLowerCase().trim();
    if (query) {
        filtered = filtered.filter(t => {
            const ticketId = (t.id || '').toLowerCase();
            const clientName = (t.clientName || t.client_name || t.fullName || t.name || '').toLowerCase();
            const clientEmail = (t.email || '').toLowerCase();
            const assigneeName = (t.assignee_name || t.assignee_login || '').toLowerCase();
            const summary = (t.summary || '').toLowerCase();
            const description = (t.description || '').toLowerCase();
            const company = (t.company || '').toLowerCase();

            return ticketId.includes(query) ||
                   clientName.includes(query) ||
                   clientEmail.includes(query) ||
                   assigneeName.includes(query) ||
                   summary.includes(query) ||
                   description.includes(query) ||
                   company.includes(query);
        });
    }

    // Aplicar ordenamiento
    const key = window.remedySortKey || 'createdAt';
    const dir = window.remedySortDir || 'desc';

    filtered.sort((a, b) => {
        let valA, valB;
        if (key === 'tecnico') {
            valA = (a.assignee_name || a.assignee_login || '').toLowerCase();
            valB = (b.assignee_name || b.assignee_login || '').toLowerCase();
        } else if (key === 'sla') {
            valA = a.slaDate || (dir === 'asc' ? '9999-12-31T23:59:59' : '0000-00-00T00:00:00');
            valB = b.slaDate || (dir === 'asc' ? '9999-12-31T23:59:59' : '0000-00-00T00:00:00');
        } else if (key === 'createdAt') {
            valA = a.created_at || a.createdAt || '';
            valB = b.created_at || b.createdAt || '';
        } else {
            valA = a[key] || '';
            valB = b[key] || '';
        }

        if (valA < valB) return dir === 'asc' ? -1 : 1;
        if (valA > valB) return dir === 'asc' ? 1 : -1;
        return 0;
    });

    const slaSortIcon = window.remedySortKey === 'sla' ? (window.remedySortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const createdSortIcon = window.remedySortKey === 'createdAt' ? (window.remedySortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const tecnicoSortIcon = window.remedySortKey === 'tecnico' ? (window.remedySortDir === 'asc' ? ' ▲' : ' ▼') : '';

    const tableHead = document.getElementById('remedyTableHead');
    if (tableHead) {
        if (filter === 'ALL_ASSIGNED') {
            tableHead.innerHTML = `
                <tr>
                    <th style="width: 140px;">Ticket</th>
                    <th style="width: 160px;">Creador / Solicitante</th>
                    <th>Tipificación / Descripción</th>
                    <th style="width: 100px;">Empresa</th>
                    <th style="width: 170px; cursor: pointer;" onclick="setRemedySort('sla')">SLA${slaSortIcon}</th>
                    <th style="width: 120px; cursor: pointer;" onclick="setRemedySort('createdAt')">Creado${createdSortIcon}</th>
                    <th style="width: 220px; text-align: center; cursor: pointer;" onclick="setRemedySort('tecnico')">Técnico${tecnicoSortIcon}</th>
                </tr>
            `;
        } else {
            tableHead.innerHTML = `
                <tr>
                    <th style="width: 140px;">Ticket</th>
                    <th style="width: 160px;">Creador / Solicitante</th>
                    <th>Tipificación / Descripción</th>
                    <th style="width: 100px;">Empresa</th>
                    <th style="width: 170px; cursor: pointer;" onclick="setRemedySort('sla')">SLA${slaSortIcon}</th>
                    <th style="width: 120px; cursor: pointer;" onclick="setRemedySort('createdAt')">Creado${createdSortIcon}</th>
                    <th style="width: 220px; text-align: center;">Acción</th>
                </tr>
            `;
        }
    }

    document.getElementById('remedyCount').textContent = `${filtered.length} ticket${filtered.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 32px; color: var(--text-faint);">No hay tickets en esta categoría.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(t => {
        const isClosed = t.status === '4' || t.status === '5' || String(t.status || '').toLowerCase().includes('resolve') || String(t.status || '').toLowerCase().includes('complete') || filter === 'MY_CLOSED';
        const isPending = t.status === '3' || String(t.status || '').toLowerCase().includes('pending');
        
        const showSLA = !(isMyTickets && t.type === 'WO') && !isClosed;
        let slaHtml = '';
        if (showSLA && t.slaDate) {
            const pct = getSLAPercentage(t.created_at || t.createdAt, t.slaDate, isPending);
            const color = getSLAColor(t.slaStatus, t.slaDate, isPending);
            const slaText = formatSLADate(t.slaDate, isPending);
            
            const barBackground = isPending
                ? `repeating-linear-gradient(45deg, ${color}, ${color} 10px, rgba(255,255,255,0.2) 10px, rgba(255,255,255,0.2) 20px)`
                : color;

            slaHtml = `
                <div style="display: flex; flex-direction: column; gap: 4px; width: 100%; max-width: 155px; padding: 2px 0; overflow: hidden;">
                    <div style="position: relative; width: 100%; height: 8px; background: var(--surface-3); border-radius: 4px; display: flex; align-items: center; overflow: hidden;">
                        <div style="height: 100%; width: ${pct}%; background: ${barBackground}; border-radius: 4px; transition: width 0.4s ease;"></div>
                    </div>
                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 100%;" title="${escapeHtml(slaText)}">
                        ${escapeHtml(slaText)}
                    </span>
                </div>
            `;
        } else {
            slaHtml = `<span class="status-pill" style="background: var(--surface-3); color: var(--text-faint); font-size:10px; font-weight:700;">Sin SLA</span>`;
        }

        // Acción: tarjetas sin asignar -> Tomar; mis tickets -> dropdown de estado.
        // Todos los tickets son válidos para ser tomados y asignados al tracker.
        const isEquip = isEquipmentElementType(t.element_type);
        let actionHtml = '';
        if (isClosed) {
            actionHtml = `<span class="status-pill" style="background: var(--surface-3); color: #107c10; font-size:11px; font-weight:700; border: 1px solid rgba(16,124,16,0.25);">Resuelto / Cerrado</span>`;
        } else if (isAllAssigned) {
            actionHtml = `<span class="status-pill" style="background: var(--primary-soft); color: var(--primary); font-size: 11px; font-weight: 700; border: 1px solid rgba(0, 120, 212, 0.25); max-width: 200px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(t.assignee_name || 'Sin asignar')}">${escapeHtml(t.assignee_name || 'Sin asignar')}</span>`;
        } else if (isMyTickets) {
            const statusValLower = String(t.status || '').toLowerCase();
            const initialStatus = (statusValLower === '2' || statusValLower.includes('progress') || statusValLower === 'in progress') ? 'inprogress' : ((statusValLower === '3' || statusValLower.includes('pending') || statusValLower === 'pending') ? 'pending' : ((statusValLower === '4' || statusValLower.includes('resolve') || statusValLower.includes('complete') || statusValLower === 'resolved') ? 'resolved' : 'assigned'));
            actionHtml = `
                <select class="ticket-status-select" data-tid="${escapeHtml(t.id)}" data-type="${escapeHtml(t.type)}" data-previous-value="${initialStatus}"
                    style="padding: 4px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-family: inherit; cursor: pointer;"
                    onchange="handleRemedyStatusChange(this)">
                    <option value="assigned" ${(t.status === '1' || t.status === 'Assigned') ? 'selected' : ''}>Asignado</option>
                    <option value="inprogress" ${(t.status === '2' || t.status === 'In Progress' || t.status === 'InProgress') ? 'selected' : ''}>En curso</option>
                    <option value="pending" ${(t.status === '3' || t.status === 'Pending') ? 'selected' : ''}>Pendiente</option>
                    <option value="resolved" ${(t.status === '4' || t.status === 'Resolved' || t.status === 'Completed') ? 'selected' : ''}>Resuelto</option>
                </select>`;
        } else {
            actionHtml = `
                <button class="btn btn-ghost" onclick="takeRemedyTicket('${escapeHtml(t.id)}')" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                    <i data-lucide="plus-circle" style="width:13px; height:13px;"></i> Tomar
                </button>`;
        }
        const elementBadge = t.element_type
            ? `<span style="display: inline-block; padding: 1px 6px; font-size: 10px; font-weight: 600; border-radius: 3px; background: var(--primary-soft); color: var(--primary); flex-shrink: 0;">${escapeHtml(t.element_type)}</span>`
            : '';

        return `
            <tr style="cursor: pointer;" onclick="if (!event.target.closest('button') && !event.target.closest('select')) showRemedyTicketDetails('${escapeHtml(t.id)}', '${filter}')" ondblclick="event.stopPropagation(); navigator.clipboard.writeText('${escapeHtml(t.id)}'); toast('Copiado: ${escapeHtml(t.id)}', 'success');">
                <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <strong style="color: var(--primary); font-family: monospace;">${escapeHtml(t.id)}</strong>
                        <button class="btn btn-ghost" title="Copiar ticket" onclick="event.stopPropagation(); navigator.clipboard.writeText('${escapeHtml(t.id)}'); toast('Copiado: ${escapeHtml(t.id)}', 'success');" style="padding: 0; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; min-width: 22px; border: none; background: transparent; cursor: pointer; color: var(--text-faint);">
                            <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
                        </button>
                    </div>
                </td>
                <td><strong style="display: block; max-width: 145px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(t.clientName || 'Sin nombre')}">${escapeHtml(t.clientName || 'Sin nombre')}</strong></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text); max-width: 480px; overflow: hidden;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;" title="${escapeHtml(t.summary)}">${escapeHtml(t.summary)}</span>
                        ${elementBadge}
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(t.description || 'Sin descripción.')}">${escapeHtml(t.description || 'Sin descripción.')}</div>
                </td>
                <td><span class="company-badge company-badge--${(t.company || '').toLowerCase().replace(/\s+/g, '_')}">${escapeHtml(t.company || '—')}</span></td>
                <td>${slaHtml}</td>
                <td style="font-size: 12px; color: var(--text-muted);">${formatDateTime(t.created_at || t.createdAt)}</td>
                <td style="text-align: center;">${actionHtml}</td>
            </tr>
        `;
    }).join('');
    renderIcons();
}

// Handler del dropdown de estado en mis tickets
async function handleRemedyStatusChange(selectEl) {
    const tid = selectEl.dataset.tid;
    const ticketType = selectEl.dataset.type;
    const newStatus = selectEl.value;
    const previousValue = selectEl.dataset.previousValue || 'assigned';

    if (newStatus === 'resolved') {
        // Abrir modal de nota de resolución
        window._resolveCtx = {
            tid,
            ticketType,
            selectEl,
            previousValue, // Conservamos el estado previo real por si cancela
            onSuccess: async () => {
                selectEl.dataset.previousValue = 'resolved';
                if (typeof loadRemedyTickets === 'function') await loadRemedyTickets();
                if (typeof refresh === 'function') await refresh();
                if (typeof renderList === 'function') renderList();
            }
        };
        const cc = (window.cases || []).find(x => x.wo === tid);
        let defaultNote = '';
        if (cc) {
            if (cc.tipo === 'vincha') {
                defaultNote = 'Vincha entregada, resuelta.';
            } else if (cc.tipo === 'kit') {
                defaultNote = 'Kit Inalambrico entregado, resuelto.';
            } else if (cc.tipo === 'cargador') {
                defaultNote = 'Cargador entregado, resuelto.';
            }
        }
        document.getElementById('resolveRemedyTicketId').textContent = tid;
        document.getElementById('resolveRemedyNote').value = defaultNote;
        document.getElementById('resolveRemedyError').style.display = 'none';
        document.getElementById('resolveRemedyModal').classList.add('open');
        return;
    }

    selectEl.disabled = true;
    try {
        await API.changeRemedyStatus(tid, ticketType, newStatus);
        selectEl.dataset.previousValue = newStatus;
        const statusNames = { 'assigned': 'Asignado', 'inprogress': 'En curso', 'pending': 'Pendiente', 'resolved': 'Resuelto' };
        toast(`Ticket ${tid} → ${statusNames[newStatus] || newStatus}`, 'success');
        if (typeof loadRemedyTickets === 'function') await loadRemedyTickets();
        if (typeof refresh === 'function') await refresh();
        if (typeof renderList === 'function') renderList();
    } catch (e) {
        toast('Error: ' + e.message, 'error');
        selectEl.value = previousValue; // revertir
    } finally {
        selectEl.disabled = false;
    }
}

window.handleRemedyStatusChange = handleRemedyStatusChange;

// Modal de resolución
document.getElementById('resolveRemedyClose').addEventListener('click', () => {
    document.getElementById('resolveRemedyModal').classList.remove('open');
    const fileInp = document.getElementById('resolveRemedyFile');
    if (fileInp) fileInp.value = '';
    if (_resolveCtx?.selectEl) {
        const prev = _resolveCtx.previousValue || 'assigned';
        _resolveCtx.selectEl.value = prev;
        _resolveCtx.selectEl.dataset.previousValue = prev;
    }
    window._resolveCtx = null;
});
document.getElementById('resolveRemedyCancel').addEventListener('click', () => {
    document.getElementById('resolveRemedyModal').classList.remove('open');
    const fileInp = document.getElementById('resolveRemedyFile');
    if (fileInp) fileInp.value = '';
    if (_resolveCtx?.selectEl) {
        const prev = _resolveCtx.previousValue || 'assigned';
        _resolveCtx.selectEl.value = prev;
        _resolveCtx.selectEl.dataset.previousValue = prev;
    }
    window._resolveCtx = null;
});

document.getElementById('resolveRemedyConfirm').addEventListener('click', async () => {
    if (!_resolveCtx) return;
    const note = document.getElementById('resolveRemedyNote').value.trim();
    const fileInp = document.getElementById('resolveRemedyFile');
    const file = fileInp ? (fileInp.files[0] || null) : null;
    const errEl = document.getElementById('resolveRemedyError');
    const confirmLabel = document.getElementById('resolveRemedyConfirmLabel');
    
    if (!note) {
        errEl.textContent = 'La nota de resolución es obligatoria.';
        errEl.style.display = 'block';
        return;
    }
    
    confirmLabel.textContent = 'Resolviendo...';
    document.getElementById('resolveRemedyConfirm').disabled = true;
    errEl.style.display = 'none';
    
    try {
        const { tid, ticketType, selectEl, onSuccess } = _resolveCtx;
        const res = await API.changeRemedyStatus(tid, ticketType, 'resolved', note, file);
        
        if (res && res.file_error) {
            Swal.fire({
                icon: 'warning',
                title: 'Ticket Resuelto con Advertencia',
                text: res.file_error,
                confirmButtonColor: 'var(--primary)'
            });
        } else {
            toast(`Ticket ${tid} marcado como Resuelto`, 'success');
        }

        const draft = res && res.outlook_draft;
        if (draft) {
            if (draft.opened) {
                toast('Draft de Outlook abierto para Rafa (sin enviar)', 'success');
            } else if (draft.reason && !draft.reason.includes('no tiene template_firmado adjunto') && !draft.reason.includes('no hay case con wo=')) {
                toast(`No se abrio draft Outlook: ${draft.reason}`, 'warning');
            }
        }
        
        document.getElementById('resolveRemedyModal').classList.remove('open');
        if (fileInp) fileInp.value = '';
        window._resolveCtx = null;
        if (typeof onSuccess === 'function') {
            await onSuccess();
        }
    } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
    } finally {
        confirmLabel.textContent = 'Confirmar resolución';
        document.getElementById('resolveRemedyConfirm').disabled = false;
    }
});


function showRemedyTicketDetails(id, filter) {
    filter = filter || window.currentRemedyFilter;
    const t = window.remedyTickets.find(x => x.id === id) ||
              window.myOpenTickets.find(x => x.id === id) ||
              window.myClosedTickets.find(x => x.id === id) ||
              (window.allAssignedTickets && window.allAssignedTickets.find(x => x.id === id));
    if (!t) return;

    // Determinar si es un ticket "ajeno" (en cartelera) o propio
    const isOwn = window.myOpenTickets.some(x => x.id === id) || window.myClosedTickets.some(x => x.id === id);
    const isCartelera = window.remedyTickets.some(x => x.id === id) && !isOwn;

    // Botones de acción en el footer de Swal
    let footerButtons = '';
    if (window.remedyConnected && isCartelera) {
        footerButtons = `
            <div style="display: flex; gap: 8px; justify-content: center; margin-top: 4px;">
                <button id="swalBtnTomar" class="swal2-confirm swal2-styled" style="background: var(--primary); font-size: 13px; padding: 8px 18px; display: inline-flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                    Tomar
                </button>
                <button id="swalBtnAsignar" class="swal2-confirm swal2-styled" style="background: var(--surface-2); color: var(--text); border: 1px solid var(--border); font-size: 13px; padding: 8px 18px; display: inline-flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    Asignar a…
                </button>
            </div>`;
    }

    let assigneeRow = '';
    if (t.assignee_name || t.assignee_login) {
        assigneeRow = `<strong>Técnico:</strong> <span><span class="status-pill" style="background: var(--primary-soft); color: var(--primary); font-weight: 600; font-size: 11px; padding: 2px 6px;">${escapeHtml(t.assignee_name || t.assignee_login)}</span></span>`;
    }

    Swal.fire({
        title: `<div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span style="font-family: monospace; color: var(--primary);">${escapeHtml(t.id)}</span>
                    <button class="btn btn-ghost" title="Copiar ticket" onclick="event.stopPropagation(); navigator.clipboard.writeText('${escapeHtml(t.id)}'); toast('Copiado: ${escapeHtml(t.id)}', 'success');" style="padding: 0; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); cursor: pointer; color: var(--text-muted); min-width: 26px;">
                        <i data-lucide="copy" style="width: 13px; height: 13px;"></i>
                    </button>
                </div>`,
        html: `
            <div style="text-align: left; font-size: 13.5px; line-height: 1.5; color: var(--text);">
                <div style="margin-bottom: 12px; display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; border-bottom: 1px solid var(--border); padding-bottom: 12px;">
                    <strong>Solicitante:</strong> <span>${escapeHtml(t.clientName || 'Sin nombre')}</span>
                    <strong>Empresa:</strong> <span>${escapeHtml(t.company)}</span>
                    <strong>Creado:</strong> <span>${formatDateTime(t.created_at || t.createdAt)}</span>
                    <strong>SLA / SLM:</strong> <span>${t.slaDate ? `<span style="color: ${getSLAColor(t.slaStatus, t.slaDate)}; font-weight: 600;">${escapeHtml(formatSLADate(t.slaDate))}</span>` : '<span style="color: var(--text-faint);">Sin SLA registrado</span>'}</span>
                    ${assigneeRow}
                </div>
                <div>
                    <div style="font-weight: bold; margin-bottom: 6px; color: var(--text-muted); font-size: 12px; text-transform: uppercase;">Tipificación:</div>
                    <div style="background: var(--surface-2); padding: 8px 12px; border-radius: var(--radius); font-weight: 600; margin-bottom: 12px; border: 1px solid var(--border);">${escapeHtml(t.summary)}</div>

                    <div style="font-weight: bold; margin-bottom: 6px; color: var(--text-muted); font-size: 12px; text-transform: uppercase;">Descripción Detallada:</div>
                    <div style="background: var(--surface-2); padding: 12px; border-radius: var(--radius); border: 1px solid var(--border); max-height: 240px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; font-size: 13px;">${escapeHtml(t.description || 'Sin descripción detallada.')}</div>
                </div>
                ${footerButtons}
            </div>
        `,
        showConfirmButton: false,
        showCloseButton: true,
        width: '560px',
        didOpen: () => {
            if (window.lucide) lucide.createIcons();

            // Bind "Tomar"
            const btnTomar = document.getElementById('swalBtnTomar');
            if (btnTomar) {
                btnTomar.addEventListener('click', async () => {
                    Swal.close();
                    await takeRemedyTicket(id);
                });
            }

            // Bind "Asignar a"
            const btnAsignar = document.getElementById('swalBtnAsignar');
            if (btnAsignar) {
                btnAsignar.addEventListener('click', () => {
                    Swal.close();
                    assignRemedyTicketToUser(t);
                });
            }
        }
    });
}


async function assignRemedyTicketToUser(t) {
    if (!window.remedyConnected) {
        toast('Debes conectarte a Remedy primero', 'error');
        return;
    }

    // Cargar técnicos de la org
    let users = [];
    try {
        users = await API.listOrgUsers();
    } catch (e) {
        toast('Error al cargar técnicos: ' + e.message, 'error');
        return;
    }

    if (!users.length) {
        toast('No hay otros técnicos en tu organización', 'error');
        return;
    }

    const optionsHtml = users.map(u =>
        `<option value="${escapeHtml(u.username)}" data-name="${escapeHtml(u.name)}" data-uid="${escapeHtml(String(u.id))}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`
    ).join('');

    const { value: selectedTech, isConfirmed } = await Swal.fire({
        title: `Asignar ticket ${escapeHtml(t.id)}`,
        html: `
            <div style="text-align: left;">
                <label style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 6px;">
                    Técnico destino
                </label>
                <select id="swalAssignSelect" style="width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 13px; font-family: inherit;">
                    <option value="">— Seleccioná un técnico —</option>
                    ${optionsHtml}
                </select>
                <div id="swalAssignError" style="display:none; color: var(--danger); font-size: 12px; margin-top: 8px;"></div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Asignar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--primary)',
        preConfirm: () => {
            const sel = document.getElementById('swalAssignSelect');
            const val = sel?.value;
            const errEl = document.getElementById('swalAssignError');
            if (!val) {
                if (errEl) { errEl.textContent = 'Seleccioná un técnico.'; errEl.style.display = 'block'; }
                return false;
            }
            const selectedOpt = sel.options[sel.selectedIndex];
            return {
                username: val,
                name: selectedOpt.getAttribute('data-name')
            };
        },
        didOpen: () => {
            if (window.lucide) lucide.createIcons();
        }
    });

    if (!isConfirmed || !selectedTech) return;

    try {
        await API.takeRemedyTicket(t.id, t.type, selectedTech.name, selectedTech.username);
        toast(`Ticket ${t.id} asignado a ${selectedTech.name} en Remedy`, 'success');

        if (typeof window.loadRemedyTickets === 'function') await window.loadRemedyTickets();
        if (typeof window.refresh === 'function') await window.refresh();
    } catch (e) {
        toast('Error al asignar ticket: ' + e.message, 'error');
    }
}


async function takeRemedyTicket(id) {
    const t = (window.remedyTickets || []).find(x => x.id === id);
    if (!t) {
        toast('Ticket no encontrado. Recargá la cartelera.', 'error');
        return;
    }

    if (!window.remedyConnected) {
        toast('Debes conectarte a Remedy primero', 'error');
        return;
    }

    if (!window.currentUser) {
        toast('Sesión no disponible. Recargá la página.', 'error');
        return;
    }

    try {
        const assigneeName = window.currentUser.name || window.currentUser.username || '';
        const assigneeUsername = window.currentUser.username || '';
        const result = await API.takeRemedyTicket(id, t.type, assigneeName, assigneeUsername);
        if (result === null) {
            toast('Sesión de Remedy expirada. Volvé a conectar.', 'warning');
            return;
        }
        toast(`Ticket ${id} asignado correctamente en Remedy`, 'success');
        
        if (typeof window.loadRemedyTickets === 'function') await window.loadRemedyTickets();
        
        // Refrescar los casos para traer el ticket asignado a la vista Kanban
        if (typeof window.refresh === 'function') await window.refresh();
        
    } catch (e) {
        toast('Error al tomar ticket: ' + e.message, 'error');
    }
}

// Buscador de cartelera Remedy
const remedySearchInput = document.getElementById('remedySearch');
if (remedySearchInput) {
    remedySearchInput.addEventListener('input', () => {
        renderRemedyTickets();
    });
}




// Expose to window for global module compatibility
window.loadClosedTicketsForList = loadClosedTicketsForList;
window.showRemedyExpirationWarning = showRemedyExpirationWarning;
window.startRemedyTokenCountdown = startRemedyTokenCountdown;
window.updateRemedyStatusUI = updateRemedyStatusUI;
window.showRemedyLoginDialog = showRemedyLoginDialog;
window.loadRemedyTickets = loadRemedyTickets;
window.isEquipmentElementType = isEquipmentElementType;
window.renderRemedyTickets = renderRemedyTickets;
window.showRemedyTicketDetails = showRemedyTicketDetails;
window.assignRemedyTicketToUser = assignRemedyTicketToUser;
window.takeRemedyTicket = takeRemedyTicket;
