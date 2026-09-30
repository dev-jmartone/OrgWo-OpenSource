// ============================================================
// ATTACHMENTS — listado y subida desde el drawer
// ============================================================

async function loadAttachmentsForCurrentCase() {
    if (!currentCaseId) return;
    const list = document.getElementById('attachmentsList');
    const empty = document.getElementById('attachmentsEmpty');
    if (!list) return;

    let items = [];
    try {
        items = await API.listAttachments(currentCaseId);
    } catch (e) {
        list.innerHTML = '<div class="attachments-empty">Error al cargar adjuntos.</div>';
        renderRemedyCloseButton();
        return;
    }

    renderRemedyCloseButton();

    const currentCase = (typeof casesById === 'function') ? casesById(currentCaseId) : null;
    const isClosed = currentCase && (['done', 'reject', 'not_accepted'].includes(currentCase.estado) || currentCase.status === '4' || currentCase.status === 'Resolved' || currentCase.status === 'Completed');
    const ticketRef = currentCase?.wo || '—';

    const uploadBtn = document.getElementById('btnUploadAttachment');
    if (uploadBtn) {
        uploadBtn.style.display = isClosed ? 'none' : 'inline-flex';
    }

    if (!items.length) {
        list.innerHTML = '<div class="attachments-empty">Sin adjuntos.</div>';
        return;
    }

    list.innerHTML = items.map(a => {
        const kindTag = a.kind ? `<span class="att-kind">${a.kind.replace(/_/g, ' ')}</span>` : '';
        const sizeKB = a.sizeBytes ? `${Math.round(a.sizeBytes / 1024)} KB` : '';
        const ids = (a.detectedIds && a.detectedIds.length)
            ? `<span class="att-ids" title="IDs detectados via OCR">${a.detectedIds.join(', ')}</span>`
            : '';

        // Adjunto archivado: PDF ya se subio a Remedy + se envio al
        // aprobador. El binario se borro para liberar disco. Solo queda
        // metadata como registro auditable. Sin descarga, sin delete.
        if (a.archivedAt) {
            return `
                <div class="att-row att-row-archived" data-att-id="${a.id}">
                    <div class="att-info">
                        <i data-lucide="archive" class="att-icon"></i>
                        <div class="att-meta">
                            <span class="att-name att-name-archived">PDF adjuntado automaticamente — ${escapeHtml(ticketRef)} — ${escapeHtml(a.filename)}</span>
                            <div class="att-sub">
                                ${kindTag}
                                ${ids}
                                <span class="att-date" title="Archivado">archivado ${formatTs(a.archivedAt)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="att-row" data-att-id="${a.id}">
                <div class="att-info">
                    <i data-lucide="file-text" class="att-icon"></i>
                    <div class="att-meta">
                        <a class="att-name" href="${API.attachmentFileUrl(a.id, true)}" onclick="event.preventDefault(); window.previewAttachment(this.href, '${escapeHtml(a.filename)}');" target="_blank" rel="noopener">${escapeHtml(a.filename)}</a>
                        <div class="att-sub">
                            ${kindTag}
                            ${ids}
                            <span class="att-size">${sizeKB}</span>
                            <span class="att-date">${formatTs(a.createdAt)}</span>
                        </div>
                    </div>
                </div>
                <div class="att-actions">
                    <a class="btn btn-ghost btn-sm" href="${API.attachmentFileUrl(a.id, false)}" title="Descargar"><i data-lucide="download"></i></a>
                    ${isClosed ? '' : `<button class="btn btn-ghost btn-sm att-delete-btn" data-att-id="${a.id}" title="Eliminar"><i data-lucide="trash-2"></i></button>`}
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.att-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const aid = btn.dataset.attId;
            if (!confirm('¿Eliminar este adjunto?')) return;
            try {
                await API.deleteAttachment(aid);
                toast('Adjunto eliminado', 'success');
                loadAttachmentsForCurrentCase();
            } catch (e) {
                toast('Error al eliminar', 'error');
            }
        });
    });

    renderIcons();
}

// escapeHtml canonico vive en core/utils.js (window.escapeHtml). Aca solo
// tomamos la referencia; utils.js carga antes que este modulo.
const escapeHtml = window.escapeHtml;

function formatTs(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return iso;
    }
}

function renderRemedyCloseButton() {
    const host = document.getElementById('remedyCloseHost');
    if (host) {
        host.innerHTML = '';
    }
}

async function closeRemedyFromCurrentCase() {
    if (!currentCaseId) return;
    const btn = document.getElementById('btnCloseRemedyFromCase');
    if (!btn) return;

    // Prompt para que el operador edite el mensaje de cierre. Mismo texto va
    // como Resolution/Detalle Terminado del ticket Remedy + Detailed
    // Description del WorkLog adjunto. Default editable.
    const defaultMsg = 'Se entregó el equipo de reemplazo.';
    const swalRes = await Swal.fire({
        title: 'Cerrar WO en Remedy',
        html: 'Esto cerrará el ticket con el template adjunto + abrirá draft Outlook para el aprobador.<br><br>Editá el mensaje de cierre (va como resolución <em>y</em> comentario del adjunto).',
        input: 'textarea',
        inputValue: defaultMsg,
        inputAttributes: { 'aria-label': 'Mensaje de cierre' },
        showCancelButton: true,
        confirmButtonText: 'Cerrar WO',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => {
            if (!value || !value.trim()) return 'No puede estar vacío';
            return null;
        },
    });
    if (!swalRes.isConfirmed) return;
    const resolutionNote = (swalRes.value || '').trim();

    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-2"></i> Cerrando...';
    renderIcons();
    try {
        const res = await API.closeRemedyFromCase(currentCaseId, resolutionNote);
        if (!res) return;
        if (res.already_resolved) {
            if (res.file_error) {
                toast(`Ya estaba cerrado en Remedy. Adjunto fallo: ${res.file_error}`, 'warning');
            } else {
                toast('Ya estaba cerrado en Remedy. Solo adjunto + draft Outlook.', 'success');
            }
        } else if (res.file_error) {
            toast(`Ticket cerrado, pero adjunto fallo: ${res.file_error}`, 'warning');
        } else {
            toast('Ticket cerrado en Remedy', 'success');
        }
        const draft = res.outlook_draft;
        if (draft && draft.opened) {
            toast('Draft Outlook abierto para el aprobador', 'success');
        } else if (draft && draft.reason && !draft.reason.includes('no tiene template_firmado adjunto') && !draft.reason.includes('no hay case con wo=')) {
            toast(`Draft Outlook no abierto: ${draft.reason}`, 'warning');
        }
        if (typeof refresh === 'function') await refresh();
        if (typeof refreshCurrentView === 'function') refreshCurrentView();
    } catch (err) {
        toast(`Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        renderIcons();
    }
}

document.getElementById('attachUploadInput')?.addEventListener('change', async (e) => {
    if (!currentCaseId) return;
    const file = e.target.files[0];
    if (!file) return;
    try {
        await API.uploadAttachment(currentCaseId, file);
        toast('Adjunto subido', 'success');
        loadAttachmentsForCurrentCase();
    } catch (err) {
        toast('Error al subir', 'error');
    } finally {
        e.target.value = '';
    }
});


// Expose to window for global module compatibility
window.loadAttachmentsForCurrentCase = loadAttachmentsForCurrentCase;
window.escapeHtml = escapeHtml;
window.formatTs = formatTs;
window.renderRemedyCloseButton = renderRemedyCloseButton;
window.closeRemedyFromCurrentCase = closeRemedyFromCurrentCase;

// Attachment Preview Modal Implementation
window.previewAttachment = function(url, filename) {
    const modal = document.getElementById('attachmentPreviewModal');
    const title = document.getElementById('attachmentPreviewTitle');
    const body = document.getElementById('attachmentPreviewBody');
    if (!modal || !title || !body) return;

    title.textContent = filename || 'Vista previa';
    body.innerHTML = '';

    const lowerName = (filename || '').toLowerCase();
    const isImage = lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.gif') || lowerName.endsWith('.webp');
    const isPDF = lowerName.endsWith('.pdf');

    if (isImage) {
        body.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 100%; object-fit: contain;" alt="${escapeHtml(filename)}" />`;
    } else if (isPDF) {
        body.innerHTML = `<iframe src="${url}" style="width: 100%; height: 100%; border: none;"></iframe>`;
    } else {
        body.innerHTML = `
            <div style="text-align: center; color: #fff; padding: 20px;">
                <i data-lucide="file-text" style="width: 48px; height: 48px; margin-bottom: 12px; color: var(--text-muted); display: inline-block;"></i>
                <p style="margin-bottom: 16px; font-size: 13.5px;">La vista previa no está disponible para este tipo de archivo.</p>
                <a href="${url}" download="${escapeHtml(filename)}" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: var(--radius); background: var(--primary); color: #fff;">
                    <i data-lucide="download" style="width: 14px; height: 14px;"></i> Descargar archivo
                </a>
            </div>
        `;
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    modal.classList.add('open');
};

// Close preview modal on button click
document.getElementById('attachmentPreviewClose')?.addEventListener('click', () => {
    const modal = document.getElementById('attachmentPreviewModal');
    if (modal) {
        modal.classList.remove('open');
        const body = document.getElementById('attachmentPreviewBody');
        if (body) body.innerHTML = '';
    }
});

// Close preview modal on clicking overlay
document.getElementById('attachmentPreviewModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'attachmentPreviewModal') {
        const modal = document.getElementById('attachmentPreviewModal');
        if (modal) {
            modal.classList.remove('open');
            const body = document.getElementById('attachmentPreviewBody');
            if (body) body.innerHTML = '';
        }
    }
});

// Close preview modal on ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('attachmentPreviewModal');
        if (modal && modal.classList.contains('open')) {
            modal.classList.remove('open');
            const body = document.getElementById('attachmentPreviewBody');
            if (body) body.innerHTML = '';
        }
    }
});
