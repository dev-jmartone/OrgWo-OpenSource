"""Generador de reportes Excel (.xlsx) nativo OpenXML para Remedy ITSM.

Genera un libro de cálculo Excel (.xlsx) 100% estándar (ECMA-376 / ISO-IEC 29500)
utilizando únicamente la biblioteca estándar de Python (zipfile, io, xml), sin
dependencias externas.

Estructura del libro:
  - Hoja 1: "Resumen Ejecutivo" (Metadatos, KPIs consolidados y comparativa por Empresa).
  - Hojas de Detalle: Detalle por Empresa (Empresas Remedy, Dominios de correo, Tipificaciones Hardware, Categorizaciones BMC, Grupos).
  - Hoja de Listado: "Listado de Tickets" (Tabla plana y completa con todos los tickets individuales para filtrado y tablas dinámicas).
"""
from __future__ import annotations

import io
import re
import zipfile
from datetime import datetime
from typing import Any


def _escape_xml(text: Any) -> str:
    """Escapa caracteres especiales XML para valores de texto."""
    if text is None:
        return ""
    s = str(text)
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&apos;")
    )


def _col_name(n: int) -> str:
    """Convierte un índice de columna 1-indexed a letras Excel (1 -> 'A', 28 -> 'AB')."""
    result = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


# ── Definición de Estilos OpenXML ─────────────────────────────────────────────
# Styles mapping:
#  0: Default normal 10pt
#  1: Workbook Main Title (Navy #1F4E79, White bold 14pt, center)
#  2: Header Empresa Principal (Blue #0078D4, White bold 11pt, left)
#  3: Header Subsidiaria (Purple #8764B8, White bold 11pt, left)
#  4: Table Header Dark (Slate #334155, White bold 10pt, center)
#  5: Table Header Gray Left (Gray #E2E8F0, Dark bold 10pt, left)
#  6: Table Header Gray Center (Gray #E2E8F0, Dark bold 10pt, center)
#  7: Table Header Gray Right (Gray #E2E8F0, Dark bold 10pt, right)
#  8: Data Cell Left (Thin border)
#  9: Data Cell Center (Thin border)
# 10: Data Cell Number Integer (#,##0, Thin border, right)
# 11: Data Cell Number Percent (0.0%, Thin border, right)
# 12: Total Row Label (Bold 10pt, light gray #EDF2F7, left)
# 13: Total Row Number (Bold 10pt, #,##0, light gray #EDF2F7, right)
# 14: Meta Label (Bold 10pt, light gray #F8FAFC, left)
# 15: Meta Value (Normal 10pt, left)

_STYLES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
  </numFmts>
  <fonts count="6">
    <font><sz val="10"/><name val="Segoe UI"/><family val="2"/></font>
    <font><b/><sz val="10"/><name val="Segoe UI"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/><family val="2"/></font>
    <font><b/><sz val="10"/><name val="Segoe UI"/><family val="2"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0078D4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF8764B8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEDF2F7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF334155"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="16">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf>
  </cellXfs>
</styleSheet>"""


class WorksheetBuilder:
    """Constructor dinámico de una hoja de cálculo OpenXML."""

    def __init__(self, name: str, col_widths: list[float] | None = None):
        self.name = name
        self.col_widths = col_widths or []
        self.rows: list[list[dict]] = []
        self.merge_cells: list[str] = []

    def add_row(self, cells: list[dict], height: int | None = None) -> int:
        """Agrega una fila de celdas.

        Cada celda es un dict:
          {"v": valor, "s": style_id (opcional), "t": "n" | "s" | "p" (opcional), "span": int (opcional)}
        """
        row_idx = len(self.rows) + 1
        processed_cells = []
        col_idx = 1

        for c in cells:
            val = c.get("v")
            style = c.get("s", 0)
            ctype = c.get("t")
            span = c.get("span", 1)

            cell_ref = f"{_col_name(col_idx)}{row_idx}"
            processed_cells.append({
                "ref": cell_ref,
                "v": val,
                "s": style,
                "t": ctype,
            })

            if span > 1:
                end_ref = f"{_col_name(col_idx + span - 1)}{row_idx}"
                self.merge_cells.append(f"{cell_ref}:{end_ref}")
                col_idx += span
            else:
                col_idx += 1

        self.rows.append(processed_cells)
        return row_idx

    def add_blank_row(self) -> int:
        self.rows.append([])
        return len(self.rows)

    def render_xml(self) -> str:
        out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']
        out.append('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">')

        # 1. Anchos de columnas (DEBE ir antes de sheetData según el schema OpenXML)
        if self.col_widths:
            out.append('  <cols>')
            for idx, w in enumerate(self.col_widths, start=1):
                out.append(f'    <col min="{idx}" max="{idx}" width="{w}" customWidth="1"/>')
            out.append('  </cols>')

        # 2. Datos de filas
        out.append('  <sheetData>')
        for r_idx, row in enumerate(self.rows, start=1):
            if not row:
                out.append(f'    <row r="{r_idx}"/>')
                continue

            out.append(f'    <row r="{r_idx}">')
            for c in row:
                ref = c["ref"]
                s = c["s"]
                val = c["v"]
                t = c.get("t")

                if val is None or val == "":
                    out.append(f'      <c r="{ref}" s="{s}"/>')
                elif t == "p":
                    # Porcentaje: valor decimal ej. 0.255 para 25.5%
                    pct_val = (val / 100.0) if val > 1.0 else val
                    out.append(f'      <c r="{ref}" s="{s}"><v>{pct_val:.4f}</v></c>')
                elif t == "n" or isinstance(val, (int, float)):
                    out.append(f'      <c r="{ref}" s="{s}"><v>{val}</v></c>')
                else:
                    escaped = _escape_xml(val)
                    out.append(f'      <c r="{ref}" s="{s}" t="inlineStr"><is><t>{escaped}</t></is></c>')
            out.append('    </row>')
        out.append('  </sheetData>')

        # 3. Celdas fusionadas (después de sheetData)
        if self.merge_cells:
            out.append(f'  <mergeCells count="{len(self.merge_cells)}">')
            for mc in self.merge_cells:
                out.append(f'    <mergeCell ref="{mc}"/>')
            out.append('  </mergeCells>')

        out.append('</worksheet>')
        return "\n".join(out)


def build_remedy_report_excel(report: dict, detailed_tickets: list[dict] | None = None) -> bytes:
    """Construye un archivo binario .xlsx completo con múltiples hojas y tablas formateadas."""
    sheets: list[WorksheetBuilder] = []

    # ═════════════════════════════════════════════════════════════════════════════
    # HOJA 1: RESUMEN EJECUTIVO
    # ═════════════════════════════════════════════════════════════════════════════
    ws_resumen = WorksheetBuilder(
        name="Resumen Ejecutivo",
        col_widths=[32, 28, 16, 16, 16, 16, 16, 16, 16],
    )

    # 1. Banner Principal
    ws_resumen.add_row([
        {"v": "REPORTE ESTADÍSTICO CONSOLIDADO DE TICKETS REMEDY POR EMPRESA", "s": 1, "span": 9}
    ])
    ws_resumen.add_blank_row()

    # 2. Metadatos del Reporte
    ws_resumen.add_row([{"v": "PARÁMETROS DEL INFORME", "s": 4, "span": 2}])
    ws_resumen.add_row([{"v": "Rango Temporal / Mes:", "s": 14}, {"v": report.get("month_label", "Histórico"), "s": 15}])
    ws_resumen.add_row([{"v": "Filtro de Empresa Aplicado:", "s": 14}, {"v": report.get("filter_label", "Todas las empresas"), "s": 15}])
    ws_resumen.add_row([{"v": "Canal / Origen:", "s": 14}, {"v": _fmt_origin_label(report.get("origin_filter")), "s": 15}])
    ws_resumen.add_row([{"v": "Total Tickets Procesados (Universo):", "s": 14}, {"v": report.get("total_tickets_processed", 0), "s": 10, "t": "n"}])
    ws_resumen.add_row([{"v": "Fecha de Emisión:", "s": 14}, {"v": report.get("generated_at_friendly", ""), "s": 15}])
    ws_resumen.add_blank_row()

    # 3. Tabla Comparativa de Empresas (Estrictamente separadas)
    ws_resumen.add_row([
        {"v": "COMPARATIVA DE EMPRESAS (MÉTRICAS ESTRICTAMENTE SEPARADAS)", "s": 4, "span": 9}
    ])
    ws_resumen.add_row([
        {"v": "Empresa", "s": 5},
        {"v": "Catalogación", "s": 5},
        {"v": "Total Tickets", "s": 7},
        {"v": "% del Universo", "s": 7},
        {"v": "Abiertos", "s": 7},
        {"v": "Cerrados / Res.", "s": 7},
        {"v": "Incidentes (INC)", "s": 7},
        {"v": "Work Orders (WO)", "s": 7},
        {"v": "Jarvis Bot", "s": 7},
    ])

    for comp in report.get("companies_data", []):
        is_primary = comp.get("company_name") == "Empresa Principal" or "empresa" in str(comp.get("company_name", "")).lower()
        comp_style = 2 if is_primary else 3
        ws_resumen.add_row([
            {"v": comp.get("company_name", "").upper(), "s": comp_style},
            {"v": comp.get("catalog_label", ""), "s": 8},
            {"v": comp.get("total_tickets", 0), "s": 10, "t": "n"},
            {"v": comp.get("percentage_of_universe", 0), "s": 11, "t": "p"},
            {"v": comp.get("open_tickets", 0), "s": 10, "t": "n"},
            {"v": comp.get("closed_tickets", 0), "s": 10, "t": "n"},
            {"v": comp.get("inc_tickets", 0), "s": 10, "t": "n"},
            {"v": comp.get("wo_tickets", 0), "s": 10, "t": "n"},
            {"v": comp.get("jarvis_tickets", 0), "s": 10, "t": "n"},
        ])

    sheets.append(ws_resumen)

    # ═════════════════════════════════════════════════════════════════════════════
    # HOJAS DE DETALLE POR EMPRESA (SEPARADAS)
    # ═════════════════════════════════════════════════════════════════════════════
    for comp in report.get("companies_data", []):
        cname = comp.get("company_name", "").upper()
        clabel = comp.get("catalog_label", "")
        is_primary = comp.get("company_name") == "Empresa Principal" or "empresa" in str(comp.get("company_name", "")).lower()
        header_style = 2 if is_primary else 3

        ws_comp = WorksheetBuilder(
            name=f"Detalle {cname}",
            col_widths=[38, 18, 16, 16, 16],
        )

        # 1. Header de Empresa
        ws_comp.add_row([
            {"v": f"EMPRESA: {cname} ({clabel}) - {report.get('month_label', '')}", "s": header_style, "span": 5}
        ])
        ws_comp.add_row([
            {"v": f"Total de Tickets Procesados: {comp.get('total_tickets', 0):,} ({comp.get('percentage_of_universe', 0)}% del universo) | Abiertos: {comp.get('open_tickets', 0):,} | Cerrados: {comp.get('closed_tickets', 0):,}", "s": 8, "span": 5}
        ])
        ws_comp.add_blank_row()

        # 2. Panel: Datos Reales de Remedy (Campo Company)
        ws_comp.add_row([{"v": "1. DATOS REALES DE REMEDY (Campo Company)", "s": 4, "span": 3}])
        ws_comp.add_row([{"v": "Empresa Registrada en Remedy", "s": 5}, {"v": "Tickets", "s": 7}, {"v": "% del Total Empresa", "s": 7}])
        for rc in comp.get("remedy_companies", []):
            ws_comp.add_row([
                {"v": rc.get("company", ""), "s": 8},
                {"v": rc.get("count", 0), "s": 10, "t": "n"},
                {"v": rc.get("percentage", 0), "s": 11, "t": "p"},
            ])
        ws_comp.add_blank_row()

        # 3. Panel: Extracción por Dominio de Correo
        ws_comp.add_row([{"v": "2. EXTRACCIÓN POR DOMINIO DE CORREO CORPORATIVO", "s": 4, "span": 3}])
        ws_comp.add_row([{"v": "Dominio de Correo", "s": 5}, {"v": "Tickets", "s": 7}, {"v": "% del Total Empresa", "s": 7}])
        for ed in comp.get("email_domains", []):
            ws_comp.add_row([
                {"v": ed.get("domain", ""), "s": 8},
                {"v": ed.get("count", 0), "s": 10, "t": "n"},
                {"v": ed.get("percentage", 0), "s": 11, "t": "p"},
            ])
        ws_comp.add_blank_row()

        # 4. Panel: Tipificación por Elemento / Hardware
        ws_comp.add_row([{"v": "3. TIPIFICACIÓN POR ELEMENTO / HARDWARE / SERVICIO", "s": 4, "span": 5}])
        ws_comp.add_row([
            {"v": "Tipo de Elemento", "s": 5},
            {"v": "Total", "s": 7},
            {"v": "Abiertos", "s": 7},
            {"v": "Cerrados", "s": 7},
            {"v": "% del Total Empresa", "s": 7},
        ])
        for et in comp.get("element_types", []):
            ws_comp.add_row([
                {"v": et.get("name", ""), "s": 8},
                {"v": et.get("count", 0), "s": 10, "t": "n"},
                {"v": et.get("open", 0), "s": 10, "t": "n"},
                {"v": et.get("closed", 0), "s": 10, "t": "n"},
                {"v": et.get("percentage", 0), "s": 11, "t": "p"},
            ])
        ws_comp.add_blank_row()

        # 5. Panel: Categorizaciones BMC Remedy
        ws_comp.add_row([{"v": "4. CATEGORIZACIONES BMC REMEDY (Tier 1 / 2 / 3)", "s": 4, "span": 3}])
        ws_comp.add_row([{"v": "Categorización Remedy", "s": 5}, {"v": "Tickets", "s": 7}, {"v": "% del Total Empresa", "s": 7}])
        for tp in comp.get("tipificaciones", []):
            ws_comp.add_row([
                {"v": tp.get("name", ""), "s": 8},
                {"v": tp.get("count", 0), "s": 10, "t": "n"},
                {"v": tp.get("percentage", 0), "s": 11, "t": "p"},
            ])
        ws_comp.add_blank_row()

        # 6. Panel: Distribución por Grupos de Soporte
        ws_comp.add_row([{"v": "5. DISTRIBUCIÓN POR GRUPO DE SOPORTE", "s": 4, "span": 5}])
        ws_comp.add_row([
            {"v": "Grupo de Soporte", "s": 5},
            {"v": "Total", "s": 7},
            {"v": "Abiertos", "s": 7},
            {"v": "Cerrados", "s": 7},
            {"v": "% del Total Empresa", "s": 7},
        ])
        for gr in comp.get("groups", []):
            ws_comp.add_row([
                {"v": gr.get("group_name", ""), "s": 8},
                {"v": gr.get("count", 0), "s": 10, "t": "n"},
                {"v": gr.get("open", 0), "s": 10, "t": "n"},
                {"v": gr.get("closed", 0), "s": 10, "t": "n"},
                {"v": gr.get("percentage", 0), "s": 11, "t": "p"},
            ])

        sheets.append(ws_comp)

    # ═════════════════════════════════════════════════════════════════════════════
    # HOJA 4: LISTADO DETALLADO DE TICKETS
    # ═════════════════════════════════════════════════════════════════════════════
    if detailed_tickets:
        ws_tickets = WorksheetBuilder(
            name="Listado de Tickets",
            col_widths=[16, 10, 24, 18, 16, 18, 26, 32, 20, 28, 18, 12, 18, 24, 45],
        )

        ws_tickets.add_row([
            {"v": f"LISTADO DETALLADO DE TICKETS PROCESADOS ({len(detailed_tickets):,} registros)", "s": 4, "span": 15}
        ])

        headers = [
            ("ID Ticket", 5),
            ("Tipo", 6),
            ("Grupo Asignado", 5),
            ("Estado", 6),
            ("Empresa Real", 6),
            ("Empresa Remedy", 5),
            ("Solicitante", 5),
            ("Correo Electrónico", 5),
            ("Elemento / Hardware", 5),
            ("Categorización Remedy", 5),
            ("Canal / Origen", 6),
            ("Mes", 6),
            ("Fecha Ingreso", 6),
            ("Técnico Asignado", 5),
            ("Resumen / Asunto", 5),
        ]
        ws_tickets.add_row([{"v": h[0], "s": h[1]} for h in headers])

        status_labels = {
            "1": "Asignado",
            "2": "En Curso",
            "3": "Pendiente",
            "4": "Resuelto / Cerrado",
        }

        for t in detailed_tickets:
            st_raw = str(t.get("status_mapped") or "")
            st_text = status_labels.get(st_raw, st_raw or "Desconocido")
            orig_text = "JARVIS CHATBOT" if t.get("is_jarvis") == 1 else "Canal Directo"

            ws_tickets.add_row([
                {"v": t.get("id", ""), "s": 8},
                {"v": t.get("ticket_type", ""), "s": 9},
                {"v": t.get("group_name", ""), "s": 8},
                {"v": st_text, "s": 9},
                {"v": t.get("user_company", ""), "s": 9},
                {"v": t.get("remedy_company", ""), "s": 8},
                {"v": t.get("client_name", ""), "s": 8},
                {"v": t.get("client_email", ""), "s": 8},
                {"v": t.get("element_type", ""), "s": 8},
                {"v": t.get("tipificacion", ""), "s": 8},
                {"v": orig_text, "s": 9},
                {"v": t.get("submit_month", ""), "s": 9},
                {"v": _clean_date_str(t.get("submit_date")), "s": 9},
                {"v": t.get("assignee_name", ""), "s": 8},
                {"v": (t.get("summary") or "")[:120], "s": 8},
            ])

        sheets.append(ws_tickets)

    # ═════════════════════════════════════════════════════════════════════════════
    # EMPAQUETADO ZIP FINAL (.XLSX)
    # ═════════════════════════════════════════════════════════════════════════════
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. [Content_Types].xml
        ct_lines = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '  <Default Extension="xml" ContentType="application/xml"/>',
            '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
            '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        ]
        for idx in range(1, len(sheets) + 1):
            ct_lines.append(f'  <Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        ct_lines.append('</Types>')
        zf.writestr("[Content_Types].xml", "\n".join(ct_lines))

        # 2. _rels/.rels
        rels_lines = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
            '</Relationships>',
        ]
        zf.writestr("_rels/.rels", "\n".join(rels_lines))

        # 3. xl/_rels/workbook.xml.rels
        wb_rels_lines = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        ]
        for idx in range(1, len(sheets) + 1):
            wb_rels_lines.append(f'  <Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>')
        wb_rels_lines.append('</Relationships>')
        zf.writestr("xl/_rels/workbook.xml.rels", "\n".join(wb_rels_lines))

        # 4. xl/workbook.xml
        wb_lines = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            '  <sheets>',
        ]
        for idx, s in enumerate(sheets, start=1):
            safe_name = _escape_xml(s.name[:31])  # Excel limita nombres de hoja a 31 caracteres
            wb_lines.append(f'    <sheet name="{safe_name}" sheetId="{idx}" r:id="rId{idx}"/>')
        wb_lines.append('  </sheets>')
        wb_lines.append('</workbook>')
        zf.writestr("xl/workbook.xml", "\n".join(wb_lines))

        # 5. xl/styles.xml
        zf.writestr("xl/styles.xml", _STYLES_XML)

        # 6. xl/worksheets/sheetX.xml
        for idx, s in enumerate(sheets, start=1):
            zf.writestr(f"xl/worksheets/sheet{idx}.xml", s.render_xml())

    bio.seek(0)
    return bio.getvalue()


def _fmt_origin_label(origin: str | None) -> str:
    orig = (origin or "all").strip().lower()
    if orig in ("jarvis", "solo_jarvis", "solo jarvis"):
        return "Solo JARVIS CHATBOT"
    if orig in ("no_jarvis", "otros", "no jarvis", "human"):
        return "Solo Otros Canales (No Jarvis)"
    return "Todos los canales (Jarvis + Otros)"


def _clean_date_str(val: Any) -> str:
    if not val:
        return ""
    s = str(val).strip()
    if s.isdigit():
        try:
            num = int(s)
            if num > 100000000000:
                num = num / 1000
            if num > 0:
                return datetime.fromtimestamp(num).strftime("%Y-%m-%d %H:%M")
        except Exception:
            pass
    if "T" in s:
        return s.split(".")[0].replace("T", " ")
    return s[:19]
