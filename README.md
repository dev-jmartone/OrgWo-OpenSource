# ⚡ OrgWo — Open Work Orders & IT Workplace Provisioning Orchestrator

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Framework: Flask 3.0](https://img.shields.io/badge/framework-Flask%203.0-green.svg)](https://flask.palletsprojects.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Database: SQLite WAL](https://img.shields.io/badge/database-SQLite%20WAL-lightgrey.svg)](https://www.sqlite.org/)
[![ITSM: BMC Remedy ARS](https://img.shields.io/badge/ITSM-BMC%20Remedy-orange.svg)](https://www.bmc.com/)
[![Demo: Zero-Config Ready](https://img.shields.io/badge/Demo-Zero--Config%20Ready-brightgreen.svg)](#-modo-demostración-zero-config--simulación-de-remedy)

**OrgWo** (*Open Work Orders & Workspace Orchestrator*) es una plataforma web enterprise diseñada para la **gestión operativa, aprovisionamiento integral de puestos de trabajo (Tech Refresh) y orquestación logística de hardware corporativo** (notebooks, desktops, celulares de flota, periféricos inalámbricos, auriculares/vinchas, cargadores y monitores).

El sistema conecta el flujo macro de la mesa de ayuda corporativa con la realidad operativa del técnico en sitio: integra tableros Kanban, un **motor de despacho inteligente balanceado (Dispatcher)**, digitalización de remitos mediante **OCR**, automatización de correos en **Microsoft Outlook**, trazabilidad de borrado seguro (*data wipe*) y sincronización bidireccional con **BMC Remedy AR System (ITSM)** para Incidencias (INC) y Órdenes de Trabajo (WO).

> [!TIP]
> **Listo para probar en segundos:** OrgWo incluye un **Motor de Simulación Integrado (Mock Mode)** y bases de datos pre-sembradas con más de 120 casos y métricas. Puedes clonar y explorar la demo completa de inmediato **sin necesidad de contar con un servidor BMC Remedy real**.

---

## 🎯 ¿Qué problemática resuelve OrgWo?

En organizaciones medianas y grandes, el ciclo de vida del puesto de trabajo y la renovación tecnológica (*Tech Refresh*) por amortización o fin de leasing suele fragmentarse entre múltiples herramientas desconectadas:

1. **Descentralización y desincronización:** Planillas Excel obsoletas compartidas entre técnicos y coordinadores que no reflejan el estado real de la entrega.
2. **Falta de visibilidad de los hitos del ciclo de vida:** El recambio exige etapas coordinadas: primer contacto, recolección de credenciales, configuración con Autopilot/MDM, coordinación presencial o postal, firma de remito, custodia del equipo saliente, borrado seguro de datos (*wipe*) y adjunto de evidencia al ticket corporativo.
3. **Sobrecarga y asignación manual en la mesa de ayuda:** Dificultad para balancear tickets entrantes entre operadores según especialización técnica (Nivel 1 para periféricos vs. Nivel 2 para configuraciones avanzadas).
4. **Auditoría y cadena de custodia física:** Pérdida de trazabilidad de remitos firmados y falta de estadísticas de cumplimiento de SLAs sin exponer datos personales sensibles.

**OrgWo unifica todo este ecosistema** en una solución liviana, rápida y desacoplada que puede operar tanto integrada a la infraestructura corporativa de Remedy y Outlook como de forma 100% autónoma en servidores locales o contenedores Docker.

---

## 🚀 Modo Demostración Zero-Config / Simulación de Remedy

Para evaluar el sistema en GitHub o realizar demostraciones sin depender de la infraestructura de una red empresarial privada, **OrgWo incorpora un motor de simulación nativo (`mock_remedy.py`)**:

* **Simulación completa de API REST de Remedy:** Permite autenticarse, consultar la cartelera de tickets (INC y WO), ver bitácoras históricas (WorkLogs), tomar tickets (*take ticket*), cambiar estados (Pendiente, Resuelto, Cerrado) y ejecutar rondas del Despachador Automático.
* **Auto-conexión transparente:** Al iniciar sesión con cualquier usuario de prueba en OrgWo, la conexión con Remedy se establece automáticamente en modo demo, mostrando el indicador verde de conectividad activa.
* **Transición inmediata a Producción:** Para conectar contra un entorno corporativo real de Remedy, basta con modificar una variable en el archivo `.env`:
  ```ini
  REMEDY_MOCK_MODE=false
  REMEDY_BASE_URL_PROD=https://remedy.tuempresa.com
  REMEDY_BASE_URL_QA=https://remedy-qa.tuempresa.com
  ```

---

## 📁 Arquitectura del Proyecto

```text
OrgWo/
│
├── Backend/                            # Servidor REST en Python / Flask
│   ├── api/                            # Controladores y endpoints REST
│   │   ├── auth_routes.py              # Autenticación local, perfiles y sesiones
│   │   ├── cases_routes.py             # CRUD de casos, transiciones Kanban y notas
│   │   ├── remedy_routes.py            # Orquestación con BMC Remedy (o Mock)
│   │   ├── admin_stats_routes.py       # Métricas consolidadas de soporte y grupos
│   │   ├── metrics_routes.py           # Telemetría de sistema (CPU, RAM, DB latency)
│   │   ├── settings_routes.py          # Preferencias del usuario y checklists dinámicos
│   │   ├── stream_routes.py            # Server-Sent Events (SSE) para tiempo real
│   │   └── users_lookup.py             # Directorio unificado de colaboradores
│   ├── base_datos/                     # Capa de persistencia SQLite (WAL Mode)
│   │   ├── connection.py               # Pool y context managers seguros
│   │   ├── schema.py                   # Esquema relacional DDL y migraciones
│   │   └── repository/                 # Repositorios tipados de acceso a datos
│   ├── integraciones/                  # Conectores externos y subsistemas
│   │   ├── remedy/                     # Cliente HTTP ARS, parsers y mock_remedy.py
│   │   ├── outlook/                    # Conector COM con Outlook (GAL / Drafts)
│   │   └── ocr/                        # Procesamiento OCR de remitos escaneados
│   ├── servicios/                      # Lógica de negocio del dominio
│   │   ├── cases.py                    # Máquina de estados del ciclo de recambio
│   │   ├── dispatcher.py               # Motor de balanceo y asignación automática
│   │   ├── remedy_session.py           # Gestor en memoria de tokens AR-JWT
│   │   ├── remedy_stats.py             # Extracción y consolidación estadística
│   │   ├── users_directory.py          # Directorio sincronizado de colaboradores
│   │   └── backup.py                   # Respaldos automatizados de base de datos
│   ├── config.py                       # Configuración centralizada vía variables .env
│   ├── main.py                         # Entrada del servidor WSGI / Waitress
│   └── utils.py                        # Validaciones, criptografía y helpers
│
├── Frontend/                           # Single-Page Application (SPA moderna)
│   ├── index.html                      # Panel de control principal unificado
│   ├── GeneradorManual.html            # Generador manual de actas de entrega
│   ├── GeneradorQR.html                # Emisor de remitos con códigos QR dinámicos
│   ├── GeneradorVisa.html              # Generador masivo de plantillas de entrega
│   ├── css/
│   │   └── styles.css                  # Sistema de diseño Fluent / Dark Mode
│   └── js/
│       ├── boot/                       # Inicialización, arranque y SSE
│       ├── core/                       # Cliente HTTP, estado global y utilidades
│       ├── domain/                     # Especificaciones de plantillas y modelos
│       └── ui/                         # Vistas: Kanban, Lista, Calendario, Dispatcher,
│                                       # Cartelera Remedy, Métricas y Drawer lateral
│
├── database/                           # Almacenamiento SQLite y scripts de seed
│   ├── data.db                         # Base de datos de Producción (pre-sembrada)
│   ├── data_qa.db                      # Base de datos de Testing / QA (pre-sembrada)
│   └── seed_db.py                      # Seeder con 120+ casos y métricas históricas
│
├── docs/                               # Documentación técnica extendida
│   ├── DOCUMENTACION_REMEDY.md         # Manual exhaustivo de la API REST de Remedy
│   ├── remedy_integration_guide.md     # Guía de arquitectura ARS
│   └── remedy_token_y_servidores.md    # Manejo de tokens y rotación en RAM
│
├── json/                               # Ejemplos de payloads crudos de Remedy ITSM
├── Dockerfile                          # Contenedor optimizado Python + Gunicorn
├── docker-compose.yml                  # Orquestador Docker Compose
├── requirements.txt                    # Dependencias oficiales de Python
├── iniciar_prod.bat                    # Lanzador Windows (Entorno Producción local)
├── iniciar_qa.bat                      # Lanzador Windows (Entorno QA / Testing)
└── iniciar.bat                         # Lanzador rápido con Docker
```

---

## ⚡ Cómo Iniciar el Proyecto

### Opción 1: Lanzadores rápidos en Windows (.bat)

El proyecto incluye scripts por lotes que detectan automáticamente el intérprete de Python instalado en el sistema, instalan dependencias si faltan e inician el servidor abriendo el navegador:

* **Entorno de Testing / QA (Puerto 5001):**
  ```cmd
  iniciar_qa.bat
  ```
* **Entorno de Producción Local (Puerto 5000):**
  ```cmd
  iniciar_prod.bat
  ```

---

### Opción 2: Ejecución estándar con Python

1. **Crear y activar el entorno virtual:**
   ```bash
   python -m venv .venv
   # En Windows:
   .venv\Scripts\activate
   # En Linux / macOS:
   source .venv/bin/activate
   ```

2. **Instalar dependencias:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Iniciar el servidor:**
   ```bash
   python Backend/main.py
   ```
   Abre en tu navegador: [http://localhost:5000](http://localhost:5000)

---

### Opción 3: Despliegue con Docker y Docker Compose

```bash
docker compose up --build
```
Para detener el contenedor:
```bash
docker compose down
```

---

## 🔐 Credenciales de Acceso Preconfiguradas

Las bases de datos pre-sembradas (`database/data.db` y `database/data_qa.db`) incluyen cuentas de prueba para evaluar los distintos roles del sistema:

| Usuario | Contraseña | Rol | Nivel Técnico | Descripción del Perfil |
| :--- | :--- | :---: | :---: | :--- |
| **`admin`** | `admin123` | **Dispatcher** (Supervisor) | Nivel 2 | Acceso total a métricas, panel de despacho automático, reasignación y configuración. |
| **`tecnico1`** | `tecnico123` | **Técnico** | Nivel 1 | Operador de soporte (Carlos Gomez). Gestión de casos asignados y entregas estándar. |
| **`tecnico2`** | `tecnico123` | **Técnico** | Nivel 2 | Operadora senior (Laura Martinez). Gestión de casos complejos y configuraciones avanzadas. |
| **`tecnico3`** | `tecnico123` | **Técnico** | Nivel 1 | Operador de soporte (Diego Fernandez). |

> [!NOTE]
> Al ingresar con cualquiera de estas cuentas, la sesión de Remedy se conectará automáticamente en modo simulación (indicador verde en la barra superior).

---

## 🖥️ Módulos y Funcionalidades Principales

### 1. Tablero Kanban y Vista de Lista Interactiva
* **Filtros multinivel:** Búsqueda por texto, estado del ciclo de vida, tipificación de hardware y rango de fechas.
* **Etapas del ciclo de vida del recambio:**
  `Asignado` ➔ `Contacto` ➔ `Esperando` ➔ `Credenciales` ➔ `Configuración/Autopilot` ➔ `Coordinación` ➔ `Aprobación` ➔ `Wipe / Borrado` ➔ `Escaneo Remito` ➔ `Cerrado`.
* **Drawer lateral de detalle:** Edición rápida, bitácora de eventos, checklist de tareas por tipo de dispositivo y cierre directo de órdenes de trabajo.

### 2. Cartelera y Sincronización BMC Remedy (ITSM)
* **Conexión en tiempo real:** Visualización inmediata de tickets de incidentes (`HPD:Help Desk`) y órdenes de trabajo (`WOI:WorkOrder`).
* **Toma de tickets (*Take Ticket*):** Asignación con un solo clic que actualiza el responsable en Remedy y crea automáticamente el caso local vinculado.
* **Detección inteligente de chatbots:** Parser capaz de desempaquetar tickets cargados automáticamente por Chatbots de IA (identificando al usuario final real y sus datos de contacto).

### 3. Despachador Inteligente de Carga (*Smart Dispatcher*)
* **Asignación automática y ponderada:** Distribuye tickets entrantes de la mesa de ayuda entre los técnicos disponibles en línea.
* **Respeto de niveles y complejidad:** Los periféricos (teclados, mouse, vinchas, cargadores) son dirigidos a técnicos Nivel 1, mientras que notebooks, configuraciones de red y software corporativo son balanceados hacia técnicos Nivel 2.
* **Gestión de disponibilidad:** Monitoreo del estado operativo del técnico (Disponible, En Pausa, Guardia, Desconectado).

### 4. Generadores de Actas, Remitos y Códigos QR
* Formularios para emisión de actas de entrega de equipamiento y comprobantes de devolución.
* Exportación a PDF e integración con Microsoft Outlook mediante el protocolo custom `templategen://` registrado por `ConfigurarEnvios.bat` o generación de archivos `.eml`.

### 5. Métricas, SLAs y Telemetría del Sistema
* Análisis de volumen por mes, tipología de hardware y cumplimiento de SLAs.
* Reportes de incidentes consolidados por empresa y unidad de negocio en formato anónimo.
* Monitor de salud local: porcentaje de uso de memoria RAM, carga de CPU y latencia de consultas SQLite.

---

## 🗄️ Base de Datos y Regeneración de Datos de Prueba

El proyecto utiliza **SQLite** configurado en modo **WAL (*Write-Ahead Logging*)**, asegurando concurrencia fluida para múltiples lectores simultáneos y despliegue sin configuración de base de datos externa.

Para restaurar o refrescar los datos de prueba con más de 120 casos nuevos, eventos y tickets de Remedy:

```bash
python database/seed_db.py
```

---

## ⚙️ Variables de Entorno (`.env`)

| Variable | Descripción | Valor por Defecto |
| :--- | :--- | :--- |
| `ENV` | Entorno de ejecución (`QA` o `PROD`). Selecciona la base de datos correspondiente. | `QA` |
| `PORT` | Puerto de escucha del servidor web. | `5000` |
| `HOST` | Interfaz de enlace de red (`0.0.0.0` para todas, `127.0.0.1` para local). | `0.0.0.0` |
| `REMEDY_MOCK_MODE` | Activa la simulación completa de Remedy en memoria para demos y pruebas. | `true` |
| `REMEDY_BASE_URL_PROD` | Endpoint de producción de la API REST de Remedy ARS. | `https://remedy.yourcompany.com` |
| `REMEDY_BASE_URL_QA` | Endpoint de testing / QA de la API REST de Remedy. | `https://remedy-qa.yourcompany.com` |
| `REMEDY_DEFAULT_COMPANY`| Compañía predeterminada para creación de tickets en Remedy. | `EMPRESA` |
| `ALLOWED_EMAIL_DOMAINS` | Dominios de correo corporativo permitidos (separados por coma). | `empresa.com,subsidiaria.com,...` |

---

## 🛡️ Seguridad y Privacidad en Modo Open Source

1. **Cero credenciales en el repositorio:** La clave secreta de Flask, claves de sesión y credenciales se definen vía variables de entorno o se generan aleatoriamente en memoria volátil.
2. **Anonimización integral:** Toda la información empresarial propietaria (nombres reales, dominios internos y URLs privadas) ha sido sustituida por esquemas estándar y parametrizables.
3. **Control de Acceso Basado en Roles (RBAC):** Separación estricta entre operaciones técnicas y facultades supervisoras de despacho y configuración.

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **MIT**. Puedes utilizarlo, adaptarlo e integrarlo libremente tanto en iniciativas comerciales como proyectos personales.
