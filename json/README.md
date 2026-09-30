# Estructura y Pipeline de Extracción de Tickets Remedy (OrgWo)

Este directorio contiene ejemplos en formato JSON de cómo están elaborados los tickets en **BMC Remedy AR System** y cómo el motor de ingesta y parseo de **OrgWo** (`Backend/integraciones/remedy/parsers.py` y `Backend/base_datos/repository/`) procesa, clasifica y normaliza la información en la base de datos SQLite o en el motor de simulación mock.

---

## 📁 Archivos Disponibles por Tipificación

| Archivo JSON | Tipificación (`element`) | Formulario Remedy | Canal / Submitter | Empresa Ejemplo |
| :--- | :--- | :--- | :--- | :--- |
| [`ticket_equipo.json`](./ticket_equipo.json) | **Equipo** (Notebook, PC, batería) | `HPD:Help Desk` (INC) | Jarvis Bot | Subsidiaria |
| [`ticket_celular.json`](./ticket_celular.json) | **Celular** (Telefonía móvil, SIM) | `WOI:WorkOrder` (WO) | Manual / Mesa | Empresa Principal |
| [`ticket_vincha.json`](./ticket_vincha.json) | **Vincha** (Headset, auriculares) | `HPD:Help Desk` (INC) | Jarvis Bot | Subsidiaria |
| [`ticket_kit.json`](./ticket_kit.json) | **Kit** (Teclado + Mouse inalámbrico) | `WOI:WorkOrder` (WO) | Jarvis Bot | Empresa Principal (Subsidiaria B) |
| [`ticket_cargador.json`](./ticket_cargador.json) | **Cargador** (Adaptador/Fuente) | `HPD:Help Desk` (INC) | Jarvis Bot | Subsidiaria |
| [`ticket_monitor.json`](./ticket_monitor.json) | **Monitor** (Pantallas, HDMI/DP) | `HPD:Help Desk` (INC) | Jarvis Bot | Empresa Principal |
| [`ticket_red_conectividad.json`](./ticket_red_conectividad.json) | **Red / Conectividad** (WiFi, VPN) | `HPD:Help Desk` (INC) | Jarvis Bot | Subsidiaria |
| [`ticket_software_configuracion.json`](./ticket_software_configuracion.json) | **Software / Configuración** (Apps/Token) | `WOI:WorkOrder` (WO) | Jarvis Bot | Empresa Principal (Subsidiaria B) |
| [`ticket_jarvis_chatbot.json`](./ticket_jarvis_chatbot.json) | **Caso Especial Jarvis** (Desempaquetado) | `HPD:Help Desk` (INC) | Jarvis Bot | Subsidiaria |

---

## 🔍 Estructura de Cada Archivo JSON

Cada archivo `.json` de esta carpeta está dividido en 4 bloques fundamentales:

1. **`origen_remedy`**:
   Indica el formulario base (`HPD:Help Desk` para Incidencias, `WOI:WorkOrder` para Órdenes de Trabajo), el endpoint REST API consumido y el grupo resolutor.

2. **`remedy_raw_api_values`**:
   Representa la carga útil JSON original (los campos "crudos") devuelta por la API REST de BMC Remedy AR System.

3. **`registro_almacenado_en_base_datos`**:
   Muestra el registro normalizado final tal como se guarda en la tabla `cases` de SQLite, listo para ser consumido por el panel web, métricas de grupos y reportes de Excel.

4. **`pipeline_como_se_obtuvo_la_informacion`**:
   Explica paso a paso las reglas de lógica de negocio aplicadas por el parser:
   - **Detección de Jarvis:** Identificación si el ticket fue cargado por el chatbot o un operador humano.
   - **Extracción de Usuario Real:** Expresión regular que recupera el nombre del colaborador del cuerpo del texto cuando el remitente formal es `jarvis`.
   - **Detección de Email y Dominio:** Búsqueda del correo en texto, base local `users_directory`, historial o GAL de Outlook.
   - **Clasificación por Empresa:** Regla determinística por dominio (`@empresa.com`, `@subsidiaria.com`, etc.) y campo `Company`.
   - **Categorización de Tipificación (`element`):** Prevalencia de expresiones regulares y palabras clave sobre el asunto y la descripción técnica.
