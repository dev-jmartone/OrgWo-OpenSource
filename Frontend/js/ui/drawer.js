// ============================================================
// DRAWER
// ============================================================
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawerOverlay');

function openCase(id) {
    const c = casesById(id);
    if (!c) return;
    window.currentCaseId = id;

    const isCaseClosed = ['done', 'reject', 'not_accepted'].includes(c.estado) || c.status === '4' || c.status === 'Resolved' || c.status === 'Completed';

    const tabGen = document.getElementById('drawer-tab-general');
    const tabComments = document.getElementById('drawer-tab-comments');
    const tabGeneralHeader = document.querySelector('.drawer-tab[data-target="drawer-tab-general"]');
    const tabCommentsHeader = document.querySelector('.drawer-tab[data-target="drawer-tab-comments"]');
    const drawerFooter = document.querySelector('.drawer-footer');

    if (isCaseClosed) {
        if (tabGeneralHeader) tabGeneralHeader.style.display = 'none';
        if (tabCommentsHeader) {
            tabCommentsHeader.style.display = 'flex';
            tabCommentsHeader.classList.add('active');
            tabCommentsHeader.style.borderBottom = '2px solid var(--primary)';
            tabCommentsHeader.style.color = 'var(--text)';
        }
        if (tabGen) tabGen.style.display = 'none';
        if (tabComments) tabComments.style.display = 'block';
        if (drawerFooter) drawerFooter.style.display = 'none';
        
        loadRemedyComments(c);
    } else {
        if (tabGeneralHeader) tabGeneralHeader.style.display = 'flex';
        if (drawerFooter) drawerFooter.style.display = 'flex';
        
        // Reset active tab to General
        document.querySelectorAll('.drawer-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.target === 'drawer-tab-general');
            t.style.borderBottom = t.dataset.target === 'drawer-tab-general' ? '2px solid var(--primary)' : '2px solid transparent';
            t.style.color = t.dataset.target === 'drawer-tab-general' ? 'var(--text)' : 'var(--text-muted)';
        });
        if (tabGen) tabGen.style.display = 'block';
        if (tabComments) tabComments.style.display = 'none';

        // Show/hide Comments tab header based on Remedy ticket presence
        const hasRemedyTicket = !!(c.wo && (c.wo.startsWith('INC') || c.wo.startsWith('WO')));
        if (tabCommentsHeader) {
            tabCommentsHeader.style.display = (window.remedyConnected && hasRemedyTicket) ? 'flex' : 'none';
        }
    }

    const displayName = c.name || 'Sin nombre';
    const emailStr = (c.email || '').trim();
    document.getElementById('drawerName').textContent = displayName;

    // Set Ticket Number
    const ticketNumEl = document.getElementById('drawerTicketNum');
    if (ticketNumEl) {
        if (c.wo) {
            ticketNumEl.innerHTML = `${escapeHtml(c.wo)} <i data-lucide="copy" style="width: 14px; height: 14px; color: var(--text-faint); margin-left: 4px; display: inline-block; vertical-align: middle;"></i>`;
            ticketNumEl.style.cursor = 'pointer';
            ticketNumEl.title = 'Hacé click para copiar el número de incidente';
        } else {
            ticketNumEl.textContent = 'Manual / Sin Ticket';
            ticketNumEl.style.cursor = 'default';
            ticketNumEl.title = '';
        }
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    const emailRow = document.getElementById('drawerEmailRow');
    if (emailStr) {
        document.getElementById('drawerEmailText').textContent = emailStr;
        emailRow.style.display = 'inline-flex';
    } else {
        emailRow.style.display = 'none';
    }

    // Set badges for Empresa and Tipificación
    const badgesContainer = document.getElementById('drawerBadges');
    if (badgesContainer) {
        let badgesHtml = '';
        const comp = getCompanyForCase(c);
        if (comp) {
            badgesHtml += `<span class="company-badge company-badge--${comp.toLowerCase().replace(/\s+/g, '_')}" style="font-size: 11px; padding: 2px 8px; font-weight: 700; border-radius: 4px;">${escapeHtml(comp)}</span>`;
        }
        const tipWC = resolveTipificacion(c);
        if (tipWC) {
            const tipWCType = (c.id && c.id.startsWith('WO')) ? 'wo' : 'inc';
            badgesHtml += `<span class="tip-badge tip-badge--${tipWCType}" style="font-size: 11px; padding: 2px 8px; font-weight: 700; border-radius: 4px;">${escapeHtml(tipWC.replace(/ \(INC\)$/, '').replace(/ \(WO\)$/, ''))}</span>`;
        }
        badgesContainer.innerHTML = badgesHtml;
    }

    // Acciones rápidas siempre se muestran ya que no hay checklist.
    document.getElementById('quickActionsBlock').classList.remove('hidden');

    renderQuickActionsInDrawer(c);

    // Metadatos rápidos en la barra superior: fecha de retiro + toggle priority.
    // El resto (tipo / movimiento / empresa / zona) ya no se edita en el drawer:
    // tipo viene de Remedy, empresa se infiere del email, zona/movimiento se
    // ponen en el template directamente.
    let frVal = '';
    if (c.fechaRetiro) {
        frVal = c.fechaRetiro;
        if (frVal.length === 10) {
            frVal += 'T09:00'; // Default morning time for older date-only records
        } else if (frVal.length > 16) {
            frVal = frVal.slice(0, 16);
        }
    }
    document.getElementById('fldFechaRetiro').value = frVal;
    // Campo tipificación Webcenter
    const fldTip = document.getElementById('fldTipificacion');
    if (fldTip) fldTip.value = resolveTipificacion(c) || '';

    document.getElementById('fldNotes').value = c.notes || '';
    const priBtn = document.getElementById('btnPriorityToggle');
    if (priBtn) {
        const isHigh = c.priority === 'alta';
        priBtn.classList.toggle('is-on', isHigh);
        priBtn.setAttribute('aria-pressed', isHigh ? 'true' : 'false');
        priBtn.title = isHigh ? 'Caso urgente (click para quitar)' : 'Marcar como urgente';
    }

    // Los inputs de datos del periférico han sido eliminados de la UI. Solo se gestiona la fecha de retiro.



    drawer.classList.add('open');
    drawerOverlay.classList.add('open');

    // Mostrar botón Transferir solo si tiene ticket asociado
    const btnTransfer = document.getElementById('btnTransferTicket');
    if (btnTransfer) {
        btnTransfer.style.display = c.wo ? 'inline-flex' : 'none';
    }

    renderIcons();

    if (typeof loadAttachmentsForCurrentCase === 'function') {
        loadAttachmentsForCurrentCase();
    }
}

function closeDrawer() {
    closePlanillaModal();
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
    window.currentCaseId = null;
}

document.getElementById('drawerClose').addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

// Click en el número de ticket → copia al portapapeles.
document.getElementById('drawerTicketNum').addEventListener('click', () => {
    if (window.currentCaseId) {
        const c = casesById(window.currentCaseId);
        if (c && c.wo) {
            navigator.clipboard.writeText(c.wo);
            toast(`Copiado: ${c.wo}`, 'success');
        }
    }
});

// Nombre del usuario en cabecera del drawer → abre chat de Teams.
document.getElementById('drawerName').addEventListener('click', () => {
    if (!currentCaseId) return;
    const c = casesById(currentCaseId);
    const email = (c?.email || '').trim();
    if (!email) { toast('El caso no tiene email', 'error'); return; }
    openTeamsChat(email, '');
});

// Icono de copia al lado del email → copia al portapapeles.
document.getElementById('drawerEmailCopy').addEventListener('click', e => {
    e.stopPropagation();
    if (!currentCaseId) return;
    const c = casesById(currentCaseId);
    const email = (c?.email || '').trim();
    if (!email) return;
    navigator.clipboard.writeText(email);
    toast('Email copiado', 'success');
});

// Toggle de prioridad: click sobre el ícono → persiste alta/normal en el case.
document.getElementById('btnPriorityToggle')?.addEventListener('click', async () => {
    if (!currentCaseId) return;
    const c = casesById(currentCaseId);
    if (!c) return;
    const wasHigh = c.priority === 'alta';
    const newPri = wasHigh ? 'normal' : 'alta';
    try {
        await API.update(currentCaseId, {
            priority: newPri,
            logEvent: wasHigh ? 'Prioridad removida' : 'Marcado como urgente',
        });
        await refresh();
        const btn = document.getElementById('btnPriorityToggle');
        btn.classList.toggle('is-on', !wasHigh);
        btn.setAttribute('aria-pressed', wasHigh ? 'false' : 'true');
        btn.title = wasHigh ? 'Marcar como urgente' : 'Caso urgente (click para quitar)';
        refreshCurrentView();
    } catch (err) {
        toast('Error al guardar prioridad', 'error');
    }
});

document.getElementById('btnSave').addEventListener('click', async () => {
    if (!currentCaseId) return;
    const c = casesById(currentCaseId);
    if (!c) return;

    const fechaRetiro = document.getElementById('fldFechaRetiro').value || null;
    const notes = document.getElementById('fldNotes').value.trim();
    const tipificacion = (document.getElementById('fldTipificacion')?.value || '').trim() || null;

    const payload = {
        fechaRetiro,
        notes,
        tipificacion,
        logEvent: 'Datos actualizados',
    };

    // Auto-agrupación por fecha programada (Programados para el dia DD/MM/YYYY)
    const oldFechaRetiro = c.fechaRetiro || null;
    let autoGroupMoved = false;

    function getGroupLabel(isoString) {
        if (!isoString) return null;
        const parts = isoString.split('T')[0].split('-');
        if (parts.length === 3) {
            return `Programados para el dia ${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return null;
    }

    if (fechaRetiro && fechaRetiro !== oldFechaRetiro) {
        const groupLabel = getGroupLabel(fechaRetiro);
        if (groupLabel) {
            if (typeof window.loadListGroupingConfig === 'function') {
                await window.loadListGroupingConfig();
            }
            
            const existingGroup = window.listGroups ? window.listGroups.find(g => g.label === groupLabel) : null;
            if (existingGroup) {
                const confirmed = await Swal.fire({
                    title: `¿Mover al grupo existente?`,
                    text: `Detectamos la fecha programada. ¿Querés mover este ticket al grupo "${groupLabel}"?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, mover',
                    cancelButtonText: 'No, dejar donde está',
                    confirmButtonColor: 'var(--primary)',
                });
                if (confirmed.isConfirmed) {
                    window.listTicketAssignments[c.id] = existingGroup.id;
                    autoGroupMoved = true;
                }
            } else {
                const confirmed = await Swal.fire({
                    title: `¿Crear grupo?`,
                    text: `¿Querés crear un nuevo grupo "${groupLabel}" y mover este ticket a él automáticamente?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, crear y mover',
                    cancelButtonText: 'No, solo guardar fecha',
                    confirmButtonColor: 'var(--primary)',
                });
                if (confirmed.isConfirmed) {
                    const newGroupId = 'group_' + Date.now();
                    if (!window.listGroups) window.listGroups = [];
                    window.listGroups.push({ id: newGroupId, label: groupLabel, isDefault: false });
                    if (!window.listTicketAssignments) window.listTicketAssignments = {};
                    window.listTicketAssignments[c.id] = newGroupId;
                    autoGroupMoved = true;
                }
            }
            
            if (autoGroupMoved && typeof window.saveListGroupingConfig === 'function') {
                await window.saveListGroupingConfig();
            }
        }
    }

    try {
        await API.update(currentCaseId, payload);
        await refresh();
        toast('Guardado', 'success');
        refreshCurrentView();
    } catch(err) { toast('Error al guardar', 'error'); }
});

// Listener para abrir el generador de templates
document.getElementById('btnOpenPlanilla')?.addEventListener('click', () => {
    if (currentCaseId) {
        openPlanillaModal(currentCaseId);
    }
});

document.getElementById('btnDelete').addEventListener('click', async () => {
    if (!currentCaseId) return;
    const c = casesById(currentCaseId);
    if (!confirm(`¿Eliminar el caso de ${c.name}? Esto no se puede deshacer.`)) return;
    try {
        await API.remove(currentCaseId);
        await refresh();
        closeDrawer();
        refreshCurrentView();
        toast('Caso eliminado', 'success');
    } catch(err) { toast('Error al eliminar', 'error'); }
});


function refreshCurrentView() {
    const active = document.querySelector('.view.active').id.replace('view-','');
    if (active === 'remedy') {
        if (typeof window.renderRemedyTickets === 'function') window.renderRemedyTickets();
    } else if (active === 'list') {
        if (typeof window.renderList === 'function') window.renderList();
    } else if (active === 'today') {
        if (typeof window.renderToday === 'function') window.renderToday();
    } else {
        switchView(active);
    }
}

function renderQuickActionsInDrawer(c) {
    const container = document.getElementById('quickActionsContainer');
    if (!container) return;

    if (!window.customQuickMessages) window.customQuickMessages = [];

    const resolvedTip = resolveTipificacion(c) || '';
    const _tk = window.tipKey || (s => (s || '').toLowerCase().trim());
    
    const cleanTip = s => (s || '')
        .replace(/\s*\(INC\)\s*$/i, '')
        .replace(/\s*\(WO\)\s*$/i, '')
        .trim();

    const ticketTypi = _tk(cleanTip(resolvedTip));

    // Filtramos solo específicos de esta tipificación (case/acento-insensible, ignorando sufijos y soportando coincidencia parcial)
    const specificMsgs = window.customQuickMessages.filter(msg => {
        if (!msg.typification || msg.typification === 'general') return false;
        const msgKey = _tk(cleanTip(msg.typification));
        if (msgKey === ticketTypi) return true;
        // Coincidencia parcial para mayor tolerancia a cambios (mínimo 3 letras)
        if (msgKey.length > 3 && ticketTypi.length > 3) {
            return msgKey.includes(ticketTypi) || ticketTypi.includes(msgKey);
        }
        return false;
    });

    const generalMsgs = window.customQuickMessages.filter(msg => {
        return !msg.typification || msg.typification === 'general';
    });

    let html = '';

    if (specificMsgs.length > 0) {
        html += specificMsgs.map((msg) => {
            const realIdx = window.customQuickMessages.indexOf(msg);
            return `<button class="qa-btn custom-qa-btn custom-specific" data-index="${realIdx}" title="Mensaje específico para esta tipificación"><i data-lucide="message-square"></i> ${escapeHtml(msg.title)}</button>`;
        }).join('');
    }

    if (generalMsgs.length > 0) {
        html += generalMsgs.map((msg) => {
            const realIdx = window.customQuickMessages.indexOf(msg);
            return `<button class="qa-btn custom-qa-btn custom-general" data-index="${realIdx}" title="Mensaje general"><i data-lucide="message-square"></i> ${escapeHtml(msg.title)}</button>`;
        }).join('');
    }

    if (specificMsgs.length === 0 && generalMsgs.length === 0) {
        html += `<div style="font-size: 12px; color: var(--danger); background: rgba(232, 17, 35, 0.1); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(232, 17, 35, 0.3); width: 100%;">
            <i data-lucide="alert-circle" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px;"></i>
            <strong>Falta configurar mensaje:</strong> No tenés mensajes rápidos configurados. Podés crearlos en la sección <strong style="cursor:pointer;text-decoration:underline;" onclick="switchView('settings')">Ajustes > Mensajes rápidos</strong>.
        </div>`;
    }

    container.innerHTML = html;

    // Re-cablear listeners de las acciones personalizadas
    container.querySelectorAll('.custom-qa-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = parseInt(btn.dataset.index);
            const msg = window.customQuickMessages[idx];
            if (!msg) return;

            // Reemplazo dinámico de variables
            const tipoLabel = (tipoInfo(c.tipo)?.label || c.tipo || '').toLowerCase();
            const company = getCompanyForCase(c) || 'Empresa Principal';

            let text = msg.text || '';
            text = text.replace(/{nombre}/g, c.name || 'Sin nombre');
            
            // Reemplazo de ticket / incidente
            const ticketNum = c.wo || '—';
            text = text.replace(/{ticket}/g, ticketNum);
            text = text.replace(/{incidente}/g, ticketNum);
            
            // Reemplazo de empresa
            text = text.replace(/{empresa}/g, company);
            
            // Reemplazo de tipificación
            const tipLabel = resolveTipificacion(c) || '—';
            text = text.replace(/{tipificacion}/g, tipLabel);
            
            // Reemplazo de equipo / elemento
            text = text.replace(/{equipo}/g, tipoLabel);
            text = text.replace(/{elemento}/g, tipoLabel);
            
            // Reemplazo de correo / email
            text = text.replace(/{correo}/g, c.email || '');
            text = text.replace(/{email}/g, c.email || '');

            const email = (c.email || '').trim();
            if (!email) {
                toast('El caso no tiene email. Copia y pegá el texto a mano.', 'error');
                openMessageModal(msg.title, text);
            } else {
                openTeamsChat(email, text);
            }

            // Auto-mover de "Por contactar" a "Esperando respuesta" en la 1a comunicación
            if (c.estado === 'contact') {
                try {
                    await API.update(c.id, {
                        estado: 'wait',
                        logEvent: `Mensaje rápido "${msg.title}" enviado — auto-movido a "Esperando respuesta"`
                    });
                    await refresh();
                    refreshCurrentView();
                } catch(err) {}
            }
        });
    });

    renderIcons();
}

// Botón para enviar comentarios directos a Remedy (puede no existir en el
// DOM si la tarjeta de comentario fue removida — opcional).
document.getElementById('btnSendRemedyComment')?.addEventListener('click', async () => {
    if (!currentCaseId) return;
    const c = casesById(currentCaseId);
    if (!c || !c.wo) {
        toast('El caso no posee un ticket de Remedy asociado', 'error');
        return;
    }
    
    const commentField = document.getElementById('fldRemedyComment');
    const comment = commentField.value.trim();
    if (!comment) {
        toast('Escribe un comentario antes de enviar', 'error');
        return;
    }
    
    const btn = document.getElementById('btnSendRemedyComment');
    const btnSpan = btn.querySelector('span');
    const originalText = btnSpan ? btnSpan.textContent : 'Comentar en Remedy';
    
    btn.disabled = true;
    if (btnSpan) btnSpan.textContent = 'Enviando...';
    
    try {
        const ticketType = c.wo.startsWith('WO') ? 'WO' : 'INC';
        await API.addRemedyComment(c.wo, ticketType, comment);
        toast('Comentario registrado en Remedy', 'success');
        commentField.value = '';
    } catch (e) {
        toast(e.message || 'Error al enviar comentario', 'error');
    } finally {
        btn.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;
    }
});

// Listener para el selector de estado asistido en el Drawer
const fldEstado = document.getElementById('fldEstado');
if (fldEstado) {
    fldEstado.addEventListener('change', async e => {
        if (!currentCaseId) return;
        const c = casesById(currentCaseId);
        if (!c) return;
        const targetStateId = e.target.value;
        if (c.estado === targetStateId) return;

        // Validar con la FSM
        const checkTransition = canTransitionTo(c, targetStateId);
        if (!checkTransition.allowed) {
            toast(checkTransition.reason, 'error');
            e.target.value = c.estado; // Revertir selección en la UI
            return;
        }

        const oldLabel = ESTADOS.find(x => x.id === c.estado)?.label || c.estado;
        const newLabel = ESTADOS.find(x => x.id === targetStateId)?.label || targetStateId;
        try {
            await API.update(currentCaseId, {
                estado: targetStateId,
                logEvent: `Movido vía Drawer: ${oldLabel} → ${newLabel}`
            });
            await refresh();
            toast(`Movido a ${newLabel}`, 'success');
            refreshCurrentView();
            
            c.estado = targetStateId;
            const ESTADOS_CON_ACCIONES = ['contact', 'wait', 'data', 'coord'];
            document.getElementById('quickActionsBlock').classList.toggle(
                'hidden', !ESTADOS_CON_ACCIONES.includes(targetStateId)
            );
            renderQuickActionsInDrawer(c);
        } catch(err) {
            toast('Error al cambiar de estado', 'error');
            e.target.value = c.estado; // Revertir
        }
    });
}

// ============================================================
// MODAL RETIRO DE DEPOSITO (PERIFERICOS: Vincha, Kit, Cargador)
// ============================================================
(function() {
    const depotModal = document.getElementById('depotWithdrawalModal');
    const depotBrand = document.getElementById('depotBrand');
    const depotModel = document.getElementById('depotModel');
    const depotSerial = document.getElementById('depotSerial');
    const depotSave = document.getElementById('depotWithdrawalModalSave');
    const depotCancel = document.getElementById('depotWithdrawalModalCancel');
    const depotClose = document.getElementById('depotWithdrawalModalClose');

    let currentCheckInput = null;
    let isEditing = false;

    // Abrir modal
    window.openDepotWithdrawalModal = function(c, checkInput, editing = false) {
        currentCheckInput = checkInput;
        isEditing = editing;
        
        // Cargar datos actuales si existen
        depotBrand.value = c.brand || '';
        depotModel.value = c.newModel || '';
        depotSerial.value = c.newSvc || '';

        depotModal.classList.add('open');
        setTimeout(() => depotBrand.focus(), 60);
    };

    function closeDepotModal() {
        depotModal.classList.remove('open');
        // Si no se guardó y no estábamos editando, desmarcamos el checkbox
        if (!isEditing && currentCheckInput && currentCheckInput.checked) {
            currentCheckInput.checked = false;
            currentCheckInput.closest('.check-item').classList.remove('checked');
        }
        currentCheckInput = null;
    }

    depotCancel.addEventListener('click', closeDepotModal);
    depotClose.addEventListener('click', closeDepotModal);
    depotModal.addEventListener('click', e => { if (e.target === depotModal) closeDepotModal(); });

    depotSave.addEventListener('click', async () => {
        const brandVal = depotBrand.value.trim();
        const modelVal = depotModel.value.trim();
        const serialVal = depotSerial.value.trim();

        if (!brandVal) { toast('Ingresá la marca', 'error'); depotBrand.focus(); return; }
        if (!modelVal) { toast('Ingresá el modelo', 'error'); depotModel.focus(); return; }
        if (!serialVal) { toast('Ingresá el número de serie (serial)', 'error'); depotSerial.focus(); return; }

        const cid = currentCaseId;
        const cc = casesById(cid);
        if (!cc) return;

        // Asegurarse de que esté marcado
        cc.checks = cc.checks || {};
        cc.checks.retiro_deposito = true;

        const payload = {
            brand: brandVal,
            newModel: modelVal,
            newSvc: serialVal,
            checks: cc.checks,
            logEvent: `Cargada info de depósito (${brandVal} ${modelVal}, S/N: ${serialVal})`
        };

        try {
            await API.update(cid, payload);
            await refresh();
            toast('Información del depósito guardada', 'success');
            depotModal.classList.remove('open');
            refreshCurrentView();
            // Recargar drawer para mostrar la info actualizada y botón de editar
            openCase(cid);
        } catch(err) {
            toast('Error al guardar datos del depósito', 'error');
        }
    });
})();

// ── Comentarios y Adjuntos de Remedy ──────────────────────────────────────────

async function loadRemedyComments(c) {
    const loadingEl = document.getElementById('remedyCommentsLoading');
    const container = document.getElementById('remedyCommentsContainer');
    if (!loadingEl || !container) return;

    loadingEl.style.display = 'block';
    container.innerHTML = '';

    try {
        const comments = await API.getTicketComments(c.wo);
        loadingEl.style.display = 'none';

        if (!comments || comments.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">No hay comentarios registrados en Remedy.</div>`;
            return;
        }

        container.innerHTML = comments.map(comment => {
            let attachmentHtml = '';
            if (comment.attachment) {
                let attachmentName = '';
                if (typeof comment.attachment === 'string') {
                    attachmentName = comment.attachment;
                } else if (comment.attachment && typeof comment.attachment === 'object') {
                    attachmentName = comment.attachment.name || '';
                }

                if (attachmentName) {
                    const lowerName = attachmentName.toLowerCase();
                    const isImage = lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.gif') || lowerName.endsWith('.webp');
                    const attachUrl = `/api/remedy/tickets/${encodeURIComponent(c.wo)}/attachments/${encodeURIComponent(comment.id)}/z2AF%20Work%20Log01`;
                    
                    if (isImage) {
                        attachmentHtml = `
                            <div style="margin-top: 8px;">
                                <a href="${attachUrl}" onclick="event.preventDefault(); window.previewAttachment(this.href, '${escapeHtml(attachmentName)}');" target="_blank">
                                    <img src="${attachUrl}" alt="${escapeHtml(attachmentName)}" style="max-width: 100%; max-height: 180px; border-radius: var(--radius); border: 1px solid var(--border); object-fit: contain; cursor: zoom-in;" />
                                </a>
                            </div>
                        `;
                    } else {
                        attachmentHtml = `
                            <a href="${attachUrl}" onclick="event.preventDefault(); window.previewAttachment(this.href, '${escapeHtml(attachmentName)}');" target="_blank" class="attachment-link" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); color: var(--primary); font-weight: 600; text-decoration: none; font-size: 12px; margin-top: 8px; width: fit-content;">
                                <i data-lucide="file" style="width: 14px; height: 14px;"></i>
                                ${escapeHtml(attachmentName)}
                            </a>
                        `;
                    }
                }
            }

            return `
                <div class="comment-card" style="border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--surface-2); display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow-sm);">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-soft); padding-bottom: 6px; font-size: 11px; color: var(--text-muted);">
                        <span style="font-weight: 700; color: var(--text);"><i data-lucide="user" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>${escapeHtml(comment.submitter || 'Remedy')}</span>
                        <span><i data-lucide="clock" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>${formatDateTime(comment.date)}</span>
                    </div>
                    <div style="font-weight: 600; font-size: 12.5px; color: var(--text); word-break: break-word;">${escapeHtml(comment.description)}</div>
                    ${comment.detailed && comment.detailed.trim() !== comment.description.trim() ? `<div style="font-size: 12px; color: var(--text-muted); white-space: pre-wrap; word-break: break-word; margin-top: 4px; border-top: 1px dashed var(--border-soft); padding-top: 6px;">${escapeHtml(comment.detailed)}</div>` : ''}
                    ${attachmentHtml}
                </div>
            `;
        }).join('');

        renderIcons();

    } catch (e) {
        loadingEl.style.display = 'none';
        container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--danger); font-size: 13px;">Error al cargar comentarios: ${escapeHtml(e.message)}</div>`;
    }
}

// Bind tab clicks
document.querySelectorAll('.drawer-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.target;
        
        // Update active tab styles
        document.querySelectorAll('.drawer-tab').forEach(t => {
            t.classList.toggle('active', t === tab);
            t.style.borderBottom = t === tab ? '2px solid var(--primary)' : '2px solid transparent';
            t.style.color = t === tab ? 'var(--text)' : 'var(--text-muted)';
        });

        // Hide/show contents
        document.querySelectorAll('.drawer-tab-content').forEach(content => {
            content.style.display = content.id === target ? 'block' : 'none';
        });

        // Load comments if comments tab selected
        if (target === 'drawer-tab-comments' && currentCaseId) {
            const c = casesById(currentCaseId);
            if (c) loadRemedyComments(c);
        }
    });
});

// Helper function to check if a typification needs input fields
function checkNeedsInputs(c) {
    if (!c) return false;
    const tip = (resolveTipificacion(c) || '').toLowerCase().trim();
    
    // Exception typifications that do NOT need device inputs (software, access, licencias, etc.)
    const exceptions = [
        'software - instalacion ',
        'software - configuración ',
        'software - configuración ',
        'software - configuracion ',
        'software - inconveniente / mensaje de error ',
        'outlook - inconvenientes con correo ',
        'equipo - configuracion de vpn ',
        'correo configuracion ',
        'red - sin acceso ',
        'pc virtual no funciona ',
        'chat corporativo ',
        'conexion oficina virtual ',
        'configuracion red wifi ',
        'expuesto de seguridad ',
        'externos maquina virtual ',
        'impresora configuracion ',
        'sin acceso /error ',
        'generales ',
        'software - instalación ',
        'red - sin acceso ',
        'internet - sin acceso / error ',
        'correo - configuración ',
        'equipo - configuración de vpn ',
        'impresora - configuración ',
        'impresora - inconveniente (error, mala calidad, etc) ',
        'maquinas virtuales ipa ',
        'equipo - configuración de red wifi ',
        'desbloqueo de usuario en aplicativos ',
        'intune - despliegue masivo de aplicacion ',
        'maquinas virtuales ipa ',
        'permisos de acceso plataforma/aplicación - abm perfil ',
        'sharepoint online (spo) - onedrive ',
        'licencias ',
        'generales ',
        'general ',
        'general ',
        'desbloqueo de usuario en aplicativos ',
        'permisos de acceso plataforma/aplicación - abm perfil ',
        'sin acceso / error ',
    ];

    if (exceptions.includes(tip)) {
        return false;
    }
    
    // All other cases need inputs
    return true;
}


// Expose to window for global module compatibility
window.openCase = openCase;
window.closeDrawer = closeDrawer;
window.refreshCurrentView = refreshCurrentView;
window.renderQuickActionsInDrawer = renderQuickActionsInDrawer;
window.loadRemedyComments = loadRemedyComments;
window.checkNeedsInputs = checkNeedsInputs;

window.addEventListener('state:refreshed', () => {
    const drawer = document.getElementById('drawer');
    if (drawer && drawer.classList.contains('open') && typeof window.refreshCurrentView === 'function') {
        window.refreshCurrentView();
    }
});
