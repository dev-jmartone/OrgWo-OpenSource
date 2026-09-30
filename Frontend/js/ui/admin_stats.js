// ============================================================
// ADMIN REMEDY GROUP STATS — Vista de Estadísticas de Grupos
// Módulo exclusivo para administradores (role === 'dispatcher').
// Soporta los 3 grupos: TECNOLOGIA USUARIOS DT, CTU DT, TECNOLOGIA CELULARES.
// Incluye análisis detallado y anónimo de tickets JARVIS CHATBOT (Empresa Principal vs. Subsidiaria).
// ============================================================

let _statsFilter = {
    group: 'ALL',
    month: 'all',
    period: 'all',
    status: '',
    type: ''
};

let _adminStatsInitialized = false;
let _statsSyncPollTimer = null;
let _currentStatsData = null;
let _selectedBreakdownMonth = null;

// Formateador numérico
function _fmtNum(n) {
    if (n === null || n === undefined) return '0';
    return Number(n).toLocaleString('es-AR');
}

// ── Inicialización de la Vista ───────────────────────────────────────────────

function initAdminStats() {
    if (_adminStatsInitialized) return;
    _adminStatsInitialized = true;

    // Filtros de encabezado
    const selGroup = document.getElementById('statsFilterGroup');
    if (selGroup) {
        selGroup.addEventListener('change', (e) => {
            _statsFilter.group = e.target.value;
            loadAdminStats();
        });
    }

    const selMonth = document.getElementById('statsFilterMonth');
    if (selMonth) {
        selMonth.addEventListener('change', (e) => {
            _statsFilter.month = e.target.value;
            _selectedBreakdownMonth = (e.target.value !== 'all') ? e.target.value : null;
            loadAdminStats();
        });
    }

    const selPeriod = document.getElementById('statsFilterPeriod');
    if (selPeriod) {
        selPeriod.addEventListener('change', (e) => {
            _statsFilter.period = e.target.value;
            loadAdminStats();
        });
    }

    const selStatus = document.getElementById('statsFilterStatus');
    if (selStatus) {
        selStatus.addEventListener('change', (e) => {
            _statsFilter.status = e.target.value;
            loadAdminStats();
        });
    }

    const selType = document.getElementById('statsFilterType');
    if (selType) {
        selType.addEventListener('change', (e) => {
            _statsFilter.type = e.target.value;
            loadAdminStats();
        });
    }

    // Botones de acción
    const btnSync = document.getElementById('btnStatsStartSync');
    if (btnSync) {
        btnSync.addEventListener('click', () => openStatsSyncModal());
    }

    const btnRefresh = document.getElementById('btnStatsRefresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => loadAdminStats(true));
    }

    // Modal de Reporte por Empresa
    const btnOpenReport = document.getElementById('btnStatsOpenReport');
    if (btnOpenReport) {
        btnOpenReport.addEventListener('click', () => openStatsReportModal());
    }

    const btnReportClose = document.getElementById('btnStatsReportClose');
    if (btnReportClose) {
        btnReportClose.addEventListener('click', () => closeStatsReportModal());
    }

    const overlayReport = document.getElementById('statsReportOverlay');
    if (overlayReport) {
        overlayReport.addEventListener('click', (e) => {
            if (e.target === overlayReport) closeStatsReportModal();
        });
    }

    const repComp = document.getElementById('reportFilterCompany');
    if (repComp) {
        repComp.addEventListener('change', () => loadAndRenderReport());
    }

    const repMonth = document.getElementById('reportFilterMonth');
    if (repMonth) {
        repMonth.addEventListener('change', () => loadAndRenderReport());
    }

    const repStatus = document.getElementById('reportFilterStatus');
    if (repStatus) {
        repStatus.addEventListener('change', () => loadAndRenderReport());
    }

    const repType = document.getElementById('reportFilterType');
    if (repType) {
        repType.addEventListener('change', () => loadAndRenderReport());
    }

    const repOrigin = document.getElementById('reportFilterOrigin');
    if (repOrigin) {
        repOrigin.addEventListener('change', () => loadAndRenderReport());
    }

    const btnRepRefresh = document.getElementById('btnReportRefresh');
    if (btnRepRefresh) {
        btnRepRefresh.addEventListener('click', () => loadAndRenderReport());
    }

    const btnRepExcel = document.getElementById('btnReportExportExcel');
    if (btnRepExcel) {
        btnRepExcel.addEventListener('click', () => exportStatsReportExcel());
    }

    const btnRepExport = document.getElementById('btnReportExportCsv');
    if (btnRepExport) {
        btnRepExport.addEventListener('click', () => exportStatsReportCsv());
    }

    const btnRepCopy = document.getElementById('btnReportCopySummary');
    if (btnRepCopy) {
        btnRepCopy.addEventListener('click', () => copyReportSummary());
    }

    const btnCancel = document.getElementById('btnStatsCancelSync');
    if (btnCancel) {
        btnCancel.addEventListener('click', async () => {
            try {
                await API.cancelAdminStatsSync();
                if (typeof window.toast === 'function') window.toast('Cancelación solicitada', 'info');
            } catch (err) {
                console.error(err);
            }
        });
    }

    const btnClear = document.getElementById('btnStatsClearData');
    if (btnClear) {
        btnClear.addEventListener('click', () => confirmClearStats());
    }

    const btnResolveGal = document.getElementById('btnJarvisResolveGal');
    if (btnResolveGal) {
        btnResolveGal.addEventListener('click', async () => {
            const btnText = document.getElementById('btnJarvisResolveGalText');
            const originalText = btnText ? btnText.textContent : 'Resolver con Outlook (GAL)';
            try {
                if (btnText) btnText.textContent = 'Resolviendo en GAL...';
                btnResolveGal.disabled = true;
                if (typeof window.toast === 'function') {
                    window.toast('Consultando Libreta de Outlook (GAL) para identificar usuarios...', 'info');
                }
                const res = await API.resolveAdminStatsGal();
                if (typeof window.toast === 'function') {
                    window.toast(`Resolución completada: ${res.updated_tickets || 0} tickets actualizados (${res.resolved_empresa || 0} Empresa Principal, ${res.resolved_subsidiaria || 0} Subsidiaria)`, 'success');
                }
                await loadAdminStats(true);
            } catch (err) {
                console.error(err);
                if (typeof window.toast === 'function') {
                    window.toast(`Error al resolver con Outlook: ${err.message}`, 'error');
                }
            } finally {
                btnResolveGal.disabled = false;
                if (btnText) btnText.textContent = originalText;
            }
        });
    }

    // Acciones de la sección de desglose mensual
    const btnCloseDetail = document.getElementById('btnMonthlyCloseDetail');
    if (btnCloseDetail) {
        btnCloseDetail.addEventListener('click', () => {
            const card = document.getElementById('monthlyDetailCard');
            if (card) card.style.display = 'none';
            _selectedBreakdownMonth = null;
        });
    }

    const btnFilterThisMonth = document.getElementById('btnMonthlyFilterThisMonth');
    if (btnFilterThisMonth) {
        btnFilterThisMonth.addEventListener('click', () => {
            if (_selectedBreakdownMonth) {
                const sel = document.getElementById('statsFilterMonth');
                if (sel) sel.value = _selectedBreakdownMonth;
                _statsFilter.month = _selectedBreakdownMonth;
                loadAdminStats();
            }
        });
    }

    // Comprobar si hay una sincronización en marcha al entrar
    checkActiveSyncStatus();
}


// ── Carga de Datos desde API ─────────────────────────────────────────────────

async function loadAdminStats(forceRefreshUI = false) {
    const spinner = document.getElementById('statsLoadingSpinner');
    const content = document.getElementById('statsMainContent');
    const emptyState = document.getElementById('statsEmptyState');

    if (spinner && (!content || content.style.display === 'none')) {
        spinner.style.display = 'flex';
    }

    try {
        const res = await API.getAdminStats({
            group: _statsFilter.group,
            month: _statsFilter.month,
            period: _statsFilter.period,
            status: _statsFilter.status,
            type: _statsFilter.type
        });

        if (!res || !res.ok || !res.data) {
            throw new Error(res?.error || 'No se recibieron datos de estadísticas');
        }

        _currentStatsData = res.data;
        populateMonthSelector(res.data.available_months || []);
        renderAdminStatsUI(res.data);

        if (spinner) spinner.style.display = 'none';
        if (content) content.style.display = 'block';
        if (emptyState) {
            emptyState.style.display = (res.data.kpis?.total_tickets === 0 && res.data.sync_info?.total_cached_tickets === 0) ? 'block' : 'none';
        }

        if (forceRefreshUI && typeof window.toast === 'function') {
            window.toast('Estadísticas actualizadas', 'success');
        }
    } catch (err) {
        console.error('[admin_stats] Error al cargar:', err);
        if (spinner) spinner.style.display = 'none';
        if (typeof window.toast === 'function') {
            window.toast('Error cargando estadísticas: ' + err.message, 'error');
        }
    }
}


// ── Renderizado Principal de la UI ───────────────────────────────────────────

function renderAdminStatsUI(data) {
    const kpis = data.kpis || {};
    const jarvis = data.jarvis || {};
    const groups = data.groups || [];
    const technicians = data.technicians || [];
    const elements = data.elements || [];
    const statuses = data.statuses || [];
    const syncInfo = data.sync_info || {};

    // 1. Tarjetas de KPIs Principales
    document.getElementById('statTotalTickets').textContent = _fmtNum(kpis.total_tickets);
    document.getElementById('statOpenTickets').textContent = _fmtNum(kpis.open_tickets);
    document.getElementById('statClosedTickets').textContent = _fmtNum(kpis.closed_tickets);
    document.getElementById('statIncWoRatio').textContent = `${_fmtNum(kpis.inc_tickets)} INC · ${_fmtNum(kpis.wo_tickets)} WO`;
    document.getElementById('statJarvisTotal').textContent = _fmtNum(kpis.jarvis_tickets);

    // Metadata de sincronización
    const lblLastSync = document.getElementById('statsLastSyncTime');
    if (lblLastSync) {
        if (syncInfo.last_sync_date) {
            try {
                const d = new Date(syncInfo.last_sync_date);
                lblLastSync.textContent = `Última sincronización: ${d.toLocaleString('es-AR')}`;
            } catch {
                lblLastSync.textContent = `Última sincronización: ${syncInfo.last_sync_date}`;
            }
        } else {
            lblLastSync.textContent = 'Sin sincronizaciones previas';
        }
    }

    const lblTotalCached = document.getElementById('statsTotalCachedCount');
    if (lblTotalCached) {
        lblTotalCached.textContent = `${_fmtNum(syncInfo.total_cached_tickets)} tickets en caché local`;
    }

    // 2. Módulo Especial: JARVIS CHATBOT (Empresa Principal vs. Subsidiaria)
    renderJarvisSection(jarvis);

    // 3. Desglose Mensual: Empresa Principal vs. Subsidiaria y Tipificaciones
    renderMonthlyBreakdownSection(data.monthly_breakdown || [], data.available_months || [], data.selected_month || 'all');

    // 4. Tabla y Gráficos de los 3 Grupos Asignados
    renderGroupsSection(groups, kpis.total_tickets);

    // 4. Carga por Técnico
    renderTechniciansSection(technicians);

    // 5. Tipología de Hardware / Elementos
    renderElementsSection(elements, kpis.total_tickets);

    // 6. Distribución por Estado
    renderStatusesSection(statuses, kpis.total_tickets);

    // Renderizar iconos de Lucide
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}


// ── Render: JARVIS CHATBOT (Empresa Principal vs. Subsidiaria) ───────────────────────────────

function renderJarvisSection(jarvis) {
    const totalJ = jarvis.total_jarvis || 0;
    const empresaCount = jarvis.empresa_count || 0;
    const subsidiariaCount = jarvis.subsidiaria_count || 0;
    const otherCount = jarvis.other_count || 0;

    const empresaPct = jarvis.empresa_percentage || 0;
    const subsidiariaPct = jarvis.subsidiaria_percentage || 0;
    const otherPct = jarvis.other_percentage || 0;

    document.getElementById('jarvisCountTotal').textContent = _fmtNum(totalJ);
    document.getElementById('jarvisCountEmpresa Principal').textContent = _fmtNum(empresaCount);
    document.getElementById('jarvisPctEmpresa Principal').textContent = `${empresaPct}%`;

    document.getElementById('jarvisCountSubsidiaria').textContent = _fmtNum(subsidiariaCount);
    document.getElementById('jarvisPctSubsidiaria').textContent = `${subsidiariaPct}%`;

    document.getElementById('jarvisCountOther').textContent = _fmtNum(otherCount);
    document.getElementById('jarvisPctOther').textContent = `${otherPct}%`;

    document.getElementById('jarvisOpenClosedRatio').textContent = 
        `${_fmtNum(jarvis.open_jarvis || 0)} abiertos · ${_fmtNum(jarvis.closed_jarvis || 0)} resueltos`;

    // Barra de distribución visual Empresa Principal vs Subsidiaria vs Otros
    const barEmpresa Principal = document.getElementById('jarvisBarEmpresa Principal');
    const barSubsidiaria = document.getElementById('jarvisBarSubsidiaria');
    const barOther = document.getElementById('jarvisBarOther');

    if (barEmpresa Principal) barEmpresa Principal.style.width = `${empresaPct}%`;
    if (barSubsidiaria) barSubsidiaria.style.width = `${subsidiariaPct}%`;
    if (barOther) barOther.style.width = `${otherPct}%`;
}


// ── Selector de Meses ────────────────────────────────────────────────────────

function populateMonthSelector(availableMonths) {
    const sel = document.getElementById('statsFilterMonth');
    if (!sel) return;

    const currentVal = _statsFilter.month || 'all';
    let html = '<option value="all">Todos los meses</option>';

    if (availableMonths && availableMonths.length > 0) {
        availableMonths.forEach(m => {
            const selected = (m.key === currentVal) ? 'selected' : '';
            html += `<option value="${m.key}" ${selected}>${m.label} (${_fmtNum(m.count)})</option>`;
        });
    }

    sel.innerHTML = html;
    sel.value = currentVal;
}


// ── Render: Desglose y Evolución Mensual (Empresa Principal vs Subsidiaria y Tipificaciones) ──

function renderMonthlyBreakdownSection(monthlyBreakdown, availableMonths, selectedMonth) {
    const tbody = document.getElementById('monthlySummaryTbody');
    const tabsContainer = document.getElementById('monthlyTabsContainer');
    const badge = document.getElementById('monthlyActiveBadge');

    // 1. Badge de estado activo
    if (badge) {
        if (selectedMonth && selectedMonth !== 'all') {
            const found = (availableMonths || []).find(m => m.key === selectedMonth);
            badge.textContent = found ? found.label : selectedMonth;
            badge.style.background = 'rgba(0,120,212,0.15)';
            badge.style.color = 'var(--primary)';
        } else {
            badge.textContent = 'Todos los meses';
            badge.style.background = 'rgba(128,128,128,0.12)';
            badge.style.color = 'var(--text-muted)';
        }
    }

    // 2. Render de Tabs rápidos de meses
    if (tabsContainer) {
        let tabsHtml = `
            <button type="button" class="btn btn-sm ${(!selectedMonth || selectedMonth === 'all') ? 'btn-primary' : 'btn-ghost'}" 
                    style="height: 26px; font-size: 11.5px; padding: 2px 10px; border-radius: 14px;" 
                    onclick="setStatsMonthFilter('all')">
                Todos
            </button>
        `;
        (availableMonths || []).forEach(m => {
            const isSel = (m.key === selectedMonth);
            tabsHtml += `
                <button type="button" class="btn btn-sm ${isSel ? 'btn-primary' : 'btn-ghost'}" 
                        style="height: 26px; font-size: 11.5px; padding: 2px 10px; border-radius: 14px; border: 1px solid var(--border);" 
                        onclick="setStatsMonthFilter('${m.key}')" 
                        title="${m.count} tickets">
                    ${m.label.split(' ')[0]} <span style="opacity:0.75;font-size:10px;">'${m.label.split(' ')[1]?.slice(-2) || ''}</span>
                </button>
            `;
        });
        tabsContainer.innerHTML = tabsHtml;
    }

    // 3. Render de la Tabla Resumen Mes a Mes
    if (tbody) {
        if (!monthlyBreakdown || monthlyBreakdown.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">Sin datos de meses en el período seleccionado</td></tr>';
            const detailCard = document.getElementById('monthlyDetailCard');
            if (detailCard) detailCard.style.display = 'none';
            return;
        }

        let html = '';
        monthlyBreakdown.forEach((m) => {
            const empresa = m.empresa || {};
            const subsidiaria = m.subsidiaria || {};
            const other = m.other || {};

            const isCurrentActive = (_selectedBreakdownMonth === m.month_key) || (selectedMonth === m.month_key);
            const rowBg = isCurrentActive ? 'background: rgba(0,120,212,0.06);' : '';

            // Top 3 tipificaciones del mes combinadas (para mostrar en la tabla)
            const topTips = [];
            const combinedElements = {};
            [empresa, subsidiaria, other].forEach(c => {
                (c.element_types || []).forEach(el => {
                    combinedElements[el.name] = (combinedElements[el.name] || 0) + el.count;
                });
            });
            Object.entries(combinedElements)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .forEach(([name, count]) => {
                    topTips.push(`<span style="background:var(--surface-2);border:1px solid var(--border);padding:1px 6px;border-radius:10px;font-size:11px;color:var(--text);">${name} <strong>${count}</strong></span>`);
                });

            const topTipsHtml = topTips.length > 0 ? topTips.join(' ') : '<span style="color:var(--text-faint);font-size:11px;">—</span>';

            html += `
                <tr style="border-bottom: 1px solid var(--border-soft); ${rowBg}" data-month="${m.month_key}">
                    <td style="padding: 10px 12px; font-weight: 700; color: var(--text);">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <i data-lucide="calendar" style="width: 13px; height: 13px; color: var(--primary);"></i>
                            <span>${m.month_name}</span>
                        </div>
                    </td>
                    <td style="padding: 10px 12px; text-align: center; font-weight: 800; font-size: 13.5px; color: var(--text);">
                        ${_fmtNum(m.total)}
                    </td>
                    <td style="padding: 10px 12px; text-align: center;">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 3px;">
                            <div style="display: flex; align-items: center; gap: 6px; justify-content: center;">
                                <span style="font-weight: 700; color: #0078D4;">${_fmtNum(empresa.total)}</span>
                                <span style="font-size: 11px; color: var(--text-muted);">(${empresa.percentage}%)</span>
                            </div>
                            <div style="width: 70px; height: 4px; background: var(--border); border-radius: 99px; overflow: hidden;">
                                <div style="width: ${Math.min(100, empresa.percentage || 0)}%; height: 100%; background: #0078D4;"></div>
                            </div>
                        </div>
                    </td>
                    <td style="padding: 10px 12px; text-align: center;">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 3px;">
                            <div style="display: flex; align-items: center; gap: 6px; justify-content: center;">
                                <span style="font-weight: 700; color: #8764B8;">${_fmtNum(subsidiaria.total)}</span>
                                <span style="font-size: 11px; color: var(--text-muted);">(${subsidiaria.percentage}%)</span>
                            </div>
                            <div style="width: 70px; height: 4px; background: var(--border); border-radius: 99px; overflow: hidden;">
                                <div style="width: ${Math.min(100, subsidiaria.percentage || 0)}%; height: 100%; background: #8764B8;"></div>
                            </div>
                        </div>
                    </td>
                    <td style="padding: 10px 12px; text-align: center; font-size: 12px; color: var(--text-muted);">
                        ${_fmtNum(other.total)} <span style="font-size: 10.5px;">(${other.percentage}%)</span>
                    </td>
                    <td style="padding: 10px 12px; text-align: left;">
                        <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                            ${topTipsHtml}
                        </div>
                    </td>
                    <td style="padding: 10px 12px; text-align: center;">
                        <div style="display: flex; align-items: center; gap: 4px; justify-content: center;">
                            <button type="button" class="btn btn-secondary btn-sm" 
                                    style="height: 26px; font-size: 11.5px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 4px;" 
                                    onclick="showMonthlyDetail('${m.month_key}')" 
                                    title="Ver tipificaciones detalladas de Empresa Principal y Subsidiaria en este mes">
                                <i data-lucide="eye" style="width: 12px; height: 12px;"></i> Tipificaciones
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }

    // 4. Si hay un mes seleccionado o activo, renderizar su ficha de detalle
    const targetMonthKey = _selectedBreakdownMonth || (selectedMonth !== 'all' ? selectedMonth : (monthlyBreakdown[0]?.month_key || null));
    if (targetMonthKey) {
        const monthObj = monthlyBreakdown.find(m => m.month_key === targetMonthKey);
        if (monthObj) {
            renderMonthlyDetailCard(monthObj);
        }
    }
}


// ── Render: Ficha Detallada de Tipificaciones del Mes (Empresa Principal vs Subsidiaria) ──────

function renderMonthlyDetailCard(m) {
    const card = document.getElementById('monthlyDetailCard');
    if (!card || !m) return;

    _selectedBreakdownMonth = m.month_key;
    card.style.display = 'block';

    // Header info
    const title = document.getElementById('monthlyDetailTitle');
    if (title) title.textContent = `Tipificaciones de Tickets — ${m.month_name}`;

    const totalBadge = document.getElementById('monthlyDetailTotalBadge');
    if (totalBadge) totalBadge.textContent = `${_fmtNum(m.total)} tickets (${_fmtNum(m.open)} abiertos · ${_fmtNum(m.closed)} cerrados)`;

    // EMPRESA PRINCIPAL
    const empresa = m.empresa || {};
    const lblEmpresa PrincipalTot = document.getElementById('monthlyDetailEmpresa PrincipalTotal');
    if (lblEmpresa PrincipalTot) lblEmpresa PrincipalTot.textContent = `${_fmtNum(empresa.total)} tickets (${empresa.percentage}% del mes)`;

    const empresaElementsEl = document.getElementById('monthlyDetailEmpresa PrincipalElements');
    if (empresaElementsEl) {
        if (!empresa.element_types || empresa.element_types.length === 0) {
            empresaElementsEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Sin tipificaciones registradas</div>';
        } else {
            let elHtml = '';
            empresa.element_types.forEach(item => {
                elHtml += `
                    <div style="font-size: 12px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                            <span style="font-weight: 600; color: var(--text);">${item.name}</span>
                            <span style="color: var(--text-muted);"><strong>${_fmtNum(item.count)}</strong> (${item.percentage}%)</span>
                        </div>
                        <div style="width: 100%; height: 5px; background: var(--border); border-radius: 99px; overflow: hidden;">
                            <div style="width: ${Math.min(100, item.percentage)}%; height: 100%; background: #0078D4; border-radius: 99px;"></div>
                        </div>
                    </div>
                `;
            });
            empresaElementsEl.innerHTML = elHtml;
        }
    }

    const empresaTiersBlock = document.getElementById('monthlyDetailEmpresa PrincipalTiersBlock');
    const empresaTiersEl = document.getElementById('monthlyDetailEmpresa PrincipalTiers');
    if (empresaTiersBlock && empresaTiersEl) {
        if (empresa.tipificaciones && empresa.tipificaciones.length > 0) {
            empresaTiersBlock.style.display = 'block';
            let tHtml = '';
            empresa.tipificaciones.slice(0, 8).forEach(item => {
                tHtml += `
                    <div style="display: flex; justify-content: space-between; font-size: 11.5px; padding: 2px 0;">
                        <span style="color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 210px;" title="${item.name}">${item.name}</span>
                        <span style="font-weight: 700; color: #0078D4;">${_fmtNum(item.count)}</span>
                    </div>
                `;
            });
            empresaTiersEl.innerHTML = tHtml;
        } else {
            empresaTiersBlock.style.display = 'none';
        }
    }

    // SUBSIDIARIA
    const subsidiaria = m.subsidiaria || {};
    const lblSubsidiariaTot = document.getElementById('monthlyDetailSubsidiariaTotal');
    if (lblSubsidiariaTot) lblSubsidiariaTot.textContent = `${_fmtNum(subsidiaria.total)} tickets (${subsidiaria.percentage}% del mes)`;

    const subsidiariaElementsEl = document.getElementById('monthlyDetailSubsidiariaElements');
    if (subsidiariaElementsEl) {
        if (!subsidiaria.element_types || subsidiaria.element_types.length === 0) {
            subsidiariaElementsEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Sin tipificaciones registradas</div>';
        } else {
            let elHtml = '';
            subsidiaria.element_types.forEach(item => {
                elHtml += `
                    <div style="font-size: 12px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                            <span style="font-weight: 600; color: var(--text);">${item.name}</span>
                            <span style="color: var(--text-muted);"><strong>${_fmtNum(item.count)}</strong> (${item.percentage}%)</span>
                        </div>
                        <div style="width: 100%; height: 5px; background: var(--border); border-radius: 99px; overflow: hidden;">
                            <div style="width: ${Math.min(100, item.percentage)}%; height: 100%; background: #8764B8; border-radius: 99px;"></div>
                        </div>
                    </div>
                `;
            });
            subsidiariaElementsEl.innerHTML = elHtml;
        }
    }

    const subsidiariaTiersBlock = document.getElementById('monthlyDetailSubsidiariaTiersBlock');
    const subsidiariaTiersEl = document.getElementById('monthlyDetailSubsidiariaTiers');
    if (subsidiariaTiersBlock && subsidiariaTiersEl) {
        if (subsidiaria.tipificaciones && subsidiaria.tipificaciones.length > 0) {
            subsidiariaTiersBlock.style.display = 'block';
            let tHtml = '';
            subsidiaria.tipificaciones.slice(0, 8).forEach(item => {
                tHtml += `
                    <div style="display: flex; justify-content: space-between; font-size: 11.5px; padding: 2px 0;">
                        <span style="color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 210px;" title="${item.name}">${item.name}</span>
                        <span style="font-weight: 700; color: #8764B8;">${_fmtNum(item.count)}</span>
                    </div>
                `;
            });
            subsidiariaTiersEl.innerHTML = tHtml;
        } else {
            subsidiariaTiersBlock.style.display = 'none';
        }
    }

    // FOOTER (Otros y Grupos)
    const other = m.other || {};
    const otherEl = document.getElementById('monthlyDetailOtherText');
    if (otherEl) {
        otherEl.textContent = `Otros / No determinado: ${_fmtNum(other.total)} tickets (${other.percentage}%)`;
    }

    const groupsEl = document.getElementById('monthlyDetailGroupsText');
    if (groupsEl && m.groups) {
        const gParts = m.groups.map(g => `${g.group_name}: ${_fmtNum(g.total)}`);
        groupsEl.textContent = `Grupos del mes: ${gParts.join(' · ')}`;
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}


// ── Render: Los 3 Grupos Asignados ───────────────────────────────────────────

function renderGroupsSection(groups, grandTotal) {
    const tbody = document.getElementById('statsGroupsTbody');
    if (!tbody) return;

    if (!groups || groups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">Sin datos para los grupos</td></tr>';
        return;
    }

    let html = '';
    groups.forEach(g => {
        const pct = g.percentage || (grandTotal > 0 ? ((g.total / grandTotal) * 100).toFixed(1) : 0);
        html += `
            <tr style="border-bottom: 1px solid var(--border-soft, rgba(128,128,128,0.1));">
                <td style="padding: 10px 12px; font-weight: 600; color: var(--text);">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--primary);"></span>
                        <span>${g.group_name}</span>
                    </div>
                </td>
                <td style="padding: 10px 12px; text-align: center; font-weight: 700; font-size: 13.5px;">${_fmtNum(g.total)}</td>
                <td style="padding: 10px 12px; text-align: center;">
                    <div style="display: flex; align-items: center; gap: 6px; justify-content: center;">
                        <span style="font-size: 12px; font-weight: 600;">${pct}%</span>
                        <div style="width: 60px; height: 5px; background: var(--border); border-radius: 99px; overflow: hidden;">
                            <div style="width: ${Math.min(100, pct)}%; height: 100%; background: var(--primary);"></div>
                        </div>
                    </div>
                </td>
                <td style="padding: 10px 12px; text-align: center; color: var(--info); font-weight: 600;">${_fmtNum(g.open)}</td>
                <td style="padding: 10px 12px; text-align: center; color: var(--success); font-weight: 600;">${_fmtNum(g.closed)}</td>
                <td style="padding: 10px 12px; text-align: center; font-size: 12px; color: var(--text-muted);">${_fmtNum(g.inc)} / ${_fmtNum(g.wo)}</td>
                <td style="padding: 10px 12px; text-align: center;">
                    <span style="background: rgba(92,45,145,0.1); color: var(--accent); padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 11px;">
                        ${_fmtNum(g.jarvis_total)}
                    </span>
                </td>
                <td style="padding: 10px 12px; text-align: center; font-size: 11px;">
                    <span style="color: #0078D4; font-weight: 600;" title="Empresa Principal">${_fmtNum(g.jarvis_empresa)}</span> / 
                    <span style="color: #8764B8; font-weight: 600;" title="Subsidiaria">${_fmtNum(g.jarvis_subsidiaria)}</span>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}


// ── Render: Carga por Técnico ────────────────────────────────────────────────

function renderTechniciansSection(techs) {
    const list = document.getElementById('statsTechList');
    if (!list) return;

    if (!techs || techs.length === 0) {
        list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">No hay técnicos registrados</div>';
        return;
    }

    const maxTotal = Math.max(...techs.map(t => t.total), 1);
    let html = '';

    techs.forEach(t => {
        const pct = ((t.total / maxTotal) * 100).toFixed(0);
        const isUnassigned = t.name.toLowerCase().includes('sin asignar');
        const color = isUnassigned ? 'var(--warn)' : 'var(--primary)';

        html += `
            <div style="padding: 6px 0; border-bottom: 1px solid var(--border-soft, rgba(128,128,128,0.08));">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; margin-bottom: 3px;">
                    <span style="font-weight: 600; color: ${isUnassigned ? 'var(--warn)' : 'var(--text)'}; display: flex; align-items: center; gap: 6px;">
                        <i data-lucide="${isUnassigned ? 'help-circle' : 'user'}" style="width: 13px; height: 13px;"></i>
                        ${t.name}
                    </span>
                    <span style="font-size: 11.5px; color: var(--text-muted);">
                        <strong>${_fmtNum(t.total)}</strong> <span style="font-size: 10px;">(${_fmtNum(t.open)} ab. / ${_fmtNum(t.closed)} cer.)</span>
                    </span>
                </div>
                <div style="width: 100%; height: 5px; background: var(--border); border-radius: 99px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 99px;"></div>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}


// ── Render: Elementos / Hardware ─────────────────────────────────────────────

function renderElementsSection(elements, total) {
    const list = document.getElementById('statsElementsList');
    if (!list) return;

    if (!elements || elements.length === 0) {
        list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">Sin tipificaciones de elementos</div>';
        return;
    }

    const iconMap = {
        'pc': 'laptop',
        'celular': 'smartphone',
        'vincha': 'headphones',
        'kit': 'keyboard',
        'monitor': 'monitor',
        'cargador': 'zap',
        'red / conectividad': 'wifi',
        'software / configuración': 'settings'
    };

    let html = '';
    elements.forEach(el => {
        const pct = total > 0 ? ((el.count / total) * 100).toFixed(1) : 0;
        const icon = iconMap[el.element_type.toLowerCase()] || 'box';

        html += `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-soft, rgba(128,128,128,0.08)); font-size: 12.5px;">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 120px;">
                    <i data-lucide="${icon}" style="width: 14px; height: 14px; color: var(--primary);"></i>
                    <span style="text-transform: capitalize; color: var(--text);">${el.element_type}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; min-width: 140px; justify-content: flex-end;">
                    <div style="width: 70px; height: 5px; background: var(--border); border-radius: 99px; overflow: hidden;">
                        <div style="width: ${Math.min(100, pct * 2)}%; height: 100%; background: var(--primary);"></div>
                    </div>
                    <span style="font-weight: 700; min-width: 35px; text-align: right;">${_fmtNum(el.count)}</span>
                    <span style="font-size: 10.5px; color: var(--text-muted); min-width: 35px; text-align: right;">${pct}%</span>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}


// ── Render: Estados ──────────────────────────────────────────────────────────

function renderStatusesSection(statuses, total) {
    const list = document.getElementById('statsStatusesList');
    if (!list) return;

    if (!statuses || statuses.length === 0) {
        list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">Sin datos de estados</div>';
        return;
    }

    const colorMap = {
        '1': 'var(--st-assigned, #038387)',
        '2': 'var(--st-contact, #0078D4)',
        '3': 'var(--st-wait, #C19C00)',
        '4': 'var(--st-done, #107C10)'
    };

    let html = '';
    statuses.forEach(s => {
        const pct = total > 0 ? ((s.count / total) * 100).toFixed(1) : 0;
        const color = colorMap[s.status_code] || 'var(--primary)';

        html += `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-soft, rgba(128,128,128,0.08)); font-size: 12.5px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></span>
                    <span style="color: var(--text);">${s.status_name}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-weight: 700;">${_fmtNum(s.count)}</span>
                    <span style="font-size: 11px; color: var(--text-muted);">(${pct}%)</span>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}


// ── Modal de Configuración de Sincronización Fragmentada ──────────────────────

function openStatsSyncModal() {
    if (!window.remedyConnected) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: 'Conexión Requerida',
                text: 'Para sincronizar los tickets de los 3 grupos asignados desde WebCenter debes iniciar sesión en Remedy primero.',
                icon: 'warning',
                confirmButtonText: 'Conectar a Remedy',
                confirmButtonColor: 'var(--primary)',
                showCancelButton: true,
                cancelButtonText: 'Cancelar'
            }).then(res => {
                if (res.isConfirmed && typeof window.showRemedyLoginModal === 'function') {
                    window.showRemedyLoginModal();
                }
            });
        } else {
            alert('Debes conectar tu sesión de Remedy antes de sincronizar.');
        }
        return;
    }

    if (typeof Swal === 'undefined') {
        _triggerSyncNow({ days_back: 30, include_closed: true });
        return;
    }

    Swal.fire({
        title: 'Sincronizar Tickets de la Ticketera',
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.5; color: var(--text);">
                <div style="background: rgba(0,120,212,0.08); border-left: 3px solid var(--primary); padding: 10px 12px; border-radius: 4px; margin-bottom: 16px;">
                    <strong>Protección Anti-Saturación:</strong><br/>
                    Para evitar sobrecargar la API de WebCenter, la tarea se fragmenta en lotes de 100 registros 
                    para los 3 grupos asignados (<code>TECNOLOGIA USUARIOS DT</code>, <code>CTU DT</code>, <code>TECNOLOGIA CELULARES</code>).
                </div>

                <div style="margin-bottom: 14px;">
                    <label style="font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 4px;">
                        Rango temporal de tickets:
                    </label>
                    <select id="swalSyncDays" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-deep); color: var(--text); font-family: inherit;">
                        <option value="30" selected>Últimos 30 días (Rápido y recomendado)</option>
                        <option value="90">Últimos 90 días</option>
                        <option value="180">Últimos 180 días (Semestre)</option>
                        <option value="365">Último año (365 días)</option>
                        <option value="0">Histórico completo (Todo lo disponible)</option>
                    </select>
                </div>

                <div style="margin-bottom: 14px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;">
                        <input type="checkbox" id="swalSyncClosed" checked style="width: 16px; height: 16px; cursor: pointer;">
                        <span>Incluir tickets cerrados y resueltos (no solo abiertos)</span>
                    </label>
                </div>

                <div style="font-size: 11px; color: var(--text-faint);">
                    * La sincronización corre en segundo plano y podrás ver el progreso en tiempo real sin bloquear la pantalla.
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Comenzar Sincronización',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--primary)',
        preConfirm: () => {
            const daysVal = parseInt(document.getElementById('swalSyncDays').value, 10);
            const closedVal = document.getElementById('swalSyncClosed').checked;
            return {
                days_back: daysVal === 0 ? null : daysVal,
                include_closed: closedVal
            };
        }
    }).then(result => {
        if (result.isConfirmed && result.value) {
            _triggerSyncNow(result.value);
        }
    });
}

async function _triggerSyncNow(options) {
    try {
        const res = await API.startAdminStatsSync(options);
        if (typeof window.toast === 'function') {
            window.toast('Sincronización en lotes iniciada', 'info');
        }
        startPollingSyncStatus();
    } catch (err) {
        console.error('[admin_stats] Error starting sync:', err);
        if (typeof window.toast === 'function') {
            window.toast(err.message || 'Error al iniciar sincronización', 'error');
        }
    }
}


// ── Monitoreo de Progreso de Sincronización en Vivo ───────────────────────────

function startPollingSyncStatus() {
    if (_statsSyncPollTimer) clearInterval(_statsSyncPollTimer);
    updateSyncProgressBarUI({ is_syncing: true, progress_percent: 5, current_message: 'Iniciando conexión con WebCenter...' });

    _statsSyncPollTimer = setInterval(async () => {
        try {
            const status = await API.getAdminStatsSyncStatus();
            updateSyncProgressBarUI(status);

            if (!status.is_syncing) {
                clearInterval(_statsSyncPollTimer);
                _statsSyncPollTimer = null;

                if (status.status === 'completed') {
                    if (typeof window.toast === 'function') {
                        window.toast('Sincronización completada exitosamente', 'success');
                    }
                    loadAdminStats();
                } else if (status.status === 'error') {
                    if (typeof window.toast === 'function') {
                        window.toast(`Error en sincronización: ${status.error || 'Fallo desconocido'}`, 'error');
                    }
                } else if (status.status === 'cancelled') {
                    if (typeof window.toast === 'function') {
                        window.toast('Sincronización cancelada por el usuario', 'warn');
                    }
                    loadAdminStats();
                }
            }
        } catch (err) {
            console.error('[admin_stats] Poll error:', err);
        }
    }, 1500);
}

async function checkActiveSyncStatus() {
    try {
        const status = await API.getAdminStatsSyncStatus();
        if (status && status.is_syncing) {
            startPollingSyncStatus();
        } else {
            updateSyncProgressBarUI(status);
        }
    } catch (err) {
        // Silencioso
    }
}

function updateSyncProgressBarUI(status) {
    const banner = document.getElementById('statsSyncProgressBanner');
    if (!banner) return;

    if (status && status.is_syncing) {
        banner.style.display = 'block';
        const fill = document.getElementById('statsProgressBarFill');
        const text = document.getElementById('statsProgressText');
        const count = document.getElementById('statsProgressCount');

        const pct = Math.max(0, Math.min(100, status.progress_percent || 0));
        if (fill) fill.style.width = `${pct}%`;
        if (text) text.textContent = status.current_message || 'Procesando lotes...';
        if (count) count.textContent = `${_fmtNum(status.tickets_fetched || 0)} tickets acumulados (${pct}%)`;
    } else {
        banner.style.display = 'none';
    }
}


// ── Limpieza de Caché de Estadísticas ─────────────────────────────────────────

function confirmClearStats() {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: '¿Limpiar datos cacheados?',
            text: 'Se eliminarán los tickets descargados de la base local. Deberás volver a sincronizar para ver las estadísticas.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, limpiar datos',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--danger)',
        }).then(async (res) => {
            if (res.isConfirmed) {
                try {
                    await API.clearAdminStats();
                    if (typeof window.toast === 'function') window.toast('Datos limpiados', 'success');
                    loadAdminStats();
                } catch (err) {
                    if (typeof window.toast === 'function') window.toast(err.message, 'error');
                }
            }
        });
    } else {
        if (confirm('¿Limpiar datos cacheados?')) {
            API.clearAdminStats().then(() => loadAdminStats());
        }
    }
}


// Exponer globalmente
window.initAdminStats = initAdminStats;
window.loadAdminStats = loadAdminStats;
window.openStatsSyncModal = openStatsSyncModal;

window.showMonthlyDetail = function(monthKey) {
    if (!_currentStatsData || !_currentStatsData.monthly_breakdown) return;
    const found = _currentStatsData.monthly_breakdown.find(m => m.month_key === monthKey);
    if (found) {
        renderMonthlyDetailCard(found);
        const card = document.getElementById('monthlyDetailCard');
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
};

window.setStatsMonthFilter = function(monthKey) {
    const sel = document.getElementById('statsFilterMonth');
    if (sel) sel.value = monthKey;
    _statsFilter.month = monthKey;
    _selectedBreakdownMonth = (monthKey !== 'all') ? monthKey : null;
    loadAdminStats();
};


// ── Módulo de Reporte Total por Empresa (Extracción por Dominio) ──────────────

let _lastReportData = null;

function _esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function openStatsReportModal() {
    const overlay = document.getElementById('statsReportOverlay');
    if (!overlay) return;

    // Sincronizar meses disponibles en el selector
    const selMonth = document.getElementById('reportFilterMonth');
    if (selMonth) {
        const currentVal = selMonth.value || _statsFilter.month || 'all';
        const months = _currentStatsData?.available_months || [];
        selMonth.innerHTML = '<option value="all">Todos los meses (Histórico)</option>';
        months.forEach(m => {
            const mVal = m.key || m.month_key;
            if (!mVal || mVal === 'undefined') return;
            const opt = document.createElement('option');
            opt.value = mVal;
            opt.textContent = `${m.label || mVal} (${_fmtNum(m.count)} tickets)`;
            selMonth.appendChild(opt);
        });
        if (_statsFilter.month && _statsFilter.month !== 'all' && _statsFilter.month !== 'undefined') {
            selMonth.value = _statsFilter.month;
        } else if (currentVal && currentVal !== 'undefined') {
            selMonth.value = currentVal;
        } else {
            selMonth.value = 'all';
        }
    }

    const selStatus = document.getElementById('reportFilterStatus');
    if (selStatus && _statsFilter.status) selStatus.value = _statsFilter.status;

    const selType = document.getElementById('reportFilterType');
    if (selType && _statsFilter.type) selType.value = _statsFilter.type;

    overlay.classList.add('open');
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    loadAndRenderReport();
}

function closeStatsReportModal() {
    const overlay = document.getElementById('statsReportOverlay');
    if (overlay) overlay.classList.remove('open');
}

async function loadAndRenderReport() {
    const spinner = document.getElementById('reportLoadingSpinner');
    const container = document.getElementById('reportCardsContainer');
    const badge = document.getElementById('reportUniverseBadge');

    const companyVal = document.getElementById('reportFilterCompany')?.value || 'all';
    const monthVal = document.getElementById('reportFilterMonth')?.value || 'all';
    const statusVal = document.getElementById('reportFilterStatus')?.value || '';
    const typeVal = document.getElementById('reportFilterType')?.value || '';
    const originVal = document.getElementById('reportFilterOrigin')?.value || 'all';
    const groupVal = _statsFilter.group || 'ALL';

    if (spinner) spinner.style.display = 'flex';
    if (container) container.innerHTML = '';

    try {
        const res = await API.getAdminStatsReport({
            company: companyVal,
            month: monthVal,
            status: statusVal,
            type: typeVal,
            origin: originVal,
            group: groupVal
        });

        if (!res || !res.ok || !res.report) {
            throw new Error(res?.error || 'Error al obtener datos del reporte');
        }

        _lastReportData = res.report;

        // Si el selector de meses no tenía opciones cargadas, sincronizar con available_months del reporte
        if (res.report.available_months && res.report.available_months.length > 0) {
            const selM = document.getElementById('reportFilterMonth');
            if (selM && (selM.options.length <= 1 || selM.querySelector('option[value="undefined"]'))) {
                const cur = selM.value || monthVal;
                selM.innerHTML = '<option value="all">Todos los meses (Histórico)</option>';
                res.report.available_months.forEach(m => {
                    const mVal = m.key || m.month_key;
                    if (!mVal || mVal === 'undefined') return;
                    const opt = document.createElement('option');
                    opt.value = mVal;
                    opt.textContent = `${m.label || mVal} (${_fmtNum(m.count)} tickets)`;
                    selM.appendChild(opt);
                });
                if (cur && cur !== 'undefined') selM.value = cur;
            }
        }

        if (badge) {
            const univ = res.report.total_tickets_processed || 0;
            const mLabel = res.report.month_label || 'Histórico';
            badge.textContent = `${_fmtNum(univ)} tickets procesados (${mLabel})`;
        }

        renderReportCards(res.report);
    } catch (err) {
        console.error('[admin_stats] Error en reporte:', err);
        if (container) {
            container.innerHTML = `
                <div style="background:rgba(239,68,68,0.08);border:1px solid var(--danger);border-radius:var(--radius);padding:24px;text-align:center;color:var(--danger);">
                    <i data-lucide="alert-circle" style="width:28px;height:28px;margin-bottom:8px;"></i>
                    <div style="font-weight:700;font-size:14px;">Error al generar el reporte</div>
                    <div style="font-size:12.5px;color:var(--text);margin-top:4px;">${_esc(err.message || 'Error desconocido')}</div>
                </div>
            `;
        }
    } finally {
        if (spinner) spinner.style.display = 'none';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }
}

function renderReportCards(report) {
    const container = document.getElementById('reportCardsContainer');
    if (!container) return;
    container.innerHTML = '';

    const companies = report.companies_data || [];
    if (companies.length === 0) {
        container.innerHTML = `
            <div style="background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius-md);padding:36px;text-align:center;color:var(--text-muted);">
                <i data-lucide="info" style="width:32px;height:32px;color:var(--text-faint);margin-bottom:8px;"></i>
                <div style="font-weight:700;font-size:14px;color:var(--text);">No hay tickets encontrados para los filtros seleccionados</div>
                <div style="font-size:12px;margin-top:4px;">Intenta seleccionando "Todos los meses" o cambiando el filtro de estado.</div>
            </div>
        `;
        return;
    }

    companies.forEach(comp => {
        const isEmpresa Principal = comp.company_name === 'Empresa Principal';
        const brandColor = comp.brand_color || (isEmpresa Principal ? '#0078D4' : '#8764B8');
        const borderColor = isEmpresa Principal ? 'rgba(0,120,212,0.35)' : 'rgba(135,100,184,0.35)';
        const headerBg = isEmpresa Principal ? 'rgba(0,120,212,0.06)' : 'rgba(135,100,184,0.06)';

        const card = document.createElement('div');
        card.style.cssText = `background:var(--surface);border:2px solid ${borderColor};border-radius:var(--radius-md);overflow:hidden;box-shadow:var(--shadow-card);`;

        // 1. Header de Empresa
        let headerHtml = `
            <div style="padding:14px 18px;background:${headerBg};border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:${brandColor};display:inline-block;box-shadow:0 0 6px ${brandColor};"></span>
                    <div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <strong style="font-size:16px;color:${brandColor};letter-spacing:0.5px;">EMPRESA: ${comp.company_name.toUpperCase()}</strong>
                            <span style="font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:10px;background:var(--surface);border:1px solid ${borderColor};color:var(--text);">
                                Catalogado como: <strong style="color:${brandColor};">${comp.catalog_label}</strong>
                            </span>
                        </div>
                        <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">
                            Extracción por dominio de correo y campo Company Remedy en el período <strong>${_esc(report.month_label)}</strong>
                        </div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="text-align:right;">
                        <span style="font-size:18px;font-weight:800;color:var(--text);">${_fmtNum(comp.total_tickets)}</span>
                        <span style="font-size:12px;color:var(--text-muted);margin-left:4px;">tickets</span>
                        <div style="font-size:11px;font-weight:700;color:${brandColor};">${comp.percentage_of_universe}% del universo procesado</div>
                    </div>
                </div>
            </div>
        `;

        // Banner informativo y diagnóstico cuando los filtros arrojan 0 tickets
        let emptyNoticeHtml = '';
        if (comp.total_tickets === 0) {
            emptyNoticeHtml = `
                <div style="margin:16px 18px 0 18px;padding:14px 16px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.35);border-radius:var(--radius);display:flex;align-items:flex-start;gap:12px;">
                    <i data-lucide="alert-triangle" style="width:20px;height:20px;color:#f59e0b;flex-shrink:0;margin-top:2px;"></i>
                    <div style="font-size:12.5px;color:var(--text);line-height:1.5;">
                        <strong style="color:#d97706;font-size:13px;display:block;margin-bottom:4px;">No se encontraron tickets para ${comp.company_name} con los filtros seleccionados</strong>
                        <div style="color:var(--text-muted);margin-bottom:6px;">Recomendaciones para comprobar el volumen de tickets:</div>
                        <ul style="margin:0 0 0 18px;padding:0;color:var(--text-muted);font-size:12px;line-height:1.6;">
                            <li><strong>Tipo de ticket:</strong> Si filtraste por <em>Solo INC</em>, verifica si los tickets corresponden a <em>Work Orders (WO)</em> cambiando el filtro a <strong>"Todos (INC + WO)"</strong>.</li>
                            <li><strong>Canal / Origen:</strong> Si filtraste por <em>Solo JARVIS CHATBOT</em>, prueba seleccionando <strong>"Todos (Jarvis + Otros)"</strong> para ver el total ingresado por otros canales.</li>
                            <li><strong>Identificación de usuarios:</strong> Los tickets de Jarvis ingresan habitualmente a Remedy bajo el cliente corporativo principal y el solicitante real figura en la descripción. Si aún no tienen correo Subsidiaria vinculado, utiliza el botón <strong>"Resolver con Outlook (GAL)"</strong> en la pestaña de estadísticas para identificarlos en la libreta corporativa.</li>
                            <li><strong>Mes seleccionado:</strong> Si ese mes no tuvo actividad registrada, selecciona <strong>"Todos los meses (Histórico)"</strong> para consultar el total acumulado.</li>
                        </ul>
                    </div>
                </div>
            `;
        }

        // 2. Fila de KPIs
        let kpiHtml = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;padding:14px 18px;background:var(--surface-2);border-bottom:1px solid var(--border);">
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;">
                    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:var(--text-muted);">Total Tickets</div>
                    <div style="font-size:18px;font-weight:800;color:var(--text);margin-top:2px;">${_fmtNum(comp.total_tickets)}</div>
                </div>
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;">
                    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:var(--info);">Abiertos / En Gestión</div>
                    <div style="font-size:18px;font-weight:800;color:var(--info);margin-top:2px;">${_fmtNum(comp.open_tickets)}</div>
                </div>
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;">
                    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:var(--success);">Cerrados / Resueltos</div>
                    <div style="font-size:18px;font-weight:800;color:var(--success);margin-top:2px;">${_fmtNum(comp.closed_tickets)}</div>
                </div>
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;">
                    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:var(--text-muted);">Incidentes (INC)</div>
                    <div style="font-size:18px;font-weight:800;color:var(--text);margin-top:2px;">${_fmtNum(comp.inc_tickets)}</div>
                </div>
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;">
                    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:var(--text-muted);">Work Orders (WO)</div>
                    <div style="font-size:18px;font-weight:800;color:var(--text);margin-top:2px;">${_fmtNum(comp.wo_tickets)}</div>
                </div>
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;">
                    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:var(--accent);">Jarvis Chatbot</div>
                    <div style="font-size:18px;font-weight:800;color:var(--accent);margin-top:2px;">${_fmtNum(comp.jarvis_tickets)}</div>
                </div>
            </div>
        `;

        // 3. Tablas Detalladas (4 paneles: Datos Remedy, Dominios de Correo, Tipología Hardware, Categorizaciones)
        // Sub-panel 1: Datos Reales de Remedy
        let remedyCompsRows = '';
        if (comp.remedy_companies && comp.remedy_companies.length > 0) {
            remedyCompsRows = comp.remedy_companies.map(rc => `
                <tr style="border-bottom:1px solid var(--border-soft);">
                    <td style="padding:6px 10px;font-weight:600;color:var(--text);"><code>${_esc(rc.company)}</code></td>
                    <td style="padding:6px 10px;text-align:center;font-weight:700;">${_fmtNum(rc.count)}</td>
                    <td style="padding:6px 10px;text-align:right;width:110px;">
                        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
                            <div style="width:40px;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
                                <div style="width:${rc.percentage}%;height:100%;background:${brandColor};"></div>
                            </div>
                            <span style="font-size:11.5px;font-weight:700;">${rc.percentage}%</span>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            remedyCompsRows = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--text-muted);">Sin datos de Company</td></tr>';
        }

        // Sub-panel 2: Dominios de correo
        let domainsRows = '';
        if (comp.email_domains && comp.email_domains.length > 0) {
            domainsRows = comp.email_domains.map(ed => `
                <tr style="border-bottom:1px solid var(--border-soft);">
                    <td style="padding:6px 10px;font-weight:600;color:var(--text);">
                        ${ed.domain.includes('Sin dominio') 
                            ? `<span style="font-size:12px;color:var(--text-muted);" title="En Remedy estos tickets se registraron con el nombre del usuario y la empresa, pero sin email directo en el ticket">${_esc(ed.domain)} <span style="font-size:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:1px 5px;margin-left:4px;color:var(--text-muted);font-weight:600;">Remedy Nativo</span></span>`
                            : `<span style="font-family:monospace;font-size:12px;color:${brandColor};">${_esc(ed.domain)}</span>`
                        }
                    </td>
                    <td style="padding:6px 10px;text-align:center;font-weight:700;">${_fmtNum(ed.count)}</td>
                    <td style="padding:6px 10px;text-align:right;width:110px;">
                        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
                            <div style="width:40px;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
                                <div style="width:${ed.percentage}%;height:100%;background:${brandColor};"></div>
                            </div>
                            <span style="font-size:11.5px;font-weight:700;">${ed.percentage}%</span>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            domainsRows = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--text-muted);">Sin correos registrados</td></tr>';
        }

        // Sub-panel 3: Tipificación Hardware / Elemento
        let elementsRows = '';
        if (comp.element_types && comp.element_types.length > 0) {
            elementsRows = comp.element_types.map(et => `
                <tr style="border-bottom:1px solid var(--border-soft);">
                    <td style="padding:6px 10px;font-weight:600;color:var(--text);">${_esc(et.name)}</td>
                    <td style="padding:6px 10px;text-align:center;font-weight:700;">${_fmtNum(et.count)}</td>
                    <td style="padding:6px 10px;text-align:center;font-size:11.5px;color:var(--info);">${_fmtNum(et.open || 0)}</td>
                    <td style="padding:6px 10px;text-align:center;font-size:11.5px;color:var(--success);">${_fmtNum(et.closed || 0)}</td>
                    <td style="padding:6px 10px;text-align:right;width:100px;">
                        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
                            <div style="width:36px;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
                                <div style="width:${et.percentage}%;height:100%;background:${brandColor};"></div>
                            </div>
                            <span style="font-size:11.5px;font-weight:700;">${et.percentage}%</span>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            elementsRows = '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--text-muted);">Sin tipificaciones de elemento</td></tr>';
        }

        // Sub-panel 4: Categorizaciones Remedy
        let tipRows = '';
        if (comp.tipificaciones && comp.tipificaciones.length > 0) {
            tipRows = comp.tipificaciones.map(tp => `
                <tr style="border-bottom:1px solid var(--border-soft);">
                    <td style="padding:6px 10px;font-size:12px;color:var(--text);" title="${_esc(tp.name)}">
                        ${_esc(tp.name)}
                    </td>
                    <td style="padding:6px 10px;text-align:center;font-weight:700;width:70px;">${_fmtNum(tp.count)}</td>
                    <td style="padding:6px 10px;text-align:right;width:100px;">
                        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
                            <div style="width:36px;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
                                <div style="width:${tp.percentage}%;height:100%;background:${brandColor};"></div>
                            </div>
                            <span style="font-size:11.5px;font-weight:700;">${tp.percentage}%</span>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tipRows = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--text-muted);">Sin categorizaciones Remedy</td></tr>';
        }

        let panelsHtml = `
            <div style="padding:16px 18px;display:grid;grid-template-columns:repeat(auto-fit, minmax(460px, 1fr));gap:16px;">
                <!-- Panel A: Datos Reales Remedy -->
                <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;">
                    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                        <i data-lucide="building-2" style="width:13px;height:13px;color:${brandColor};"></i> Datos Reales Remedy (Campo Company)
                    </div>
                    <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius);background:var(--surface);">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead style="background:var(--surface-2);position:sticky;top:0;z-index:2;">
                                <tr style="border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600;text-align:left;">
                                    <th style="padding:6px 10px;">Empresa Remedy</th>
                                    <th style="padding:6px 10px;text-align:center;">Tickets</th>
                                    <th style="padding:6px 10px;text-align:right;">%</th>
                                </tr>
                            </thead>
                            <tbody>${remedyCompsRows}</tbody>
                        </table>
                    </div>
                </div>

                <!-- Panel B: Extracción por Dominio -->
                <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;">
                    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                        <i data-lucide="at-sign" style="width:13px;height:13px;color:${brandColor};"></i> Extracción por Dominio de Correo
                    </div>
                    <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius);background:var(--surface);">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead style="background:var(--surface-2);position:sticky;top:0;z-index:2;">
                                <tr style="border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600;text-align:left;">
                                    <th style="padding:6px 10px;">Dominio</th>
                                    <th style="padding:6px 10px;text-align:center;">Tickets</th>
                                    <th style="padding:6px 10px;text-align:right;">%</th>
                                </tr>
                            </thead>
                            <tbody>${domainsRows}</tbody>
                        </table>
                    </div>
                </div>

                <!-- Panel C: Tipificación Elemento / Hardware -->
                <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;">
                    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                        <i data-lucide="cpu" style="width:13px;height:13px;color:${brandColor};"></i> Tipificación por Elemento / Hardware
                    </div>
                    <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius);background:var(--surface);">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead style="background:var(--surface-2);position:sticky;top:0;z-index:2;">
                                <tr style="border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600;text-align:left;">
                                    <th style="padding:6px 10px;">Tipo Elemento</th>
                                    <th style="padding:6px 10px;text-align:center;">Total</th>
                                    <th style="padding:6px 10px;text-align:center;">Abiertos</th>
                                    <th style="padding:6px 10px;text-align:center;">Cerrados</th>
                                    <th style="padding:6px 10px;text-align:right;">%</th>
                                </tr>
                            </thead>
                            <tbody>${elementsRows}</tbody>
                        </table>
                    </div>
                </div>

                <!-- Panel D: Categorizaciones BMC Remedy -->
                <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;">
                    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                        <i data-lucide="tag" style="width:13px;height:13px;color:${brandColor};"></i> Categorizaciones Remedy (Tier 1 / 2 / 3)
                    </div>
                    <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius);background:var(--surface);">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead style="background:var(--surface-2);position:sticky;top:0;z-index:2;">
                                <tr style="border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600;text-align:left;">
                                    <th style="padding:6px 10px;">Categorización</th>
                                    <th style="padding:6px 10px;text-align:center;">Tickets</th>
                                    <th style="padding:6px 10px;text-align:right;">%</th>
                                </tr>
                            </thead>
                            <tbody>${tipRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        card.innerHTML = headerHtml + emptyNoticeHtml + kpiHtml + panelsHtml;
        container.appendChild(card);
    });
}

function exportStatsReportExcel() {
    const companyVal = document.getElementById('reportFilterCompany')?.value || 'all';
    const monthVal = document.getElementById('reportFilterMonth')?.value || 'all';
    const statusVal = document.getElementById('reportFilterStatus')?.value || '';
    const typeVal = document.getElementById('reportFilterType')?.value || '';
    const originVal = document.getElementById('reportFilterOrigin')?.value || 'all';
    const groupVal = _statsFilter.group || 'ALL';

    const params = new URLSearchParams({
        company: companyVal,
        month: monthVal,
        status: statusVal,
        type: typeVal,
        origin: originVal,
        group: groupVal
    });

    const url = `/api/admin/stats/report/excel?${params.toString()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (typeof window.toast === 'function') {
        window.toast('Generando libro Excel (.xlsx) estructurado por hojas...', 'info');
    }
}

function exportStatsReportCsv() {
    const companyVal = document.getElementById('reportFilterCompany')?.value || 'all';
    const monthVal = document.getElementById('reportFilterMonth')?.value || 'all';
    const statusVal = document.getElementById('reportFilterStatus')?.value || '';
    const typeVal = document.getElementById('reportFilterType')?.value || '';
    const originVal = document.getElementById('reportFilterOrigin')?.value || 'all';
    const groupVal = _statsFilter.group || 'ALL';

    const params = new URLSearchParams({
        company: companyVal,
        month: monthVal,
        status: statusVal,
        type: typeVal,
        origin: originVal,
        group: groupVal
    });

    const url = `/api/admin/stats/report/csv?${params.toString()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (typeof window.toast === 'function') {
        window.toast('Descargando reporte en formato CSV / Excel...', 'info');
    }
}

function copyReportSummary() {
    if (!_lastReportData || !_lastReportData.companies_data || _lastReportData.companies_data.length === 0) {
        if (typeof window.toast === 'function') window.toast('No hay datos para copiar', 'warn');
        return;
    }

    const r = _lastReportData;
    let txt = `=========================================================\n`;
    txt += `REPORTE ESTADÍSTICO DE TICKETS REMEDY POR EMPRESA\n`;
    txt += `Mes / Rango: ${r.month_label}\n`;
    txt += `Fecha de Emisión: ${r.generated_at_friendly}\n`;
    txt += `Total Tickets Procesados: ${_fmtNum(r.total_tickets_processed)}\n`;
    txt += `Filtro Aplicado: ${r.filter_label}\n`;
    txt += `=========================================================\n\n`;

    r.companies_data.forEach(c => {
        txt += `---------------------------------------------------------\n`;
        txt += `EMPRESA: ${c.company_name.toUpperCase()} (${c.catalog_label})\n`;
        txt += `Total Tickets: ${_fmtNum(c.total_tickets)} (${c.percentage_of_universe}% del universo)\n`;
        txt += `Abiertos: ${_fmtNum(c.open_tickets)} | Cerrados: ${_fmtNum(c.closed_tickets)}\n`;
        txt += `INC: ${_fmtNum(c.inc_tickets)} | WO: ${_fmtNum(c.wo_tickets)} | Jarvis Bot: ${_fmtNum(c.jarvis_tickets)}\n\n`;

        txt += `[DATOS REALES REMEDY]\n`;
        (c.remedy_companies || []).forEach(rc => {
            txt += ` - ${rc.company}: ${_fmtNum(rc.count)} (${rc.percentage}%)\n`;
        });

        txt += `\n[DOMINIOS DE CORREO]\n`;
        (c.email_domains || []).forEach(ed => {
            txt += ` - ${ed.domain}: ${_fmtNum(ed.count)} (${ed.percentage}%)\n`;
        });

        txt += `\n[TIPIFICACIÓN ELEMENTO / HARDWARE]\n`;
        (c.element_types || []).forEach(et => {
            txt += ` - ${et.name}: ${_fmtNum(et.count)} (${et.percentage}%) [Abiertos: ${et.open}, Cerrados: ${et.closed}]\n`;
        });

        txt += `\n[CATEGORIZACIÓN REMEDY]\n`;
        (c.tipificaciones || []).slice(0, 10).forEach(tp => {
            txt += ` - ${tp.name}: ${_fmtNum(tp.count)} (${tp.percentage}%)\n`;
        });
        txt += `\n---------------------------------------------------------\n\n`;
    });

    navigator.clipboard.writeText(txt).then(() => {
        if (typeof window.toast === 'function') {
            window.toast('Resumen del reporte copiado al portapapeles', 'success');
        }
    }).catch(err => {
        console.error('Error al copiar:', err);
        if (typeof window.toast === 'function') window.toast('No se pudo copiar automáticamente', 'error');
    });
}

// Exponer métodos de reporte globalmente
window.openStatsReportModal = openStatsReportModal;
window.closeStatsReportModal = closeStatsReportModal;
window.loadAndRenderReport = loadAndRenderReport;
window.exportStatsReportExcel = exportStatsReportExcel;
window.exportStatsReportCsv = exportStatsReportCsv;
window.copyReportSummary = copyReportSummary;


