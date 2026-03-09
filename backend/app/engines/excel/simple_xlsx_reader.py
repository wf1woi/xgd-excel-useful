from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from xml.etree import ElementTree
from zipfile import ZipFile


XML_NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


@dataclass(frozen=True)
class SimpleSheet:
    name: str
    rows: list[list[str]]


class SimpleXlsxReader:
    def read(self, content: bytes) -> list[SimpleSheet]:
        with ZipFile(BytesIO(content)) as archive:
            workbook_xml = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            workbook_rels_xml = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            shared_strings = self._read_shared_strings(archive)
            rel_map = {
                rel.attrib["Id"]: rel.attrib["Target"]
                for rel in workbook_rels_xml.findall("pkgrel:Relationship", XML_NS)
            }

            sheets: list[SimpleSheet] = []
            for sheet_element in workbook_xml.findall("main:sheets/main:sheet", XML_NS):
                relation_id = sheet_element.attrib.get(f"{{{XML_NS['rel']}}}id")
                if relation_id is None or relation_id not in rel_map:
                    continue
                target = rel_map[relation_id].lstrip("/")
                if not target.startswith("xl/"):
                    target = f"xl/{target}"
                sheet_rows = self._read_sheet_rows(archive.read(target), shared_strings)
                sheets.append(SimpleSheet(name=sheet_element.attrib.get("name", "Sheet"), rows=sheet_rows))
            return sheets

    def _read_shared_strings(self, archive: ZipFile) -> list[str]:
        if "xl/sharedStrings.xml" not in archive.namelist():
            return []
        xml_root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
        values: list[str] = []
        for item in xml_root.findall("main:si", XML_NS):
            texts = [node.text or "" for node in item.findall(".//main:t", XML_NS)]
            values.append("".join(texts))
        return values

    def _read_sheet_rows(self, sheet_xml: bytes, shared_strings: list[str]) -> list[list[str]]:
        xml_root = ElementTree.fromstring(sheet_xml)
        rows: list[list[str]] = []
        for row_element in xml_root.findall(".//main:sheetData/main:row", XML_NS):
            row_values: dict[int, str] = {}
            for cell in row_element.findall("main:c", XML_NS):
                reference = cell.attrib.get("r", "")
                column_index = self._column_reference_to_index(reference)
                row_values[column_index] = self._read_cell_value(cell, shared_strings)
            if not row_values:
                rows.append([])
                continue
            max_index = max(row_values.keys())
            rows.append([row_values.get(index, "").strip() for index in range(max_index + 1)])
        return rows

    def _read_cell_value(self, cell_element, shared_strings: list[str]) -> str:
        cell_type = cell_element.attrib.get("t")
        if cell_type == "inlineStr":
            texts = [node.text or "" for node in cell_element.findall(".//main:t", XML_NS)]
            return "".join(texts)
        value_node = cell_element.find("main:v", XML_NS)
        if value_node is None or value_node.text is None:
            return ""
        raw_value = value_node.text
        if cell_type == "s":
            index = int(raw_value)
            return shared_strings[index] if 0 <= index < len(shared_strings) else ""
        if cell_type == "b":
            return "TRUE" if raw_value == "1" else "FALSE"
        return raw_value

    def _column_reference_to_index(self, reference: str) -> int:
        letters = "".join(char for char in reference if char.isalpha()).upper()
        result = 0
        for char in letters:
            result = result * 26 + (ord(char) - 64)
        return max(result - 1, 0)
