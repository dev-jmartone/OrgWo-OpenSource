// ============================================================
// TRANSFER TICKET MODAL LOGIC
// ============================================================
let _transferCaseId = null;

document.getElementById('btnTransferTicket')?.addEventListener('click', async () => {
    if (!currentCaseId) return;
    const c = casesById(currentCaseId);
    if (!c) return;
    _transferCaseId = currentCaseId;

    // Mostrar info del ticket
    const infoEl = document.getElementById('transferTicketInfo');
    if (infoEl) infoEl.textContent = c.wo ? `Remedy Ticket: ${c.wo}` : `ID: ${c.id}`;
    
    const noteEl = document.getElementById('transferNote');
    if (noteEl) noteEl.value = '';
    
    const errEl = document.getElementById('transferError');
    if (errEl) errEl.style.display = 'none';

    // Cargar técnicos de la org
    const select = document.getElementById('transferTargetSelect');
    if (select) {
        select.innerHTML = '<option value="">Cargando…</option>';
        try {
            const users = await API.listOrgUsers();
            if (users.length === 0) {
                select.innerHTML = '<option value="">No hay otros técnicos en tu organización</option>';
            } else {
                select.innerHTML = '<option value="">— Seleccioná un técnico —</option>' +
                    users.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`).join('');
            }
        } catch (e) {
            select.innerHTML = '<option value="">Error al cargar técnicos</option>';
        }
    }

    const modal = document.getElementById('transferModal');
    if (modal) {
        modal.classList.add('open');
        renderIcons(); // For the new icons inside the modal if any
    }
});

document.getElementById('transferModalConfirm')?.addEventListener('click', async () => {
    const targetId = document.getElementById('transferTargetSelect')?.value;
    const errEl = document.getElementById('transferError');
    if (!targetId) {
        if (errEl) {
            errEl.textContent = 'Por favor seleccioná un técnico destino.';
            errEl.style.display = 'block';
        }
        return;
    }
    
    const note = document.getElementById('transferNote')?.value.trim();
    const btn = document.getElementById('transferModalConfirm');
    const label = document.getElementById('transferModalConfirmLabel');
    
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Transfiriendo…';

    try {
        await API.transferCase(_transferCaseId, targetId);
        if (note) {
            await API.addEvent(_transferCaseId, `Nota de transferencia: ${note}`);
        }
        document.getElementById('transferModal')?.classList.remove('open');
        closeDrawer();
        await refresh();
        // The active view (Kanban or List) should reflect the change
        if (typeof renderKanban === 'function' && document.getElementById('view-kanban')?.classList.contains('active')) {
            renderKanban();
        } else if (typeof renderList === 'function' && document.getElementById('view-list')?.classList.contains('active')) {
            renderList();
        }
        toast('Ticket transferido correctamente', 'success');
    } catch (e) {
        if (errEl) {
            errEl.textContent = e.message || 'Error al transferir ticket';
            errEl.style.display = 'block';
        }
    } finally {
        if (btn) btn.disabled = false;
        if (label) label.textContent = 'Transferir';
    }
});

// Cerrar modal
['transferModalClose', 'transferModalCancel'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
        document.getElementById('transferModal')?.classList.remove('open');
    });
});
