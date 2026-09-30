// ============================================================
// MESSAGE TEMPLATES
// ============================================================
// Starter set de plantillas personalizables. Se carga via boton en
// Editar perfil → Mensajes Rapidos para que el operador arranque con
// un set base y lo edite a su gusto. NO son hardcoded a nivel codigo:
// una vez cargadas viven en settings.quick_messages del user, donde
// el operador las modifica o borra. Tokens soportados (resueltos en
// drawer.js: {nombre}, {ticket}, {empresa}, {equipo}.
const STARTER_QUICK_MESSAGES = [
    {
        title: 'Coordinar retiro PC',
        text: 'Hola {nombre}, tu notebook nueva ya está lista en depósito. ¿Cuándo podés pasar a retirarla? Horarios del DT: 9:10 hs / 17:00 hs. Saludos.'
    },
    {
        title: 'Coordinar retiro Cel',
        text: 'Hola {nombre}, tu celular nuevo ya está preparado. ¿Cuándo te queda cómodo pasar a retirarlo por depósito? Horarios DT: 9:10 hs / 17:00 hs.'
    },
    {
        title: 'Equipo listo - aviso',
        text: '{nombre}, tu {equipo} nuevo está listo para retirar en el depósito de Tecnología. Pasá a buscarlo cuando puedas. Saludos.'
    },
    {
        title: 'Aviso wipe a fábrica',
        text: '{nombre}, hoy se restablece a fábrica el {equipo} viejo. Asegurate de tener todo respaldado en Drive antes del cambio. Cualquier archivo no guardado se pierde.'
    },
    {
        title: 'Follow-up sin respuesta',
        text: 'Hola {nombre}, te escribí hace unos días por el recambio de tu {equipo}. ¿Llegaste a verlo? Si seguís interesado avisame para coordinar. Gracias.'
    },
    {
        title: 'Pedir datos Monitor',
        text: 'Hola {nombre}, recibí tu solicitud de monitor. Para avanzar necesito:\n• Número de ticket WO\n• Modelo de monitor (si lo sabés)\n• Fecha en la que podés acercarte al DT a retirarlo\nSaludos.'
    },
    {
        title: 'Devolución por renuncia',
        text: 'Hola {nombre}, en el marco de tu egreso de {empresa} necesito coordinar la devolución de los equipos asignados. ¿Cuándo podrías acercarte al DT? Horarios: 9:10 hs / 17:00 hs.'
    },
    {
        title: 'Alta empleado nuevo',
        text: 'Hola {nombre}, bienvenid@ a {empresa}. Estamos preparando tu equipamiento. Para avanzar necesito:\n• Tu clave de red\n• Aplicaciones específicas que vayas a necesitar\n• Fecha tentativa de inicio en la oficina\nQuedo a disposición.'
    },
    {
        title: 'Envío a provincia',
        text: 'Hola {nombre}, vamos a enviarte el {equipo} por correo interno. Necesito por favor:\n• Dirección completa (calle, número, ciudad, provincia, CP)\n• Teléfono de contacto para el courier\n• Horario en el que hay alguien para recibir\nSaludos.'
    },
    {
        title: 'Confirmación post-entrega',
        text: 'Hola {nombre}, te confirmo que el {equipo} se entregó correctamente y la WO {ticket} queda cerrada. Cualquier inconveniente avisame. Saludos.'
    },
];

const MSG_TEMPLATES = {
    'msg-rt': c => {
        // Saludo según hora del día (6-12 días, 12-19 tardes, resto noches).
        const h = new Date().getHours();
        const saludo = (h >= 6 && h < 12) ? 'buenos días'
                     : (h >= 12 && h < 19) ? 'buenas tardes'
                     : 'buenas noches';
        // Variantes según tipo de recambio: solo notebook, solo celular,
        // o ambos. Cambian sustantivo, género y número.
        let equipoAsignado, beneficio;
        if (c.tipo === 'pc') {
            equipoAsignado = 'la notebook asignada';
            beneficio = 'la notebook actual quedará para tu uso personal y se te entregará una nueva notebook para continuar trabajando';
        } else if (c.tipo === 'cel') {
            equipoAsignado = 'el celular asignado';
            beneficio = 'el celular actual quedará para tu uso personal y se te entregará un nuevo celular para continuar trabajando';
        } else {
            equipoAsignado = 'los equipos asignados';
            beneficio = 'los equipos actuales quedarán para tu uso personal y se te entregarán nuevos equipos para continuar trabajando';
        }
        return `Hola, ${saludo}. ¿Cómo estás?

Me comunico desde Soporte por el recambio tecnológico correspondiente a los 3 años de uso de ${equipoAsignado}.

Como parte del beneficio corporativo, al realizar el recambio ${beneficio}.

Estamos realizando múltiples recambios en simultáneo, por lo que la gestión puede demorar algunos días dependiendo de la coordinación y disponibilidad de equipos.

Cuando puedas, confirmame por favor si querés avanzar con el proceso para continuar con la coordinación.`;
    },

    'msg-pc': c => `Voy a estar tomando tu caso. Para poder avanzar con el recambio de la notebook, necesitaría por favor la siguiente información:

• Número de ticket WO solicitando la baja de la notebook actual
• Clave de red de tu cuenta empresa
• Programas que necesitás instalados en el nuevo equipo
• Fecha a partir de la próxima semana en la que podrías acercarte al DT o, en caso de envío, zona aproximada donde vivís

Importante: el día del cambio la notebook anterior será restablecida a estado de fábrica para su entrega, por lo que es necesario contar previamente con la información importante respaldada en Drive o en algún backup.

Te dejo también la tipificación correspondiente por si todavía no generaste el ticket:

> > > BAJA NOTEBOOK <<<

https://remedy.yourcompany.com/dwp/app/#/srm/profile/[ID_SRM]/srm

Descripción sugerida:
Buenas, solicito la baja de la notebook asignada y la gestión del beneficio para conservar la misma.

NOTEBOOK - ${c.oldModel || '[MODELO]'} - SERIAL: ${c.svcTag ? 'NT-' + c.svcTag : '[SERIAL]'}`,

    'msg-cel': c => `Voy a estar tomando tu caso. Para poder continuar con la instalación del nuevo celular, necesitaría por favor la siguiente información:

• Número de ticket WO solicitando la baja del celular actual
• Tipo de uso del equipo (guardia o uso habitual)
• Captura donde se visualicen IMEI y número de serie del equipo actual
• Clave de red de tu cuenta empresa
• Aplicaciones que necesitás instaladas
• Fecha a partir de la próxima semana en la que podrías acercarte al DT o, en caso de envío, zona aproximada donde vivís

Te dejo también la tipificación correspondiente por si todavía no generaste el ticket:

> > > BAJA CELULAR <<<

https://remedy.yourcompany.com/dwp/app/#/srm/profile/[ID_SRM]/srm

Descripción sugerida:
Buenas, solicito la baja del celular asignado y la gestión del beneficio para conservar el mismo.

CELULAR - ${c.oldModel || '[MODELO]'} - IMEI: ${c.svcTag || '[IMEI]'}`,

    'msg-co': c => `Hola, buenas tardes. ¿Cómo estás?

Me comunico desde Soporte por el recambio tecnológico correspondiente a los 3 años de uso de los equipos asignados.

Estamos realizando múltiples recambios en simultáneo, por lo que la gestión puede demorar algunos días dependiendo de la coordinación y disponibilidad de equipos.

Para poder avanzar con el proceso, necesitaría por favor la siguiente información:

Notebook:
• Número de ticket WO solicitando la baja de la notebook actual
• Programas que necesitás instalados en el nuevo equipo

Celular:
• Número de ticket WO solicitando la baja del celular actual
• Tipo de uso del equipo (guardia o uso habitual)
• Captura donde se visualicen IMEI y número de serie
• Aplicaciones que necesitás instaladas
• PIN actual del celular a entregar

Adicionalmente:
• Clave de red de tu cuenta empresa para configurar ambos equipos
• Fecha en la que podrías acercarte al DT o, en caso de envío, zona aproximada donde vivís

Importante: el día del cambio los equipos anteriores serán restablecidos a estado de fábrica para su entrega, por lo que es necesario contar previamente con la información importante respaldada en Drive o en algún backup.

Te dejo también las tipificaciones correspondientes por si todavía no generaste los tickets:

> > > BAJA NOTEBOOK <<<
https://remedy.yourcompany.com/dwp/app/#/srm/profile/[ID_SRM]/srm

> > > BAJA CELULAR <<<
https://remedy.yourcompany.com/dwp/app/#/srm/profile/[ID_SRM]/srm`,

    'msg-vk-coord': c => {
        let art = 'una';
        let elem = 'Vincha';
        let pron = 'la misma';
        if (c.tipo === 'kit') {
            art = 'un';
            elem = 'Kit Inalámbrico';
            pron = 'el mismo';
        } else if (c.tipo === 'cargador') {
            art = 'un';
            elem = 'Cargador';
            pron = 'el mismo';
        }
        return `Buen dia ${c.name || ''}, te escribo de soporte a usuarios por tu ticket ${c.wo || ''} para realizar la entrega de ${art} ${elem}, quisiera saber que dia estas disponible para el retiro de ${pron}?`;
    },

    'msg-vk-ready': c => {
        let typeLabel = 'Vincha';
        if (c.tipo === 'kit') typeLabel = 'Kit Inalámbrico';
        else if (c.tipo === 'cargador') typeLabel = 'Cargador';
        return `Hola, ¿cómo estás? Te aviso que tu nueva ${typeLabel} ya está lista y preparada para retirar en el depósito de Tecnología. Cuando gustes podés pasar a buscarla. ¡Muchas gracias!`;
    },

    // Defectuoso / extravío ahora viven como observaciones predeterminadas
    // dentro de DEFAULT_OBS (planilla). El operador elige la razón en el
    // wizard y la obs se pre-llena automáticamente.
};

document.querySelectorAll('.qa-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!currentCaseId) return;
        const action = btn.dataset.action;
        const c = casesById(currentCaseId);

        if (action.startsWith('msg-')) {
            const text = MSG_TEMPLATES[action](c);
            const email = (c.email || '').trim();
            if (!email) {
                toast('El caso no tiene email. Copia y pegá el texto a mano.', 'error');
                openMessageModal(btn.textContent.trim(), text);
            } else {
                openTeamsChat(email, text);
            }
            if (action === 'msg-rt' || action === 'msg-co') {
                if (c.estado === 'contact') {
                    try {
                        await API.update(currentCaseId, {
                            estado: 'wait',
                            logEvent: '1ª comunicación enviada — auto-movido a "Esperando respuesta"'
                        });
                        await refresh();
                    } catch(err) {}
                }
            }
        }
    });
});

// Abre el chat de la persona en Teams (desktop si está instalado, web
// como fallback) con el mensaje pre-cargado en la barra de envío. NO
// envía el mensaje: hace falta apretar Enter manualmente.
// El protocolo msteams: tiene un límite empírico en la longitud del
// querystring; truncamos para evitar que el handler pierda parte del texto.
const TEAMS_MAX_MESSAGE_LEN = 1900;
function openTeamsChat(email, text) {
    let msg = text;
    if (msg.length > TEAMS_MAX_MESSAGE_LEN) {
        msg = msg.slice(0, TEAMS_MAX_MESSAGE_LEN);
        toast('Mensaje truncado por longitud. Revisá antes de enviar.', 'error');
    }
    const url = `msteams:/l/chat/0/0?users=${encodeURIComponent(email)}&message=${encodeURIComponent(msg)}`;
    // Dispara el protocol handler vía anchor temporal para no tocar
    // la URL visible de la pestaña ni meter una entrada en el history.
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Abriendo Teams…', 'success');
}

const modal = document.getElementById('modalOverlay');
function openMessageModal(title, text) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalText').value = text;
    modal.classList.add('open');
}
document.getElementById('modalClose').addEventListener('click', () => modal.classList.remove('open'));
document.getElementById('modalCloseBtn').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
document.getElementById('modalCopy').addEventListener('click', () => {
    const ta = document.getElementById('modalText');
    ta.select();
    navigator.clipboard.writeText(ta.value).then(() => toast('Copiado al portapapeles', 'success'));
});


// Expose to window for global module compatibility
window.openTeamsChat = openTeamsChat;
window.openMessageModal = openMessageModal;
