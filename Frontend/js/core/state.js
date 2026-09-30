// ============================================================
// STATE
// ============================================================
let cases = [];  // array en memoria, se refresca desde API
let currentCaseId = null;
let currentFilter = 'all';
let usersSort = { key: 'updatedAt', dir: 'desc' };
// Columnas con buscador local y la query vigente de cada una.
const COL_SEARCH_ESTADOS = ['wait', 'config', 'not_accepted'];
let colSearch = {};

// Expose to window for global access
window.cases = cases;
window.currentCaseId = currentCaseId;
window.currentFilter = currentFilter;
window.usersSort = usersSort;
window.COL_SEARCH_ESTADOS = COL_SEARCH_ESTADOS;
window.colSearch = colSearch;

function casesById(id) {
    let found = cases.find(c => c.id === id);
    if (found) {
        if (['done', 'reject', 'not_accepted'].includes(found.estado) && typeof window.myClosedTickets !== 'undefined' && window.myClosedTickets.length > 0) {
            const rt = window.myClosedTickets.find(x => x.wo === found.wo || x.id === found.wo || x.id === found.id);
            if (rt && rt.description) {
                found.notes = rt.description;
            }
        }
        return found;
    }

    // Buscar en tickets en vivo de Remedy si está disponible
    if (typeof window.myOpenTickets !== 'undefined' && window.myOpenTickets.length > 0) {
        const t = window.myOpenTickets.find(x => x.id === id);
        if (t) {
            const isWO = String(t.id).toUpperCase().startsWith('WO');
            return {
                id: t.id,
                name: t.clientName || 'Sin nombre',
                email: '',
                company: t.company || '—',
                puesto: t.summary || '—',
                estado: isWO ? 'remedy_wo_assigned' : 'remedy_inc_assigned',
                wo: t.id,
                fechaRetiro: null,
                updatedAt: t.createdAt || t.created_at || nowISO(),
                createdAt: t.createdAt || t.created_at || nowISO(),
                notes: t.description || '',
                slaDate: t.slaDate || null,
                slaStatus: t.slaStatus || null,
                priority: t.priority || 'normal',
                isRemedyOnly: true,
                status: t.status || '1',
                tipo: (() => {
                    const el = (t.element_type || '').toLowerCase();
                    if (el.includes('vincha')) return 'vincha';
                    if (el.includes('kit')) return 'kit';
                    if (el.includes('celular') || el.includes('cel')) return 'cel';
                    if (el.includes('cargador')) return 'cargador';
                    if (el.includes('monitor')) return 'monitor';
                    return 'pc';
                })(),
                tipificacion: t.tipificacion || t.element_type || ''
            };
        }
    }

    // Buscar en cerrados
    if (typeof window.myClosedTickets !== 'undefined' && window.myClosedTickets.length > 0) {
        const t = window.myClosedTickets.find(x => x.id === id);
        if (t) {
            const isWO = String(t.id).toUpperCase().startsWith('WO');
            return {
                id: t.id,
                name: t.clientName || 'Sin nombre',
                email: '',
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
                isRemedyOnly: true,
                status: t.status || '4',
                tipo: (() => {
                    const el = (t.element_type || '').toLowerCase();
                    if (el.includes('vincha')) return 'vincha';
                    if (el.includes('kit')) return 'kit';
                    if (el.includes('celular') || el.includes('cel')) return 'cel';
                    if (el.includes('cargador')) return 'cargador';
                    if (el.includes('monitor')) return 'monitor';
                    return 'pc';
                })(),
                tipificacion: t.tipificacion || t.element_type || ''
            };
        }
    }
    return undefined;
}

async function refresh() {
    try {
        const activeTab = document.querySelector('#listTabs button.active')?.dataset.listFilter;
        const allCases = (activeTab === 'all');
        cases = await API.list(allCases);
        window.cases = cases;
        document.getElementById('connDot').classList.remove('offline');
        window.dispatchEvent(new CustomEvent('state:refreshed'));
    } catch(e) {
        document.getElementById('connDot').classList.add('offline');
        toast('Sin conexión con el servidor', 'error');
        throw e;
    }
}

export { cases, currentCaseId, currentFilter, usersSort, COL_SEARCH_ESTADOS, colSearch, casesById, refresh };



// Expose to window for global module compatibility
window.casesById = casesById;
window.refresh = refresh;
