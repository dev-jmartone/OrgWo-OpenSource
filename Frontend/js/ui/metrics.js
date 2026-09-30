// ============================================================
// METRICS DASHBOARD — Panel embebido en OrgWo (sin nueva pestaña)
// Requiere role === 'dispatcher' para mostrar datos.
// ============================================================

let _metricsInterval = null;
let _metricsUsersInterval = null;

// ── Helpers ──────────────────────────────────────────────────

function _fmt(n, dec = 1) {
    if (n === null || n === undefined || n === 'Error') return '—';
    return Number(n).toFixed(dec);
}

function _bar(percent, color = 'var(--primary)') {
    const p = Math.min(100, Math.max(0, percent || 0));
    const bg = p > 85 ? 'var(--danger)' : p > 65 ? 'var(--warn)' : color;
    return `<div style="background:var(--border);border-radius:99px;height:6px;overflow:hidden;margin-top:4px;">
        <div style="width:${p}%;height:100%;background:${bg};border-radius:99px;transition:width .5s;"></div>
    </div>`;
}

function _relTime(isoStr) {
    if (!isoStr) return '—';
    try {
        let normalized = isoStr;
        if (isoStr.indexOf(' ') > 0 && isoStr.indexOf('T') < 0) {
            normalized = isoStr.replace(' ', 'T');
        }
        const d = new Date(normalized.endsWith('Z') || normalized.indexOf('-0') > 0 || normalized.indexOf('+0') > 0 ? normalized : normalized + 'Z');
        if (isNaN(d.getTime())) {
            const dDirect = new Date(isoStr);
            if (isNaN(dDirect.getTime())) return isoStr;
            return dDirect.toLocaleDateString('es-AR');
        }
        const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
        if (isNaN(diffSec)) return isoStr;
        if (diffSec < 60) return `hace ${diffSec}s`;
        if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)}m`;
        if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)}h`;
        return d.toLocaleDateString('es-AR');
    } catch { return isoStr; }
}

function _logLevelBadge(level) {
    const map = { ERROR: 'var(--danger)', WARNING: 'var(--warn)', INFO: 'var(--primary)', DEBUG: 'var(--text-muted)' };
    const color = map[level] || 'var(--text-muted)';
    return `<span style="font-size:9px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.5px;border:1px solid ${color};border-radius:3px;padding:1px 4px;">${level}</span>`;
}

// ── Card builder ──────────────────────────────────────────────

function _card(title, icon, content, extra = '') {
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 16px;display:flex;flex-direction:column;gap:10px;${extra}">
        <div style="display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);">
            <i data-lucide="${icon}" style="width:13px;height:13px;"></i>${title}
        </div>
        ${content}
    </div>`;
}

function _statRow(label, value, sub = '') {
    return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--border-soft,rgba(128,128,128,.1));">
        <span style="color:var(--text-muted);">${label}</span>
        <span style="font-weight:600;color:var(--text);">${value}${sub ? `<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">${sub}</span>` : ''}</span>
    </div>`;
}

// ── Render sections ───────────────────────────────────────────

function _renderSystem(data) {
    return _card('Sistema', 'server',
        _statRow('CPU', `${_fmt(data.cpu_percent)}%`) + _bar(data.cpu_percent) +
        _statRow('RAM usada', `${_fmt(data.ram_percent)}%`, `(${_fmt(data.ram_rss_mb)} MB proceso)`) + _bar(data.ram_percent) +
        _statRow('Disco libre', `${_fmt(data.disk?.free_gb, 1)} GB`, `de ${_fmt(data.disk?.total_gb, 1)} GB`) + _bar(100 - (data.disk?.free_percent || 0)) +
        _statRow('Uptime', data.uptime || '—') +
        _statRow('Hilos activos', data.active_threads ?? '—') +
        _statRow('Entorno', data.environment || '—')
    );
}

function _renderDatabase(data) {
    const db = data.database || {};
    const bk = data.backup || {};
    const integrityColor = db.integrity === 'ok' ? 'var(--success)' : 'var(--danger)';
    return _card('Base de datos', 'database',
        _statRow('Latencia', db.latency_ms !== undefined ? `${_fmt(db.latency_ms, 2)} ms` : '—') +
        _statRow('Tamaño DB', `${_fmt(db.size_kb, 1)} KB`) +
        _statRow('WAL', `${db.wal_size_kb ?? 0} KB`) +
        _statRow('Casos', db.cases_count ?? '—') +
        _statRow('Eventos', db.events_count ?? '—') +
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--border-soft,rgba(128,128,128,.1));">
            <span style="color:var(--text-muted);">Integridad</span>
            <span style="font-weight:700;color:${integrityColor};">${db.integrity || '—'}</span>
         </div>` +
        _statRow('Último backup', bk.date || 'Ninguno', bk.size_mb ? `${bk.size_mb} MB` : '') +
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:4px 0;">
            <span style="color:var(--text-muted);">Estado backup</span>
            <span style="font-weight:600;color:${bk.status === 'Exitoso' ? 'var(--success)' : 'var(--warn)'};">${bk.status || '—'}</span>
         </div>`
    );
}

function _renderSecurity(data) {
    return _card('Seguridad', 'shield',
        _statRow('Logins fallidos (24h)', data.security?.failed_logins_24h ?? '—') +
        _statRow('Outlook GAL', data.outlook_status || '—') +
        _statRow('Scans en inbox', data.inbox?.files_count ?? '—') +
        _statRow('Requests totales', data.traffic?.requests_total ?? '—')
    );
}

function _renderTraffic(data) {
    const codes = data.traffic?.status_codes || {};
    const paths = data.traffic?.paths || {};
    const topPaths = Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const codesHtml = Object.entries(codes).map(([code, count]) => {
        const color = code.startsWith('2') ? 'var(--success)' : code.startsWith('4') ? 'var(--warn)' : code.startsWith('5') ? 'var(--danger)' : 'var(--text-muted)';
        return `<span style="font-size:10px;font-weight:700;color:${color};border:1px solid ${color};border-radius:3px;padding:1px 5px;">${code}: ${count}</span>`;
    }).join(' ');

    const pathsHtml = topPaths.map(([p, c]) =>
        `<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:3px 0;border-bottom:1px solid var(--border-soft,rgba(128,128,128,.1));">
            <code style="color:var(--text-muted);font-size:10.5px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p}</code>
            <span style="font-weight:600;color:var(--text);flex-shrink:0;margin-left:8px;">${c}</span>
         </div>`
    ).join('');

    return _card('Tráfico HTTP', 'activity',
        `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">${codesHtml || '<span style="color:var(--text-muted);font-size:12px;">Sin datos</span>'}</div>` +
        `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-faint);margin-bottom:4px;">Endpoints más usados</div>` +
        (pathsHtml || `<span style="color:var(--text-muted);font-size:12px;">Sin datos</span>`)
    );
}

function _renderOnlineUsers(users) {
    if (!users || users.length === 0) {
        return `<div style="color:var(--text-muted);font-size:12.5px;padding:8px 0;">Sin usuarios activos en los últimos 15 minutos.</div>`;
    }
    return users.map(u => {
        const displayName = u.name || u.username;
        const subInfo = u.name ? ` (${u.username})` : '';
        const orgRole = [u.organization, u.role].filter(Boolean).join(' · ') || '—';
        const actionHtml = u.last_action 
            ? `<div style="font-size: 10px; color: var(--primary); font-weight: 500; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(u.last_action_details || '')}">
                 Acción: <strong>${escapeHtml(u.last_action)}</strong>
               </div>` 
            : '';
        return `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-soft,rgba(128,128,128,.1));">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--primary);display:grid;place-items:center;font-size:10.5px;font-weight:700;color:#fff;flex-shrink:0;margin-top:2px;">
                ${(displayName || '?')[0].toUpperCase()}
            </div>
            <div style="flex:1;min-width:0;line-height:1.3;">
                <div style="font-size:12px;font-weight:600;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:4px;">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(displayName)}${escapeHtml(subInfo)}</span>
                    <span style="width:7px;height:7px;border-radius:50%;background:var(--success);flex-shrink:0;"></span>
                </div>
                <div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(orgRole)}</div>
                <div style="font-size:10px;color:var(--text-faint);">${escapeHtml(u.ip || '—')} · ${_relTime(u.last_seen)}</div>
                ${actionHtml}
            </div>
        </div>`;
    }).join('');
}

function _renderActionLogs(logs) {
    if (!logs || logs.length === 0) {
        return `<div style="color:var(--text-muted);font-size:12.5px;padding:8px 0;">Sin registros recientes.</div>`;
    }
    return `<div style="max-height:280px;overflow-y:auto;padding-right:4px;">` +
        logs.slice(0, 40).map(l => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-soft,rgba(128,128,128,.1));">
            <span style="font-size:10.5px;color:var(--text-muted);flex-shrink:0;width:65px;text-align:right;">${_relTime(l.timestamp)}</span>
            <span style="font-size:10.5px;font-weight:700;color:var(--primary);flex-shrink:0;min-width:110px;">${l.username || '—'}</span>
            <span style="font-size:10.5px;font-weight:600;color:var(--text);flex-shrink:0;min-width:80px;">${l.action || ''}</span>
            <span style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.details || ''}</span>
        </div>`).join('') +
    `</div>`;
}

function _renderServerLogs(logs) {
    if (!logs || logs.length === 0) {
        return `<div style="color:var(--text-muted);font-size:12.5px;padding:8px 0;">Sin logs en memoria.</div>`;
    }
    return `<div style="max-height:200px;overflow-y:auto;font-family:monospace;font-size:11px;padding-right:4px;">` +
        logs.slice(0, 30).map(l => `
        <div style="display:flex;align-items:flex-start;gap:6px;padding:3px 0;border-bottom:1px solid var(--border-soft,rgba(128,128,128,.1));">
            ${_logLevelBadge(l.level)}
            <span style="color:var(--text-muted);flex-shrink:0;">${l.time || ''}</span>
            <span style="color:var(--text);word-break:break-all;">${l.message || ''}</span>
        </div>`).join('') +
    `</div>`;
}

// ── Users CRUD ────────────────────────────────────────────────

let _usersData = [];

function _renderUsersTable(users) {
    _usersData = users || [];
    const tbody = document.getElementById('metricsUsersTbody');
    if (!tbody) return;
    if (!_usersData.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:16px;font-size:12.5px;">Sin usuarios registrados</td></tr>`;
        return;
    }
    tbody.innerHTML = _usersData.map(u => `
        <tr data-user-id="${u.id}">
            <td style="font-weight:600;font-size:12.5px;">${u.username}</td>
            <td style="font-size:12.5px;">${u.name}</td>
            <td style="font-size:12.5px;">${u.email}</td>
            <td style="font-size:12.5px;">${u.organization}</td>
            <td><span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;${(u.role || '').toLowerCase() === 'dispatcher' ? 'background:rgba(59,130,246,.15);color:var(--primary);' : 'background:var(--surface-2);color:var(--text-muted);'}">${u.role}</span></td>
            <td><span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:var(--surface-2);color:var(--text-muted);">N${u.nivel || 1}</span></td>
            <td style="text-align:center;">
                <button onclick="metricsEditUser('${u.id}')" style="background:transparent;border:1px solid var(--border);border-radius:var(--radius);padding:3px 8px;cursor:pointer;font-size:11px;color:var(--text);margin-right:4px;" title="Editar">
                    <i data-lucide="pencil" style="width:12px;height:12px;"></i>
                </button>
                <button onclick="metricsDeleteUser('${u.id}','${u.username}')" style="background:transparent;border:1px solid var(--danger);border-radius:var(--radius);padding:3px 8px;cursor:pointer;font-size:11px;color:var(--danger);" title="Eliminar">
                    <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                </button>
            </td>
        </tr>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function _loadUsers() {
    try {
        const res = await fetch('/api/secret/users', { credentials: 'include' });
        if (!res.ok) return;
        const users = await res.json();
        _renderUsersTable(users);
    } catch (e) {
        console.error('[metrics] Error loading users:', e);
    }
}

window.metricsEditUser = function(userId) {
    const user = _usersData.find(u => u.id == userId);
    if (!user) return;

    const overlay = document.getElementById('metricsUserEditOverlay');
    if (!overlay) return;

    document.getElementById('metricsEditUserId').value = user.id;
    document.getElementById('metricsEditUsername').value = user.username;
    document.getElementById('metricsEditName').value = user.name;
    document.getElementById('metricsEditEmail').value = user.email;
    document.getElementById('metricsEditOrg').value = user.organization;
    document.getElementById('metricsEditRole').value = user.role_id || 1;
    document.getElementById('metricsEditNivel').value = user.nivel || 1;
    document.getElementById('metricsEditPassword').value = '';
    document.getElementById('metricsEditError').style.display = 'none';
    overlay.classList.add('open');
};

window.metricsDeleteUser = async function(userId, username) {
    const confirmed = await Swal.fire({
        title: `¿Eliminar a "${username}"?`,
        text: 'Esta acción no se puede deshacer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--danger)',
    });
    if (!confirmed.isConfirmed) return;
    try {
        const res = await fetch(`/api/secret/users/${userId}`, { method: 'DELETE', credentials: 'include' });
        const data = await res.json();
        if (data.ok) {
            toast('Usuario eliminado', 'success');
            _loadUsers();
        } else {
            toast(data.error || 'Error al eliminar', 'error');
        }
    } catch (e) {
        toast('Error de red', 'error');
    }
};

// ── Main fetch & render ───────────────────────────────────────

async function loadMetricsDashboard() {
    const container = document.getElementById('view-metrics');
    if (!container) return;

    const setHtml = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };
    const setText = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    };

    // Spinner + ocultar contenido SOLO en la primera carga. En los refrescos
    // (cada 15s) los valores se actualizan in-place; no se recarga el esqueleto.
    const spinner = document.getElementById('metricsLoadingSpinner');
    const content = document.getElementById('metricsContent');
    // El layout (cards con "—") se muestra siempre y hace de skeleton: los valores
    // se rellenan al llegar los datos. Sin spinner full que bloquee o quede fijo.
    if (spinner) spinner.style.display = 'none';
    if (content) content.style.display = 'block';

    try {
        const res = await fetch('/api/secret/metrics', { credentials: 'include' });
        if (res.status === 404) {
            if (spinner) spinner.style.display = 'none';
            if (content) {
                content.style.display = 'block';
                content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Sin acceso a métricas.</div>`;
            }
            return;
        }
        const data = await res.json();

        // Rellenar las cards estáticas
        // Rellenar las cards estáticas
        const cpuTrackerStr = data.process_cpu_percent !== undefined ? `<span style="font-size:11px;color:var(--text-muted);font-weight:normal;margin-left:4px;">(tracker: ${_fmt(data.process_cpu_percent)}%)</span>` : '';
        setHtml('mSysCpu', `${_fmt(data.cpu_percent)}%${cpuTrackerStr}` + _bar(data.cpu_percent));
        
        // CPU Cores
        const coresEl = document.getElementById('mSysCpuCores');
        if (coresEl && data.cpu_cores && data.cpu_cores.length > 0) {
            coresEl.innerHTML = data.cpu_cores.map((val, idx) => {
                const bg = val > 85 ? 'var(--danger)' : val > 65 ? 'var(--warn)' : 'var(--primary)';
                return `<div style="flex:1;height:12px;background:var(--border-soft, rgba(128,128,128,0.1));border-radius:2px;position:relative;" title="Core ${idx}: ${val}%">
                    <div style="position:absolute;bottom:0;left:0;right:0;height:${val}%;background:${bg};border-radius:2px;transition:height .3s;"></div>
                </div>`;
            }).join('');
        } else if (coresEl) {
            coresEl.innerHTML = '';
        }

        const ramDetailsStr = (data.ram_used_gb !== undefined && data.ram_total_gb !== undefined) 
            ? `<span style="font-size:11px;color:var(--text-muted);font-weight:normal;margin-left:4px;">(sistema: ${_fmt(data.ram_used_gb)} GB / ${_fmt(data.ram_total_gb)} GB · tracker: ${_fmt(data.ram_rss_mb)} MB)</span>`
            : `<span style="font-size:11px;color:var(--text-muted);font-weight:normal;margin-left:4px;">(tracker: ${_fmt(data.ram_rss_mb)} MB)</span>`;
        setHtml('mSysRam', `${_fmt(data.ram_percent)}% ${ramDetailsStr}` + _bar(data.ram_percent));
        setHtml('mSysDisk', `${_fmt(data.disk?.free_gb, 1)} GB libre` + _bar(100 - (data.disk?.free_percent || 0), 'var(--success)'));
        setText('mSysUptime', data.uptime || '—');
        setText('mSysOsUptime', data.os_uptime || '—');
        setText('mSysThreads', data.active_threads ?? '—');
        setText('mSysEnv', data.environment || '—');

        // Top procesos
        const topProcEl = document.getElementById('mSysTopProcesses');
        if (topProcEl && data.top_processes && data.top_processes.length > 0) {
            topProcEl.innerHTML = `
                <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text-faint); margin-bottom: 6px;">Top Procesos (por RAM)</div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    ${data.top_processes.map(p => `
                        <div style="display: flex; justify-content: space-between; font-size: 11px;">
                            <span style="color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 155px;" title="PID ${p.pid}: ${escapeHtml(p.name)}">
                                <code>${p.pid}</code> ${escapeHtml(p.name)}
                            </span>
                            <span style="font-weight: 600; color: var(--text);">
                                ${_fmt(p.ram_mb, 0)} MB <span style="font-size: 9.5px; color: var(--text-muted); font-weight: normal; margin-left: 2px;">(${p.cpu}%)</span>
                            </span>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (topProcEl) {
            topProcEl.innerHTML = '';
        }

        // Umbrales e Indicadores HSL de Salud - Sistema
        let sysColor = 'var(--success)';
        let sysShadow = '0 0 6px var(--success)';
        if (data.cpu_percent > 85 || data.ram_percent > 90 || (data.disk && data.disk.free_percent < 10)) {
            sysColor = 'var(--danger)';
            sysShadow = '0 0 6px var(--danger)';
        } else if (data.cpu_percent > 65 || data.ram_percent > 80 || (data.disk && data.disk.free_percent < 20)) {
            sysColor = 'var(--warn)';
            sysShadow = '0 0 6px var(--warn)';
        }
        const sysDot = document.getElementById('mSysStatusDot');
        if (sysDot) {
            sysDot.style.backgroundColor = sysColor;
            sysDot.style.boxShadow = sysShadow;
        }

        const db = data.database || {};
        setText('mDbLatency', db.latency_ms !== undefined ? `${_fmt(db.latency_ms, 2)} ms` : '—');
        setText('mDbSize', `${_fmt(db.size_kb, 1)} KB`);
        setText('mDbWal', `${db.wal_size_kb ?? 0} KB`);
        setText('mDbCases', db.cases_count ?? '—');
        setText('mDbEvents', db.events_count ?? '—');
        
        // Integridad y check completo programado
        const intEl = document.getElementById('mDbIntegrity');
        if (intEl) {
            let lastCheckedStr = ' (completo: pendiente)';
            if (db.integrity_last_checked) {
                let normChecked = db.integrity_last_checked;
                if (normChecked.indexOf(' ') > 0 && normChecked.indexOf('T') < 0) {
                    normChecked = normChecked.replace(' ', 'T');
                }
                const parsed = new Date(normChecked.endsWith('Z') || normChecked.indexOf('-0') > 0 || normChecked.indexOf('+0') > 0 ? normChecked : normChecked + 'Z');
                if (!isNaN(parsed.getTime())) {
                    lastCheckedStr = ` (completo: ${parsed.toLocaleDateString('es-AR')})`;
                } else {
                    const parsedDirect = new Date(db.integrity_last_checked);
                    if (!isNaN(parsedDirect.getTime())) {
                        lastCheckedStr = ` (completo: ${parsedDirect.toLocaleDateString('es-AR')})`;
                    } else {
                        lastCheckedStr = ` (completo: ${db.integrity_last_checked})`;
                    }
                }
            }
            intEl.textContent = `${db.integrity_quick || '—'}${lastCheckedStr}`;
            intEl.style.color = db.integrity === 'ok' && db.integrity_quick === 'ok' ? 'var(--success)' : 'var(--danger)';
        }

        const bk = data.backup || {};
        setText('mDbBackupDate', bk.date || 'Ninguno');
        const bkStatus = document.getElementById('mDbBackupStatus');
        if (bkStatus) {
            bkStatus.textContent = bk.status || '—';
            bkStatus.style.color = bk.status === 'Exitoso' ? 'var(--success)' : 'var(--warn)';
        }

        // Umbrales e Indicadores HSL de Salud - DB
        let dbColor = 'var(--success)';
        let dbShadow = '0 0 6px var(--success)';
        if (db.integrity !== 'ok' || db.integrity_quick !== 'ok' || bk.status === 'Error' || (db.latency_ms !== 'Error' && db.latency_ms > 150)) {
            dbColor = 'var(--danger)';
            dbShadow = '0 0 6px var(--danger)';
        } else if ((db.latency_ms !== 'Error' && db.latency_ms > 50) || bk.status === 'Sin copias') {
            dbColor = 'var(--warn)';
            dbShadow = '0 0 6px var(--warn)';
        }
        const dbDot = document.getElementById('mDbStatusDot');
        if (dbDot) {
            dbDot.style.backgroundColor = dbColor;
            dbDot.style.boxShadow = dbShadow;
        }

        const sec = data.security || {};
        setText('mSecFailed', sec.failed_logins_24h ?? '—');
        
        const outlookVal = data.outlook_status || '—';
        const latencyVal = data.outlook_gal_latency_ms !== undefined && data.outlook_gal_latency_ms >= 0 
            ? ` (${_fmt(data.outlook_gal_latency_ms, 0)} ms GAL)` 
            : '';
        setText('mSecOutlook', outlookVal + latencyVal);
        
        setText('mSecInbox', data.inbox?.files_count ?? '—');
        
        const reqsTotal = data.traffic?.requests_total ?? '—';
        const rate5xxVal = data.traffic?.rate_5xx !== undefined && data.traffic.rate_5xx > 0 
            ? ` (${data.traffic.rate_5xx}% error 5xx)` 
            : '';
        setText('mTrafficTotal', reqsTotal + rate5xxVal);

        // Umbrales e Indicadores HSL de Salud - Seguridad
        const failedCount = sec.failed_logins_24h || 0;
        const hasConcurrent = sec.concurrent_sessions && sec.concurrent_sessions.length > 0;
        const outlookActive = data.outlook_status && data.outlook_status.startsWith('Activo');
        let secColor = 'var(--success)';
        let secShadow = '0 0 6px var(--success)';
        if (hasConcurrent || failedCount >= 5) {
            secColor = 'var(--danger)';
            secShadow = '0 0 6px var(--danger)';
        } else if (failedCount > 0 || !outlookActive) {
            secColor = 'var(--warn)';
            secShadow = '0 0 6px var(--warn)';
        }
        const secDot = document.getElementById('mSecStatusDot');
        if (secDot) {
            secDot.style.backgroundColor = secColor;
            secDot.style.boxShadow = secShadow;
        }
        const secAlertDot = document.getElementById('mSecAlertDot');
        if (secAlertDot) {
            secAlertDot.style.backgroundColor = secColor;
            secAlertDot.style.boxShadow = secShadow;
        }

        // Renderizar lista de IPs sospechosas en Auditoría de Seguridad
        const failedIpsEl = document.getElementById('mSecFailedIps');
        if (failedIpsEl) {
            const ips = sec.failed_logins_by_ip || [];
            if (ips.length === 0) {
                failedIpsEl.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:12px 0;">Sin sospechas</div>`;
            } else {
                failedIpsEl.innerHTML = ips.map(item => `
                    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft,rgba(128,128,128,.1));">
                        <code style="color:var(--text-muted);">${item.ip}</code>
                        <span style="font-weight:700;color:var(--danger);">${item.count} fallas</span>
                    </div>
                `).join('');
            }
        }

        // Alerta de sesiones concurrentes
        const concurrentAlert = document.getElementById('mSecConcurrentAlert');
        const concurrentList = document.getElementById('mSecConcurrentUserList');
        if (concurrentAlert && concurrentList) {
            const sessions = sec.concurrent_sessions || [];
            if (sessions.length > 0) {
                concurrentAlert.style.display = 'flex';
                concurrentList.innerHTML = sessions.map(item => `
                    <div><strong>${item.username}</strong> desde: <code>${item.ips.join(', ')}</code></div>
                `).join('');
            } else {
                concurrentAlert.style.display = 'none';
                concurrentList.innerHTML = '';
            }
        }

        // Traffic codes
        const codes = data.traffic?.status_codes || {};
        const codesEl = document.getElementById('mTrafficCodes');
        if (codesEl) {
            codesEl.innerHTML = Object.entries(codes).map(([code, count]) => {
                const color = code.startsWith('2') ? 'var(--success)' : code.startsWith('4') ? 'var(--warn)' : code.startsWith('5') ? 'var(--danger)' : 'var(--text-muted)';
                return `<span style="font-size:10px;font-weight:700;color:${color};border:1px solid ${color};border-radius:3px;padding:1px 5px;">${code}: ${count}</span>`;
            }).join(' ') || '<span style="color:var(--text-muted);font-size:11px;">Sin datos</span>';
        }

        // Top paths
        const paths = data.traffic?.paths || {};
        const topPaths = Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const pathsEl = document.getElementById('mTrafficPaths');
        if (pathsEl) {
            pathsEl.innerHTML = topPaths.map(([p, c]) =>
                `<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:3px 0;border-bottom:1px solid var(--border-soft,rgba(128,128,128,.1));">
                    <code style="color:var(--text-muted);font-size:10.5px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p}</code>
                    <span style="font-weight:600;color:var(--text);flex-shrink:0;margin-left:8px;">${c}</span>
                 </div>`
            ).join('') || '<span style="color:var(--text-muted);font-size:11px;">Sin datos</span>';
        }

        // Online users
        const usersEl = document.getElementById('mOnlineUsers');
        if (usersEl) usersEl.innerHTML = _renderOnlineUsers(data.active_users);

        // Badge
        const badge = document.getElementById('mOnlineBadge');
        if (badge) badge.textContent = (data.active_users || []).length;

        // Action logs
        const logsEl = document.getElementById('mActionLogs');
        if (logsEl) logsEl.innerHTML = _renderActionLogs(data.action_logs);

        // Server logs
        const srvEl = document.getElementById('mServerLogs');
        if (srvEl) srvEl.innerHTML = _renderServerLogs(data.latest_logs);

        // Last updated
        const tsEl = document.getElementById('mLastUpdated');
        if (tsEl) tsEl.textContent = new Date().toLocaleTimeString('es-AR');

        // Render telemetry trends
        _renderTelemetryChart(data.telemetry_history);

        // Fetch and render Dispatcher status
        try {
            const dispRes = await fetch('/api/dispatcher/status', { credentials: 'include' });
            if (dispRes.ok) {
                const dispData = await dispRes.json();
                const dot = document.getElementById('mDispatcherStatusDot');
                const btn = document.getElementById('btnDispatcherToggle');
                const sel = document.getElementById('selectDispatcherInterval');
                const selRound = document.getElementById('selectDispatcherMaxRound');
                const selTech = document.getElementById('selectDispatcherMaxTech');
                const lastRun = document.getElementById('mDispatcherLastRun');
                
                if (dot && btn && sel && lastRun) {
                    sel.value = dispData.interval;
                    if (selRound && dispData.maxRound !== undefined) selRound.value = dispData.maxRound;
                    if (selTech && dispData.maxTech !== undefined) selTech.value = dispData.maxTech;
                    lastRun.textContent = dispData.lastRun ? _relTime(dispData.lastRun) : '—';
                    if (dispData.lastRun) {
                        lastRun.title = dispData.lastRun;
                    }
                    
                    if (dispData.active) {
                        dot.style.backgroundColor = 'var(--success)';
                        dot.style.boxShadow = '0 0 6px var(--success)';
                        btn.innerHTML = '<i data-lucide="toggle-right" style="width:14px;height:14px;color:var(--success);"></i> <span style="color:var(--success);font-weight:600;">Activo</span>';
                    } else {
                        dot.style.backgroundColor = 'var(--danger)';
                        dot.style.boxShadow = '0 0 6px var(--danger)';
                        btn.innerHTML = '<i data-lucide="toggle-left" style="width:14px;height:14px;color:var(--text-muted);"></i> <span>Inactivo</span>';
                    }
                }
            }
        } catch (dispErr) {
            console.error('[metrics] Error fetch dispatcher status:', dispErr);
        }

        if (content) content.style.display = 'block';

        // Re-render lucide icons (no-op despues de la primera, ya son SVG).
        if (typeof lucide !== 'undefined') lucide.createIcons();

    } catch (e) {
        console.error('[metrics] Error:', e);
        if (spinner) spinner.style.display = 'none';
        if (content) {
            content.style.display = 'block';
            content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);">Error al cargar métricas: ${e.message}</div>`;
        }
    }
}

// ── Auto-refresh ──────────────────────────────────────────────

function startMetricsAutoRefresh() {
    stopMetricsAutoRefresh();
    loadMetricsDashboard();
    _metricsInterval = setInterval(loadMetricsDashboard, 5000);
    _metricsUsersInterval = setInterval(_loadUsers, 20000);
    _loadUsers();
}

function stopMetricsAutoRefresh() {
    if (_metricsInterval) { clearInterval(_metricsInterval); _metricsInterval = null; }
    if (_metricsUsersInterval) { clearInterval(_metricsUsersInterval); _metricsUsersInterval = null; }
}

// ── User edit form handlers ───────────────────────────────────

function _initUserEditModal() {
    const overlay = document.getElementById('metricsUserEditOverlay');
    if (!overlay) return;

    document.getElementById('metricsEditCancelBtn')?.addEventListener('click', () => {
        overlay.classList.remove('open');
    });

    document.getElementById('metricsEditSaveBtn')?.addEventListener('click', async () => {
        const userId = document.getElementById('metricsEditUserId').value;
        const errEl = document.getElementById('metricsEditError');
        errEl.style.display = 'none';

        const payload = {
            name: document.getElementById('metricsEditName').value.trim(),
            email: document.getElementById('metricsEditEmail').value.trim(),
            organization: document.getElementById('metricsEditOrg').value.trim(),
            role_id: parseInt(document.getElementById('metricsEditRole').value),
            nivel: parseInt(document.getElementById('metricsEditNivel').value || '1'),
        };
        const pw = document.getElementById('metricsEditPassword').value.trim();
        if (pw) payload.password = pw;

        if (!payload.name || !payload.email || !payload.organization) {
            errEl.textContent = 'Nombre, email y organización son obligatorios.';
            errEl.style.display = 'block';
            return;
        }

        try {
            const res = await fetch(`/api/secret/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.ok) {
                toast('Usuario actualizado', 'success');
                overlay.classList.remove('open');
                _loadUsers();
            } else {
                errEl.textContent = data.error || 'Error al guardar';
                errEl.style.display = 'block';
            }
        } catch (e) {
            errEl.textContent = 'Error de red';
            errEl.style.display = 'block';
        }
    });

    document.getElementById('metricsCreateSaveBtn')?.addEventListener('click', async () => {
        const errEl = document.getElementById('metricsCreateError');
        errEl.style.display = 'none';

        const payload = {
            username: document.getElementById('metricsCreateUsername').value.trim().toLowerCase(),
            password: document.getElementById('metricsCreatePassword').value.trim(),
            name: document.getElementById('metricsCreateName').value.trim(),
            email: document.getElementById('metricsCreateEmail').value.trim(),
            organization: document.getElementById('metricsCreateOrg').value.trim(),
            role_id: parseInt(document.getElementById('metricsCreateRole').value),
            nivel: parseInt(document.getElementById('metricsCreateNivel').value || '1'),
        };

        if (!payload.username || !payload.password || !payload.name || !payload.email || !payload.organization) {
            errEl.textContent = 'Todos los campos son obligatorios.';
            errEl.style.display = 'block';
            return;
        }

        try {
            const res = await fetch('/api/secret/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.ok) {
                toast('Usuario creado', 'success');
                document.getElementById('metricsCreateOverlay').classList.remove('open');
                // Limpiar form
                ['metricsCreateUsername','metricsCreatePassword','metricsCreateName','metricsCreateEmail','metricsCreateOrg'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                _loadUsers();
            } else {
                errEl.textContent = data.error || 'Error al crear';
                errEl.style.display = 'block';
            }
        } catch (e) {
            errEl.textContent = 'Error de red';
            errEl.style.display = 'block';
        }
    });

    document.getElementById('metricsCreateCancelBtn')?.addEventListener('click', () => {
        document.getElementById('metricsCreateOverlay').classList.remove('open');
    });

    document.getElementById('btnMetricsCreateUser')?.addEventListener('click', () => {
        document.getElementById('metricsCreateError').style.display = 'none';
        document.getElementById('metricsCreateOverlay').classList.add('open');
    });

    document.getElementById('btnMetricsRefresh')?.addEventListener('click', () => {
        loadMetricsDashboard();
        _loadUsers();
    });
}

// ── Init ──────────────────────────────────────────────────────

function initMetrics() {
    _initUserEditModal();
}

function _renderTelemetryChart(history) {
    const container = document.getElementById('mTelemetryChart');
    if (!container) return;

    if (!history || history.length < 2) {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:12.5px;text-align:center;padding:40px 0;">Historial insuficiente para mostrar tendencias (mínimo 2 registros)</div>`;
        return;
    }

    const width = 1000;
    const height = 120;
    const paddingLeft = 40;
    const paddingRight = 10;
    const paddingTop = 10;
    const paddingBottom = 15;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const pointsCpu = [];
    const pointsRam = [];

    const n = history.length;
    for (let i = 0; i < n; i++) {
        const item = history[i];
        const x = paddingLeft + (i / (n - 1)) * chartWidth;
        
        const cpuVal = Math.min(100, Math.max(0, item.cpu_percent || 0));
        const ramVal = Math.min(100, Math.max(0, item.ram_percent || 0));
        
        const yCpu = height - paddingBottom - (cpuVal / 100) * chartHeight;
        const yRam = height - paddingBottom - (ramVal / 100) * chartHeight;

        pointsCpu.push(`${x.toFixed(1)},${yCpu.toFixed(1)}`);
        pointsRam.push(`${x.toFixed(1)},${yRam.toFixed(1)}`);
    }

    const dCpu = "M " + pointsCpu.join(" L ");
    const dRam = "M " + pointsRam.join(" L ");

    const dAreaCpu = `${dCpu} L ${paddingLeft + chartWidth},${height - paddingBottom} L ${paddingLeft},${height - paddingBottom} Z`;
    const dAreaRam = `${dRam} L ${paddingLeft + chartWidth},${height - paddingBottom} L ${paddingLeft},${height - paddingBottom} Z`;

    const svgHtml = `
        <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:100%;font-family:sans-serif;overflow:visible;">
            <defs>
                <linearGradient id="gradCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.15"/>
                    <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.0"/>
                </linearGradient>
                <linearGradient id="gradRam" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#10B981" stop-opacity="0.15"/>
                    <stop offset="100%" stop-color="#10B981" stop-opacity="0.0"/>
                </linearGradient>
            </defs>

            <!-- Grid Lines -->
            <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="var(--border-soft, rgba(128,128,128,0.15))" stroke-width="1" />
            <line x1="${paddingLeft}" y1="${height - paddingBottom - chartHeight * 0.5}" x2="${width - paddingRight}" y2="${height - paddingBottom - chartHeight * 0.5}" stroke="var(--border-soft, rgba(128,128,128,0.15))" stroke-width="1" stroke-dasharray="4,4" />
            <line x1="${paddingLeft}" y1="${paddingTop}" x2="${width - paddingRight}" y2="${paddingTop}" stroke="var(--border-soft, rgba(128,128,128,0.15))" stroke-width="1" stroke-dasharray="4,4" />

            <!-- Y Axis Labels -->
            <text x="${paddingLeft - 8}" y="${height - paddingBottom + 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">0%</text>
            <text x="${paddingLeft - 8}" y="${height - paddingBottom - chartHeight * 0.5 + 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">50%</text>
            <text x="${paddingLeft - 8}" y="${paddingTop + 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">100%</text>

            <!-- Areas (Gradients) -->
            <path d="${dAreaCpu}" fill="url(#gradCpu)" />
            <path d="${dAreaRam}" fill="url(#gradRam)" />

            <!-- Line paths -->
            <path d="${dCpu}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="${dRam}" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    `;

    container.innerHTML = svgHtml;
}

// Expose
window.loadMetricsDashboard = loadMetricsDashboard;
window.startMetricsAutoRefresh = startMetricsAutoRefresh;
window.stopMetricsAutoRefresh = stopMetricsAutoRefresh;
window.initMetrics = initMetrics;

window.toggleDispatcher = async function() {
    const btn = document.getElementById('btnDispatcherToggle');
    if (!btn) return;
    
    const isActive = btn.querySelector('span').textContent === 'Activo';
    const newState = !isActive;
    const interval = document.getElementById('selectDispatcherInterval').value;
    const maxRound = document.getElementById('selectDispatcherMaxRound')?.value || 3;
    const maxTech = document.getElementById('selectDispatcherMaxTech')?.value || 1;
    
    try {
        const res = await fetch('/api/dispatcher/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                active: newState, 
                interval: parseInt(interval),
                maxRound: parseInt(maxRound),
                maxTech: parseInt(maxTech)
            }),
            credentials: 'include'
        });
        if (res.ok) {
            loadMetricsDashboard();
        } else {
            const errData = await res.json();
            alert('Error: ' + (errData.error || 'No se pudo guardar la configuración'));
        }
    } catch (e) {
        console.error('Error toggling dispatcher:', e);
    }
};

window.updateDispatcherInterval = async function() {
    const btn = document.getElementById('btnDispatcherToggle');
    if (!btn) return;
    
    const isActive = btn.querySelector('span').textContent === 'Activo';
    const interval = document.getElementById('selectDispatcherInterval').value;
    const maxRound = document.getElementById('selectDispatcherMaxRound')?.value || 3;
    const maxTech = document.getElementById('selectDispatcherMaxTech')?.value || 1;
    
    try {
        const res = await fetch('/api/dispatcher/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                active: isActive, 
                interval: parseInt(interval),
                maxRound: parseInt(maxRound),
                maxTech: parseInt(maxTech)
            }),
            credentials: 'include'
        });
        if (res.ok) {
            loadMetricsDashboard();
        }
    } catch (e) {
        console.error('Error updating dispatcher interval:', e);
    }
};
