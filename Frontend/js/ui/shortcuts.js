// ============================================================
// SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList.contains('open') && typeof window.closeDrawer === 'function') {
            window.closeDrawer();
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const listSearch = document.getElementById('listSearch');
        if (listSearch) {
            switchView('list');
            setTimeout(() => listSearch.focus(), 50);
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        // drawer es block-scoped al if de Escape; aca hay que volver a tomarlo.
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList.contains('open')) {
            e.preventDefault();
            document.getElementById('btnSave').click();
        }
    }
});

// Toggle de tema claro/oscuro. Cambia el atributo data-theme en <html> y
// persiste la elección en localStorage. El icono refleja el siguiente
// modo al que se cambiaría con un click.
function syncThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const btn = document.getElementById('btnTheme');
    if (!btn) return;
    btn.innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>`;
    btn.title = isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    if (window.lucide) lucide.createIcons();
}
document.getElementById('btnTheme').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? null : 'dark';
    if (next) root.setAttribute('data-theme', next);
    else root.removeAttribute('data-theme');
    try { localStorage.setItem('theme', next || 'light'); } catch (e) {}
    syncThemeIcon();
});
syncThemeIcon();


// Expose to window for global module compatibility
window.syncThemeIcon = syncThemeIcon;
