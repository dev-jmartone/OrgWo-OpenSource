// ============================================================
// DISPATCHER & FICHAJE SYSTEM
// Handles technician clock-in/out and dispatcher rule configuration.
// ============================================================

let _dispatcherRefreshInterval = null;
window.selfDisponible = 1; // 1: Disponible, 2: Ocupado, 3: Almuerzo, 4: Desconectado

const STATUS_MAP = {
    1: { text: 'Disponible', color: '#22c55e', shadow: '0 0 6px #22c55e' },
    2: { text: 'Ocupado', color: '#eab308', shadow: '0 0 6px #eab308' },
    3: { text: 'Almuerzo', color: '#3b82f6', shadow: '0 0 6px #3b82f6' },
    4: { text: 'Desconectado', color: '#6b7280', shadow: '0 0 6px #6b7280' }
};

// 1. Availability (Fichaje) for Current User
async function loadSelfAvailability() {
    try {
        const r = await fetch('/api/users/availability?_t=' + Date.now());
        if (!r.ok) return;
        const data = await r.json();
        const currentVal = parseInt(data.disponible) || 1;
        window.selfDisponible = currentVal;
        console.log("[Fichaje] loadSelfAvailability loaded value:", currentVal);
        
        const selectEl = document.getElementById('selfAvailabilitySelect');
        const dotEl = document.getElementById('selfAvailabilityDot');
        
        if (selectEl) {
            selectEl.value = String(currentVal);
        }
        
        if (dotEl && STATUS_MAP[currentVal]) {
            dotEl.style.background = STATUS_MAP[currentVal].color;
            dotEl.style.boxShadow = STATUS_MAP[currentVal].shadow;
        }
    } catch (err) {
        console.error("Error loading self availability:", err);
    }
}

async function changeSelfAvailability(val) {
    console.log("[DEBUG-AVAILABILITY] changeSelfAvailability entered with value:", val);
    try {
        const intVal = parseInt(val) || 1;
        console.log("[DEBUG-AVAILABILITY] changeSelfAvailability sending POST payload:", { disponible: intVal });
        const r = await fetch('/api/users/availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disponible: intVal })
        });
        console.log("[DEBUG-AVAILABILITY] changeSelfAvailability response status:", r.status, "ok:", r.ok);
        if (r.ok) {
            const stateInfo = STATUS_MAP[intVal] || { text: 'Actualizado' };
            toast(`Estado cambiado a: ${stateInfo.text}`, 'success');
            console.log("[DEBUG-AVAILABILITY] changeSelfAvailability calling loadSelfAvailability()...");
            await loadSelfAvailability();
            
            // Si estamos en la vista de dispatcher, actualizar la lista
            const viewDisp = document.getElementById('view-dispatcher');
            if (viewDisp && viewDisp.classList.contains('active')) {
                console.log("[DEBUG-AVAILABILITY] changeSelfAvailability calling loadDispatcherDashboard(true)...");
                loadDispatcherDashboard(true); // silent refresh
            }
        } else {
            console.error("[DEBUG-AVAILABILITY] changeSelfAvailability POST failed with status", r.status);
            toast('Error al actualizar estado', 'error');
        }
    } catch (err) {
        console.error("[DEBUG-AVAILABILITY] Error changing self availability:", err);
        toast('Error al actualizar estado', 'error');
    }
}

function initSelfAvailabilitySelectListener() {
    // Ya no se requiere porque el select usa onchange inline en index.html
}

// 2. Dispatcher Panel Initialization & Handlers
function initDispatcher() {
    // Evitar duplicar listeners
    const btnRefresh = document.getElementById('btnDispatcherRefresh');
    if (btnRefresh && !btnRefresh.dataset.hasListener) {
        btnRefresh.dataset.hasListener = 'true';
        btnRefresh.addEventListener('click', () => loadDispatcherDashboard(false));
    }

    const btnRunNow = document.getElementById('btnDispatcherRunNow');
    if (btnRunNow && !btnRunNow.dataset.hasListener) {
        btnRunNow.dataset.hasListener = 'true';
        btnRunNow.addEventListener('click', runDispatcherNow);
    }

    const btnSaveRules = document.getElementById('btnSaveDispatcherRules');
    if (btnSaveRules && !btnSaveRules.dataset.hasListener) {
        btnSaveRules.dataset.hasListener = 'true';
        btnSaveRules.addEventListener('click', saveDispatcherRules);
    }

    // Inicializar también por las dudas si el dropdown se renderiza tarde
    initSelfAvailabilitySelectListener();

    loadDispatcherDashboard(false);
}

// 3. Load Dashboard Data
async function loadDispatcherDashboard(silent = false) {
    const spinner = document.getElementById('dispatcherLoadingSpinner');
    const content = document.getElementById('dispatcherContent');

    if (!silent && spinner && content) {
        spinner.style.display = 'flex';
        content.style.display = 'none';
    }

    try {
        const fetchJSON = async (url) => {
            const r = await fetch(url);
            if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${r.status}`);
            }
            return r.json();
        };

        const ts = Date.now();
        const [debugRes, statusRes, rulesRes] = await Promise.all([
            fetchJSON(`/api/dispatcher/debug?_t=${ts}`),
            fetchJSON(`/api/dispatcher/tech-status?_t=${ts}`),
            fetchJSON(`/api/dispatcher/rules?_t=${ts}`)
        ]);

        // Render Run info
        const lastRun = debugRes.lastRun;
        const dispLastRun = document.getElementById('dispLastRun');
        if (dispLastRun) {
            dispLastRun.textContent = lastRun ? formatFriendlyDate(lastRun) : 'Nunca';
        }

        // Render Technician Availability Table
        renderTechStatus(statusRes);

        // Render Rules Table
        renderRulesTable(rulesRes.rules || {});

        // Render Logs
        renderLogs(debugRes.logs || []);

    } catch (err) {
        console.error("Error loading dispatcher dashboard:", err);
        toast('Error al cargar datos: ' + err.message, 'error');
    } finally {
        if (spinner && content) {
            spinner.style.display = 'none';
            content.style.display = 'flex';
        }
    }
}

// 4. Renderers
function renderTechStatus(techs) {
    const tbody = document.getElementById('dispatcherTechStatusTbody');
    if (!tbody) return;
    
    if (!techs || techs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-muted);">Sin técnicos registrados.</td></tr>`;
        return;
    }

    tbody.innerHTML = techs.map(t => {
        const currentVal = parseInt(t.disponible) || 1;
        const stateInfo = STATUS_MAP[currentVal] || { text: 'Desconocido', color: '#6b7280' };
        
        return `
            <tr style="border-bottom:1px solid var(--border-soft); height:40px;">
                <td style="padding:6px 10px; font-weight:600; color:var(--text);">${t.name} <span style="font-weight:normal; font-size:11.5px; color:var(--text-muted);">(${t.username})</span></td>
                <td style="padding:6px 10px;">Nivel ${t.nivel || 1}</td>
                <td style="padding:6px 10px;">
                    <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:${stateInfo.color};">
                        <span style="width:6px; height:6px; border-radius:50%; background:${stateInfo.color}; display:inline-block;"></span>
                        ${stateInfo.text}
                    </span>
                </td>
                <td style="padding:6px 10px; text-align:center;">
                    <select style="padding:4px 8px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-deep); color:var(--text); font-family:inherit; font-size:12px; cursor:pointer;" onchange="window.toggleTechAvailability('${t.id}', this.value)">
                        <option value="1" ${currentVal === 1 ? 'selected' : ''}>Disponible</option>
                        <option value="2" ${currentVal === 2 ? 'selected' : ''}>Ocupado</option>
                        <option value="3" ${currentVal === 3 ? 'selected' : ''}>Almuerzo</option>
                        <option value="4" ${currentVal === 4 ? 'selected' : ''}>Desconectado</option>
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

function renderRulesTable(savedRules) {
    const tbody = document.getElementById('dispatcherRulesTbody');
    if (!tbody) return;

    let tips = window.ALL_TIPIFICACIONES;
    if (!tips || tips.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="padding:12px;text-align:center;color:var(--text-muted);">Cargando catálogo...</td></tr>`;
        return;
    }

    // Default levels and complexities as fallback
    const defaultLevels = {
        "vincha": 1,
        "kit": 1,
        "cargador": 1,
        "celular": 1,
        "monitor": 1,
        "red / conectividad": 2,
        "software / configuración": 2,
        "equipo": 2
    };

    const defaultComplexities = {
        "vincha": 1,
        "kit": 1,
        "cargador": 1,
        "celular": 3,
        "monitor": 2,
        "red / conectividad": 4,
        "software / configuración": 4,
        "equipo": 5
    };

    tbody.innerHTML = tips.map(tip => {
        const canonicalKey = tip.toLowerCase();
        
        // Determinar defaults
        let defLevel = 1;
        let defComplexity = 1;
        
        for (const k in defaultLevels) {
            if (canonicalKey.includes(k)) {
                defLevel = defaultLevels[k];
                defComplexity = defaultComplexities[k];
                break;
            }
        }

        // Si es software o VPN
        if (canonicalKey.includes('software') || canonicalKey.includes('vpn') || canonicalKey.includes('outlook') || canonicalKey.includes('virtual') || canonicalKey.includes('reparacion')) {
            defLevel = 2;
            defComplexity = 4;
            if (canonicalKey.includes('reparacion')) defComplexity = 5;
        }

        // Cargar guardados o usar defaults
        const rule = savedRules[canonicalKey] || {};
        let selectedLevels = [];
        if (rule.niveles !== undefined) {
            selectedLevels = rule.niveles.map(x => parseInt(x));
        } else if (rule.nivel !== undefined) {
            selectedLevels = [parseInt(rule.nivel)];
        } else {
            selectedLevels = [defLevel];
        }
        const complexityN1Val = rule.complexity_n1 !== undefined ? parseInt(rule.complexity_n1) : (rule.complexity !== undefined ? parseInt(rule.complexity) : defComplexity);
        const complexityN2Val = rule.complexity_n2 !== undefined ? parseInt(rule.complexity_n2) : (rule.complexity !== undefined ? parseInt(rule.complexity) : defComplexity);

        return `
            <tr class="rule-row" data-key="${escapeHtml(canonicalKey)}" style="border-bottom:1px solid var(--border-soft); height:48px;">
                <td style="padding:8px 12px; font-weight:500;">${escapeHtml(tip)}</td>
                <td style="padding:8px 12px;">
                    <div style="display: flex; gap: 16px; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 4px; font-weight: 500; cursor: pointer; user-select: none; margin: 0;">
                            <input type="checkbox" class="rule-lvl-1" value="1" ${selectedLevels.includes(1) ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> N1
                        </label>
                        <label style="display: flex; align-items: center; gap: 4px; font-weight: 500; cursor: pointer; user-select: none; margin: 0;">
                            <input type="checkbox" class="rule-lvl-2" value="2" ${selectedLevels.includes(2) ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> N2
                        </label>
                    </div>
                </td>
                <td style="padding:8px 12px;">
                    <input type="number" class="rule-complexity-n1" min="1" max="5" value="${complexityN1Val}" style="width:60px; padding:4px 8px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-deep); color:var(--text); font-family:inherit;">
                    <span style="font-size:11px; color:var(--text-faint); margin-left:4px;">pts</span>
                </td>
                <td style="padding:8px 12px;">
                    <input type="number" class="rule-complexity-n2" min="1" max="5" value="${complexityN2Val}" style="width:60px; padding:4px 8px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-deep); color:var(--text); font-family:inherit;">
                    <span style="font-size:11px; color:var(--text-faint); margin-left:4px;">pts</span>
                </td>
            </tr>
        `;
    }).join('');
}

function renderLogs(logs) {
    const container = document.getElementById('dispatcherLogsContainer');
    if (!container) return;

    if (!logs || logs.length === 0) {
        container.textContent = 'Sin logs registrados en esta sesión.';
        return;
    }

    container.textContent = logs.join('\n');
    container.scrollTop = container.scrollHeight; // Auto-scroll to bottom
}

// 5. Action Handlers
async function toggleTechAvailability(userId, selectedVal) {
    try {
        const intVal = parseInt(selectedVal) || 1;
        const r = await fetch(`/api/dispatcher/tech-status/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disponible: intVal })
        });
        if (r.ok) {
            toast('Estado del técnico actualizado', 'success');
            
            // Si el técnico que modificamos somos nosotros mismos, sincronizar el dropdown
            if (userId === window.currentUser?.id) {
                await loadSelfAvailability();
            }
            
            await loadDispatcherDashboard(true);
        } else {
            toast('Error al actualizar estado del técnico', 'error');
        }
    } catch (err) {
        console.error("Error toggling tech availability:", err);
        toast('Error al actualizar estado del técnico', 'error');
    }
}

async function saveDispatcherRules() {
    const rows = document.querySelectorAll('.rule-row');
    const rules = {};

    rows.forEach(row => {
        const key = row.dataset.key;
        const levels = [];
        if (row.querySelector('.rule-lvl-1').checked) levels.push(1);
        if (row.querySelector('.rule-lvl-2').checked) levels.push(2);
        
        // Default to [1] if none are selected
        if (levels.length === 0) levels.push(1);
        
        const complexity_n1 = parseInt(row.querySelector('.rule-complexity-n1').value) || 1;
        const complexity_n2 = parseInt(row.querySelector('.rule-complexity-n2').value) || 1;
        rules[key] = { niveles: levels, complexity_n1, complexity_n2 };
    });

    try {
        const r = await fetch('/api/dispatcher/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rules })
        });
        if (r.ok) {
            toast('Reglas de asignación guardadas', 'success');
            await loadDispatcherDashboard(true);
        } else {
            toast('Error al guardar reglas', 'error');
        }
    } catch (err) {
        console.error("Error saving dispatcher rules:", err);
        toast('Error al guardar reglas', 'error');
    }
}

async function runDispatcherNow() {
    const btn = document.getElementById('btnDispatcherRunNow');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin" style="width:14px;height:14px;"></i> Ejecutando...`;
        renderIcons();
    }

    try {
        const r = await fetch('/api/dispatcher/run', { method: 'POST' });
        if (r.ok) {
            toast('Ejecutando ronda de asignación...', 'success');
            
            // Poll logs dynamically after 2 seconds to show output
            setTimeout(async () => {
                await loadDispatcherDashboard(true);
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `<i data-lucide="play" style="width:14px;height:14px;"></i> Forzar Ronda`;
                    renderIcons();
                }
            }, 2000);
        } else {
            const err = await r.json();
            toast(err.error || 'Error al forzar asignación', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i data-lucide="play" style="width:14px;height:14px;"></i> Forzar Ronda`;
                renderIcons();
            }
        }
    } catch (err) {
        console.error("Error running dispatcher:", err);
        toast('Error al forzar asignación', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="play" style="width:14px;height:14px;"></i> Forzar Ronda`;
            renderIcons();
        }
    }
}

// 6. Logs Auto Refresh Management
function startDispatcherAutoRefresh() {
    if (_dispatcherRefreshInterval) clearInterval(_dispatcherRefreshInterval);
    
    // Refresh logs, run status, and technician availability every 10s silent
    _dispatcherRefreshInterval = setInterval(async () => {
        try {
            const ts = Date.now();
            
            const [debugRes, statusRes] = await Promise.all([
                fetch(`/api/dispatcher/debug?_t=${ts}`).then(r => r.ok ? r.json() : {}),
                fetch(`/api/dispatcher/tech-status?_t=${ts}`).then(r => r.ok ? r.json() : [])
            ]);
            
            // Update last run info
            const lastRun = debugRes.lastRun;
            const runEl = document.getElementById('dispLastRun');
            if (runEl) runEl.textContent = lastRun ? formatFriendlyDate(lastRun) : 'Nunca';
            
            // Update logs
            if (debugRes.logs) {
                renderLogs(debugRes.logs);
            }
            
            // Update technician availability list
            if (statusRes) {
                renderTechStatus(statusRes);
            }
        } catch (err) {
            console.error("Auto refresh logs/status error:", err);
        }
    }, 10000);
}

function stopDispatcherAutoRefresh() {
    if (_dispatcherRefreshInterval) {
        clearInterval(_dispatcherRefreshInterval);
        _dispatcherRefreshInterval = null;
    }
}

// Utilities/Helpers
function formatFriendlyDate(isoString) {
    if (!isoString) return '—';
    try {
        const dt = new Date(isoString);
        if (isNaN(dt.getTime())) return isoString;
        
        const pad = (n) => String(n).padStart(2, '0');
        const d = pad(dt.getDate());
        const m = pad(dt.getMonth() + 1);
        const y = dt.getFullYear();
        const hr = pad(dt.getHours());
        const min = pad(dt.getMinutes());
        const sec = pad(dt.getSeconds());
        
        return `${d}/${m}/${y} ${hr}:${min}:${sec}`;
    } catch (e) {
        return isoString;
    }
}

// Global Exposing
window.loadSelfAvailability = loadSelfAvailability;
window.changeSelfAvailability = changeSelfAvailability;
window.initSelfAvailabilitySelectListener = initSelfAvailabilitySelectListener;
window.initDispatcher = initDispatcher;
window.startDispatcherAutoRefresh = startDispatcherAutoRefresh;
window.stopDispatcherAutoRefresh = stopDispatcherAutoRefresh;
window.toggleTechAvailability = toggleTechAvailability;
