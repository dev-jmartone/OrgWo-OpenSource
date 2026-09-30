// ============================================================
// TOAST MANAGER (ES6 Module)
// ============================================================

export class ToastManager {
    static container = null;

    static getOrCreateContainer() {
        if (!this.container) {
            this.container = document.getElementById('toast-container');
            if (!this.container) {
                this.container = document.createElement('div');
                this.container.id = 'toast-container';
                this.container.className = 'toast-container';
                document.body.appendChild(this.container);
            }
        }
        return this.container;
    }

    static show(msg, type = '', duration = 3000) {
        const container = this.getOrCreateContainer();

        const el = document.createElement('div');
        el.className = `toast-item ${type}`;
        el.textContent = msg;

        container.appendChild(el);

        // Force reflow
        el.offsetHeight;

        el.classList.add('show');

        // Automatically remove after duration
        setTimeout(() => {
            el.classList.remove('show');
            let removed = false;
            const removeEl = () => {
                if (!removed) {
                    removed = true;
                    el.remove();
                }
            };
            el.addEventListener('transitionend', removeEl);
            // Fallback in case transitionend does not fire
            setTimeout(removeEl, 500);
        }, duration);
    }
}

// Expose to window for global availability
window.ToastManager = ToastManager;

// Process queued toasts if any
if (window._queuedToasts) {
    window._queuedToasts.forEach(t => ToastManager.show(t.msg, t.type));
    delete window._queuedToasts;
}
