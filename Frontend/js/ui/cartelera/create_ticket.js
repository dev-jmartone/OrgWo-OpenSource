// ============================================================
// CREACION DE TICKETS EN REMEDY
// Modal + classifications registry + dynamic field renderer.
// Extraido de system_enhancements.js (refactor fase 2).
// ============================================================

// ============================================================
// CREACIÓN DE TICKETS EN REMEDY
// ============================================================

const REMEDY_CLASSIFICATIONS = {
    // ───── Incidentes (INC) y Consultas (INC) ─────
    kit_inc: {
        type: 'INC',
        label: 'KIT INALAMBRICO ',
        summary: 'Solicitud de Kit Inalámbrico',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'KIT INALAMBRICO',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios para dejar constancia...', required: true }
        ]
    },
    vincha_inc: {
        type: 'INC',
        label: 'VINCHA ',
        summary: 'Solicitud de Vincha',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'VINCHA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios para dejar constancia...', required: true }
        ]
    },
    equipo_rep_inc: {
        type: 'INC',
        label: 'EQUIPO - REPARACION ',
        summary: 'Equipo - Falla / Reparación',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'EQUIPO - REPARACION',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios para dejar constancia...', required: true }
        ]
    },
    cable_inc: {
        type: 'INC',
        label: 'ADAPTADOR / CABLE ',
        summary: 'Solicitud de Adaptador o Cable',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'ADAPTADOR / CABLE',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios para dejar constancia...', required: true }
        ]
    },
    generales_inc: {
        type: 'INC',
        label: 'GENERALES ',
        summary: 'Consulta o soporte general',
        op_tier_1: 'CONSULTA',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'GENERALES',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios...', required: true }
        ]
    },
    software_inst_inc: {
        type: 'INC',
        label: 'SOFTWARE - INSTALACIÓN ',
        summary: 'Instalación de software',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'SOFTWARE - INSTALACIÓN',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese el software a instalar...', required: true }
        ]
    },
    software_err_inc: {
        type: 'INC',
        label: 'SOFTWARE - INCONVENIENTE / MENSAJE DE ERROR ',
        summary: 'Error o inconveniente de software',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'SOFTWARE - INCONVENIENTE / MENSAJE DE ERROR',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Describa el error o inconveniente...', required: true }
        ]
    },
    software_conf_inc: {
        type: 'INC',
        label: 'SOFTWARE - CONFIGURACIÓN ',
        summary: 'Configuración de software',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'SOFTWARE - CONFIGURACIÓN',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la configuración...', required: true }
        ]
    },
    red_sin_acceso_inc: {
        type: 'INC',
        label: 'RED - SIN ACCESO ',
        summary: 'Problema de acceso a red',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'RED - SIN ACCESO',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la falta de acceso...', required: true }
        ]
    },
    conexion_oficina_inc: {
        type: 'INC',
        label: 'CONEXION OFICINA VIRTUAL ',
        summary: 'Falla conexión oficina virtual',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'CONEXION OFICINA VIRTUAL',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la conexión...', required: true }
        ]
    },
    outlook_correo_inc: {
        type: 'INC',
        label: 'OUTLOOK - INCONVENIENTES CON CORREO ',
        summary: 'Problemas de correo Outlook',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'OUTLOOK - INCONVENIENTES CON CORREO',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles del inconveniente...', required: true }
        ]
    },
    maquina_virtual_inc: {
        type: 'INC',
        label: 'MAQUINA VIRTUAL ',
        summary: 'Solicitud o falla Máquina Virtual',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'MAQUINA VIRTUAL',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la máquina virtual...', required: true }
        ]
    },
    internet_sin_acceso_inc: {
        type: 'INC',
        label: 'INTERNET - SIN ACCESO / ERROR ',
        summary: 'Sin acceso a Internet / Error',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'INTERNET - SIN ACCESO / ERROR',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la falla...', required: true }
        ]
    },
    externos_mv_inc: {
        type: 'INC',
        label: 'EXTERNOS MAQUINA VIRTUAL ',
        summary: 'Máquina virtual para externos',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'EXTERNOS MAQUINA VIRTUAL',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese los detalles del externo...', required: true }
        ]
    },
    pc_virtual_inc: {
        type: 'INC',
        label: 'PC VIRTUAL NO FUNCIONA ',
        summary: 'PC virtual no funciona',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'PC VIRTUAL NO FUNCIONA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Falla o error presentado...', required: true }
        ]
    },
    correo_conf_inc: {
        type: 'INC',
        label: 'CORREO - CONFIGURACIÓN ',
        summary: 'Configuración de correo corporativo',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'CORREO - CONFIGURACIÓN',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la configuración...', required: true }
        ]
    },
    vpn_conf_inc: {
        type: 'INC',
        label: 'EQUIPO - CONFIGURACIÓN DE VPN ',
        summary: 'Configuración de VPN',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'EQUIPO - CONFIGURACIÓN DE VPN',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles del acceso VPN...', required: true }
        ]
    },
    impresora_conf_inc: {
        type: 'INC',
        label: 'IMPRESORA - CONFIGURACIÓN ',
        summary: 'Configuración de impresora',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'IMPRESORA - CONFIGURACIÓN',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Modelo e IP/Nombre de impresora...', required: true }
        ]
    },
    chat_corp_inc: {
        type: 'INC',
        label: 'CHAT CORPORATIVO ',
        summary: 'Inconveniente Chat Corporativo',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'CHAT CORPORATIVO',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la falla...', required: true }
        ]
    },
    impresora_inc: {
        type: 'INC',
        label: 'IMPRESORA - INCONVENIENTE ',
        summary: 'Impresora - Inconveniente (Error, mala calidad, etc.)',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'IMPRESORA - INCONVENIENTE (ERROR, MALA CALIDAD, ETC)',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Describa el inconveniente...', required: true }
        ]
    },
    periferico_inc: {
        type: 'INC',
        label: 'INCONVENIENTE PERIFERICO ',
        summary: 'Inconveniente periférico',
        op_tier_1: 'INCIDENTE',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'INCONVENIENTE PERIFERICO',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles del periférico con falla...', required: true }
        ]
    },
    wifi_conf_inc: {
        type: 'INC',
        label: 'EQUIPO - CONFIGURACIÓN DE RED WIFI ',
        summary: 'Configuración red WIFI',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'EQUIPO - CONFIGURACIÓN DE RED WIFI',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Nombre de red y detalles...', required: true }
        ]
    },
    mv_ipa_inc: {
        type: 'INC',
        label: 'MAQUINAS VIRTUALES IPA ',
        summary: 'Consulta Máquinas Virtuales IPA',
        op_tier_1: 'CONSULTA',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'MAQUINAS VIRTUALES IPA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la consulta...', required: true }
        ]
    },

    // ───── Órdenes de Trabajo WO y Solicitudes (WO) ─────
    notebook_baja_wo: {
        type: 'WO',
        label: 'NOTEBOOK BAJA ',
        summary: 'Solicitud de Baja de Notebook',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'NOTEBOOK BAJA',
        fields: [
            { id: 'fecha_limite', label: 'Petición debe completarse antes de', type: 'date', required: true },
            { id: 'modelo', label: 'Modelo a dar de baja', type: 'text', placeholder: 'Ej: Lenovo ThinkPad L13', required: true },
            { id: 'serial', label: 'Service Tag / Serial Number', type: 'text', placeholder: 'Ej: 7X8Y9Z2', required: true },
            { id: 'notas', label: 'Motivo de la baja', type: 'textarea', placeholder: 'Ingrese el motivo de la baja...', required: true }
        ]
    },
    equipo_nuevo_wo: {
        type: 'WO',
        label: 'EQUIPO NUEVO O ACTUALIZACION ',
        summary: 'Solicitud de Equipo Nuevo o Actualización',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'EQUIPO NUEVO O ACTUALIZACION',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios para dejar constancia...', required: true }
        ]
    },
    software_deploy_wo: {
        type: 'WO',
        label: 'INSTALACION SOFTWARE DEPLOY ',
        summary: 'Instalación software deploy',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'INSTALACION SOFTWARE DEPLOY',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles del software a desplegar...', required: true }
        ]
    },
    celular_wo: {
        type: 'WO',
        label: 'ALTA/CAMBIO EQUIPO CELULAR ',
        summary: 'Solicitud de Alta o Cambio de Celular',
        priority: 'Low',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'ALTA/CAMBIO EQUIPO CELULAR',
        fields: [
            { id: 'fecha_limite', label: 'Petición debe completarse antes de', type: 'date', required: true },
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios...', required: true }
        ]
    },
    self_celular_wo: {
        type: 'WO',
        label: 'SELF SERVICE - CELULAR Y LINEA ',
        summary: 'Self Service celular y línea',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'SELF SERVICE - CELULAR Y LINEA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles del servicio...', required: true }
        ]
    },
    baja_celular_wo: {
        type: 'WO',
        label: 'TEL. MOVIL BAJA CELULAR ',
        summary: 'TEL. MOVIL BAJA CELULAR',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'TEL. MOVIL BAJA CELULAR',
        fields: [
            { id: 'fecha_limite', label: 'Petición debe completarse antes de', type: 'date', required: true },
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios...', required: true }
        ]
    },
    monitor_wo: {
        type: 'WO',
        label: 'SOLICITUD DE MONITOR ',
        summary: 'Solicitud de Monitor Adicional',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'SOLICITUD DE MONITOR',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios para dejar constancia...', required: true }
        ]
    },
    self_notebook_wo: {
        type: 'WO',
        label: 'SELF SERVICE - NOTEBOOK ',
        summary: 'Self Service notebook',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'SELF SERVICE - NOTEBOOK',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles del equipo solicitado...', required: true }
        ]
    },
    externos_imagen_wo: {
        type: 'WO',
        label: 'EXTERNOS INSTALACION IMAGEN CORPORATIVA ',
        summary: 'Externos instalación imagen corporativa',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'EXTERNOS INSTALACION IMAGEN CORPORATIVA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles...', required: true }
        ]
    },
    baja_subsidiaria_wo: {
        type: 'WO',
        label: 'NOTEBOOK BAJA SUBSIDIARIA ',
        summary: 'Baja notebook Subsidiaria',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'NOTEBOOK BAJA SUBSIDIARIA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la baja...', required: true }
        ]
    },
    alta_subsidiaria_wo: {
        type: 'WO',
        label: 'NOTEBOOK ALTA EMPLEADO SUBSIDIARIA ',
        summary: 'Alta notebook empleado Subsidiaria',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'NOTEBOOK ALTA EMPLEADO SUBSIDIARIA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la entrega...', required: true }
        ]
    },
    sharepoint_wo: {
        type: 'WO',
        label: 'SHAREPOINT ONLINE (SPO) - ONEDRIVE ',
        summary: 'SharePoint Online (SPO) - OneDrive',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SERVIDORES',
        op_tier_3: 'SHAREPOINT ONLINE (SPO) - ONEDRIVE',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la solicitud...', required: true }
        ]
    },
    licencias_wo: {
        type: 'WO',
        label: 'LICENCIAS ',
        summary: 'Solicitud de Licencias',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'LICENCIAS',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese la licencia solicitada...', required: true }
        ]
    },
    self_monitor_wo: {
        type: 'WO',
        label: 'SELF SERVICE - MONITOR ',
        summary: 'Self Service monitor',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'SELF SERVICE - MONITOR',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la solicitud...', required: true }
        ]
    },
    equipo_rep_wo: {
        type: 'WO',
        label: 'EQUIPO - REPARACION ',
        summary: 'Solicitud reparación de equipo',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'EQUIPO - REPARACION',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios...', required: true }
        ]
    },
    ram_wo: {
        type: 'WO',
        label: 'AMPLIAR MEMORIA RAM ',
        summary: 'Solicitud de Ampliación de Memoria RAM',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'AMPLIAR MEMORIA RAM',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Ingrese las notas o comentarios para dejar constancia...', required: true }
        ]
    },
    desbloqueo_wo: {
        type: 'WO',
        label: 'DESBLOQUEO DE USUARIO EN APLICATIVOS ',
        summary: 'Desbloqueo usuario aplicativos',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'PERMISOS Y USUARIOS',
        op_tier_3: 'DESBLOQUEO DE USUARIO EN APLICATIVOS',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Usuario y aplicativo afectado...', required: true }
        ]
    },
    intune_wo: {
        type: 'WO',
        label: 'INTUNE - DESPLIEGUE MASIVO DE APLICACION ',
        summary: 'Despliegue masivo Intune',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'INTUNE - DESPLIEGUE MASIVO DE APLICACION',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles del aplicativo y alcance...', required: true }
        ]
    },
    mv_ipa_wo: {
        type: 'WO',
        label: 'MAQUINAS VIRTUALES IPA ',
        summary: 'Máquinas Virtuales IPA',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'MAQUINAS VIRTUALES IPA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la máquina virtual...', required: true }
        ]
    },
    permisos_abm_wo: {
        type: 'WO',
        label: 'PERMISOS DE ACCESO PLATAFORMA/APLICACIÓN - ABM PERFIL ',
        summary: 'Permisos de acceso plataforma/aplicación - ABM perfil',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SEGURIDAD INFORMATICA',
        op_tier_3: 'PERMISOS DE ACCESO PLATAFORMA/APLICACIÓN - ABM PERFIL',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles...', required: true }
        ]
    },
    tablet_baja_wo: {
        type: 'WO',
        label: 'TABLET BAJA ',
        summary: 'Baja de tablet',
        op_tier_1: 'SOLICITUD',
        op_tier_2: 'SOPORTE A USUARIOS',
        op_tier_3: 'TABLET BAJA',
        fields: [
            { id: 'notas', label: 'Notas / Detalles del caso', type: 'textarea', placeholder: 'Detalles de la baja...', required: true }
        ]
    }
};

// Vinculación de eventos para el Modal de Creación de Tickets en Remedy
const initCreateTicket = () => {
    const btnCreate = document.getElementById('btnCreateRemedyTicket');
    const modal = document.getElementById('createRemedyTicketModal');
    const closeBtn = document.getElementById('createRemedyTicketClose');
    const cancelBtn = document.getElementById('createRemedyTicketCancel');
    const confirmBtn = document.getElementById('createRemedyTicketConfirm');
    const selectType = document.getElementById('createRemedyType');

    if (selectType) {
        // Generar opciones dinámicamente
        selectType.innerHTML = '<option value="" disabled selected>-- Seleccione una tipificación --</option>';
        
        const incGroup = document.createElement('optgroup');
        incGroup.label = 'Incidentes / Consultas INC';
        
        const woGroup = document.createElement('optgroup');
        woGroup.label = 'Órdenes de Trabajo WO';
        
        Object.entries(REMEDY_CLASSIFICATIONS).forEach(([key, spec]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = spec.label;
            if (spec.type === 'INC') {
                incGroup.appendChild(opt);
            } else {
                woGroup.appendChild(opt);
            }
        });
        
        selectType.appendChild(incGroup);
        selectType.appendChild(woGroup);
        
        selectType.addEventListener('change', (e) => {
            renderRemedyDynamicFields(e.target.value);
        });
    }

    if (btnCreate) {
        btnCreate.addEventListener('click', () => {
            if (selectType) selectType.value = '';
            
            const dynCont = document.getElementById('remedyDynamicFields');
            const dynHead = document.getElementById('remedyDynamicFieldsHeader');
            if (dynCont) dynCont.innerHTML = '';
            if (dynHead) dynHead.style.display = 'none';
            
            const errEl = document.getElementById('createRemedyError');
            if (errEl) errEl.style.display = 'none';
            
            modal.classList.add('open');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => modal.classList.remove('open'));
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            const typeKey = selectType.value;
            const errEl = document.getElementById('createRemedyError');

            if (!typeKey) {
                errEl.textContent = 'Por favor selecciona la tipificación de solicitud.';
                errEl.style.display = 'block';
                return;
            }

            const spec = REMEDY_CLASSIFICATIONS[typeKey];
            if (!spec) return;

            // Validar y recolectar campos dinámicos
            const dynamicValues = [];
            let hasErrors = false;

            for (const f of spec.fields) {
                const el = document.getElementById(`dyn_remedy_${f.id}`);
                if (!el) continue;
                const val = el.value.trim();
                if (f.required && !val) {
                    errEl.textContent = `El campo "${f.label}" es obligatorio.`;
                    errEl.style.display = 'block';
                    el.focus();
                    hasErrors = true;
                    break;
                }
                dynamicValues.push(`${f.label}: ${val}`);
            }

            if (hasErrors) return;

            if (errEl) errEl.style.display = 'none';
            confirmBtn.disabled = true;
            document.getElementById('createRemedyTicketConfirmLabel').textContent = 'Creando...';

            try {
                const uStatus = window.remedyUserStatus || {};
                const firstName = uStatus.firstName || uStatus.username || 'Usuario';
                const lastName = uStatus.lastName || '.';
                const company = uStatus.company || 'EMPRESA';

                // Compilar la descripción detallada de forma directa y simplificada
                let formattedDescription = '';
                if (spec.fields.length === 1 && spec.fields[0].id === 'notas') {
                    const notasEl = document.getElementById('dyn_remedy_notas');
                    formattedDescription = notasEl ? notasEl.value.trim() : '';
                } else {
                    formattedDescription = dynamicValues.join('\n');
                }
                
                const summary = spec.label.replace(/\s*\(INC\)\s*|\s*\(WO\)\s*/i, '').trim();

                const payload = {
                    firstName,
                    lastName,
                    company,
                    summary,
                    description: formattedDescription,
                    priority: spec.priority || 'Low',
                    op_tier_1: spec.op_tier_1,
                    op_tier_2: spec.op_tier_2,
                    op_tier_3: spec.op_tier_3
                };

                const res = await API.createRemedyTicket(spec.type, payload);
                if (res && res.ticketId) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Ticket Creado con Éxito',
                        text: `Se creó el ticket ${res.ticketId} en Remedy bajo la clasificación ${spec.label}.`,
                        confirmButtonColor: 'var(--primary)'
                    });
                    modal.classList.remove('open');
                    
                    // Recargar los tickets en caliente
                    if (typeof loadRemedyTickets === 'function') await loadRemedyTickets();
                } else {
                    throw new Error('No se pudo recuperar el ID del ticket creado.');
                }
            } catch (e) {
                errEl.textContent = e.message || 'Error al intentar crear el caso en Remedy.';
                errEl.style.display = 'block';
            } finally {
                confirmBtn.disabled = false;
                document.getElementById('createRemedyTicketConfirmLabel').textContent = 'Crear Ticket';
            }
        });
    }
};
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCreateTicket);
} else {
    initCreateTicket();
}

function renderRemedyDynamicFields(type) {
    const container = document.getElementById('remedyDynamicFields');
    const header = document.getElementById('remedyDynamicFieldsHeader');
    if (!container || !header) return;

    container.innerHTML = '';
    
    const spec = REMEDY_CLASSIFICATIONS[type];
    if (!spec) {
        header.style.display = 'none';
        return;
    }

    header.style.display = 'block';

    spec.fields.forEach(f => {
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'field';
        fieldDiv.style.marginTop = '12px';

        const label = document.createElement('label');
        label.innerHTML = `${f.label} ${f.required ? '<span style="color: var(--danger);">*</span>' : ''}`;
        fieldDiv.appendChild(label);

        let input;
        if (f.type === 'select') {
            input = document.createElement('select');
            input.style.width = '100%';
            input.style.background = 'var(--surface)';
            input.style.border = '1px solid var(--border)';
            input.style.borderRadius = 'var(--radius)';
            input.style.padding = '8px 10px';
            input.style.fontFamily = 'inherit';
            input.style.fontSize = '13.5px';
            input.style.color = 'var(--text)';
            input.style.marginTop = '4px';
            input.style.cursor = 'pointer';

            f.options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = opt;
                input.appendChild(o);
            });
        } else if (f.type === 'textarea') {
            input = document.createElement('textarea');
            input.style.width = '100%';
            input.style.height = '72px';
            input.style.minHeight = '72px';
            input.style.resize = 'vertical';
            input.style.background = 'var(--surface)';
            input.style.border = '1px solid var(--border)';
            input.style.borderRadius = 'var(--radius)';
            input.style.padding = '8px 10px';
            input.style.fontFamily = 'inherit';
            input.style.fontSize = '13.5px';
            input.style.color = 'var(--text)';
            input.style.marginTop = '4px';
            input.placeholder = f.placeholder || '';
        } else if (f.type === 'date') {
            input = document.createElement('input');
            input.type = 'date';
            input.style.width = '100%';
            input.style.background = 'var(--surface)';
            input.style.border = '1px solid var(--border)';
            input.style.borderRadius = 'var(--radius)';
            input.style.padding = '8px 10px';
            input.style.fontFamily = 'inherit';
            input.style.fontSize = '13.5px';
            input.style.color = 'var(--text)';
            input.style.marginTop = '4px';
            input.style.cursor = 'pointer';
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.style.width = '100%';
            input.style.background = 'var(--surface)';
            input.style.border = '1px solid var(--border)';
            input.style.borderRadius = 'var(--radius)';
            input.style.padding = '8px 10px';
            input.style.fontFamily = 'inherit';
            input.style.fontSize = '13.5px';
            input.style.color = 'var(--text)';
            input.style.marginTop = '4px';
            input.placeholder = f.placeholder || '';
        }

        input.id = `dyn_remedy_${f.id}`;
        input.dataset.label = f.label;
        if (f.required) input.required = true;

        fieldDiv.appendChild(input);
        container.appendChild(fieldDiv);
    });
}


// Expose to window for global module compatibility
window.renderRemedyDynamicFields = renderRemedyDynamicFields;
