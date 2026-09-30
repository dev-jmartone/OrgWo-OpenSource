// ============================================================
// CONFIGURACIÓN DE AGRUPACIÓN POR LISTAS (CRUD + Persistencia)
// ============================================================

// ── Matriz de Prioridad Remedy (Impact × Urgency) ────────────────────────────
// Urgency: "1-Critical","2-High","3-Medium","4-Low"  (o el número solo)
// Impact:  "1-Extensive/Widespread","2-Significant/Large","3-Moderate/Limited","4-Minor/Localized"
// Resultado: { label, color, bg }
function calcRemedyPriority(urgencyRaw, impactRaw) {
    const u = parseInt((urgencyRaw || '').toString().trim().charAt(0)) || 0;
    const i = parseInt((impactRaw  || '').toString().trim().charAt(0)) || 0;

    // Matriz 4×4 según tabla BMC estándar
    const matrix = {
        '1-1': 'critica',
        '1-2': 'alta',  '1-3': 'alta',
        '1-4': 'media',
        '2-1': 'alta',  '2-2': 'alta',
        '2-3': 'media', '2-4': 'media',
        '3-1': 'alta',
        '3-2': 'media', '3-3': 'media',
        '3-4': 'baja',
        '4-1': 'media', '4-2': 'media',
        '4-3': 'baja',  '4-4': 'baja',
    };

    const key = `${i}-${u}`;
    const level = matrix[key] || null;

    const styles = {
        critica: { label: 'Crítica',  color: '#c62828', bg: 'rgba(198,40,40,0.12)',  dot: '#c62828' },
        alta:    { label: 'Alta',     color: '#e65100', bg: 'rgba(230,81,0,0.12)',   dot: '#e65100' },
        media:   { label: 'Media',    color: '#f9a825', bg: 'rgba(249,168,37,0.12)', dot: '#f9a825' },
        baja:    { label: 'Baja',     color: '#2e7d32', bg: 'rgba(46,125,50,0.12)',  dot: '#2e7d32' },
    };

    return level ? { ...styles[level], level } : null;
}

function remedyPriorityChip(urgency, impact) {
    const p = calcRemedyPriority(urgency, impact);
    if (!p) {
        return `<span style="color: var(--text-faint); font-size: 11px;">—</span>`;
    }
    const urgNum = parseInt((urgency || '').toString().trim().charAt(0)) || '?';
    const impNum = parseInt((impact  || '').toString().trim().charAt(0)) || '?';
    const tooltip = `Impacto ${impNum} · Urgencia ${urgNum} → ${p.label}`;
    return `<span title="${tooltip}" style="
        display: inline-block;
        width: 10px; height: 10px; border-radius: 50%;
        background: ${p.dot}; cursor: default;
    "></span>`;
}
// ─────────────────────────────────────────────────────────────────────────────

let closedSearchTimeout = null;
const selectedCaseIds = new Set(); // Set global para preservar la selección masiva de casos
let listGroups = [
    { id: 'default-inc', label: 'Incidentes', isDefault: true },
    { id: 'default-wo', label: 'Work Orders', isDefault: true }
];
let listTicketAssignments = {};
window.listGroups = listGroups;
window.listTicketAssignments = listTicketAssignments;
let listGroupsCollapsed = {};
let listTicketOrder = {};          // { groupId: [caseId, ...] } — orden personalizado dentro del grupo
let listGroupingLoaded = false;
let listGroupingPromise = null;
let enabledWidgets = ['inc-open', 'remedy-group-open', 'wo-open', 'inc-closed', 'wo-closed', 'kits-today', 'sla-alerts', 'closed-typifications'];
window.enabledWidgets = enabledWidgets;

async function loadListGroupingConfig() {
    try {
        const settings = await API.getUserSettings();
        if (settings && !Array.isArray(settings)) {
            if (settings.list_groups && settings.list_groups.length > 0) {
                listGroups = settings.list_groups;
                window.listGroups = listGroups;
            }
            if (settings.list_ticket_assignments) {
                listTicketAssignments = settings.list_ticket_assignments;
                window.listTicketAssignments = listTicketAssignments;
            }
            if (settings.list_groups_collapsed) {
                listGroupsCollapsed = settings.list_groups_collapsed;
            }
            if (settings.list_ticket_order) {
                listTicketOrder = settings.list_ticket_order;
            }
            if (settings.enabled_widgets) {
                enabledWidgets = settings.enabled_widgets.slice(0, 8);
                window.enabledWidgets = enabledWidgets;
            }
        }
    } catch (e) {
        console.error("Error loading list grouping config:", e);
    }
}

async function saveListGroupingConfig() {
    try {
        if (window.listGroups) listGroups = window.listGroups;
        if (window.listTicketAssignments) listTicketAssignments = window.listTicketAssignments;

        const settings = await API.getUserSettings();
        let newSettings = (settings && !Array.isArray(settings)) ? { ...settings } : {};
        newSettings.list_groups = listGroups;
        newSettings.list_ticket_assignments = listTicketAssignments;
        newSettings.list_groups_collapsed = listGroupsCollapsed;
        newSettings.list_ticket_order = listTicketOrder;
        newSettings.enabled_widgets = enabledWidgets;
        await API.saveUserSettings(newSettings);
    } catch (e) {
        console.error("Error saving list grouping config:", e);
    }
}

// ============================================================
// CONTROLADORES DE EVENTOS DRAG & DROP Y CRUD
// ============================================================
window.handleRowDragStart = function(e, caseId) {
    e.dataTransfer.setData('text/plain', caseId);
    // Guardar grupo de origen para distinguir reorder vs move-to-group
    const tbody = e.target.closest('tbody.group-tbody');
    if (tbody) {
        e.dataTransfer.setData('text/source-group', tbody.dataset.groupId || '');
    }
    const row = e.target.closest('tr');
    if (row) {
        row.classList.add('dragging-row');
        row.dataset.draggingId = caseId;
    }
    window._draggingCaseId = caseId;
    window._draggingSourceGroup = tbody ? tbody.dataset.groupId : '';
};

window.handleRowDragEnd = function(e) {
    const row = e.target.closest('tr');
    if (row) {
        row.classList.remove('dragging-row');
    }
    document.querySelectorAll('.group-tbody').forEach(tb => tb.classList.remove('drag-over'));
};

window.handleGroupDragOver = function(e) {
    e.preventDefault();
    const tbody = e.target.closest('tbody');
    if (tbody) {
        tbody.classList.add('drag-over');
    }
};

window.handleGroupDragLeave = function(e) {
    const tbody = e.target.closest('tbody');
    if (tbody) {
        tbody.classList.remove('drag-over');
    }
};

window.handleGroupDrop = async function(e, groupId) {
    e.preventDefault();
    const tbody = e.target.closest('tbody');
    if (tbody) tbody.classList.remove('drag-over');

    const caseId = e.dataTransfer.getData('text/plain');
    const sourceGroup = e.dataTransfer.getData('text/source-group') || window._draggingSourceGroup || '';
    if (!caseId || !groupId) return;

    // Si la drop ocurre sobre una ROW del mismo grupo → reorden interno
    const targetRow = e.target.closest('tr:not(.group-header-row)');
    if (targetRow && sourceGroup === groupId) {
        await window.handleRowReorder(caseId, groupId, targetRow);
        return;
    }

    // Move ticket a otro grupo
    listTicketAssignments[caseId] = groupId;
    // Limpiar posición antigua en el orden del grupo origen
    if (sourceGroup && listTicketOrder[sourceGroup]) {
        listTicketOrder[sourceGroup] = listTicketOrder[sourceGroup].filter(id => id !== String(caseId));
    }
    await saveListGroupingConfig();
    renderList();
    toast('Ticket movido de grupo', 'success');
};

/**
 * Reordena un ticket dentro del mismo grupo.
 * targetRow = la <tr> sobre la que se soltó el elemento arrastrado.
 */
window.handleRowReorder = async function(caseId, groupId, targetRow) {
    const targetId = targetRow ? targetRow.dataset.caseId : null;
    if (!targetId || targetId === String(caseId)) return;

    // Obtener el orden actual del grupo
    const tbody = document.querySelector(`.group-tbody[data-group-id="${groupId}"]`);
    const currentOrder = [];
    if (tbody) {
        tbody.querySelectorAll('tr[data-case-id]').forEach(row => {
            currentOrder.push(row.dataset.caseId);
        });
    }

    // Reordenar: mover caseId antes de targetId
    const newOrder = currentOrder.filter(id => id !== String(caseId));
    const insertAt = newOrder.indexOf(String(targetId));
    if (insertAt === -1) {
        newOrder.push(String(caseId));
    } else {
        newOrder.splice(insertAt, 0, String(caseId));
    }

    listTicketOrder[groupId] = newOrder;
    await saveListGroupingConfig();
    renderList();
};

window.isDraggingGroupHeader = false;

window.handleGroupHeaderDragStart = function(e, groupId) {
    window.isDraggingGroupHeader = true;
    e.dataTransfer.setData('text/group-id', groupId);
    const tr = e.target.closest('tr');
    if (tr) tr.classList.add('dragging-group-header');
    e.stopPropagation();
};

window.handleGroupHeaderDragEnd = function(e) {
    const tr = e.target.closest('tr');
    if (tr) tr.classList.remove('dragging-group-header');
    document.querySelectorAll('.group-header-row').forEach(row => row.classList.remove('group-drag-over'));
    
    // Clear flag after click event has had a chance to fire
    setTimeout(() => {
        window.isDraggingGroupHeader = false;
    }, 100);
};

window.handleGroupHeaderDragOver = function(e) {
    if (e.dataTransfer.types.includes('text/group-id')) {
        e.preventDefault();
        const tr = e.target.closest('tr');
        if (tr) tr.classList.add('group-drag-over');
    }
};

window.handleGroupHeaderDragLeave = function(e) {
    const tr = e.target.closest('tr');
    if (tr) tr.classList.remove('group-drag-over');
};

window.handleGroupHeaderDrop = async function(e, targetGroupId) {
    e.preventDefault();
    const tr = e.target.closest('tr');
    if (tr) tr.classList.remove('group-drag-over');
    
    const sourceGroupId = e.dataTransfer.getData('text/group-id');
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) return;

    const sourceIdx = listGroups.findIndex(g => g.id === sourceGroupId);
    const targetIdx = listGroups.findIndex(g => g.id === targetGroupId);
    if (sourceIdx !== -1 && targetIdx !== -1) {
        // Move element in listGroups array
        const [moved] = listGroups.splice(sourceIdx, 1);
        listGroups.splice(targetIdx, 0, moved);
        
        await saveListGroupingConfig();
        renderList();
        toast('Orden de listas actualizado', 'success');
    }
};

window.createNewGroup = async function() {
    const { value: name } = await Swal.fire({
        title: 'Crear nuevo grupo',
        input: 'text',
        inputLabel: 'Nombre del grupo',
        inputPlaceholder: 'Ej: Entregas Urgentes',
        showCancelButton: true,
        confirmButtonColor: 'var(--primary)',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Crear',
        inputValidator: (value) => {
            if (!value) return '¡El nombre no puede estar vacío!';
            if (listGroups.some(g => g.label.toLowerCase() === value.trim().toLowerCase())) {
                return 'Ya existe un grupo con ese nombre';
            }
        }
    });
    if (name) {
        const newId = 'group_' + Date.now();
        listGroups.push({ id: newId, label: name.trim(), isDefault: false });
        await saveListGroupingConfig();
        renderList();
        toast(`Grupo "${name}" creado`, 'success');
    }
};

window.renameGroup = async function(groupId) {
    const group = listGroups.find(g => g.id === groupId);
    if (!group || group.isDefault) return;
    const { value: name } = await Swal.fire({
        title: 'Renombrar grupo',
        input: 'text',
        inputLabel: 'Nuevo nombre del grupo',
        inputValue: group.label,
        showCancelButton: true,
        confirmButtonColor: 'var(--primary)',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Guardar',
        inputValidator: (value) => {
            if (!value) return '¡El nombre no puede estar vacío!';
            if (listGroups.some(g => g.id !== groupId && g.label.toLowerCase() === value.trim().toLowerCase())) {
                return 'Ya existe un grupo con ese nombre';
            }
        }
    });
    if (name) {
        group.label = name.trim();
        await saveListGroupingConfig();
        renderList();
        toast('Grupo renombrado', 'success');
    }
};

window.deleteGroup = async function(groupId) {
    const group = listGroups.find(g => g.id === groupId);
    if (!group || group.isDefault) return;
    const { isConfirmed } = await Swal.fire({
        title: '¿Eliminar grupo?',
        text: `Los tickets dentro del grupo "${group.label}" volverán a sus grupos por defecto (Incidentes o Work Orders).`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--danger)',
        cancelButtonColor: 'var(--text-faint)',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });
    if (isConfirmed) {
        listGroups = listGroups.filter(g => g.id !== groupId);
        window.listGroups = listGroups;
        for (const [caseId, gId] of Object.entries(listTicketAssignments)) {
            if (gId === groupId) {
                delete listTicketAssignments[caseId];
            }
        }
        await saveListGroupingConfig();
        renderList();
        toast('Grupo eliminado', 'success');
    }
};

window.toggleGroupCollapse = function(groupId) {
    if (window.isDraggingGroupHeader) return;
    listGroupsCollapsed[groupId] = !listGroupsCollapsed[groupId];
    saveListGroupingConfig();
    renderList();
};

/** Ordena los tickets del grupo por fechaRetiro ascendente y persiste ese orden. */
window.sortGroupByDate = async function(groupId) {
    const tbody = document.querySelector(`.group-tbody[data-group-id="${groupId}"]`);
    if (!tbody) return;
    const currentIds = [];
    tbody.querySelectorAll('tr[data-case-id]').forEach(row => currentIds.push(row.dataset.caseId));

    // Ordenar por fechaRetiro asc; sin fecha van al final
    const casesInGroup = (window.cases || []).filter(c => {
        const id = String(c.id || c.wo);
        return currentIds.includes(id);
    });
    casesInGroup.sort((a, b) => {
        const ta = a.fechaRetiro ? new Date(String(a.fechaRetiro).replace(' ', 'T')).getTime() : 9e15;
        const tb = b.fechaRetiro ? new Date(String(b.fechaRetiro).replace(' ', 'T')).getTime() : 9e15;
        return ta - tb;
    });

    listTicketOrder[groupId] = casesInGroup.map(c => String(c.id || c.wo));
    await saveListGroupingConfig();
    renderList();
    toast('Grupo ordenado por fecha de retiro', 'success');
};

/** Borra el orden personalizado del grupo y vuelve al sort global. */
window.resetGroupOrder = async function(groupId) {
    delete listTicketOrder[groupId];
    await saveListGroupingConfig();
    renderList();
    toast('Orden personalizado eliminado', 'success');
};

// ============================================================
// AUXILIAR: RENDER DE UNA FILA DE CASO Y ACCIONES RÁPIDAS
// ============================================================
window.quickTransferTicket = function(caseId) {
    window.currentCaseId = caseId;
    const btn = document.getElementById('btnTransferTicket');
    if (btn) {
        btn.click();
    }
};

window.quickCommentRemedy = async function(wo, ticketType) {
    const { value: comment } = await Swal.fire({
        title: `Comentar en Remedy — ${wo}`,
        input: 'textarea',
        inputPlaceholder: 'Escribe un comentario para Remedy...',
        showCancelButton: true,
        confirmButtonColor: 'var(--primary)',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Enviar',
        inputValidator: (value) => {
            if (!value.trim()) return '¡El comentario no puede estar vacío!';
        }
    });
    if (comment) {
        Swal.fire({
            title: 'Enviando comentario...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
        try {
            await API.addRemedyComment(wo, ticketType, comment.trim());
            toast('Comentario registrado en Remedy', 'success');
            Swal.close();
        } catch (e) {
            Swal.fire({
                icon: 'error',
                title: 'Error al enviar comentario',
                text: e.message || 'No se pudo registrar el comentario'
            });
        }
    }
};

function renderListRow(c, tabFilter) {
    const estado = window.ESTADOS.find(e => e.id === c.estado);

    // Badge visual por empresa
    const comp = getCompanyForCase(c);
    const companyBadge = comp
        ? `<span class="company-badge company-badge--${comp.toLowerCase().replace(/\s+/g, '_')}">${escapeHtml(comp)}</span>`
        : '<span style="color: var(--text-faint);">—</span>';

    const onclickAction = `openCase('${c.id}')`;

    const ticketCell = c.wo
        ? `<div style="display: flex; align-items: center; gap: 6px;">
             <strong style="font-family: monospace; color: var(--primary); font-size: 12.5px;">${escapeHtml(c.wo)}</strong>
             <button class="btn btn-ghost" title="Copiar ticket" onclick="event.stopPropagation(); navigator.clipboard.writeText('${escapeHtml(c.wo)}'); toast('Copiado: ${escapeHtml(c.wo)}', 'success');" style="padding: 0; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; min-width: 22px; border: none; background: transparent; cursor: pointer; color: var(--text-faint);">
                 <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
             </button>
           </div>`
        : '<span style="color: var(--text-faint); font-size: 12px;">Manual</span>';

    // Pausas y lógica de SLA
    let slaHtml = '';
    const isWO = c.wo && String(c.wo).toUpperCase().startsWith('WO');
    const isClosed = tabFilter === 'closed' || ['done', 'reject', 'not_accepted'].includes(c.estado);
    
    // Un ticket está pausado/pending si su estado es pending ("3") o SQLite "wait" (Pendiente)
    const isPending = (c.wo && (c.status === '3' || String(c.status || '').toLowerCase().includes('pending') || c.excelStatus === '3' || c.excelStatus === 3)) || (!c.wo && c.estado === 'wait');
    
    const hasSLA = c.slaDate && !isWO && !isClosed;
    
    if (hasSLA) {
        const color = getSLAColor(c.slaStatus, c.slaDate, isPending);
        const pct = getSLAPercentage(c.createdAt, c.slaDate, isPending);
        const slaText = formatSLADate(c.slaDate, isPending);
        
        const barBackground = isPending
            ? `repeating-linear-gradient(45deg, ${color}, ${color} 10px, rgba(255,255,255,0.2) 10px, rgba(255,255,255,0.2) 20px)`
            : color;

        slaHtml = `
            <div style="display: flex; flex-direction: column; gap: 4px; width: 100%; min-width: 140px; max-width: 180px; padding: 2px 0;">
                <div style="position: relative; width: 100%; height: 8px; background: var(--surface-3); border-radius: 4px; display: flex; align-items: center; overflow: hidden;">
                    <div style="height: 100%; width: ${pct}%; background: ${barBackground}; border-radius: 4px; transition: width 0.4s ease;"></div>
                </div>
                <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;" title="${escapeHtml(slaText)}">
                    ${escapeHtml(slaText)}
                </span>
            </div>
        `;
    } else {
        slaHtml = `<span class="status-pill" style="background: var(--surface-3); color: var(--text-faint); font-size:10px; font-weight:700;">Sin SLA</span>`;
    }

    // Columna de acción en la lista
    let actionHtml = '';
    if (isClosed) {
        actionHtml = `<span class="status-pill" style="background: var(--surface-3); color: #107c10; font-size:11px; font-weight:700; border: 1px solid rgba(16,124,16,0.25);">Resuelto / Cerrado</span>`;
    } else {
        let remedySelect = '';
        if (c.wo && window.remedyConnected) {
            const ticketType = isWO ? 'WO' : 'INC';
            const currentStatus = c.status || c.excelStatus || 'assigned';
            const statusValLower = String(currentStatus).toLowerCase();
            const initialStatus = (statusValLower === '2' || statusValLower.includes('progress') || statusValLower === 'in progress') ? 'inprogress' : ((statusValLower === '3' || statusValLower.includes('pending') || statusValLower === 'pending') ? 'pending' : ((statusValLower === '4' || statusValLower.includes('resolve') || statusValLower.includes('complete') || statusValLower === 'resolved') ? 'resolved' : 'assigned'));
            
            remedySelect = `
                <select class="ticket-status-select" data-tid="${escapeHtml(c.wo)}" data-type="${escapeHtml(ticketType)}" data-previous-value="${initialStatus}"
                    style="padding: 4px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-family: inherit; cursor: pointer; height: 32px;"
                    onchange="handleRemedyStatusChange(this)">
                    <option value="assigned" ${(currentStatus === '1' || currentStatus === 'Assigned') ? 'selected' : ''}>Asignado</option>
                    <option value="inprogress" ${(currentStatus === '2' || currentStatus === 'In Progress' || currentStatus === 'InProgress') ? 'selected' : ''}>En curso</option>
                    <option value="pending" ${(currentStatus === '3' || currentStatus === 'Pending') ? 'selected' : ''}>Pendiente</option>
                    <option value="resolved" ${(currentStatus === '4' || currentStatus === 'Resolved' || currentStatus === 'Completed') ? 'selected' : ''}>Resuelto</option>
                </select>`;
        } else {
            remedySelect = '<span style="color: var(--text-faint);">—</span>';
        }

        // Acciones rápidas (Transferir y Comentarios en Remedy)
        let quickActionsHtml = '';
        if (c.wo && window.remedyConnected) {
            const ticketType = isWO ? 'WO' : 'INC';
            quickActionsHtml = `
                <div style="display: inline-flex; gap: 4px; align-items: center; vertical-align: middle;">
                    <button class="btn btn-ghost" title="Comentar en Remedy" onclick="event.stopPropagation(); quickCommentRemedy('${escapeHtml(c.wo)}', '${escapeHtml(ticketType)}')" style="padding: 0; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; min-width: 32px; background: var(--surface);">
                        <i data-lucide="message-square-plus" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button class="btn btn-ghost" title="Transferir ticket" onclick="event.stopPropagation(); quickTransferTicket('${escapeHtml(c.id)}')" style="padding: 0; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; min-width: 32px; background: var(--surface);">
                        <i data-lucide="arrow-right-left" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            `;
        } else if (c.id && !c.isRemedyOnly) {
            // Local case without Remedy connection or manual case: only transfer
            quickActionsHtml = `
                <div style="display: inline-flex; gap: 4px; align-items: center; vertical-align: middle;">
                    <button class="btn btn-ghost" title="Transferir ticket" onclick="event.stopPropagation(); quickTransferTicket('${escapeHtml(c.id)}')" style="padding: 0; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; min-width: 32px; background: var(--surface);">
                        <i data-lucide="arrow-right-left" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            `;
        }

        actionHtml = `
            <div style="display: flex; gap: 6px; align-items: center; justify-content: center;">
                ${remedySelect}
                ${quickActionsHtml}
            </div>
        `;
    }

    const trOnclick = `if (!event.target.closest('button') && !event.target.closest('select')) ${onclickAction}`;
    const trOndblclick = c.wo
        ? `event.stopPropagation(); navigator.clipboard.writeText('${escapeHtml(c.wo)}'); toast('Copiado: ${escapeHtml(c.wo)}', 'success');`
        : '';

    if (tabFilter === 'closed') {
        return `
            <tr onclick="${trOnclick}" ondblclick="${trOndblclick}">
                <td>${ticketCell}</td>
                <td>
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.name || 'Sin nombre')}">
                        <strong>${escapeHtml(c.name || 'Sin nombre')}</strong>
                    </div>
                    <div style="font-size: 12px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.email || '')}">
                        ${escapeHtml(c.email || '')}
                    </div>
                </td>
                <td>${companyBadge}</td>
                <td style="font-size: 13px;">
                    ${(function() {
                        const tipWC = resolveTipificacion(c);
                        if (tipWC) {
                            const tipWCType = (c.id && c.id.startsWith('WO')) ? 'wo' : 'inc';
                            return `<span class="tip-badge tip-badge--${tipWCType}" title="${escapeHtml(tipWC)}">${escapeHtml(tipWC.replace(/ \(INC\)$/, '').replace(/ \(WO\)$/, ''))}</span>`;
                        }
                        return '<span style="color: var(--text-faint);">—</span>';
                    })()}
                </td>
                <td style="font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.notes || '')}">
                    ${escapeHtml(c.notes || '—')}
                </td>
            </tr>
        `;
    }

    // Checkbox for bulk actions: only enabled for active tickets
    const checkboxHtml = `<td style="text-align: center;" onclick="event.stopPropagation();">
        <input type="checkbox" class="bulk-case-checkbox" data-id="${c.id}" data-wo="${escapeHtml(c.wo || '')}" style="cursor: pointer;" ${isClosed ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''} ${selectedCaseIds.has(c.id) ? 'checked' : ''}>
    </td>`;

    // Only allow dragging active (open) cases
    const dragAttr = !isClosed ? `draggable="true" ondragstart="handleRowDragStart(event, '${c.id || c.wo}')" ondragend="handleRowDragEnd(event)"` : '';
    const trOncontextmenu = !isClosed ? `oncontextmenu="window.handleRowContextMenu(event, '${c.id || c.wo}')"` : '';

    return `
        <tr data-case-id="${escapeHtml(String(c.id || c.wo))}" ${dragAttr} ${trOncontextmenu} onclick="${trOnclick}" ondblclick="${trOndblclick}">
            ${checkboxHtml}
            <td>${ticketCell}</td>
            <td>
                <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.name || 'Sin nombre')}">
                    <strong>${escapeHtml(c.name || 'Sin nombre')}</strong>
                </div>
                <div style="font-size: 12px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.email || '')}">
                    ${escapeHtml(c.email || '')}
                </div>
            </td>
            <td>${companyBadge}</td>
            <td style="font-size: 13px;">
                ${(function() {
                    const tipWC = resolveTipificacion(c);
                    if (tipWC) {
                        const tipWCType = (c.id && c.id.startsWith('WO')) ? 'wo' : 'inc';
                        return `<span class="tip-badge tip-badge--${tipWCType}" title="${escapeHtml(tipWC)}">${escapeHtml(tipWC.replace(/ \(INC\)$/, '').replace(/ \(WO\)$/, ''))}</span>`;
                    }
                    return '<span style="color: var(--text-faint);">—</span>';
                })()}
            </td>
            <td style="font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.notes || '')}">
                ${escapeHtml(c.notes || '—')}
            </td>
            <td>
                ${slaHtml}
                ${c.priority === 'alta' ? `<div style="margin-top: 4px;"><span class="priority-badge"><i data-lucide="alert-triangle"></i> Urgente</span></div>` : ''}
            </td>
            <td style="text-align: center;">${actionHtml}</td>
        </tr>
    `;
}

// ============================================================
// WIDGETS Y CONTADORES
// ============================================================
const ALL_WIDGETS = {
    'inc-open': {
        id: 'inc-open',
        title: 'INC Asignados',
        icon: 'activity',
        color: 'var(--primary)',
        hasPopover: true,
        popoverId: 'popoverIncBreakdown',
        description: 'Incidentes abiertos asignados'
    },
    'wo-open': {
        id: 'wo-open',
        title: 'WO Asignados',
        icon: 'briefcase',
        color: 'var(--primary)',
        hasPopover: true,
        popoverId: 'popoverWoBreakdown',
        description: 'Work orders abiertas asignadas'
    },
    'inc-closed': {
        id: 'inc-closed',
        title: 'INC Cerrados (Hoy)',
        icon: 'check-circle',
        color: 'var(--success)',
        description: 'Incidentes cerrados hoy'
    },
    'wo-closed': {
        id: 'wo-closed',
        title: 'WO Cerrados (Hoy)',
        icon: 'check-square',
        color: 'var(--success)',
        description: 'Work orders cerradas hoy'
    },
    'kits-today': {
        id: 'kits-today',
        title: 'Kits Hoy',
        icon: 'keyboard',
        color: 'var(--warning, #f59e0b)',
        hasPopover: true,
        popoverId: 'popoverKitsBreakdown',
        description: 'Retiros de kits programados hoy'
    },
    'vinchas-today': {
        id: 'vinchas-today',
        title: 'Vinchas Hoy',
        icon: 'headphones',
        color: 'var(--warning, #f59e0b)',
        hasPopover: true,
        popoverId: 'popoverVinchasBreakdown',
        description: 'Retiros de vinchas programados hoy'
    },
    'recambios-today': {
        id: 'recambios-today',
        title: 'Recambios Hoy',
        icon: 'refresh-cw',
        color: 'var(--warning, #f59e0b)',
        hasPopover: true,
        popoverId: 'popoverRecambiosBreakdown',
        description: 'Retiros de recambio programados hoy'
    },
    'closed-typifications': {
        id: 'closed-typifications',
        title: 'Tipificaciones (Hoy)',
        icon: 'pie-chart',
        color: 'var(--success)',
        hasPopover: true,
        popoverId: 'popoverClosedTypifications',
        description: 'Distribución de tipificaciones resueltas hoy'
    },
    'closed-companies': {
        id: 'closed-companies',
        title: 'Empresas (Hoy)',
        icon: 'building-2',
        color: 'var(--success)',
        hasPopover: true,
        popoverId: 'popoverClosedCompanies',
        description: 'Casos resueltos hoy por empresa'
    },
    'sla-alerts': {
        id: 'sla-alerts',
        title: 'Alertas de SLA',
        icon: 'clock',
        color: 'var(--danger)',
        hasPopover: true,
        popoverId: 'popoverSlaAlerts',
        description: 'Tickets con SLA vencido o por vencer (< 24h)'
    },
    'state-distribution': {
        id: 'state-distribution',
        title: 'Por Estado',
        icon: 'kanban',
        color: 'var(--primary)',
        hasPopover: true,
        popoverId: 'popoverStateDistribution',
        description: 'Distribución de casos abiertos por columna'
    },
    'overdue-pickups': {
        id: 'overdue-pickups',
        title: 'Retiros Vencidos',
        icon: 'calendar-x',
        color: 'var(--danger)',
        hasPopover: true,
        popoverId: 'popoverOverduePickups',
        description: 'Casos abiertos con fecha de retiro pasada'
    },
    'priority-breakdown': {
        id: 'priority-breakdown',
        title: 'Por Prioridad',
        icon: 'alert-octagon',
        color: 'var(--warning, #f59e0b)',
        hasPopover: true,
        popoverId: 'popoverPriorityBreakdown',
        description: 'Distribución de casos abiertos por urgencia/impacto'
    },
    'missing-wo': {
        id: 'missing-wo',
        title: 'Casos sin WO',
        icon: 'help-circle',
        color: 'var(--text-muted)',
        hasPopover: true,
        popoverId: 'popoverMissingWo',
        description: 'Casos locales creados sin ticket Remedy'
    },
    'inc-closed-all': {
        id: 'inc-closed-all',
        title: 'INC Cerrados (Histórico)',
        icon: 'check-circle',
        color: 'var(--success)',
        description: 'Total histórico de incidentes cerrados'
    },
    'wo-closed-all': {
        id: 'wo-closed-all',
        title: 'WO Cerrados (Histórico)',
        icon: 'check-square',
        color: 'var(--success)',
        description: 'Total histórico de work orders cerradas'
    },
    'closed-typifications-all': {
        id: 'closed-typifications-all',
        title: 'Tipificaciones (Histórico)',
        icon: 'pie-chart',
        color: 'var(--success)',
        hasPopover: true,
        popoverId: 'popoverClosedTypificationsAll',
        description: 'Distribución histórica de tipificaciones resueltas'
    },
    'closed-companies-all': {
        id: 'closed-companies-all',
        title: 'Empresas (Histórico)',
        icon: 'building-2',
        color: 'var(--success)',
        hasPopover: true,
        popoverId: 'popoverClosedCompaniesAll',
        description: 'Casos resueltos históricos por empresa'
    },
    'kits-all': {
        id: 'kits-all',
        title: 'Kits (Histórico)',
        icon: 'keyboard',
        color: 'var(--warning, #f59e0b)',
        hasPopover: true,
        popoverId: 'popoverKitsBreakdownAll',
        description: 'Total histórico de retiros de kits programados'
    },
    'vinchas-all': {
        id: 'vinchas-all',
        title: 'Vinchas (Histórico)',
        icon: 'headphones',
        color: 'var(--warning, #f59e0b)',
        hasPopover: true,
        popoverId: 'popoverVinchasBreakdownAll',
        description: 'Total histórico de retiros de vinchas programados'
    },
    'recambios-all': {
        id: 'recambios-all',
        title: 'Recambios (Histórico)',
        icon: 'refresh-cw',
        color: 'var(--warning, #f59e0b)',
        hasPopover: true,
        popoverId: 'popoverRecambiosBreakdownAll',
        description: 'Total histórico de retiros de recambio programados'
    },
    'remedy-group-open': {
        id: 'remedy-group-open',
        title: 'Grupo Abiertos',
        icon: 'folder-open',
        color: 'var(--primary)',
        hasPopover: true,
        popoverId: 'popoverRemedyGroupOpen',
        description: 'Total de incidentes y work orders abiertas del grupo (sin asignar + asignadas)'
    },
    'remedy-group-unassigned': {
        id: 'remedy-group-unassigned',
        title: 'Grupo Sin Asignar',
        icon: 'user-x',
        color: 'var(--warning, #f59e0b)',
        hasPopover: true,
        popoverId: 'popoverRemedyGroupUnassigned',
        description: 'Tickets del grupo sin asignar (en cola)'
    },
    'remedy-group-assigned': {
        id: 'remedy-group-assigned',
        title: 'Grupo Asignados',
        icon: 'users',
        color: 'var(--primary)',
        hasPopover: true,
        popoverId: 'popoverRemedyGroupAssigned',
        description: 'Tickets asignados a otros técnicos del grupo'
    }
};

function renderWidgetsLayout(force = false) {
    const container = document.getElementById('listMetricsCards');
    if (!container) return;

    const currentSerialized = enabledWidgets.join(',');
    if (!force && container.dataset.renderedWidgets === currentSerialized) {
        return;
    }
    container.dataset.renderedWidgets = currentSerialized;

    let html = '';
    enabledWidgets.forEach(widgetId => {
        const widget = ALL_WIDGETS[widgetId];
        if (!widget) return;

        html += `
            <div class="draggable-widget-card" 
                 draggable="true" 
                 ondragstart="window.handleWidgetDragStart(event, '${widget.id}')"
                 ondragend="window.handleWidgetDragEnd(event)"
                 ondragover="window.handleWidgetDragOver(event)"
                 ondragleave="window.handleWidgetDragLeave(event)"
                 ondrop="window.handleWidgetDrop(event, '${widget.id}')"
                 style="flex: 1; min-width: 150px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; position: relative; cursor: grab;">
                <span style="font-size: 11.5px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between; width: 100%;">
                    <span style="display: flex; align-items: center; gap: 5px; pointer-events: none;">
                        <i data-lucide="${widget.icon}" style="width: 12px; height: 12px; flex-shrink: 0;"></i> ${widget.title}
                    </span>
                    ${widget.hasPopover ? `
                    <span class="breakdown-hover-container">
                        <i data-lucide="help-circle" style="width: 13px; height: 13px; cursor: pointer;"></i>
                        <div class="breakdown-popover" id="${widget.popoverId}">
                            <div style="position: absolute; bottom: 100%; right: 22px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 5px solid var(--border);"></div>
                            <div style="position: absolute; bottom: 100%; right: 22px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 5px solid var(--surface); margin-bottom: -1px;"></div>
                            <div class="breakdown-content" style="display: flex; flex-direction: column; gap: 4px;">Cargando...</div>
                        </div>
                    </span>
                    ` : ''}
                </span>
                <span style="font-size: 20px; font-weight: 800; color: ${widget.color}; pointer-events: none;" id="metric_${widget.id}">0</span>
            </div>
        `;
    });

    html += `
        <div class="widget-settings-card" onclick="openManageWidgetsModal()" title="Configurar widgets" style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            min-height: 70px;
            border: 1px dashed var(--border);
            border-radius: var(--radius-md);
            cursor: pointer;
            color: var(--text-muted);
            background: transparent;
            transition: all 0.2s ease;
        " onmouseover="this.style.background='var(--border-soft)'; this.style.color='var(--text)'" onmouseout="this.style.background='transparent'; this.style.color='var(--text-muted)'">
            <i data-lucide="settings" style="width: 18px; height: 18px;"></i>
        </div>
    `;

    container.innerHTML = html;

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

window.openManageWidgetsModal = function() {
    let optionsHtml = '';
    Object.values(ALL_WIDGETS).forEach(widget => {
        const isChecked = enabledWidgets.includes(widget.id);
        optionsHtml += `
            <label class="widget-toggle-label" style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 12px;
                border: 1px solid var(--border);
                border-radius: var(--radius);
                cursor: pointer;
                background: var(--surface);
                transition: all 0.2s ease;
                margin-bottom: 8px;
            " onmouseover="this.style.borderColor='var(--primary)'; this.style.background='var(--surface-2)';" onmouseout="this.style.borderColor='var(--border)'; this.style.background='var(--surface)';">
                <div style="display: flex; align-items: center; gap: 10px; text-align: left;">
                    <span style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); background: var(--surface-2); color: ${widget.color};">
                        <i data-lucide="${widget.icon}" style="width: 16px; height: 16px;"></i>
                    </span>
                    <div>
                        <strong style="font-size: 13.5px; color: var(--text); display: block;">${widget.title}</strong>
                        <span style="font-size: 11.5px; color: var(--text-muted); display: block;">${widget.description}</span>
                    </div>
                </div>
                <input type="checkbox" class="widget-checkbox" value="${widget.id}" ${isChecked ? 'checked' : ''} style="
                    width: 18px;
                    height: 18px;
                    accent-color: var(--primary);
                    cursor: pointer;
                ">
            </label>
        `;
    });

    Swal.fire({
        title: 'Configurar Widgets',
        html: `
            <div style="text-align: left; font-family: inherit; max-height: 400px; overflow-y: auto; padding-right: 4px; margin-top: 10px;">
                <p style="margin-bottom: 12px; font-size: 13px; color: var(--text-muted);">Activa o desactiva los widgets que deseas visualizar en la cartelera principal.</p>
                ${optionsHtml}
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--primary)',
        customClass: {
            popup: 'premium-swal-popup',
            confirmButton: 'btn btn-primary',
            cancelButton: 'btn btn-ghost'
        },
        didOpen: () => {
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
            const popup = Swal.getPopup();
            popup.addEventListener('change', (e) => {
                if (e.target.classList.contains('widget-checkbox')) {
                    const checkedCount = popup.querySelectorAll('.widget-checkbox:checked').length;
                    if (checkedCount > 8) {
                        e.target.checked = false; // uncheck
                        Swal.showValidationMessage('Máximo de 8 widgets permitidos');
                        setTimeout(() => Swal.resetValidationMessage(), 2500);
                    }
                }
            });
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const checkboxes = document.querySelectorAll('.widget-checkbox');
            const selected = [];
            checkboxes.forEach(cb => {
                if (cb.checked) {
                    selected.push(cb.value);
                }
            });

            enabledWidgets = selected;
            window.enabledWidgets = enabledWidgets;

            renderWidgetsLayout(true);
            updateListMetrics();
            await saveListGroupingConfig();

            Swal.fire({
                icon: 'success',
                title: 'Widgets actualizados',
                timer: 1500,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
            });
        }
    });
};

// ============================================================
// DRAG AND DROP DE WIDGETS
// ============================================================
window.handleWidgetDragStart = function(e, widgetId) {
    window._draggingWidgetId = widgetId;
    const card = e.target.closest('.draggable-widget-card');
    if (card) {
        card.classList.add('dragging-widget');
    }
    e.dataTransfer.effectAllowed = 'move';
};

window.handleWidgetDragEnd = function(e) {
    document.querySelectorAll('.draggable-widget-card').forEach(card => {
        card.classList.remove('dragging-widget');
        card.classList.remove('widget-drag-over');
    });
    window._draggingWidgetId = null;
};

window.handleWidgetDragOver = function(e) {
    e.preventDefault();
    const card = e.target.closest('.draggable-widget-card');
    if (card && window._draggingWidgetId && card.querySelector(`#metric_${window._draggingWidgetId}`) === null) {
        card.classList.add('widget-drag-over');
    }
    e.dataTransfer.dropEffect = 'move';
};

window.handleWidgetDragLeave = function(e) {
    const card = e.target.closest('.draggable-widget-card');
    if (card) {
        card.classList.remove('widget-drag-over');
    }
};

window.handleWidgetDrop = function(e, targetWidgetId) {
    e.preventDefault();
    const draggedId = window._draggingWidgetId;
    if (!draggedId || draggedId === targetWidgetId) return;

    const draggedIdx = enabledWidgets.indexOf(draggedId);
    const targetIdx = enabledWidgets.indexOf(targetWidgetId);
    if (draggedIdx !== -1 && targetIdx !== -1) {
        enabledWidgets.splice(draggedIdx, 1);
        enabledWidgets.splice(targetIdx, 0, draggedId);
        window.enabledWidgets = enabledWidgets;
        renderWidgetsLayout(true);
        updateListMetrics();
        saveListGroupingConfig();
    }
};

// Delegación de eventos para calcular y ajustar bordes de popovers
document.addEventListener('mouseover', function(e) {
    const hoverContainer = e.target.closest('.breakdown-hover-container');
    if (hoverContainer) {
        const popover = hoverContainer.querySelector('.breakdown-popover');
        if (popover) {
            const originalVisibility = popover.style.visibility;
            const originalDisplay = popover.style.display;
            const originalOpacity = popover.style.opacity;
            
            popover.style.display = 'block';
            popover.style.visibility = 'visible';
            popover.style.opacity = '1';
            
            const rect = popover.getBoundingClientRect();
            
            popover.style.display = originalDisplay;
            popover.style.visibility = originalVisibility;
            popover.style.opacity = originalOpacity;
            
            const rightMargin = window.innerWidth - 16;
            if (rect.right > rightMargin) {
                popover.style.right = '0px';
                popover.style.left = 'auto';
            } else if (rect.left < 16) {
                popover.style.left = '0px';
                popover.style.right = 'auto';
            } else {
                popover.style.right = '';
                popover.style.left = '';
            }
        }
    }

    const breakdownItem = e.target.closest('.breakdown-item');
    if (breakdownItem) {
        const subPopover = breakdownItem.querySelector('.breakdown-sub-popover');
        if (subPopover) {
            const originalVisibility = subPopover.style.visibility;
            const originalDisplay = subPopover.style.display;
            const originalOpacity = subPopover.style.opacity;
            
            subPopover.style.display = 'block';
            subPopover.style.visibility = 'visible';
            subPopover.style.opacity = '1';
            
            const rect = subPopover.getBoundingClientRect();
            
            subPopover.style.display = originalDisplay;
            subPopover.style.visibility = originalVisibility;
            subPopover.style.opacity = originalOpacity;
            
            const rightMargin = window.innerWidth - 16;
            if (rect.right > rightMargin) {
                subPopover.style.left = 'auto';
                subPopover.style.right = 'calc(100% + 8px)';
                subPopover.classList.add('flipped');
            } else {
                subPopover.style.left = '';
                subPopover.style.right = '';
                subPopover.classList.remove('flipped');
            }
        }
    }
});

window.updateClosedTypificationsPopover = function(localClosed, elementId = 'popoverClosedTypifications') {
    const popover = document.getElementById(elementId);
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!localClosed || localClosed.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay casos cerrados.</span>';
        return;
    }

    const categoryDetails = {};
    localClosed.forEach(c => {
        let rawTip = resolveTipificacion(c) || 'Otros / Sin clasificar';
        let cat = rawTip.replace(/ \(INC\)$/, '').replace(/ \(WO\)$/, '');

        if (!categoryDetails[cat]) {
            categoryDetails[cat] = { count: 0, companies: {} };
        }
        categoryDetails[cat].count++;

        let comp = typeof window.getCompanyForCase === 'function' ? window.getCompanyForCase(c) : (c.company || 'Empresa Principal');
        if (!comp || comp === '—') comp = 'Empresa Principal';
        categoryDetails[cat].companies[comp] = (categoryDetails[cat].companies[comp] || 0) + 1;
    });

    const isHistorical = elementId.toLowerCase().includes('all') || elementId.toLowerCase().includes('historic');
    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Tipificaciones Resueltas</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">${isHistorical ? 'Histórico' : 'Hoy'}</span>
        </div>
    `;

    function getIconForCat(catName) {
        const name = catName.toLowerCase();
        if (name.includes('vincha')) return 'headphones';
        if (name.includes('kit')) return 'keyboard';
        if (name.includes('celular') || name.includes('cel')) return 'smartphone';
        if (name.includes('cargador') || name.includes('adaptador')) return 'plug';
        if (name.includes('monitor')) return 'monitor';
        if (name.includes('software') || name.includes('configur')) return 'settings';
        if (name.includes('red') || name.includes('wifi') || name.includes('conexion') || name.includes('conectiv')) return 'wifi';
        if (name.includes('equipo') || name.includes('pc') || name.includes('notebook') || name.includes('laptop')) return 'laptop';
        return 'tag';
    }

    const sortedEntries = Object.entries(categoryDetails).sort((a, b) => b[1].count - a[1].count);
    const visibleEntries = sortedEntries.slice(0, 12);

    let itemsHtml = visibleEntries.map(([cat, detail]) => {
        const iconName = getIconForCat(cat);
        const { count, companies } = detail;

        const companyRows = Object.entries(companies)
            .sort((a, b) => b[1] - a[1])
            .map(([company, cnt]) => `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; padding: 1px 0; gap: 8px;">
                    <span style="color: var(--text-muted); font-weight: 500; white-space: nowrap;">${company}</span>
                    <strong style="color: var(--primary); font-weight: 700;">${cnt}</strong>
                </div>
            `).join('');

        const subPopoverHtml = `
            <div class="breakdown-sub-popover">
                <div style="font-weight: 700; color: var(--text); font-size: 10px; margin-bottom: 4px; border-bottom: 1px solid var(--border-soft); padding-bottom: 2px; text-transform: uppercase; letter-spacing: 0.3px;">Empresa</div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    ${companyRows}
                </div>
            </div>
        `;

        return `
            <div class="breakdown-item">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                        <i data-lucide="${iconName}" style="width: 12.5px; height: 12.5px; flex-shrink: 0; color: var(--text-muted);"></i>
                        <span style="color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${escapeHtml(cat)}">${escapeHtml(cat)}</span>
                    </div>
                    <span style="background: var(--primary-soft); color: var(--primary); font-weight: 700; border-radius: 4px; padding: 1px 5px; font-size: 10px; min-width: 16px; text-align: center;">${count}</span>
                </div>
                ${subPopoverHtml}
            </div>
        `;
    }).join('');

    if (sortedEntries.length > 12) {
        itemsHtml += `
            <div class="show-more-typifications-btn" onclick="window.openAllTypificationsModal('${elementId}')" style="
                text-align: center; 
                font-size: 10.5px; 
                color: var(--primary); 
                font-weight: 700; 
                cursor: pointer; 
                padding: 6px 0; 
                border-top: 1px dashed var(--border-soft); 
                margin-top: 6px;
                transition: color 0.15s ease;
            " onmouseover="this.style.color='var(--primary-hover)'; this.style.textDecoration='underline';" onmouseout="this.style.color='var(--primary)'; this.style.textDecoration='none';">
                Mostrar más (${sortedEntries.length - 12} más)
            </div>
        `;
    }

    contentDiv.innerHTML = headerHtml + itemsHtml;

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.openAllTypificationsModal = function(elementId) {
    const isHistorical = elementId.toLowerCase().includes('all') || elementId.toLowerCase().includes('historic');
    const casesList = isHistorical ? window._lastAllClosed : window._lastLocalClosed;
    if (!casesList || casesList.length === 0) return;

    const categoryDetails = {};
    casesList.forEach(c => {
        let rawTip = resolveTipificacion(c) || 'Otros / Sin clasificar';
        let cat = rawTip.replace(/ \(INC\)$/, '').replace(/ \(WO\)$/, '');

        if (!categoryDetails[cat]) {
            categoryDetails[cat] = { count: 0, companies: {} };
        }
        categoryDetails[cat].count++;

        let comp = typeof window.getCompanyForCase === 'function' ? window.getCompanyForCase(c) : (c.company || 'Empresa Principal');
        if (!comp || comp === '—') comp = 'Empresa Principal';
        categoryDetails[cat].companies[comp] = (categoryDetails[cat].companies[comp] || 0) + 1;
    });

    const sortedEntries = Object.entries(categoryDetails).sort((a, b) => b[1].count - a[1].count);

    function getIconForCat(catName) {
        const name = catName.toLowerCase();
        if (name.includes('vincha')) return 'headphones';
        if (name.includes('kit')) return 'keyboard';
        if (name.includes('celular') || name.includes('cel')) return 'smartphone';
        if (name.includes('cargador') || name.includes('adaptador')) return 'plug';
        if (name.includes('monitor')) return 'monitor';
        if (name.includes('software') || name.includes('configur')) return 'settings';
        if (name.includes('red') || name.includes('wifi') || name.includes('conexion') || name.includes('conectiv')) return 'wifi';
        if (name.includes('equipo') || name.includes('pc') || name.includes('notebook') || name.includes('laptop')) return 'laptop';
        return 'tag';
    }

    let itemsHtml = '';
    sortedEntries.forEach(([cat, detail]) => {
        const iconName = getIconForCat(cat);
        const { count, companies } = detail;

        const companyChips = Object.entries(companies)
            .sort((a, b) => b[1] - a[1])
            .map(([company, cnt]) => `
                <span style="display: inline-flex; align-items: center; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; font-size: 11px;">
                    <strong style="color: var(--text-muted);">${company}:</strong>
                    <span style="color: var(--primary); font-weight: 700;">${cnt}</span>
                </span>
            `).join('');

        itemsHtml += `
            <div class="modal-typification-item" style="padding: 10px 12px; border-bottom: 1px solid var(--border-soft); display: flex; flex-direction: column; gap: 6px; transition: background 0.15s ease; cursor: default;">
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                    <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <i data-lucide="${iconName}" style="width: 14px; height: 14px; color: var(--text-muted); flex-shrink: 0;"></i>
                        <span style="color: var(--text); font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px;" title="${escapeHtml(cat)}">${escapeHtml(cat)}</span>
                    </div>
                    <span style="background: var(--primary-soft); color: var(--primary); font-weight: 700; border-radius: 4px; padding: 2px 6px; font-size: 11px; min-width: 20px; text-align: center;">${count}</span>
                </div>
                <div class="company-breakdown-inline" style="display: flex; flex-wrap: wrap; gap: 6px; padding-left: 22px;">
                    ${companyChips}
                </div>
            </div>
        `;
    });

    Swal.fire({
        title: isHistorical ? 'Tipificaciones Resueltas (Histórico)' : 'Tipificaciones Resueltas (Hoy)',
        html: `
            <div style="text-align: left; font-family: inherit; max-height: 280px; overflow-y: auto; padding-right: 4px; padding-bottom: 20px; margin-top: 10px; display: flex; flex-direction: column; gap: 4px;">
                ${itemsHtml}
            </div>
        `,
        confirmButtonText: 'Cerrar',
        confirmButtonColor: 'var(--primary)',
        customClass: {
            popup: 'premium-swal-popup',
            confirmButton: 'btn btn-primary'
        },
        didOpen: () => {
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        }
    });
};

window.updateClosedByCompanyPopover = function(localClosed, elementId = 'popoverClosedCompanies') {
    const popover = document.getElementById(elementId);
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!localClosed || localClosed.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay casos cerrados.</span>';
        return;
    }

    const counts = {};
    localClosed.forEach(c => {
        let comp = typeof window.getCompanyForCase === 'function' ? window.getCompanyForCase(c) : (c.company || 'Empresa Principal');
        if (!comp || comp === '—') comp = 'Empresa Principal';
        counts[comp] = (counts[comp] || 0) + 1;
    });

    const isHistorical = elementId.toLowerCase().includes('all') || elementId.toLowerCase().includes('historic');
    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Por Empresa</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">${isHistorical ? 'Histórico' : 'Cerrados hoy'}</span>
        </div>
    `;

    const itemsHtml = Object.entries(counts)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([company, count]) => {
            const iconName = company === 'Subsidiaria' ? 'credit-card' : (company === 'Empresa Principal' ? 'building-2' : 'building');
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                        <i data-lucide="${iconName}" style="width: 12.5px; height: 12.5px; flex-shrink: 0; color: var(--text-muted);"></i>
                        <span style="color: var(--text-muted); font-weight: 500;">${company}</span>
                    </div>
                    <span style="background: var(--primary-soft); color: var(--primary); font-weight: 700; border-radius: 4px; padding: 1px 5px; font-size: 10px; min-width: 16px; text-align: center;">${count}</span>
                </div>
            `;
        }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml;

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.updateSlaAlertsPopover = function(slaAlerts) {
    const popover = document.getElementById('popoverSlaAlerts');
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!slaAlerts || slaAlerts.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">Sin alertas de SLA.</span>';
        return;
    }

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Alertas de SLA</span>
            <span style="font-size: 9px; color: var(--danger); font-weight: normal; background: var(--danger-soft); padding: 1px 4px; border-radius: 4px;">Crítico</span>
        </div>
    `;

    const itemsHtml = slaAlerts.slice(0, 10).map(c => {
        const d = new Date(c.slaDate);
        const diffMs = d.getTime() - new Date().getTime();
        let timeText = '';
        let timeColor = 'var(--danger)';
        if (diffMs < 0) {
            timeText = 'Vencido';
        } else {
            const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
            if (diffHours === 0) {
                const diffMins = Math.floor(diffMs / (60 * 1000));
                timeText = `En ${diffMins}m`;
            } else {
                timeText = `En ${diffHours}h`;
            }
            timeColor = 'var(--warning)';
        }

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                <span style="font-weight: 600; color: var(--text); font-family: monospace;">${escapeHtml(c.wo || 'S/D')}</span>
                <span style="color: ${timeColor}; font-weight: 700; font-size: 10px;">${timeText}</span>
            </div>
        `;
    }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml + (slaAlerts.length > 10 ? `<div style="text-align: center; font-size: 9px; color: var(--text-muted); margin-top: 4px;">+${slaAlerts.length - 10} más</div>` : '');

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.updateStateDistributionPopover = function(openCasesMerged) {
    const popover = document.getElementById('popoverStateDistribution');
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!openCasesMerged || openCasesMerged.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay casos abiertos.</span>';
        return;
    }

    const statesCounts = {};
    openCasesMerged.forEach(c => {
        let state = c.estado || 'open';
        statesCounts[state] = (statesCounts[state] || 0) + 1;
    });

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Por Estado</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Abiertos</span>
        </div>
    `;

    const stateLabels = {
        'remedy_assigned': { label: 'Remedy Asignado', color: '#4f46e5' },
        'open': { label: 'Abierto', color: '#2563eb' },
        'pending': { label: 'Pendiente', color: '#ea580c' },
        'progress': { label: 'En Progreso', color: '#16a34a' },
        'correo': { label: 'Enviado Correo', color: '#0891b2' },
        'retirado': { label: 'Retirado', color: '#7c3aed' },
        'done': { label: 'Finalizado', color: '#15803d' },
        'reject': { label: 'Rechazado', color: '#be123c' },
        'not_accepted': { label: 'No Aceptado', color: '#9f1239' }
    };

    const itemsHtml = Object.entries(statesCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([state, count]) => {
            const stateInfo = stateLabels[state] || { label: state, color: 'var(--text-muted)' };
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                    <span style="color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px;">
                        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${stateInfo.color}; display: inline-block;"></span>
                        ${escapeHtml(stateInfo.label)}
                    </span>
                    <span style="font-weight: 700; color: var(--text);">${count}</span>
                </div>
            `;
        }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml;

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.updateOverduePickupsPopover = function(overduePickups) {
    const popover = document.getElementById('popoverOverduePickups');
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!overduePickups || overduePickups.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">Sin retiros vencidos.</span>';
        return;
    }

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Retiros Vencidos</span>
            <span style="font-size: 9px; color: var(--danger); font-weight: normal; background: var(--danger-soft); padding: 1px 4px; border-radius: 4px;">Pendientes</span>
        </div>
    `;

    const itemsHtml = overduePickups.slice(0, 10).map(c => {
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                <span style="font-weight: 600; color: var(--text); font-family: monospace;">${escapeHtml(c.wo || 'S/D')}</span>
                <span style="color: var(--text-muted); font-size: 10px;">${escapeHtml(String(c.fechaRetiro).slice(5, 10))}</span>
            </div>
        `;
    }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml + (overduePickups.length > 10 ? `<div style="text-align: center; font-size: 9px; color: var(--text-muted); margin-top: 4px;">+${overduePickups.length - 10} más</div>` : '');

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.updatePriorityBreakdownPopover = function(priorityCounts) {
    const popover = document.getElementById('popoverPriorityBreakdown');
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Por Prioridad</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Abiertos</span>
        </div>
    `;

    const colors = { 'Crítica': '#c62828', 'Alta': '#e65100', 'Media': '#f9a825', 'Baja': '#2e7d32' };

    const itemsHtml = Object.entries(priorityCounts)
        .map(([prio, count]) => {
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                    <span style="color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px;">
                        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${colors[prio] || 'var(--text-muted)'}; display: inline-block;"></span>
                        ${escapeHtml(prio)}
                    </span>
                    <span style="font-weight: 700; color: var(--text);">${count}</span>
                </div>
            `;
        }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml;

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.updateMissingWoPopover = function(missingWoCases) {
    const popover = document.getElementById('popoverMissingWo');
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!missingWoCases || missingWoCases.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">Todos los casos tienen WO/INC.</span>';
        return;
    }

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Casos sin WO</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Locales</span>
        </div>
    `;

    const itemsHtml = missingWoCases.slice(0, 10).map(c => {
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                <span style="color: var(--text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${escapeHtml(c.name || 'Sin nombre')}">${escapeHtml(c.name || 'Sin nombre')}</span>
                <span style="background: var(--border-soft); color: var(--text-muted); font-size: 9px; padding: 1px 4px; border-radius: 4px;">Sin ID</span>
            </div>
        `;
    }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml + (missingWoCases.length > 10 ? `<div style="text-align: center; font-size: 9px; color: var(--text-muted); margin-top: 4px;">+${missingWoCases.length - 10} más</div>` : '');

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.updateRemedyGroupOpenPopover = function() {
    const popover = document.getElementById('popoverRemedyGroupOpen');
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!window.remedyConnected) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">Remedy desconectado.</span>';
        return;
    }

    const unassignedCount = (window.remedyTickets || []).length;
    const assignedCount = (window.allAssignedTickets || []).length;
    const totalCount = unassignedCount + assignedCount;

    if (totalCount === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay tickets de grupo abiertos.</span>';
        return;
    }

    const unassignedInc = (window.remedyTickets || []).filter(t => t.id && t.id.startsWith('INC')).length;
    const unassignedWo = (window.remedyTickets || []).filter(t => t.id && t.id.startsWith('WO')).length;

    // Agrupar asignados por tecnico
    const techCounts = {};
    (window.allAssignedTickets || []).forEach(t => {
        const name = t.assignee_name || t.assignee_login || 'Otros';
        techCounts[name] = (techCounts[name] || 0) + 1;
    });

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Tickets del Grupo</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Remedy</span>
        </div>
    `;

    const summaryHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0; border-bottom: 1px dashed var(--border-soft); margin-bottom: 4px; padding-bottom: 4px;">
            <span style="color: var(--text-muted); font-weight: 500;">Sin asignar</span>
            <span style="font-weight: 700; color: var(--warning);">${unassignedCount} <span style="font-size: 9px; font-weight: normal; color: var(--text-muted);">(${unassignedInc} INC, ${unassignedWo} WO)</span></span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0; margin-bottom: 4px;">
            <span style="color: var(--text-muted); font-weight: 500;">Asignados</span>
            <span style="font-weight: 700; color: var(--primary);">${assignedCount}</span>
        </div>
    `;

    let techRows = '';
    const sortedTechs = Object.entries(techCounts).sort((a, b) => b[1] - a[1]);
    if (sortedTechs.length > 0) {
        techRows = `
            <div style="font-weight: 600; color: var(--text-muted); font-size: 10px; margin: 6px 0 4px 0; text-transform: uppercase; letter-spacing: 0.2px;">Por Técnico</div>
            <div style="display: flex; flex-direction: column; gap: 3px;">
                ${sortedTechs.map(([tech, count]) => `
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; padding: 1px 0;">
                        <span style="color: var(--text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${escapeHtml(tech)}">${escapeHtml(tech)}</span>
                        <strong style="color: var(--primary); font-weight: 700;">${count}</strong>
                    </div>
                `).join('')}
            </div>
        `;
    }

    contentDiv.innerHTML = headerHtml + summaryHtml + techRows;
};

window.updateRemedyGroupUnassignedPopover = function() {
    const popover = document.getElementById('popoverRemedyGroupUnassigned');
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!window.remedyConnected) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">Remedy desconectado.</span>';
        return;
    }

    const unassigned = window.remedyTickets || [];
    if (unassigned.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay tickets sin asignar.</span>';
        return;
    }

    const typeDetails = {};
    unassigned.forEach(t => {
        let type = t.element_type || (t.id && t.id.startsWith('INC') ? 'Incidente' : 'Work Order');
        typeDetails[type] = (typeDetails[type] || 0) + 1;
    });

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Sin Asignar (Cola)</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Remedy</span>
        </div>
    `;

    const summaryHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0; border-bottom: 1px dashed var(--border-soft); margin-bottom: 4px; padding-bottom: 4px;">
            <span style="color: var(--text-muted); font-weight: 500;">Total cola</span>
            <span style="font-weight: 700; color: var(--warning);">${unassigned.length}</span>
        </div>
    `;

    const itemsHtml = Object.entries(typeDetails)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                <span style="color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${escapeHtml(type)}">${escapeHtml(type)}</span>
                <span style="font-weight: 700; color: var(--text);">${count}</span>
            </div>
        `).join('');

    contentDiv.innerHTML = headerHtml + summaryHtml + itemsHtml;
};

window.updateRemedyGroupAssignedPopover = function() {
    const popover = document.getElementById('popoverRemedyGroupAssigned');
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!window.remedyConnected) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">Remedy desconectado.</span>';
        return;
    }

    const assigned = window.allAssignedTickets || [];
    if (assigned.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay tickets asignados en el grupo.</span>';
        return;
    }

    const techCounts = {};
    assigned.forEach(t => {
        const name = t.assignee_name || t.assignee_login || 'Otros';
        techCounts[name] = (techCounts[name] || 0) + 1;
    });

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Asignados (Técnicos)</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Remedy</span>
        </div>
    `;

    const summaryHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0; border-bottom: 1px dashed var(--border-soft); margin-bottom: 4px; padding-bottom: 4px;">
            <span style="color: var(--text-muted); font-weight: 500;">Total asignados</span>
            <span style="font-weight: 700; color: var(--primary);">${assigned.length}</span>
        </div>
    `;

    const itemsHtml = Object.entries(techCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([tech, count]) => `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                <span style="color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${escapeHtml(tech)}">${escapeHtml(tech)}</span>
                <span style="font-weight: 700; color: var(--text);">${count}</span>
            </div>
        `).join('');

    contentDiv.innerHTML = headerHtml + summaryHtml + itemsHtml;
};

function updateListMetrics() {
    if (typeof window.myOpenTickets === 'undefined') return;

    // Calcular inicio de la jornada actual (9:00 AM)
    const now = new Date();
    const shiftStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    if (now.getHours() < 9) {
        shiftStart.setDate(shiftStart.getDate() - 1);
    }

    // 1. Obtener y enriquecer los cerrados locales y mezclarlos con los de Remedy
    let allClosed = (window.cases || []).filter(c => ['done', 'reject', 'not_accepted'].includes(c.estado));

    if (typeof window.remedyConnected !== 'undefined' && window.remedyConnected && typeof window.myClosedTickets !== 'undefined' && window.myClosedTickets.length > 0) {
        // Enriquecer primero los locales con info de Remedy (como descripción, empresa y tipificación)
        allClosed.forEach(c => {
            if (c.wo) {
                const rt = window.myClosedTickets.find(t => t.id === c.wo);
                if (rt) {
                    if (rt.description) c.notes = rt.description;
                    if (rt.company && (!c.company || c.company === '—')) c.company = rt.company;
                    if (!c.tipificacion || c.tipificacion === '') {
                        c.tipificacion = (typeof autoDetectTipificacion === 'function' ? autoDetectTipificacion(rt.summary || c.puesto) : null) || rt.element_type || '';
                    }
                }
            }
        });

        const mappedClosed = window.myClosedTickets.map(t => ({
            id: t.id,
            name: t.clientName || 'Sin nombre',
            email: t.email || '',
            company: t.company || '—',
            puesto: t.summary || '—',
            estado: 'done',
            wo: t.id,
            fechaRetiro: null,
            updatedAt: t.createdAt || t.created_at || now.toISOString(),
            createdAt: t.createdAt || t.created_at || now.toISOString(),
            notes: t.description || '',
            slaDate: t.slaDate || null,
            slaStatus: t.slaStatus || null,
            priority: t.priority || 'normal',
            urgency: t.urgency || '',
            impact: t.impact || '',
            tipificacion: (typeof autoDetectTipificacion === 'function' ? autoDetectTipificacion(t.summary) : null) || t.element_type || '',
            isRemedyOnly: true,
            status: t.status || '4'
        }));

        const localWos = new Set(allClosed.map(c => c.wo).filter(Boolean));
        const uniqueRemedyClosed = mappedClosed.filter(t => !localWos.has(t.wo));
        allClosed = [...allClosed, ...uniqueRemedyClosed];
    }

    const closedRemedyIds = new Set((typeof window.myClosedTickets !== 'undefined' ? window.myClosedTickets : []).map(t => t.id).filter(Boolean));

    const incClosedAll = allClosed.filter(c => (c.id && c.id.startsWith('INC')) || (c.wo && c.wo.startsWith('INC'))).length;
    const woClosedAll = allClosed.filter(c => (c.id && c.id.startsWith('WO')) || (c.wo && c.wo.startsWith('WO'))).length;

    // Obtener los cerrados de hoy
    const localClosed = allClosed.filter(c => {
        if (c.isRemedyOnly) return true; // Todo lo de myClosedTickets es de hoy (último shift)
        if (c.wo && closedRemedyIds.has(c.wo)) return true;
        if (c.id && closedRemedyIds.has(c.id)) return true;
        if (!c.updatedAt) return false;
        const updateTime = new Date(c.updatedAt);
        return updateTime >= shiftStart;
    });

    const incClosed = localClosed.filter(c => (c.id && c.id.startsWith('INC')) || (c.wo && c.wo.startsWith('INC'))).length;
    const woClosed = localClosed.filter(c => (c.id && c.id.startsWith('WO')) || (c.wo && c.wo.startsWith('WO'))).length;

    // Calcular tickets abiertos mezclados (localOpen + Remedy en vivo)
    let openCasesMerged = (window.cases || []).filter(c => !['done', 'reject', 'not_accepted'].includes(c.estado));
    if (typeof window.remedyConnected !== 'undefined' && window.remedyConnected && typeof window.myOpenTickets !== 'undefined' && window.myOpenTickets.length > 0) {
        // Enriquecer locales con Remedy en vivo
        openCasesMerged.forEach(c => {
            if (c.wo) {
                const rt = window.myOpenTickets.find(t => t.id === c.wo);
                if (rt) {
                    if (rt.description) c.notes = rt.description;
                    if (rt.company && (!c.company || c.company === '—')) c.company = rt.company;
                    if (!c.tipificacion || c.tipificacion === '') {
                        c.tipificacion = (typeof autoDetectTipificacion === 'function' ? autoDetectTipificacion(rt.summary || c.puesto) : null) || rt.element_type || '';
                    }
                }
            }
        });

        const mappedOpen = window.myOpenTickets.map(t => ({
            id: t.id,
            name: t.clientName || 'Sin nombre',
            email: t.email || '',
            company: t.company || '—',
            puesto: t.summary || '—',
            estado: 'remedy_assigned',
            wo: t.id,
            fechaRetiro: null,
            updatedAt: t.createdAt || t.created_at || now.toISOString(),
            createdAt: t.createdAt || t.created_at || now.toISOString(),
            notes: t.description || '',
            slaDate: t.slaDate || null,
            slaStatus: t.slaStatus || null,
            priority: t.priority || 'normal',
            urgency: t.urgency || '',
            impact: t.impact || '',
            tipificacion: (typeof autoDetectTipificacion === 'function' ? autoDetectTipificacion(t.summary) : null) || t.element_type || '',
            isRemedyOnly: true,
            status: t.status || '1'
        }));
        const localWos = new Set(openCasesMerged.map(c => c.wo).filter(Boolean));
        const uniqueRemedyOpen = mappedOpen.filter(t => !localWos.has(t.wo));
        openCasesMerged = [...openCasesMerged, ...uniqueRemedyOpen];
    }

    const incOpen = openCasesMerged.filter(t => t.id && t.id.startsWith('INC')).length;
    const woOpen = openCasesMerged.filter(t => t.id && t.id.startsWith('WO')).length;

    // ── Retiros de HOY por tipo de equipo ─────────────────────────────────────
    const todayKey = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const todayRetiros = (window.cases || []).filter(c => {
        if (!c.fechaRetiro) return false;
        if (['done', 'reject', 'not_accepted'].includes(c.estado)) return false;
        return String(c.fechaRetiro).slice(0, 10) === todayKey;
    });

    function _isKit(c) {
        const tip = (typeof resolveTipificacion === 'function' ? resolveTipificacion(c) : null) || c.tipificacion || '';
        return tip.toLowerCase().includes('kit');
    }
    function _isVincha(c) {
        const tip = (typeof resolveTipificacion === 'function' ? resolveTipificacion(c) : null) || c.tipificacion || '';
        return tip.toLowerCase().includes('vincha');
    }
    function _isRecambio(c) {
        const action = (c.action || '').toLowerCase();
        if (action === 'recambio') return true;
        const tip = (typeof resolveTipificacion === 'function' ? resolveTipificacion(c) : null) || c.tipificacion || '';
        const norm = tip.toLowerCase();
        return norm.includes('recambio') || norm.includes('equipo nuevo') || norm.includes('actualizacion') || norm.includes('alta/cambio');
    }

    const kitsHoy      = todayRetiros.filter(_isKit).length;
    const vinchasHoy   = todayRetiros.filter(_isVincha).length;
    const recambiosHoy = todayRetiros.filter(_isRecambio).length;

    const kitsAll      = allClosed.filter(_isKit).length;
    const vinchasAll   = allClosed.filter(_isVincha).length;
    const recambiosAll = allClosed.filter(_isRecambio).length;

    // Calcular métricas para nuevos widgets
    // 1. Alertas de SLA
    const next24 = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const slaAlerts = openCasesMerged.filter(c => {
        if (!c.slaDate) return false;
        const d = new Date(c.slaDate);
        return d <= next24;
    });

    // 2. Retiros Vencidos
    const overduePickups = openCasesMerged.filter(c => {
        if (!c.fechaRetiro) return false;
        const rStr = String(c.fechaRetiro).slice(0, 10);
        return rStr < todayKey;
    });

    // 3. Casos por prioridad
    const priorityCounts = { 'Crítica': 0, 'Alta': 0, 'Media': 0, 'Baja': 0 };
    openCasesMerged.forEach(c => {
        let p = 'Media';
        if (c.priority) {
            const lower = c.priority.toLowerCase();
            if (lower.includes('crit') || lower.includes('1')) p = 'Crítica';
            else if (lower.includes('alt') || lower.includes('2')) p = 'Alta';
            else if (lower.includes('med') || lower.includes('3')) p = 'Media';
            else if (lower.includes('baj') || lower.includes('4')) p = 'Baja';
        } else if (c.urgency && c.impact) {
            const resolved = calcRemedyPriority(c.urgency, c.impact);
            if (resolved && resolved.level) {
                const lvl = resolved.level;
                if (lvl === 'critica') p = 'Crítica';
                else if (lvl === 'alta') p = 'Alta';
                else if (lvl === 'media') p = 'Media';
                else if (lvl === 'baja') p = 'Baja';
            }
        }
        priorityCounts[p]++;
    });

    // 4. Casos sin WO
    const missingWoCases = (window.cases || []).filter(c => {
        if (['done', 'reject', 'not_accepted'].includes(c.estado)) return false;
        return !c.wo || (!c.wo.startsWith('WO') && !c.wo.startsWith('INC'));
    });

    // Actualizar elementos de texto en el DOM
    const elIncOpen = document.getElementById('metric_inc-open') || document.getElementById('metricIncOpen');
    if (elIncOpen) elIncOpen.textContent = incOpen;

    const elWoOpen = document.getElementById('metric_wo-open') || document.getElementById('metricWoOpen');
    if (elWoOpen) elWoOpen.textContent = woOpen;

    const elIncClosed = document.getElementById('metric_inc-closed') || document.getElementById('metricIncClosed');
    if (elIncClosed) elIncClosed.textContent = incClosed;

    const elWoClosed = document.getElementById('metric_wo-closed') || document.getElementById('metricWoClosed');
    if (elWoClosed) elWoClosed.textContent = woClosed;

    const elKits = document.getElementById('metric_kits-today') || document.getElementById('metricKitsHoy');
    if (elKits) elKits.textContent = kitsHoy;

    const elVinchas = document.getElementById('metric_vinchas-today') || document.getElementById('metricVinchasHoy');
    if (elVinchas) elVinchas.textContent = vinchasHoy;

    const elRecambios = document.getElementById('metric_recambios-today') || document.getElementById('metricRecambiosHoy');
    if (elRecambios) elRecambios.textContent = recambiosHoy;

    const elClosedTypifications = document.getElementById('metric_closed-typifications');
    if (elClosedTypifications) elClosedTypifications.textContent = localClosed.length;

    const elClosedCompanies = document.getElementById('metric_closed-companies');
    if (elClosedCompanies) elClosedCompanies.textContent = localClosed.length;

    const elSlaAlerts = document.getElementById('metric_sla-alerts');
    if (elSlaAlerts) elSlaAlerts.textContent = slaAlerts.length;

    const elStateDist = document.getElementById('metric_state-distribution');
    if (elStateDist) elStateDist.textContent = openCasesMerged.length;

    const elOverduePickups = document.getElementById('metric_overdue-pickups');
    if (elOverduePickups) elOverduePickups.textContent = overduePickups.length;

    const elPriorityBreakdown = document.getElementById('metric_priority-breakdown');
    if (elPriorityBreakdown) elPriorityBreakdown.textContent = openCasesMerged.length;

    const elMissingWo = document.getElementById('metric_missing-wo');
    if (elMissingWo) elMissingWo.textContent = missingWoCases.length;

    // Elementos de métricas históricas
    const elIncClosedAll = document.getElementById('metric_inc-closed-all');
    if (elIncClosedAll) elIncClosedAll.textContent = incClosedAll;

    const elWoClosedAll = document.getElementById('metric_wo-closed-all');
    if (elWoClosedAll) elWoClosedAll.textContent = woClosedAll;

    const elClosedTypificationsAll = document.getElementById('metric_closed-typifications-all');
    if (elClosedTypificationsAll) elClosedTypificationsAll.textContent = allClosed.length;

    const elClosedCompaniesAll = document.getElementById('metric_closed-companies-all');
    if (elClosedCompaniesAll) elClosedCompaniesAll.textContent = allClosed.length;

    const elKitsAll = document.getElementById('metric_kits-all');
    if (elKitsAll) elKitsAll.textContent = kitsAll;

    const elVinchasAll = document.getElementById('metric_vinchas-all');
    if (elVinchasAll) elVinchasAll.textContent = vinchasAll;

    const elRecambiosAll = document.getElementById('metric_recambios-all');
    if (elRecambiosAll) elRecambiosAll.textContent = recambiosAll;

    // Remedy Group Widgets
    const remedyGroupUnassignedCount = (window.remedyTickets || []).length;
    const remedyGroupAssignedCount = (window.allAssignedTickets || []).length;
    const remedyGroupOpenCount = remedyGroupUnassignedCount + remedyGroupAssignedCount;

    const elGroupOpen = document.getElementById('metric_remedy-group-open');
    if (elGroupOpen) elGroupOpen.textContent = remedyGroupOpenCount;

    const elGroupUnassigned = document.getElementById('metric_remedy-group-unassigned');
    if (elGroupUnassigned) elGroupUnassigned.textContent = remedyGroupUnassignedCount;

    const elGroupAssigned = document.getElementById('metric_remedy-group-assigned');
    if (elGroupAssigned) elGroupAssigned.textContent = remedyGroupAssignedCount;

    // Actualizar popovers correspondientes
    if (typeof window.updateBreakdownPopover === 'function') {
        if (enabledWidgets.includes('inc-open')) {
            window.updateBreakdownPopover('INC', 'popoverIncBreakdown');
        }
        if (enabledWidgets.includes('wo-open')) {
            window.updateBreakdownPopover('WO', 'popoverWoBreakdown');
        }
    }

    if (typeof window.updateTodayRetirosPopover === 'function') {
        if (enabledWidgets.includes('kits-today')) {
            window.updateTodayRetirosPopover('popoverKitsBreakdown', _isKit);
        }
        if (enabledWidgets.includes('vinchas-today')) {
            window.updateTodayRetirosPopover('popoverVinchasBreakdown', _isVincha);
        }
        if (enabledWidgets.includes('recambios-today')) {
            window.updateTodayRetirosPopover('popoverRecambiosBreakdown', _isRecambio);
        }
    }

    if (typeof window.updateAllRetirosPopover === 'function') {
        if (enabledWidgets.includes('kits-all')) {
            window.updateAllRetirosPopover('popoverKitsBreakdownAll', _isKit, allClosed);
        }
        if (enabledWidgets.includes('vinchas-all')) {
            window.updateAllRetirosPopover('popoverVinchasBreakdownAll', _isVincha, allClosed);
        }
        if (enabledWidgets.includes('recambios-all')) {
            window.updateAllRetirosPopover('popoverRecambiosBreakdownAll', _isRecambio, allClosed);
        }
    }

    // Actualizar popovers de cerrados y nuevos widgets
    if (enabledWidgets.includes('closed-typifications')) {
        window.updateClosedTypificationsPopover(localClosed, 'popoverClosedTypifications');
    }
    if (enabledWidgets.includes('closed-companies')) {
        window.updateClosedByCompanyPopover(localClosed, 'popoverClosedCompanies');
    }
    if (enabledWidgets.includes('closed-typifications-all')) {
        window.updateClosedTypificationsPopover(allClosed, 'popoverClosedTypificationsAll');
    }
    if (enabledWidgets.includes('closed-companies-all')) {
        window.updateClosedByCompanyPopover(allClosed, 'popoverClosedCompaniesAll');
    }
    if (enabledWidgets.includes('sla-alerts')) {
        window.updateSlaAlertsPopover(slaAlerts);
    }
    if (enabledWidgets.includes('state-distribution')) {
        window.updateStateDistributionPopover(openCasesMerged);
    }
    if (enabledWidgets.includes('overdue-pickups')) {
        window.updateOverduePickupsPopover(overduePickups);
    }
    if (enabledWidgets.includes('priority-breakdown')) {
        window.updatePriorityBreakdownPopover(priorityCounts);
    }
    if (enabledWidgets.includes('missing-wo')) {
        window.updateMissingWoPopover(missingWoCases);
    }

    if (enabledWidgets.includes('remedy-group-open')) {
        window.updateRemedyGroupOpenPopover();
    }
    if (enabledWidgets.includes('remedy-group-unassigned')) {
        window.updateRemedyGroupUnassignedPopover();
    }
    if (enabledWidgets.includes('remedy-group-assigned')) {
        window.updateRemedyGroupAssignedPopover();
    }

    // Guardar para el modal de ver todas las tipificaciones
    window._lastLocalClosed = localClosed;
    window._lastAllClosed = allClosed;
}

function renderList() {
    // Si la configuración no está cargada, la cargamos de forma asíncrona no-bloqueante
    if (!listGroupingLoaded) {
        if (!listGroupingPromise) {
            listGroupingPromise = loadListGroupingConfig().then(() => {
                listGroupingLoaded = true;
                renderList();
            });
        }
        return;
    }

    // Generar estructura HTML de widgets dinámicamente según configuración
    renderWidgetsLayout();

    // Actualizar métricas antes de renderizar
    updateListMetrics();

    const query = window.listSearchQuery || '';
    const tabFilter = document.querySelector('#listTabs button.active')?.dataset.listFilter || 'open';
    
    // 1. Separamos por solapa (Mis activos o Mis cerrados) y mezclamos los tickets de Remedy en vivo
    let filtered = [];
    if (tabFilter === 'open') {
        filtered = window.cases.filter(c => !['done', 'reject', 'not_accepted'].includes(c.estado));
        
        // Mezclar tickets abiertos de Remedy en vivo si está conectado
        if (typeof window.remedyConnected !== 'undefined' && window.remedyConnected && typeof window.myOpenTickets !== 'undefined' && window.myOpenTickets.length > 0) {
            const mappedOpen = window.myOpenTickets.map(t => ({
                id: t.id,
                name: t.clientName || 'Sin nombre',
                email: t.email || '',
                company: t.company || '—',
                puesto: t.summary || '—',
                estado: 'remedy_assigned',
                wo: t.id,
                fechaRetiro: null,
                updatedAt: t.createdAt || t.created_at || nowISO(),
                createdAt: t.createdAt || t.created_at || nowISO(),
                notes: t.description || '',
                slaDate: t.slaDate || null,
                slaStatus: t.slaStatus || null,
                priority: t.priority || 'normal',
                urgency: t.urgency || '',
                impact: t.impact || '',
                tipificacion: (typeof autoDetectTipificacion === 'function' ? autoDetectTipificacion(t.summary) : null) || t.element_type || '',
                isRemedyOnly: true,
                status: t.status || '1'
            }));
            
            // Evitamos duplicar por WO
            const localWos = new Set(filtered.map(c => c.wo).filter(Boolean));
            const uniqueRemedyOpen = mappedOpen.filter(t => !localWos.has(t.wo));
            
            filtered = [...filtered, ...uniqueRemedyOpen];
        }
    } else if (tabFilter === 'closed') {
        filtered = window.cases.filter(c => ['done', 'reject', 'not_accepted'].includes(c.estado));

        // Mezclar tickets cerrados de Remedy en vivo si está conectado
        if (typeof window.remedyConnected !== 'undefined' && window.remedyConnected && typeof window.myClosedTickets !== 'undefined' && window.myClosedTickets.length > 0) {
            // Actualizar descripción de casos locales con la descripción original de Remedy
            filtered.forEach(c => {
                if (c.wo) {
                    const rt = window.myClosedTickets.find(t => t.id === c.wo);
                    if (rt && rt.description) {
                        c.notes = rt.description;
                    }
                }
            });

            const mappedClosed = window.myClosedTickets.map(t => ({
                id: t.id,
                name: t.clientName || 'Sin nombre',
                email: t.email || '',
                company: t.company || '—',
                puesto: t.summary || '—',
                estado: 'done',
                wo: t.id,
                fechaRetiro: null,
                updatedAt: t.createdAt || t.created_at || nowISO(),
                createdAt: t.createdAt || t.created_at || nowISO(),
                notes: t.description || '',
                slaDate: t.slaDate || null,
                slaStatus: t.slaStatus || null,
                priority: t.priority || 'normal',
                urgency: t.urgency || '',
                impact: t.impact || '',
                tipificacion: (typeof autoDetectTipificacion === 'function' ? autoDetectTipificacion(t.summary) : null) || t.element_type || '',
                isRemedyOnly: true,
                status: t.status || '4'
            }));

            // Evitamos duplicar por WO
            const localWos = new Set(filtered.map(c => c.wo).filter(Boolean));
            const uniqueRemedyClosed = mappedClosed.filter(t => !localWos.has(t.wo));

            filtered = [...filtered, ...uniqueRemedyClosed];
        }
    } else if (tabFilter === 'all') {
        filtered = window.cases;
    }

    // 2. Ahora aplicamos la búsqueda sobre la lista combinada final
    filtered = searchCases(filtered, query);

    const sorted = [...filtered].sort((a, b) => {
        if (window.usersSort.key === 'fechaRetiro') {
            const timeA = a.fechaRetiro 
                ? new Date(a.fechaRetiro.includes('T') ? a.fechaRetiro : a.fechaRetiro + 'T00:00:00').getTime() 
                : (window.usersSort.dir === 'asc' ? 9999999999999 : -1);
            const timeB = b.fechaRetiro 
                ? new Date(b.fechaRetiro.includes('T') ? b.fechaRetiro : b.fechaRetiro + 'T00:00:00').getTime() 
                : (window.usersSort.dir === 'asc' ? 9999999999999 : -1);
            return window.usersSort.dir === 'asc' ? timeA - timeB : timeB - timeA;
        }
        const valA = a[window.usersSort.key] || '';
        const valB = b[window.usersSort.key] || '';
        return window.usersSort.dir === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

    const totalLabel = query
        ? `${sorted.length} resultado${sorted.length === 1 ? '' : 's'}`
        : `${sorted.length} caso${sorted.length === 1 ? '' : 's'}`;
    document.getElementById('usersCount').textContent = totalLabel;

    // 3. Renderizamos dinámicamente usando múltiples tbodies para los grupos
    const table = document.querySelector('#view-list .users-table');
    if (table) {
        // Limpiamos los tbodies anteriores
        table.querySelectorAll('tbody').forEach(tb => tb.remove());

        // Controlar la visibilidad del botón de crear grupo
        const createGroupBtn = document.getElementById('btnCreateGroup');
        if (createGroupBtn) {
            createGroupBtn.style.display = tabFilter === 'open' ? 'inline-flex' : 'none';
        }

        // Modificar los encabezados de la tabla dinámicamente
        const thead = table.querySelector('thead');
        if (thead) {
            if (tabFilter === 'closed') {
                thead.innerHTML = `
                    <tr>
                        <th data-sort="wo" style="width: 140px; cursor: pointer;">Incidente / Ticket</th>
                        <th data-sort="name" style="width: 160px; cursor: pointer;">Usuario</th>
                        <th data-sort="company" style="width: 120px; cursor: pointer;">Empresa</th>
                        <th data-sort="puesto" style="width: 240px; cursor: pointer;">Tipificación</th>
                        <th style="cursor: default;">Descripción</th>
                    </tr>
                `;
            } else {
                thead.innerHTML = `
                    <tr>
                        <th style="width: 36px; text-align: center;"><input type="checkbox" id="bulkSelectAll" style="cursor: pointer;"></th>
                        <th data-sort="wo" style="width: 140px; cursor: pointer;">Incidente / Ticket</th>
                        <th data-sort="name" style="width: 140px; cursor: pointer;">Usuario</th>
                        <th data-sort="company" style="width: 100px; cursor: pointer;">Empresa</th>
                        <th data-sort="puesto" style="width: 230px; cursor: pointer;">Tipificación</th>
                        <th style="cursor: default;">Descripción</th>
                        <th data-sort="slaDate" style="width: 170px; cursor: pointer;">SLA</th>
                        <th style="width: 220px; text-align: center; cursor: default;">Acción</th>
                    </tr>
                `;
            }
            // Re-cablear listeners de ordenamiento
            thead.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const key = th.dataset.sort;
                    if (window.usersSort.key === key) {
                        window.usersSort.dir = window.usersSort.dir === 'asc' ? 'desc' : 'asc';
                    } else {
                        window.usersSort.key = key;
                        window.usersSort.dir = 'asc';
                    }
                    renderList();
                });
            });
        }

        if (tabFilter === 'closed') {
            // Render clásico plano para cerrados
            const tbody = document.createElement('tbody');
            tbody.id = 'usersTableBody';
            tbody.innerHTML = sorted.length === 0
                ? `<tr><td colspan="5" style="text-align:center; padding: 32px; color: var(--text-faint);">Sin resultados.</td></tr>`
                : sorted.map(c => renderListRow(c, tabFilter)).join('');
            table.appendChild(tbody);
        } else {
            // Render agrupado para activos
            listGroups.forEach(group => {
                const groupCases = sorted.filter(c => {
                    const assignedGroupId = (c.id && listTicketAssignments[c.id]) || (c.wo && listTicketAssignments[c.wo]);
                    if (assignedGroupId) {
                        return assignedGroupId === group.id;
                    }
                    // Determinación por defecto
                    const isWO = c.wo && String(c.wo).toUpperCase().startsWith('WO');
                    const defaultGroupId = isWO ? 'default-wo' : 'default-inc';
                    return defaultGroupId === group.id;
                });

                // Aplicar orden personalizado dentro del grupo si existe
                const groupOrder = listTicketOrder[group.id];
                if (groupOrder && groupOrder.length > 0) {
                    groupCases.sort((a, b) => {
                        const idA = a.id || a.wo;
                        const idB = b.id || b.wo;
                        const posA = groupOrder.indexOf(String(idA));
                        const posB = groupOrder.indexOf(String(idB));
                        // Tickets sin posición van al final
                        const normA = posA === -1 ? 9999 : posA;
                        const normB = posB === -1 ? 9999 : posB;
                        return normA - normB;
                    });
                }

                const isCollapsed = !!listGroupsCollapsed[group.id];
                const tbody = document.createElement('tbody');
                tbody.className = 'group-tbody';
                tbody.dataset.groupId = group.id;

                // Listeners de drag & drop
                tbody.addEventListener('dragover', window.handleGroupDragOver);
                tbody.addEventListener('dragleave', window.handleGroupDragLeave);
                tbody.addEventListener('drop', (e) => window.handleGroupDrop(e, group.id));

                const colColor = group.id === 'default-inc' ? 'var(--st-assigned, #038387)' : group.id === 'default-wo' ? 'var(--st-assigned-wo, #0099BC)' : 'var(--primary)';

                const headerHtml = `
                    <tr class="group-header-row" draggable="true"
                        ondragstart="window.handleGroupHeaderDragStart(event, '${group.id}')"
                        ondragend="window.handleGroupHeaderDragEnd(event)"
                        ondragover="window.handleGroupHeaderDragOver(event)"
                        ondragleave="window.handleGroupHeaderDragLeave(event)"
                        ondrop="window.handleGroupHeaderDrop(event, '${group.id}')"
                        onclick="toggleGroupCollapse('${group.id}')">
                        <td colspan="8">
                            <div class="group-header-content" style="display: flex; align-items: center; justify-content: flex-start; gap: 16px;">
                                <div style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
                                    <i data-lucide="grip-vertical" class="group-drag-handle" style="width: 14px; height: 14px; color: var(--text-faint); cursor: grab;" onclick="event.stopPropagation();"></i>
                                    <i data-lucide="${isCollapsed ? 'chevron-right' : 'chevron-down'}" style="width: 14px; height: 14px; color: var(--text-muted);"></i>
                                    <span style="font-size: 13.5px; color: ${colColor};">${escapeHtml(group.label)}</span>
                                    <span class="col-count">${groupCases.length}</span>
                                </div>
                                <div style="display: flex; gap: 6px; align-items: center;" onclick="event.stopPropagation();">
                                    ${listTicketOrder[group.id] && listTicketOrder[group.id].length > 0 ? `
                                        <button class="btn btn-ghost" title="Orden personalizado activo. Clic para ordenar por fecha de retiro."
                                            onclick="window.resetGroupOrder('${group.id}')"
                                            style="font-size: 11px; padding: 2px 6px; gap: 3px; height: 22px; border: 1px solid var(--primary); color: var(--primary); background: rgba(0,120,212,0.07);">
                                            <i data-lucide="list-ordered" style="width: 11px; height: 11px;"></i> Orden propio
                                        </button>
                                    ` : `
                                        <button class="btn btn-ghost" title="Ordenar por fecha de retiro (asc)"
                                            onclick="window.sortGroupByDate('${group.id}')"
                                            style="font-size: 11px; padding: 2px 6px; gap: 3px; height: 22px; border: 1px solid var(--border); color: var(--text-muted);">
                                            <i data-lucide="calendar-arrow-up" style="width: 11px; height: 11px;"></i> Por fecha
                                        </button>
                                    `}
                                </div>
                                ${!group.isDefault ? `
                                    <div class="group-actions" onclick="event.stopPropagation();" style="display: flex; gap: 6px;">
                                        <button class="btn btn-ghost" onclick="renameGroup('${group.id}')" title="Renombrar grupo" style="font-size: 11px; padding: 2px 6px; gap: 4px; height: 24px; border: 1px solid var(--border); background: var(--surface); color: var(--text);"><i data-lucide="pencil" style="width: 11px; height: 11px;"></i> Renombrar</button>
                                        <button class="btn btn-danger" onclick="deleteGroup('${group.id}')" title="Eliminar grupo" style="font-size: 11px; padding: 2px 6px; gap: 4px; height: 24px; border: 1px solid var(--border); background: var(--surface); color: var(--danger);"><i data-lucide="trash-2" style="width: 11px; height: 11px;"></i> Eliminar</button>
                                    </div>
                                ` : ''}
                            </div>
                        </td>
                    </tr>
                `;

                let rowsHtml = '';
                if (!isCollapsed) {
                    if (groupCases.length === 0) {
                        rowsHtml = `
                            <tr>
                                <td colspan="8" style="text-align:center; padding: 16px; color: var(--text-faint); font-style: italic; font-size: 12.5px; border-bottom: 1px solid var(--border-soft);">
                                    Arrastrá tickets acá para agruparlos
                                </td>
                            </tr>
                        `;
                    } else {
                        rowsHtml = groupCases.map(c => renderListRow(c, tabFilter)).join('');
                    }
                }

                tbody.innerHTML = headerHtml + rowsHtml;
                table.appendChild(tbody);
            });
        }
    }

    // Re-cableo el listener del buscador en cada render. Mantengo el foco
    // si el usuario venía escribiendo.
    const searchEl = document.getElementById('listSearch');
    if (searchEl) {
        searchEl.value = query;
        searchEl.oninput = (e) => {
            const val = e.target.value;
            window.listSearchQuery = val;
            renderList();

            // Búsqueda en caliente en Remedy para tickets cerrados (desactivada en favor de búsqueda SQLite local)
            /*
            if (tabFilter === 'closed' && typeof window.remedyConnected !== 'undefined' && window.remedyConnected) {
                if (closedSearchTimeout) clearTimeout(closedSearchTimeout);
                closedSearchTimeout = setTimeout(async () => {
                    const trimmed = val.trim();
                    if (trimmed.length > 0 && trimmed.length < 3) return;
                    try {
                        window.myClosedTickets = await API.listMyRemedyTickets('closed', trimmed);
                        renderList();
                    } catch (err) {
                        console.error("Error al buscar tickets cerrados:", err);
                    }
                }, 400);
            }
            */
        };
        if (query) {
            searchEl.focus();
            searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
        }
    }
    renderIcons();

    // Re-cablear listeners de acciones masivas flotantes
    const bulkSelectAll = document.getElementById('bulkSelectAll');
    if (bulkSelectAll) {
        const activeCheckboxes = document.querySelectorAll('.bulk-case-checkbox:not(:disabled)');
        const allChecked = activeCheckboxes.length > 0 && Array.from(activeCheckboxes).every(cb => selectedCaseIds.has(cb.dataset.id));
        bulkSelectAll.checked = allChecked;
        
        bulkSelectAll.onchange = (e) => {
            const checked = e.target.checked;
            const checkboxes = document.querySelectorAll('.bulk-case-checkbox:not(:disabled)');
            checkboxes.forEach(cb => {
                cb.checked = checked;
                const id = cb.dataset.id;
                if (id) {
                    if (checked) selectedCaseIds.add(id);
                    else selectedCaseIds.delete(id);
                }
            });
            onBulkCheckboxChange();
        };
    }

    const itemCheckboxes = document.querySelectorAll('.bulk-case-checkbox');
    itemCheckboxes.forEach(cb => {
        cb.onchange = (e) => {
            const id = cb.dataset.id;
            if (id) {
                if (e.target.checked) selectedCaseIds.add(id);
                else selectedCaseIds.delete(id);
            }
            // Sincronizar el checkbox general "Seleccionar todo"
            const activeCheckboxes = document.querySelectorAll('.bulk-case-checkbox:not(:disabled)');
            const allChecked = activeCheckboxes.length > 0 && Array.from(activeCheckboxes).every(inp => selectedCaseIds.has(inp.dataset.id));
            if (bulkSelectAll) bulkSelectAll.checked = allChecked;
            
            onBulkCheckboxChange();
        };
    });

    onBulkCheckboxChange();
}



// Formato corto para fecha de retiro: "Lun 19/05". Usado en chips de Vista Hoy
// y Tablero. Una fecha tipo "2026-05-20" se interpreta como UTC por new Date,
// y en zonas con offset negativo (AR = UTC-3) cae al día anterior. Tomamos
// los componentes manuales para forzar interpretación local.
function formatRetiroShort(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const dia = d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
    const fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    let label = `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${fecha}`;
    
    // Si contiene hora (formato YYYY-MM-DDTHH:MM)
    if (iso.includes('T')) {
        const timePart = iso.split('T')[1].slice(0, 5); // extrae HH:MM
        label += ` ${timePart}hs`;
    }
    return label;
}

function renderTaskItem(c, opts) {
    opts = opts || {};
    const days = daysSince(c.updatedAt);
    const aging = days < 2 ? 'aging-fresh' : (days < 5 ? 'aging-warn' : 'aging-stale');
    const agingLabel = days === 0 ? 'hoy' : `${days}d`;
    const estado = window.ESTADOS.find(e => e.id === c.estado);
    const priorityChip = c.priority === 'alta'
        ? `<span class="priority-badge"><i data-lucide="alert-triangle"></i> Urgente</span>` : '';
    const retiroChip = (opts.showFechaRetiro && c.fechaRetiro)
        ? `<span class="retiro-badge"><i data-lucide="calendar"></i> ${formatRetiroShort(c.fechaRetiro)}</span>` : '';
    // En grupos de retiro la fecha agendada manda. El aging por updatedAt
    // confunde porque marca cuándo se tocó el caso, no cuándo se retira.
    const showAging = !opts.showFechaRetiro;
    return `
        <div class="task-item" onclick="openCase('${c.id}')">
            <div class="task-avatar">${initials(c.name)}</div>
            <div class="task-content">
                <div class="task-name">${escapeHtml(c.name || 'Sin nombre')}</div>
                <div class="task-meta">
                    <span>${escapeHtml(c.company || '—')}</span>
                    <span class="dot"></span>
                    <span>${estadoLabelFor(c)}</span>
                    ${retiroChip}
                    ${priorityChip}
                </div>
            </div>
            ${showAging ? `<span class="aging-badge ${aging}">${agingLabel}</span>` : ''}
        </div>
    `;
}

// ============================================================
// ACCIONES MASIVAS: CIERRE EN LOTE
// ============================================================
window.onBulkCheckboxChange = function() {
    const count = selectedCaseIds.size;
    const bar = document.getElementById('bulkActionBar');
    const selectedText = document.getElementById('bulkSelectedText');
    
    if (bar && selectedText) {
        if (count > 0) {
            selectedText.textContent = `${count} caso${count === 1 ? '' : 's'} seleccionado${count === 1 ? '' : 's'}`;
            bar.style.display = 'flex';
        } else {
            bar.style.display = 'none';
            const allChk = document.getElementById('bulkSelectAll');
            if (allChk) allChk.checked = false;
        }
    }
};

window.clearBulkSelection = function() {
    selectedCaseIds.clear();
    const checkboxes = document.querySelectorAll('.bulk-case-checkbox');
    checkboxes.forEach(c => c.checked = false);
    const allChk = document.getElementById('bulkSelectAll');
    if (allChk) allChk.checked = false;
    onBulkCheckboxChange();
};

// Bind cancel button
const btnBulkCancel = document.getElementById('btnBulkCancel');
if (btnBulkCancel) {
    btnBulkCancel.addEventListener('click', clearBulkSelection);
}

// Modal bulk resolve events
const btnBulkClose = document.getElementById('btnBulkClose');
if (btnBulkClose) {
    btnBulkClose.addEventListener('click', () => {
        const checkedBoxes = document.querySelectorAll('.bulk-case-checkbox:checked');
        if (checkedBoxes.length === 0) return;
        
        const wos = Array.from(checkedBoxes).map(cb => cb.dataset.wo).filter(Boolean);
        const ticketListContainer = document.getElementById('bulkResolveTicketList');
        if (ticketListContainer) {
            ticketListContainer.textContent = wos.length > 0 ? wos.join(', ') : 'Casos manuales sin número de Remedy';
        }
        document.getElementById('bulkResolveNote').value = '';
        document.getElementById('bulkResolveError').style.display = 'none';
        
        const fileInp = document.getElementById('bulkResolveFile');
        if (fileInp) fileInp.value = '';
        
        document.getElementById('bulkResolveModal').classList.add('open');
    });
}

const bulkResolveClose = document.getElementById('bulkResolveClose');
if (bulkResolveClose) {
    bulkResolveClose.addEventListener('click', () => {
        document.getElementById('bulkResolveModal').classList.remove('open');
    });
}
const bulkResolveCancel = document.getElementById('bulkResolveCancel');
if (bulkResolveCancel) {
    bulkResolveCancel.addEventListener('click', () => {
        document.getElementById('bulkResolveModal').classList.remove('open');
    });
}

// Bulk Resolve Confirm
const bulkResolveConfirm = document.getElementById('bulkResolveConfirm');
if (bulkResolveConfirm) {
    bulkResolveConfirm.addEventListener('click', async () => {
        const checkedBoxes = document.querySelectorAll('.bulk-case-checkbox:checked');
        if (checkedBoxes.length === 0) return;
        
        const note = document.getElementById('bulkResolveNote').value.trim();
        const fileInp = document.getElementById('bulkResolveFile');
        const file = fileInp ? (fileInp.files[0] || null) : null;
        const errEl = document.getElementById('bulkResolveError');
        const confirmLabel = document.getElementById('bulkResolveConfirmLabel');
        
        if (!note) {
            if (errEl) {
                errEl.textContent = 'La nota de resolución es obligatoria.';
                errEl.style.display = 'block';
            }
            return;
        }
        
        if (confirmLabel) confirmLabel.textContent = 'Procesando cierre...';
        document.getElementById('bulkResolveConfirm').disabled = true;
        if (errEl) errEl.style.display = 'none';
        
        const casesToResolve = Array.from(checkedBoxes).map(cb => {
            const id = cb.dataset.id;
            const wo = cb.dataset.wo;
            const ticketType = (wo && wo.startsWith('WO')) ? 'WO' : 'INC';
            return { id, wo, ticketType };
        });
        
        let successCount = 0;
        let errors = [];
        
        Swal.fire({
            title: 'Cerrando tickets...',
            html: `Procesando <b>0</b> de ${casesToResolve.length} tickets en Remedy.`,
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        for (let i = 0; i < casesToResolve.length; i++) {
            const item = casesToResolve[i];
            const boldEl = Swal.getHtmlContainer().querySelector('b');
            if (boldEl) boldEl.textContent = i + 1;
            
            try {
                // 1. Resolver en Remedy
                if (item.wo && typeof window.remedyConnected !== 'undefined' && window.remedyConnected) {
                    await API.changeRemedyStatus(item.wo, item.ticketType, 'resolved', note, file);
                }
                
                // 2. Actualizar localmente en SQLite
                if (item.id && !item.id.startsWith('remedy-')) {
                    await API.update(item.id, {
                        estado: 'done',
                        logEvent: `Cierre masivo en lote. Nota: ${note}`
                    });
                }
                successCount++;
            } catch(e) {
                console.error(`Error resolviendo ticket ${item.wo || item.id}:`, e);
                errors.push(`Ticket ${item.wo || item.id}: ${e.message}`);
            }
        }
        
        if (confirmLabel) confirmLabel.textContent = 'Confirmar cierre masivo';
        document.getElementById('bulkResolveConfirm').disabled = false;
        document.getElementById('bulkResolveModal').classList.remove('open');
        
        clearBulkSelection();
        
        if (typeof loadRemedyTickets === 'function') await loadRemedyTickets();
        if (typeof refresh === 'function') await refresh();
        renderList();
        
        if (errors.length > 0) {
            Swal.fire({
                icon: 'warning',
                title: `Cierre masivo completado`,
                html: `Se cerraron con éxito <b>${successCount}</b> tickets.<br><br>Hubo errores en <b>${errors.length}</b> tickets:<br><ul style="text-align:left; font-size:12px; margin-top:8px;">${errors.map(err => `<li>${escapeHtml(err)}</li>`).join('')}</ul>`,
                confirmButtonColor: 'var(--primary)'
            });
        } else {
            Swal.fire({
                icon: 'success',
                title: 'Cierre masivo exitoso',
                text: `Se han resuelto los ${successCount} tickets correctamente en Remedy y el organizador.`,
                confirmButtonColor: 'var(--primary)'
            });
        }
    });
}

// Botón Refresh Token en la lista
const btnRefreshListToken = document.getElementById('btnRefreshListToken');
if (btnRefreshListToken) {
    btnRefreshListToken.addEventListener('click', async () => {
        btnRefreshListToken.innerHTML = '<i data-lucide="loader-2" class="spin" style="width:14px; height:14px;"></i>';
        renderIcons();
        try {
            if (typeof window.loadRemedyTickets === 'function') {
                await window.loadRemedyTickets();
                toast('Tickets y Token actualizados', 'success');
            } else {
                toast('Error: Remedy no conectado', 'error');
            }
        } catch(e) {
            toast('Error al actualizar: ' + e.message, 'error');
        } finally {
            btnRefreshListToken.innerHTML = '<i data-lucide="refresh-cw" style="width:14px; height:14px;"></i>';
            renderIcons();
            if (typeof renderList === 'function') renderList();
        }
    });
}

window.togglePriorityInList = async function(caseId) {
    const c = casesById(caseId);
    if (!c) {
        toast('No se encontró el caso', 'error');
        return;
    }
    const isHigh = c.priority === 'alta';
    const newPri = isHigh ? 'normal' : 'alta';
    try {
        await API.update(caseId, {
            priority: newPri,
            logEvent: isHigh ? 'Prioridad removida' : 'Marcado como urgente'
        });
        await refresh();
        if (typeof window.myOpenTickets !== 'undefined' && window.myOpenTickets.length > 0) {
            const idx = window.myOpenTickets.findIndex(t => t.id === caseId);
            if (idx !== -1) {
                window.myOpenTickets[idx].priority = newPri;
            }
        }
        if (typeof window.myClosedTickets !== 'undefined' && window.myClosedTickets.length > 0) {
            const idx = window.myClosedTickets.findIndex(t => t.id === caseId);
            if (idx !== -1) {
                window.myClosedTickets[idx].priority = newPri;
            }
        }
        renderList();
        toast(isHigh ? 'Prioridad: Normal' : 'Prioridad: Alta', 'success');
    } catch (err) {
        console.error(err);
        toast('Error al actualizar prioridad', 'error');
    }
};


// Expose to window for global module compatibility
window.calcRemedyPriority = calcRemedyPriority;
window.remedyPriorityChip = remedyPriorityChip;
window.loadListGroupingConfig = loadListGroupingConfig;
window.saveListGroupingConfig = saveListGroupingConfig;
window.renderListRow = renderListRow;
window.updateListMetrics = updateListMetrics;
window.renderList = renderList;
window.formatRetiroShort = formatRetiroShort;
window.renderTaskItem = renderTaskItem;

// Context Menu handlers
window.handleRowContextMenu = function(e, caseId) {
    e.preventDefault();
    e.stopPropagation();

    const menu = document.getElementById('customContextMenu');
    if (!menu) return;

    // Find the case object
    let caseObj = (window.cases || []).find(c => c.id === caseId || c.wo === caseId);
    if (!caseObj && typeof window.myOpenTickets !== 'undefined') {
        caseObj = window.myOpenTickets.find(t => t.id === caseId);
    }
    
    // Get current group assignment
    let currentGroupId = null;
    if (caseObj) {
        currentGroupId = (caseObj.id && listTicketAssignments[caseObj.id]) || (caseObj.wo && listTicketAssignments[caseObj.wo]);
        if (!currentGroupId) {
            const isWO = caseObj.wo && String(caseObj.wo).toUpperCase().startsWith('WO');
            currentGroupId = isWO ? 'default-wo' : 'default-inc';
        }
    } else {
        currentGroupId = listTicketAssignments[caseId];
        if (!currentGroupId) {
            const isWO = String(caseId).toUpperCase().startsWith('WO');
            currentGroupId = isWO ? 'default-wo' : 'default-inc';
        }
    }

    const submenu = document.getElementById('contextMenuSubmenu');
    if (!submenu) return;

    submenu.innerHTML = '';
    listGroups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'context-submenu-item';
        item.innerHTML = (group.id === currentGroupId ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--primary);display:inline-block;margin-right:6px;"></span>' : '') + escapeHtml(group.label);
        item.title = group.label;
        item.onclick = async (event) => {
            event.stopPropagation();
            menu.classList.add('hidden');
            await window.moveTicketToGroup(caseId, group.id);
        };
        submenu.appendChild(item);
    });

    const menuWidth = 180;
    const menuHeight = 50;
    
    let left = e.pageX;
    let top = e.pageY;
    
    if (left + menuWidth > window.innerWidth + window.scrollX) {
        left = window.innerWidth + window.scrollX - menuWidth - 10;
    }
    if (top + menuHeight > window.innerHeight + window.scrollY) {
        top = window.innerHeight + window.scrollY - menuHeight - 10;
    }
    
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    if (left + menuWidth * 2 > window.innerWidth + window.scrollX) {
        submenu.style.left = 'auto';
        submenu.style.right = '99%';
    } else {
        submenu.style.left = '99%';
        submenu.style.right = 'auto';
    }

    menu.classList.remove('hidden');
    
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.moveTicketToGroup = async function(caseId, groupId) {
    if (!caseId || !groupId) return;
    
    listTicketAssignments[caseId] = groupId;
    await saveListGroupingConfig();
    renderList();
    toast('Ticket movido de grupo', 'success');
};

// Document-level events for closing the context menu
document.addEventListener('click', () => {
    const menu = document.getElementById('customContextMenu');
    if (menu) menu.classList.add('hidden');
});

document.addEventListener('contextmenu', (e) => {
    const tr = e.target.closest('tr');
    if (!tr || !tr.hasAttribute('oncontextmenu')) {
        const menu = document.getElementById('customContextMenu');
        if (menu) menu.classList.add('hidden');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const menu = document.getElementById('customContextMenu');
        if (menu) menu.classList.add('hidden');
    }
});

window.updateBreakdownPopover = function(type, elementId) {
    const popover = document.getElementById(elementId);
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    if (!window.myOpenTickets || window.myOpenTickets.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay tickets.</span>';
        return;
    }

    const filtered = window.myOpenTickets.filter(t => t.id && t.id.startsWith(type));
    if (filtered.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay tickets.</span>';
        return;
    }

    const categoryDetails = {};
    filtered.forEach(t => {
        let cat = t.element_type || 'Otros / Equipo';
        
        // Clasificación inteligente en el frontend si es genérico "Equipo" o "Otros / Equipo"
        if (cat === 'Equipo' || cat === 'Otros / Equipo') {
            const text = ((t.summary || '') + ' ' + (t.description || '')).toLowerCase();
            if (text.includes('software') || text.includes('configur') || text.includes('instalac') || text.includes('outlook') || text.includes('correo') || text.includes('acceso') || text.includes('virtual') || text.includes('error')) {
                cat = 'Software / Configuración';
            } else if (text.includes('wifi') || text.includes('red') || text.includes('conexion') || text.includes('conexión') || text.includes('vpn') || text.includes('switch') || text.includes('router') || text.includes('conectividad')) {
                cat = 'Red / Conectividad';
            }
        }
        
        if (!categoryDetails[cat]) {
            categoryDetails[cat] = { count: 0, companies: {} };
        }
        categoryDetails[cat].count++;
        
        let comp = typeof window.getCompanyForCase === 'function' ? window.getCompanyForCase(t) : (t.company || 'Empresa Principal');
        if (!comp || comp === '—') comp = 'Empresa Principal';
        categoryDetails[cat].companies[comp] = (categoryDetails[cat].companies[comp] || 0) + 1;
    });

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Distribución</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Remedy</span>
        </div>
    `;

    function getIconForCat(catName) {
        const name = catName.toLowerCase();
        if (name.includes('vincha')) return 'headphones';
        if (name.includes('kit')) return 'keyboard';
        if (name.includes('celular') || name.includes('cel')) return 'smartphone';
        if (name.includes('cargador') || name.includes('adaptador')) return 'plug';
        if (name.includes('monitor')) return 'monitor';
        if (name.includes('software') || name.includes('configur')) return 'settings';
        if (name.includes('red') || name.includes('wifi') || name.includes('conexion') || name.includes('conectiv')) return 'wifi';
        if (name.includes('equipo') || name.includes('pc') || name.includes('notebook') || name.includes('laptop')) return 'laptop';
        return 'tag';
    }

    const itemsHtml = Object.entries(categoryDetails)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([cat, detail]) => {
            const iconName = getIconForCat(cat);
            const { count, companies } = detail;
            
            const companyRows = Object.entries(companies)
                .sort((a, b) => b[1] - a[1])
                .map(([company, cnt]) => `
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; gap: 8px;">
                        <span style="color: var(--text-muted); font-weight: 500; white-space: nowrap;">${company}</span>
                        <strong style="color: var(--primary); font-weight: 700;">${cnt}</strong>
                    </div>
                `).join('');

            const subPopoverHtml = `
                <div class="breakdown-sub-popover">
                    <!-- Flecha apuntando a la izquierda (borde izquierdo) -->
                    <div style="position: absolute; top: 10px; right: 100%; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-right: 5px solid var(--border);"></div>
                    <div style="position: absolute; top: 10px; right: 100%; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-right: 5px solid var(--surface); margin-right: -1px;"></div>
                    <div style="font-weight: 700; color: var(--text); font-size: 10px; margin-bottom: 4px; border-bottom: 1px solid var(--border-soft); padding-bottom: 2px; text-transform: uppercase; letter-spacing: 0.3px;">Empresa</div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        ${companyRows}
                    </div>
                </div>
            `;

            return `
                <div class="breakdown-item">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                            <i data-lucide="${iconName}" style="width: 12.5px; height: 12.5px; flex-shrink: 0; color: var(--text-muted);"></i>
                            <span style="color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${escapeHtml(cat)}">${escapeHtml(cat)}</span>
                        </div>
                        <span style="background: var(--primary-soft); color: var(--primary); font-weight: 700; border-radius: 4px; padding: 1px 5px; font-size: 10px; min-width: 16px; text-align: center;">${count}</span>
                    </div>
                    ${subPopoverHtml}
                </div>
            `;
        }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml;

    if (typeof renderIcons === 'function') {
        renderIcons();
    } else if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.updateTodayRetirosPopover = function(elementId, filterFn) {
    const popover = document.getElementById(elementId);
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    const todayKey = new Date().toISOString().slice(0, 10);
    const todayRetiros = (window.cases || []).filter(c => {
        if (!c.fechaRetiro) return false;
        if (['done', 'reject', 'not_accepted'].includes(c.estado)) return false;
        return String(c.fechaRetiro).slice(0, 10) === todayKey;
    });

    const filtered = todayRetiros.filter(filterFn);
    if (filtered.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay retiros hoy.</span>';
        return;
    }

    const counts = {};
    filtered.forEach(c => {
        let comp = typeof window.getCompanyForCase === 'function' ? window.getCompanyForCase(c) : (c.company || 'Empresa Principal');
        if (!comp || comp === '—') comp = 'Empresa Principal';
        counts[comp] = (counts[comp] || 0) + 1;
    });

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Por Empresa</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Hoy</span>
        </div>
    `;

    const itemsHtml = Object.entries(counts)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([company, count]) => {
            const iconName = company === 'Subsidiaria' ? 'credit-card' : (company === 'Empresa Principal' ? 'building-2' : 'building');
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                        <i data-lucide="${iconName}" style="width: 12.5px; height: 12.5px; flex-shrink: 0; color: var(--text-muted);"></i>
                        <span style="color: var(--text-muted); font-weight: 500;">${company}</span>
                    </div>
                    <span style="background: var(--primary-soft); color: var(--primary); font-weight: 700; border-radius: 4px; padding: 1px 5px; font-size: 10px; min-width: 16px; text-align: center;">${count}</span>
                </div>
            `;
        }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml;

    if (typeof renderIcons === 'function') {
        renderIcons();
    } else if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.updateAllRetirosPopover = function(elementId, filterFn, casesList = null) {
    const popover = document.getElementById(elementId);
    if (!popover) return;
    const contentDiv = popover.querySelector('.breakdown-content');
    if (!contentDiv) return;

    const list = casesList || (window.cases || []);
    const allRetiros = list.filter(filterFn);
    if (allRetiros.length === 0) {
        contentDiv.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No hay retiros registrados.</span>';
        return;
    }

    const counts = {};
    allRetiros.forEach(c => {
        let comp = typeof window.getCompanyForCase === 'function' ? window.getCompanyForCase(c) : (c.company || 'Empresa Principal');
        if (!comp || comp === '—') comp = 'Empresa Principal';
        counts[comp] = (counts[comp] || 0) + 1;
    });

    const headerHtml = `
        <div style="font-weight: 700; color: var(--text); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px;">
            <span>Por Empresa</span>
            <span style="font-size: 9px; color: var(--text-muted); font-weight: normal; background: var(--border-soft); padding: 1px 4px; border-radius: 4px;">Histórico</span>
        </div>
    `;

    const itemsHtml = Object.entries(counts)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([company, count]) => {
            const iconName = company === 'Subsidiaria' ? 'credit-card' : (company === 'Empresa Principal' ? 'building-2' : 'building');
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                        <i data-lucide="${iconName}" style="width: 12.5px; height: 12.5px; flex-shrink: 0; color: var(--text-muted);"></i>
                        <span style="color: var(--text-muted); font-weight: 500;">${company}</span>
                    </div>
                    <span style="background: var(--primary-soft); color: var(--primary); font-weight: 700; border-radius: 4px; padding: 1px 5px; font-size: 10px; min-width: 16px; text-align: center;">${count}</span>
                </div>
            `;
        }).join('');

    contentDiv.innerHTML = headerHtml + itemsHtml;

    if (typeof renderIcons === 'function') {
        renderIcons();
    } else if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
};

window.addEventListener('state:refreshed', () => {
    if (window.currentView === 'list' && typeof window.renderList === 'function') {
        window.renderList();
    }
});

