// ============================================================
// PROFILE — edit modal + quick messages modal + preferences + dropdowns.
// Extraido de system_enhancements.js (refactor fase 2).
// ============================================================

// ============================================================
// MODAL EDICIÓN DE PERFIL
// ============================================================
// MODAL EDICIÓN DE PERFIL
// ============================================================
window.profileQuickMessages = [];

function renderProfileQuickMessages() {
    const containerIds = ['profileQuickMsgsList'];
    
    containerIds.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        
        if (!window.profileQuickMessages || window.profileQuickMessages.length === 0) {
            container.innerHTML = `<div style="text-align: center; color: var(--text-faint); padding: 16px; font-size: 12px;">No tenés mensajes rápidos personalizados. Hacé clic en "Agregar" o en "Restablecer de fábrica".</div>`;
        } else {
            const typiOptions = (typeof ALL_TIPIFICACIONES !== 'undefined' ? ALL_TIPIFICACIONES : []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

            container.innerHTML = window.profileQuickMessages.map((msg, index) => {
                return `
                    <div class="quick-msg-card" data-index="${index}" style="border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--surface-2);">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <input type="text" class="quick-msg-title" value="${escapeHtml(msg.title)}" placeholder="Título (Ej: Pedir datos)" style="font-size: 12.5px; font-weight: 600; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); flex-grow: 1; min-width: 0;">
                            
                            <div class="custom-select-wrapper" style="position: relative; flex-grow: 1; min-width: 150px;">
                                <div class="custom-select-trigger" style="font-size: 12px; padding: 5px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                                    <span class="custom-select-label" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${escapeHtml(msg.typification === 'general' || !msg.typification ? 'Por Defecto (General)' : msg.typification)}</span>
                                    <i data-lucide="chevron-down" style="width: 14px; height: 14px; flex-shrink: 0;"></i>
                                </div>
                                <div class="custom-select-options" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); max-height: 150px; overflow-y: auto; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-top: 2px;">
                                    <div class="custom-option" data-value="general" style="padding: 6px 8px; font-size: 12px; cursor: pointer; border-bottom: 1px solid var(--border-soft); transition: background 0.2s;">Por Defecto (General)</div>
                                    ${(typeof ALL_TIPIFICACIONES !== 'undefined' ? ALL_TIPIFICACIONES : []).map(t => 
                                        `<div class="custom-option" data-value="${escapeHtml(t)}" style="padding: 6px 8px; font-size: 12px; cursor: pointer; border-bottom: 1px solid var(--border-soft); transition: background 0.2s;">${escapeHtml(t)}</div>`
                                    ).join('')}
                                </div>
                                <input type="hidden" class="quick-msg-typification" value="${escapeHtml(msg.typification || 'general')}">
                            </div>

                            <button class="btn btn-ghost quick-msg-copy" type="button" data-index="${index}" style="padding: 4px 6px; color: var(--text-muted); height: auto; min-height: 24px; border: 1px solid var(--border); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: 11px;" title="Copiar texto al portapapeles">
                                <i data-lucide="copy" style="width: 12px; height: 12px;"></i> Copiar
                            </button>
                            <button class="btn btn-ghost quick-msg-delete" type="button" data-index="${index}" style="padding: 4px; color: var(--danger); height: auto; min-height: 24px; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;" title="Eliminar mensaje">
                                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                            </button>
                        </div>
                        <textarea class="quick-msg-text" placeholder="Texto del mensaje. Variables: {nombre} {ticket} {incidente} {elemento} {tipificacion} {empresa} {correo}" style="font-size: 12px; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-family: inherit; resize: vertical; min-height: 60px;">${escapeHtml(msg.text || '')}</textarea>
                    </div>
                `;
            }).join('');
        }

        // Bind delete events
        container.querySelectorAll('.quick-msg-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                syncProfileQuickMessagesFromUI();
                window.profileQuickMessages.splice(idx, 1);
                renderProfileQuickMessages();
            });
        });

        // Bind copy events
        container.querySelectorAll('.quick-msg-copy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                const card = container.querySelector(`.quick-msg-card[data-index="${idx}"]`);
                const txt = card?.querySelector('.quick-msg-text')?.value || '';
                if (!txt) {
                    toast('El mensaje está vacío', 'error');
                    return;
                }
                navigator.clipboard.writeText(txt).then(
                    () => toast('Texto copiado al portapapeles', 'success'),
                    () => toast('No se pudo copiar', 'error')
                );
            });
        });

        // Custom select dropdown logic
        container.querySelectorAll('.custom-select-trigger').forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close all others
                container.querySelectorAll('.custom-select-options').forEach(opt => {
                    if(opt !== trigger.nextElementSibling) opt.style.display = 'none';
                });
                const options = trigger.nextElementSibling;
                options.style.display = options.style.display === 'none' ? 'block' : 'none';
            });
        });

        container.querySelectorAll('.custom-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const wrapper = option.closest('.custom-select-wrapper');
                const triggerLabel = wrapper.querySelector('.custom-select-label');
                const hiddenInput = wrapper.querySelector('.quick-msg-typification');
                const options = wrapper.querySelector('.custom-select-options');
                
                triggerLabel.textContent = option.textContent;
                hiddenInput.value = option.dataset.value;
                options.style.display = 'none';
                syncProfileQuickMessagesFromUI();
            });
            
            option.addEventListener('mouseenter', () => option.style.background = 'var(--surface-hover)');
            option.addEventListener('mouseleave', () => option.style.background = 'transparent');
        });
    });

    if (!window.quickMsgsCustomSelectBound) {
        window.quickMsgsCustomSelectBound = true;
        document.addEventListener('click', () => {
            containerIds.forEach(id => {
                const list = document.getElementById(id);
                if (list) {
                    list.querySelectorAll('.custom-select-options').forEach(opt => opt.style.display = 'none');
                }
            });
        });
    }

    renderIcons();
}

function syncProfileQuickMessagesFromUI() {
    let container = document.getElementById('quickMsgsList');
    const prefModal = document.getElementById('preferencesModal');
    if (prefModal && prefModal.classList.contains('open')) {
        container = document.getElementById('profileQuickMsgsList');
    }
    if (!container) return;
    
    const cards = container.querySelectorAll('.quick-msg-card');
    cards.forEach(card => {
        const idx = parseInt(card.dataset.index);
        const titleVal = card.querySelector('.quick-msg-title').value.trim();
        const textVal = card.querySelector('.quick-msg-text').value;
        const typInput = card.querySelector('.quick-msg-typification');
        if (window.profileQuickMessages[idx]) {
            window.profileQuickMessages[idx].title = titleVal;
            window.profileQuickMessages[idx].text = textVal;
            if (typInput) {
                window.profileQuickMessages[idx].typification = typInput.value;
            }
        }
    });
}

// Global state for active tab inside the Quick Messages modal
let activeQuickMsgsTab = 'general';

// Bind "Agregar" button inside quick messages modal
document.getElementById('quickMsgsAddBtn').addEventListener('click', () => {
    syncProfileQuickMessagesFromUI();
    window.profileQuickMessages.push({
        title: 'Mensaje Personalizado',
        typification: activeQuickMsgsTab,
        text: 'Hola {nombre}, te contacto de tecnología por el ticket {ticket}.'
    });
    renderQuickMsgsModal();
});

// Bind "Agregar" button inside preferences modal
document.getElementById('profileAddMsgBtn')?.addEventListener('click', () => {
    syncProfileQuickMessagesFromUI();
    window.profileQuickMessages.push({
        title: 'Mensaje Personalizado',
        typification: 'general',
        text: 'Hola {nombre}, te contacto de tecnología por el ticket {ticket}.'
    });
    renderProfileQuickMessages();
});

// Bind "Restablecer de fábrica" inside quick messages modal
const btnRestoreMsgs = document.getElementById('quickMsgsRestoreBtn');
if (btnRestoreMsgs) {
    btnRestoreMsgs.addEventListener('click', () => {
        Swal.fire({
            title: '¿Restablecer mensajes?',
            text: 'Se borrarán tus mensajes actuales y se cargarán los predeterminados.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, restablecer',
            cancelButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                window.profileQuickMessages = JSON.parse(JSON.stringify(window.DEFAULT_QUICK_MESSAGES || []));
                activeQuickMsgsTab = 'general';
                renderQuickMsgsModal();
                toast('Mensajes restablecidos', 'success');
            }
        });
    });
}

// Bind "Cargar default" inside preferences modal
document.getElementById('profileSeedMsgBtn')?.addEventListener('click', () => {
    Swal.fire({
        title: '¿Restablecer mensajes?',
        text: 'Se borrarán tus mensajes actuales y se cargarán los predeterminados.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, restablecer',
        cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            window.profileQuickMessages = JSON.parse(JSON.stringify(window.DEFAULT_QUICK_MESSAGES || []));
            renderProfileQuickMessages();
            toast('Mensajes restablecidos', 'success');
        }
    });
});

// Render function for standalone Tabbed Quick Messages Modal
function renderQuickMsgsModal() {
    const tabsList = document.getElementById('quickMsgsTabsList');
    const msgsList = document.getElementById('quickMsgsList');
    if (!tabsList || !msgsList) return;

    // 1. Calculate counts for each typification to display on tabs.
    // Se agrupa por clave canónica (tipKey) para que variantes de mayúsculas/
    // acentos del mismo nombre cuenten en una sola tab.
    const _tk = window.tipKey || (s => (s || '').toLowerCase().trim());
    const counts = {};
    (window.profileQuickMessages || []).forEach(msg => {
        const typ = msg.typification ? _tk(msg.typification) : 'general';
        counts[typ] = (counts[typ] || 0) + 1;
    });

    // 2. Get search filter
    const searchInput = document.getElementById('quickMsgsTabSearch');
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // 3. Render tabs list
    let tabsHtml = '';
    
    // "Por Defecto (General)" tab (always exists, only filtered if search is active and doesn't match)
    const generalLabel = 'Por Defecto (General)';
    const generalCount = counts['general'] || 0;
    if (!filterText || generalLabel.toLowerCase().includes(filterText)) {
        const isActive = activeQuickMsgsTab === 'general' ? 'active' : '';
        tabsHtml += `
            <div class="quick-msg-tab ${isActive}" data-value="general">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${generalLabel}">${generalLabel}</span>
                <span class="quick-msg-tab-badge">${generalCount}</span>
            </div>
        `;
    }

    const typificationsList = typeof ALL_TIPIFICACIONES !== 'undefined' ? ALL_TIPIFICACIONES : [];
    const seenCleanTips = new Set();
    typificationsList.forEach(tip => {
        const cleanTip = tip.replace(/\s*\((INC|WO)\)$/i, '');
        // Deduplicar tabs por cleanTip normalizado (evita mostrar "Equipo - Reparacion"
        // dos veces si ALL_TIPIFICACIONES trae variantes de casing)
        const cleanKey = _tk(cleanTip);
        if (seenCleanTips.has(cleanKey)) return;
        seenCleanTips.add(cleanKey);

        if (filterText && !cleanTip.toLowerCase().includes(filterText)) return;
        // Comparar con tipKey para que mensajes guardados en CAPS activen el tab correcto
        const isActive = _tk(activeQuickMsgsTab) === _tk(tip) ? 'active' : '';
        const count = counts[_tk(tip)] || 0;
        tabsHtml += `
            <div class="quick-msg-tab ${isActive}" data-value="${escapeHtml(tip)}">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(cleanTip)}">${escapeHtml(cleanTip)}</span>
                <span class="quick-msg-tab-badge">${count}</span>
            </div>
        `;
    });

    tabsList.innerHTML = tabsHtml || '<div style="text-align: center; color: var(--text-faint); padding: 16px; font-size: 11px;">No se encontraron tipificaciones.</div>';

    // 4. Update active tab header info on the right side
    const activeTitleEl = document.getElementById('quickMsgsActiveTabTitle');
    if (activeTitleEl) {
        const cleanActiveTab = activeQuickMsgsTab === 'general' ? 'Por Defecto (General)' : activeQuickMsgsTab.replace(/\s*\((INC|WO)\)$/i, '');
        activeTitleEl.textContent = cleanActiveTab;
        activeTitleEl.title = cleanActiveTab;
    }

    // 5. Render quick messages matching the active tab
    const filteredMsgs = (window.profileQuickMessages || []).map((msg, index) => ({ msg, realIndex: index }))
        .filter(item => {
            const typ = item.msg.typification ? _tk(item.msg.typification) : 'general';
            if (activeQuickMsgsTab === 'general') {
                return typ === 'general';
            }
            return typ === _tk(activeQuickMsgsTab);
        });

    if (filteredMsgs.length === 0) {
        msgsList.innerHTML = `
            <div style="text-align: center; color: var(--text-faint); padding: 32px; font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <i data-lucide="message-square" style="width: 24px; height: 24px; color: var(--text-faint);"></i>
                No hay mensajes rápidos para esta tipificación.<br>¡Creá uno nuevo haciendo clic en "Nuevo mensaje" arriba!
            </div>
        `;
    } else {
        msgsList.innerHTML = filteredMsgs.map(item => {
            const { msg, realIndex } = item;
            
            return `
                <div class="quick-msg-card" data-index="${realIndex}" style="border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--surface-2); position: relative;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <input type="text" class="quick-msg-title" value="${escapeHtml(msg.title || '')}" placeholder="Título (Ej: Pedir datos)" style="font-size: 13px; font-weight: 600; padding: 5px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); flex-grow: 1; min-width: 0;">
                        
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <button class="btn btn-ghost quick-msg-delete" type="button" data-index="${realIndex}" style="padding: 4px; color: var(--danger); height: auto; min-height: 28px; width: 28px; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;" title="Eliminar mensaje">
                                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                            </button>
                        </div>
                    </div>
                    <textarea class="quick-msg-text" placeholder="Texto del mensaje. Variables: {nombre} {ticket} {incidente} {elemento} {tipificacion} {empresa} {correo}" style="font-size: 12px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-family: inherit; resize: vertical; min-height: 70px;">${escapeHtml(msg.text || '')}</textarea>
                </div>
            `;
        }).join('');
    }

    // 6. Wire tab click handlers
    tabsList.querySelectorAll('.quick-msg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            syncProfileQuickMessagesFromUI();
            activeQuickMsgsTab = tab.dataset.value;
            renderQuickMsgsModal();
        });
    });

    // 7. Wire card delete handlers
    msgsList.querySelectorAll('.quick-msg-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            syncProfileQuickMessagesFromUI();
            window.profileQuickMessages.splice(idx, 1);
            renderQuickMsgsModal();
        });
    });

    // 8. Wire real-time inputs change syncing
    msgsList.querySelectorAll('.quick-msg-title, .quick-msg-text').forEach(el => {
        el.addEventListener('change', () => {
            syncProfileQuickMessagesFromUI();
        });
    });

    renderIcons();
}

// Bind live search for typification tabs
document.getElementById('quickMsgsTabSearch')?.addEventListener('input', () => {
    renderQuickMsgsModal();
});

// Standalone Quick Messages modal control
function openQuickMsgsModal() {
    window.profileQuickMessages = JSON.parse(JSON.stringify(window.customQuickMessages || window.DEFAULT_QUICK_MESSAGES || []));
    activeQuickMsgsTab = 'general';
    const searchInput = document.getElementById('quickMsgsTabSearch');
    if (searchInput) searchInput.value = '';

    API.getUserSettings().then(settings => {
        if (settings && !Array.isArray(settings)) {
            if (settings.quick_messages && settings.quick_messages.length > 0) {
                window.profileQuickMessages = settings.quick_messages;
            }
        }
        renderQuickMsgsModal();
    }).catch(err => {
        console.error("Error loading user settings:", err);
        renderQuickMsgsModal();
    });

    document.getElementById('quickMsgsModal').classList.add('open');
    document.getElementById('userDropdown').classList.remove('open');
}

function closeQuickMsgsModal() {
    document.getElementById('quickMsgsModal').classList.remove('open');
}

document.getElementById('btnManageQuickMsgs').addEventListener('click', openQuickMsgsModal);

// Boton TEMPORAL (solo dispatcher): exporta los mensajes rapidos del usuario a
// un JSON descargable, para sembrar el set default del resto del equipo. Lee
// directo del backend (no depende de abrir el modal antes). Se puede borrar
// una vez cargado el default.
const _btnExportQM = document.getElementById('btnExportQuickMsgs');
if (_btnExportQM) {
    _btnExportQM.addEventListener('click', async () => {
        try {
            const settings = await API.getUserSettings();
            const msgs = (settings && settings.quick_messages) || [];
            const blob = new Blob([JSON.stringify(msgs, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const uname = (window.currentUser && window.currentUser.username) || 'usuario';
            a.href = url;
            a.download = `mensajes_rapidos_${uname}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            if (typeof toast === 'function') toast(`Exportados ${msgs.length} mensaje(s) rápido(s)`, 'success');
        } catch (e) {
            if (typeof toast === 'function') toast('Error al exportar mensajes rápidos', 'error');
        }
    });
}
document.getElementById('quickMsgsModalClose').addEventListener('click', closeQuickMsgsModal);
document.getElementById('quickMsgsModalCancel').addEventListener('click', closeQuickMsgsModal);

document.getElementById('quickMsgsModalSave').addEventListener('click', async () => {
    syncProfileQuickMessagesFromUI();
    try {
        const settings = await API.getUserSettings();
        let newSettings = {};
        if (settings && !Array.isArray(settings)) {
            newSettings = { ...settings, quick_messages: window.profileQuickMessages };
        } else {
            newSettings = {
                kanban_groups: KANBAN_GROUPS,
                quick_messages: window.profileQuickMessages
            };
        }
        await API.saveUserSettings(newSettings);
        window.customQuickMessages = window.profileQuickMessages; // Actualizar cache global en vivo
        closeQuickMsgsModal();
        toast('Mensajes rápidos actualizados', 'success');
    } catch (err) {
        console.error("Error saving quick messages settings:", err);
        toast('Error al guardar mensajes', 'error');
    }
});

// Profile edit control
function openProfileEditModal() {
    if (!currentUser) return;
    document.getElementById('profileEditName').value = currentUser.name || '';
    document.getElementById('profileEditEmail').value = currentUser.email || '';
    document.getElementById('profileEditOrg').value = currentUser.organization || '';
    document.getElementById('profileCurrentPw').value = '';
    document.getElementById('profileNewPw').value = '';
    document.getElementById('profileConfirmPw').value = '';
    document.getElementById('profileEditError').style.display = 'none';

    document.getElementById('profileEditModal').classList.add('open');
    document.getElementById('userDropdown').classList.remove('open');
}

function closeProfileEditModal() {
    document.getElementById('profileEditModal').classList.remove('open');
}

document.getElementById('btnEditProfile').addEventListener('click', openProfileEditModal);
document.getElementById('profileEditClose').addEventListener('click', closeProfileEditModal);
document.getElementById('profileEditCancel').addEventListener('click', closeProfileEditModal);

// ============================================================
// MODAL DE PREFERENCIAS (saludo default + futuras prefs del operador)
// ============================================================
// Global states for preferences modal
window.activePrefTab = 'asignacion';
window.activePrefSubTab = 'greetings';

function renderPreferencesTabs() {
    const tabsList = document.getElementById('preferencesTabsList');
    if (!tabsList) return;
    
    const categories = [
        { action: 'asignacion', label: 'Asignación', icon: 'arrow-up-right' },
        { action: 'recambio', label: 'Recambio', icon: 'refresh-cw' },
        { action: 'prestamo', label: 'Préstamo', icon: 'calendar' },
        { action: 'renuncia', label: 'Renuncia', icon: 'log-out' },
        { action: 'reemplazo', label: 'Reemplazo', icon: 'repeat' }
    ];
    
    // Calculate counts for badges (greetings + observations of each action)
    const counts = {};
    categories.forEach(cat => {
        const gCount = (window.profileTemplateGreetings || []).filter(g => g.action === cat.action).length;
        const oCount = (window.profileTemplateObs || []).filter(o => o.action === cat.action).length;
        counts[cat.action] = gCount + oCount;
    });
    
    tabsList.innerHTML = categories.map(cat => {
        const isActive = window.activePrefTab === cat.action ? 'active' : '';
        return `
            <div class="quick-msg-tab ${isActive}" data-value="${cat.action}">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="${cat.icon}" style="width: 14px; height: 14px;"></i>
                    <span>${cat.label}</span>
                </div>
                <span class="quick-msg-tab-badge">${counts[cat.action]}</span>
            </div>
        `;
    }).join('');
    
    // Bind click events on the tabs
    tabsList.querySelectorAll('.quick-msg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const action = tab.dataset.value;
            if (action === window.activePrefTab) return;
            
            // Sync current UI fields before switching
            syncProfileTemplateFromUI();
            
            window.activePrefTab = action;
            renderPreferencesTabs();
            updatePreferencesHeader();
            renderProfileTemplateContent();
        });
    });
    
    if (window.lucide) lucide.createIcons();
}

function updatePreferencesHeader() {
    const titleEl = document.getElementById('prefActiveTabTitle');
    if (titleEl) {
        const categories = {
            'asignacion': 'Asignación',
            'recambio': 'Recambio',
            'prestamo': 'Préstamo',
            'renuncia': 'Renuncia',
            'reemplazo': 'Reemplazo'
        };
        titleEl.textContent = categories[window.activePrefTab || 'asignacion'] || 'Asignación';
    }
    
    // Highlight sub-tab buttons
    const subtabs = document.querySelectorAll('.pref-subtab');
    subtabs.forEach(btn => {
        if (btn.dataset.subtab === window.activePrefSubTab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function syncProfileTemplateFromUI() {
    const container = document.getElementById('prefContentList');
    if (!container) return;
    
    const subtab = window.activePrefSubTab || 'greetings';
    const currentTab = window.activePrefTab || 'asignacion';
    
    if (subtab === 'greetings') {
        const cards = container.querySelectorAll('.greeting-template-card');
        const updatedForActiveTab = [];
        cards.forEach(card => {
            const titleVal = card.querySelector('.greeting-template-title').value.trim();
            const textVal = card.querySelector('.greeting-template-text').value;
            updatedForActiveTab.push({ title: titleVal, text: textVal, action: currentTab });
        });
        const otherTabs = (window.profileTemplateGreetings || []).filter(greet => greet.action !== currentTab);
        window.profileTemplateGreetings = [...otherTabs, ...updatedForActiveTab];
    } else {
        const cards = container.querySelectorAll('.obs-template-card');
        const updatedForActiveTab = [];
        cards.forEach(card => {
            const titleVal = card.querySelector('.obs-template-title').value.trim();
            const textVal = card.querySelector('.obs-template-text').value;
            updatedForActiveTab.push({ title: titleVal, text: textVal, action: currentTab });
        });
        const otherTabs = (window.profileTemplateObs || []).filter(obs => obs.action !== currentTab);
        window.profileTemplateObs = [...otherTabs, ...updatedForActiveTab];
    }
}

function renderProfileTemplateContent() {
    const container = document.getElementById('prefContentList');
    const infoBar = document.getElementById('prefInfoBar');
    if (!container) return;
    
    const currentTab = window.activePrefTab || 'asignacion';
    const subtab = window.activePrefSubTab || 'greetings';
    
    if (subtab === 'greetings') {
        infoBar.innerHTML = `
            Textos que aparecen como opción de <strong>Saludo del email</strong> en la planilla para esta categoría.
            <div style="font-size: 11px; color: var(--text-muted); background: var(--surface); padding: 6px 8px; border-radius: 4px; margin-top: 8px; border: 1px solid var(--border);">
                Tokens disponibles: <code>{saludo}</code> hora · <code>{fecha}</code> retiro · <code>{elemento}</code> tipo · <code>{persona}</code> retira
            </div>
        `;
        
        const filtered = (window.profileTemplateGreetings || []).map((greet, idx) => ({ greet, idx })).filter(item => item.greet.action === currentTab);
        if (filtered.length === 0) {
            container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:32px;">No hay saludos personalizados para esta categoría. Hacé clic en "+ Nuevo" o en "Restablecer" arriba.</div>';
            return;
        }
        
        container.innerHTML = filtered.map(item => `
            <div class="quick-msg-card greeting-template-card" data-index="${item.idx}" style="border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--surface-2); position: relative;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <input type="text" class="greeting-template-title" value="${escapeHtml(item.greet.title)}" placeholder="Título (Ej: Saludo Estándar)" style="font-size: 13px; font-weight: 600; padding: 5px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); flex-grow: 1; min-width: 0;">
                    <button class="btn btn-ghost greeting-template-delete" type="button" data-index="${item.idx}" style="padding: 4px; color: var(--danger); height: auto; min-height: 28px; width: 28px; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;" title="Eliminar saludo">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
                <textarea class="greeting-template-text" placeholder="Saludo. Variables: {saludo}, {fecha}, {elemento}, {persona}" style="font-size: 12px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-family: inherit; resize: vertical; min-height: 60px;">${escapeHtml(item.greet.text || '')}</textarea>
            </div>
        `).join('');
        
        container.querySelectorAll('.greeting-template-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                syncProfileTemplateFromUI();
                window.profileTemplateGreetings.splice(idx, 1);
                renderProfileTemplateContent();
                renderPreferencesTabs();
            });
        });
        
        container.querySelectorAll('.greeting-template-title, .greeting-template-text').forEach(el => {
            el.addEventListener('change', () => {
                syncProfileTemplateFromUI();
            });
        });
    } else {
        infoBar.innerHTML = `
            Botones de observaciones rápidas para inyectar al redactar la planilla para esta categoría.
            <div style="font-size: 11px; color: var(--text-muted); background: var(--surface); padding: 6px 8px; border-radius: 4px; margin-top: 8px; border: 1px solid var(--border);">
                Tokens disponibles: <code>{equipo}</code> = notebook, celular, etc.
            </div>
        `;
        
        const filtered = (window.profileTemplateObs || []).map((obs, idx) => ({ obs, idx })).filter(item => item.obs.action === currentTab);
        if (filtered.length === 0) {
            container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:32px;">No hay observaciones personalizadas para esta categoría. Hacé clic en "+ Nuevo" o en "Restablecer" arriba.</div>';
            return;
        }
        
        container.innerHTML = filtered.map(item => `
            <div class="quick-msg-card obs-template-card" data-index="${item.idx}" style="border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--surface-2); position: relative;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <input type="text" class="obs-template-title" value="${escapeHtml(item.obs.title)}" placeholder="Título (Ej: Observación Standard)" style="font-size: 13px; font-weight: 600; padding: 5px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); flex-grow: 1; min-width: 0;">
                    <button class="btn btn-ghost obs-template-delete" type="button" data-index="${item.idx}" style="padding: 4px; color: var(--danger); height: auto; min-height: 28px; width: 28px; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;" title="Eliminar observación">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
                <textarea class="obs-template-text" placeholder="Observaciones. Variables: {equipo}" style="font-size: 12px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-family: inherit; resize: vertical; min-height: 60px;">${escapeHtml(item.obs.text || '')}</textarea>
            </div>
        `).join('');
        
        container.querySelectorAll('.obs-template-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                syncProfileTemplateFromUI();
                window.profileTemplateObs.splice(idx, 1);
                renderProfileTemplateContent();
                renderPreferencesTabs();
            });
        });
        
        container.querySelectorAll('.obs-template-title, .obs-template-text').forEach(el => {
            el.addEventListener('change', () => {
                syncProfileTemplateFromUI();
            });
        });
    }
    
    if (window.lucide) lucide.createIcons();
}

// Bind subtab switching
document.querySelectorAll('.pref-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.subtab;
        if (target === window.activePrefSubTab) return;
        
        syncProfileTemplateFromUI();
        window.activePrefSubTab = target;
        updatePreferencesHeader();
        renderProfileTemplateContent();
    });
});

// Bind templates Restore / Add buttons
document.getElementById('prefRestoreBtn')?.addEventListener('click', () => {
    const subtab = window.activePrefSubTab || 'greetings';
    if (subtab === 'greetings') {
        Swal.fire({
            title: '¿Restablecer saludos?',
            text: 'Se borrarán tus saludos actuales y se cargarán los predeterminados para todas las categorías.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, restablecer',
            cancelButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                window.profileTemplateGreetings = JSON.parse(JSON.stringify(window.DEFAULT_TEMPLATE_GREETINGS || []));
                renderProfileTemplateContent();
                renderPreferencesTabs();
                toast('Saludos restablecidos', 'success');
            }
        });
    } else {
        Swal.fire({
            title: '¿Restablecer observaciones?',
            text: 'Se borrarán tus observaciones actuales y se cargarán las predeterminadas para todas las categorías.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, restablecer',
            cancelButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                window.profileTemplateObs = JSON.parse(JSON.stringify(window.DEFAULT_TEMPLATE_OBS || []));
                renderProfileTemplateContent();
                renderPreferencesTabs();
                toast('Observaciones restablecidas', 'success');
            }
        });
    }
});

document.getElementById('prefAddBtn')?.addEventListener('click', () => {
    syncProfileTemplateFromUI();
    const subtab = window.activePrefSubTab || 'greetings';
    const currentTab = window.activePrefTab || 'asignacion';
    
    if (subtab === 'greetings') {
        window.profileTemplateGreetings.push({
            title: 'Nuevo Saludo',
            text: '',
            action: currentTab
        });
    } else {
        window.profileTemplateObs.push({
            title: 'Nueva Observación',
            text: '',
            action: currentTab
        });
    }
    
    renderProfileTemplateContent();
    renderPreferencesTabs();
});

function openPreferencesModal() {
    const errEl = document.getElementById('preferencesError');
    if (errEl) errEl.style.display = 'none';
    window.profileQuickMessages = JSON.parse(JSON.stringify(window.customQuickMessages || window.DEFAULT_QUICK_MESSAGES || []));
    window.profileTemplateObs = JSON.parse(JSON.stringify(window.userTemplateObs || window.DEFAULT_TEMPLATE_OBS || []));
    window.profileTemplateGreetings = JSON.parse(JSON.stringify(window.userTemplateGreetings || window.DEFAULT_TEMPLATE_GREETINGS || []));
    window.activePrefTab = 'asignacion';
    window.activePrefSubTab = 'greetings';

    updatePreferencesHeader();
    renderProfileTemplateContent();
    API.getUserSettings().then(settings => {
        if (settings && !Array.isArray(settings)) {
            if (settings.quick_messages && settings.quick_messages.length > 0) {
                window.profileQuickMessages = settings.quick_messages;
            }
            if (settings.template_obs && settings.template_obs.length > 0) {
                window.profileTemplateObs = settings.template_obs;
            }
            if (settings.template_greetings && settings.template_greetings.length > 0) {
                window.profileTemplateGreetings = settings.template_greetings;
            }
        }
        // Asegurar que cada observación importada tenga una acción asignada
        window.profileTemplateObs.forEach(obs => {
            if (!obs.action) {
                const t = String(obs.title).toLowerCase();
                if (t.includes('recambio') || t.includes('defectuoso')) obs.action = 'recambio';
                else if (t.includes('prestamo') || t.includes('préstamo')) obs.action = 'prestamo';
                else if (t.includes('renuncia')) obs.action = 'renuncia';
                else if (t.includes('reemplazo')) obs.action = 'reemplazo';
                else obs.action = 'asignacion';
            }
        });
        // Asegurar que cada saludo importado tenga una acción asignada
        window.profileTemplateGreetings.forEach(greet => {
            if (!greet.action) {
                const t = String(greet.title).toLowerCase();
                if (t.includes('recambio')) greet.action = 'recambio';
                else if (t.includes('prestamo') || t.includes('préstamo')) greet.action = 'prestamo';
                else if (t.includes('renuncia')) greet.action = 'renuncia';
                else if (t.includes('reemplazo')) greet.action = 'reemplazo';
                else greet.action = 'asignacion';
            }
        });
        renderPreferencesTabs();
        updatePreferencesHeader();
        renderProfileTemplateContent();
    }).catch(err => {
        console.error('Error loading preferences:', err);
        renderPreferencesTabs();
        updatePreferencesHeader();
        renderProfileTemplateContent();
    });
    document.getElementById('preferencesModal').classList.add('open');
    document.getElementById('userDropdown').classList.remove('open');
}

function closePreferencesModal() {
    document.getElementById('preferencesModal').classList.remove('open');
}

document.getElementById('btnPreferences')?.addEventListener('click', openPreferencesModal);
document.getElementById('preferencesClose')?.addEventListener('click', closePreferencesModal);
document.getElementById('preferencesCancel')?.addEventListener('click', closePreferencesModal);
document.getElementById('preferencesSave')?.addEventListener('click', async () => {
    const errEl = document.getElementById('preferencesError');
    if (errEl) errEl.style.display = 'none';
    
    // Sync desde UI
    syncProfileTemplateFromUI();
    
    const quickMsgs = window.profileQuickMessages || [];
    const templateObs = window.profileTemplateObs || [];
    const templateGreetings = window.profileTemplateGreetings || [];
    try {
        const settings = await API.getUserSettings();
        let newSettings = {};
        if (settings && !Array.isArray(settings)) {
            newSettings = {
                ...settings,
                quick_messages: quickMsgs,
                template_obs: templateObs,
                template_greetings: templateGreetings
            };
        } else {
            newSettings = {
                kanban_groups: KANBAN_GROUPS,
                quick_messages: quickMsgs,
                template_obs: templateObs,
                template_greetings: templateGreetings,
            };
        }
        await API.saveUserSettings(newSettings);
        window.customQuickMessages = quickMsgs; // refresca cache
        window.userTemplateObs = templateObs;
        window.userTemplateGreetings = templateGreetings;
        closePreferencesModal();
        toast('Preferencias guardadas', 'success');
    } catch (err) {
        console.error('Error saving preferences:', err);
        if (errEl) {
            errEl.textContent = 'No se pudo guardar. Reintentá.';
            errEl.style.display = 'block';
        }
    }
});

document.getElementById('profileEditSave').addEventListener('click', async () => {
    const errEl = document.getElementById('profileEditError');
    const saveLabel = document.getElementById('profileEditSaveLabel');
    errEl.style.display = 'none';

    const name = document.getElementById('profileEditName').value.trim();
    const email = document.getElementById('profileEditEmail').value.trim();
    const org = document.getElementById('profileEditOrg').value.trim();
    const currentPw = document.getElementById('profileCurrentPw').value;
    const newPw = document.getElementById('profileNewPw').value;
    const confirmPw = document.getElementById('profileConfirmPw').value;

    const payload = {};
    if (name) payload.name = name;
    if (email) payload.email = email;
    if (org) payload.organization = org;
    if (newPw) {
        if (newPw !== confirmPw) {
            errEl.textContent = 'Las contraseñas nuevas no coinciden';
            errEl.style.display = 'block';
            return;
        }
        payload.newPassword = newPw;
        payload.currentPassword = currentPw;
    }

    if (!Object.keys(payload).length) {
        closeProfileEditModal();
        toast('Perfil sin cambios', 'success');
        return;
    }

    saveLabel.textContent = 'Guardando...';
    document.getElementById('profileEditSave').disabled = true;
    try {
        const result = await API.updateProfile(payload);
        if (currentUser) {
            if (result.name) { currentUser.name = result.name; }
            if (result.email) currentUser.email = result.email;
            if (result.organization) currentUser.organization = result.organization;
        }
        // Refrescar UI del perfil
        if (result.name) {
            document.getElementById('userProfileName').textContent = result.name;
            const initialsStr = result.name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
            document.getElementById('userInitials').textContent = initialsStr;
        }
        if (result.email) document.getElementById('userProfileEmail').textContent = result.email;
        if (result.organization) document.getElementById('userProfileOrg').textContent = result.organization;
        closeProfileEditModal();
        toast('Perfil actualizado correctamente', 'success');
    } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
    } finally {
        saveLabel.textContent = 'Guardar cambios';
        document.getElementById('profileEditSave').disabled = false;
    }
});


// Dropdowns: Perfil y Notificaciones
document.getElementById('btnUser').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('userDropdown').classList.toggle('open');
    document.getElementById('notificationDropdown').classList.remove('open');
});

document.getElementById('btnNotifications').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('notificationDropdown').classList.toggle('open');
    document.getElementById('userDropdown').classList.remove('open');
});

document.addEventListener('click', () => {
    document.getElementById('userDropdown').classList.remove('open');
    document.getElementById('notificationDropdown').classList.remove('open');
});

document.getElementById('userDropdown').addEventListener('click', e => e.stopPropagation());
document.getElementById('notificationDropdown').addEventListener('click', e => e.stopPropagation());

window.showQuickMsgsVariablesHelp = function() {
    Swal.fire({
        title: 'Variables para Mensajes Rápidos',
        html: `
            <div style="text-align: left; font-size: 13.5px; line-height: 1.6; color: var(--text);">
                <p style="margin-bottom: 12px;">Podés incluir cualquiera de estas variables encerradas entre llaves <code>{ }</code> en tus mensajes. El sistema las reemplazará automáticamente con la información del ticket:</p>
                <ul style="padding-left: 20px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px;">
                    <li><strong><code>{nombre}</code></strong>: Nombre completo del usuario.</li>
                    <li><strong><code>{ticket}</code></strong> o <strong><code>{incidente}</code></strong>: Código/Número del ticket (INC o WO).</li>
                    <li><strong><code>{equipo}</code></strong> o <strong><code>{elemento}</code></strong>: Tipo de dispositivo (ej: notebook, celular, vincha, etc.).</li>
                    <li><strong><code>{tipificacion}</code></strong>: Tipificación del ticket (ej: Kit Inalambrico (INC) o Vincha (INC)).</li>
                    <li><strong><code>{empresa}</code></strong>: Empresa propietaria asignada al ticket.</li>
                    <li><strong><code>{correo}</code></strong> o <strong><code>{email}</code></strong>: Dirección de e-mail del usuario.</li>
                </ul>
                <p style="color: var(--text-faint); font-size: 12px; border-top: 1px solid var(--border); padding-top: 10px; margin: 0;">Ejemplo: <em>"Hola {nombre}, te contacto por tu ticket {incidente}..."</em></p>
            </div>
        `,
        icon: 'info',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--primary)'
    });
};



// Expose to window for global module compatibility
window.renderProfileQuickMessages = renderProfileQuickMessages;
window.syncProfileQuickMessagesFromUI = syncProfileQuickMessagesFromUI;
window.renderQuickMsgsModal = renderQuickMsgsModal;
window.openQuickMsgsModal = openQuickMsgsModal;
window.closeQuickMsgsModal = closeQuickMsgsModal;
window.openProfileEditModal = openProfileEditModal;
window.closeProfileEditModal = closeProfileEditModal;
window.openPreferencesModal = openPreferencesModal;
window.closePreferencesModal = closePreferencesModal;
