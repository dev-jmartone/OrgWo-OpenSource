// ============================================================
// CHECKLIST TEMPLATES CONFIGURATION MANAGER (UI MANAGER)
// ============================================================

(function() {
    const checklistModal = document.getElementById('checklistTemplatesModal');
    const selTipificacion = document.getElementById('selChecklistTipificacion');
    const itemsList = document.getElementById('checklistItemsList');
    
    let activeTip = 'default';
    let tempChecklistItems = [];

    // Cargar selector de tipificaciones
    function populateTipificacionesSelect() {
        if (!selTipificacion) return;
        
        let html = `<option value="default" style="font-weight: 700;">💻 Flujo por Defecto (Equipos)</option>`;
        
        html += `<optgroup label="Incidentes INC">`;
        TIPIFICACIONES_INC.forEach(tip => {
            html += `<option value="${tip}">${tip}</option>`;
        });
        html += `</optgroup>`;
        
        html += `<optgroup label="Órdenes de Trabajo WO">`;
        TIPIFICACIONES_WO.forEach(tip => {
            html += `<option value="${tip}">${tip}</option>`;
        });
        html += `</optgroup>`;
        
        selTipificacion.innerHTML = html;
        selTipificacion.value = activeTip;
    }

    // Renderizar listado de tareas de la plantilla seleccionada
    function renderChecklistItems() {
        if (!itemsList) return;
        
        if (tempChecklistItems.length === 0) {
            itemsList.innerHTML = `
                <div style="text-align: center; padding: 24px; color: var(--text-faint); border: 1px dashed var(--border); border-radius: var(--radius);">
                    <i data-lucide="info" style="width: 24px; height: 24px; margin-bottom: 8px; color: var(--primary); opacity: 0.7; display: inline-block;"></i>
                    <p style="font-size: 13px;">No hay tareas personalizadas para esta tipificación. Se usará el flujo por defecto.</p>
                </div>
            `;
            renderIcons();
            return;
        }

        const customStates = getCustomStates();

        itemsList.innerHTML = tempChecklistItems.map((item, idx) => {
            // Generar dropdown para seleccionar en qué estado es obligatorio
            let stateOptions = `<option value="">— Sin restricción (Opcional) —</option>`;
            customStates.forEach(st => {
                const isSelected = item.required_for_state === st.id ? 'selected' : '';
                stateOptions += `<option value="${st.id}" ${isSelected}>Fase: ${st.label}</option>`;
            });

            return `
                <div class="checklist-row" style="display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); position: relative; transition: all 0.2s ease;">
                    <div style="flex: 2;">
                        <label style="font-size: 10px; color: var(--text-faint); display: block; margin-bottom: 2px; font-weight: 600;">Nombre del Check</label>
                        <input type="text" value="${escapeHtml(item.label)}" onchange="updateChecklistItemLabel(${idx}, this.value)" style="width: 100%; padding: 5px 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-family: inherit; font-size: 12.5px;">
                    </div>
                    <div style="flex: 2.2;">
                        <label style="font-size: 10px; color: var(--text-faint); display: block; margin-bottom: 2px; font-weight: 600;">Bloquea acceso a</label>
                        <select onchange="updateChecklistItemState(${idx}, this.value)" style="width: 100%; padding: 5px 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-family: inherit; font-size: 12.5px; cursor: pointer;">
                            ${stateOptions}
                        </select>
                    </div>
                    <div style="width: 60px; flex-shrink: 0;">
                        <label style="font-size: 10px; color: var(--text-faint); display: block; margin-bottom: 2px; font-weight: 600;">Orden</label>
                        <input type="number" value="${item.order || 10}" onchange="updateChecklistItemOrder(${idx}, this.value)" style="width: 100%; padding: 5px 6px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-family: inherit; font-size: 12.5px; text-align: center;">
                    </div>
                    <button class="close-btn" style="width: 28px; height: 28px; display: grid; place-items: center; align-self: flex-end; margin-bottom: 2px;" onclick="removeChecklistItem(${idx})" title="Eliminar tarea"><i data-lucide="trash-2" style="width: 13px; height: 13px; color: var(--danger);"></i></button>
                </div>
            `;
        }).join('');

        renderIcons();
    }

    // Funciones globales expuestas al window para los onchange/onclick dinámicos
    window.updateChecklistItemLabel = (idx, val) => {
        if (tempChecklistItems[idx]) {
            tempChecklistItems[idx].label = val;
        }
    };

    window.updateChecklistItemState = (idx, val) => {
        if (tempChecklistItems[idx]) {
            tempChecklistItems[idx].required_for_state = val || null;
        }
    };

    window.updateChecklistItemOrder = (idx, val) => {
        if (tempChecklistItems[idx]) {
            tempChecklistItems[idx].order = parseInt(val) || 10;
        }
    };

    window.removeChecklistItem = (idx) => {
        tempChecklistItems.splice(idx, 1);
        renderChecklistItems();
    };

    // Agregar nuevo check a la plantilla
    document.getElementById('btnChecklistAdd').addEventListener('click', () => {
        tempChecklistItems.push({
            id: 'chk_' + Date.now(),
            label: 'Nueva tarea',
            required_for_state: '',
            order: (tempChecklistItems.length + 1) * 10
        });
        renderChecklistItems();
    });

    // Abrir Modal de checklists
    document.getElementById('btnManageChecklists').addEventListener('click', () => {
        activeTip = 'default';
        populateTipificacionesSelect();
        
        // Copia profunda
        tempChecklistItems = JSON.parse(JSON.stringify(window.CHECKLIST_TEMPLATES[activeTip] || []));
        renderChecklistItems();
        
        checklistModal.classList.add('open');
        document.getElementById('userDropdown').classList.remove('open');
    });

    // Cerrar / Cancelar modal
    const closeBtn = document.getElementById('checklistModalClose');
    if (closeBtn) closeBtn.addEventListener('click', () => checklistModal.classList.remove('open'));
    
    const cancelBtn = document.getElementById('checklistModalCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => checklistModal.classList.remove('open'));
    
    checklistModal.addEventListener('click', e => {
        if (e.target === checklistModal) checklistModal.classList.remove('open');
    });

    // Cambiar de tipificación en el selector
    selTipificacion.addEventListener('change', (e) => {
        activeTip = e.target.value;
        tempChecklistItems = JSON.parse(JSON.stringify(window.CHECKLIST_TEMPLATES[activeTip] || []));
        renderChecklistItems();
    });

    // Guardar cambios a base de datos
    document.getElementById('checklistModalSave').addEventListener('click', async () => {
        // Guardar la plantilla activa temporal en el objeto global
        window.CHECKLIST_TEMPLATES[activeTip] = tempChecklistItems;

        // Limpiar plantillas vacías para no saturar la base de datos
        for (const [key, list] of Object.entries(window.CHECKLIST_TEMPLATES)) {
            if (key !== 'default' && (!list || list.length === 0)) {
                delete window.CHECKLIST_TEMPLATES[key];
            }
        }

        try {
            await API.saveOrgSetting('checklist_templates', JSON.stringify(window.CHECKLIST_TEMPLATES));
            checklistModal.classList.remove('open');
            
            // Refrescar vistas activas y el drawer si estuviera abierto
            if (typeof refresh === 'function') await refresh();
            if (typeof renderKanban === 'function') renderKanban();
            if (typeof renderToday === 'function') renderToday();
            if (typeof renderList === 'function') renderList();
            
            if (typeof currentCaseId !== 'undefined' && currentCaseId) {
                const c = casesById(currentCaseId);
                if (c && typeof openCase === 'function') openCase(currentCaseId);
            }
            
            toast('Plantillas de checklists guardadas', 'success');
        } catch (e) {
            console.error("Error guardando checklists:", e);
            toast('Error al guardar checklists', 'error');
        }
    });

    // Helper para escapar HTML en Strings de texto
    function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
})();
