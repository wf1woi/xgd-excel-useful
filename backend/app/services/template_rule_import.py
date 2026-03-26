from __future__ import annotations

import re
from collections import defaultdict

from app.engines.excel.simple_xlsx_reader import SimpleSheet, SimpleXlsxReader
from app.models.template_rule_set import TemplateRuleSet
from app.repositories.template_rule_set import TemplateRuleSetRepository
from app.schemas.template_rule_set import (
    TemplateRuleImportFieldCandidate,
    TemplateRuleImportPreviewResponse,
    TemplateRuleImportSheetPreview,
    TemplateRuleImportSheetOption,
    TemplateRuleOutputConfigPayload,
    TemplateRuleOutputFieldPayload,
    TemplateRuleSetCreate,
    TemplateRuleSetResponse,
)
from app.services.template_rule_set import TemplateRuleSetService


RULE_META_FIELD_ALIASES = {
    "反馈人": "反馈人",
    "分公司": "分公司",
    "银行名称": "银行名称",
    "银行名称（出资方名称）": "银行名称（与出资方名称一致）",
    "银行名称（与出资方名称一致）": "银行名称（与出资方名称一致）",
    "频次": "频次",
    "表内容": "表内容",
    "字段": "字段",
}

SUMMARY_AGGREGATE_FIELD_NAMES = {"交易金额(元)", "手续费优惠(元)", "原始手续费(元)"}


def to_column_letter(column_index: int) -> str:
    current = column_index + 1
    result = ""
    while current > 0:
        remainder = (current - 1) % 26
        result = chr(65 + remainder) + result
        current = (current - 1) // 26
    return result


class TemplateRuleImportService:
    def __init__(
        self,
        reader: SimpleXlsxReader,
        repository: TemplateRuleSetRepository,
        rule_service: TemplateRuleSetService,
    ) -> None:
        self.reader = reader
        self.repository = repository
        self.rule_service = rule_service

    def preview(self, content: bytes) -> TemplateRuleImportPreviewResponse:
        sheets = self.reader.read(content)
        if not sheets:
            raise ValueError("规则模板中没有可读取的 sheet")
        selected_sheet = sheets[0]
        previews = []
        for sheet in sheets:
            parsed_rules = self._parse_sheet_rules(sheet)
            previews.append(
                TemplateRuleImportSheetPreview(
                    sheet_name=sheet.name,
                    rule_count=len(parsed_rules),
                    sample_rules=parsed_rules[:3],
                )
            )
        selected_option = self._build_sheet_option(selected_sheet)
        return TemplateRuleImportPreviewResponse(
            sheet_names=[sheet.name for sheet in sheets],
            sheets=previews,
            selected_sheet_name=selected_sheet.name,
            rows=self._clip_rows(selected_sheet.rows),
            max_rows=min(len(selected_sheet.rows), 30),
            max_columns=min(max((len(row) for row in selected_sheet.rows), default=0), 20),
            rule_item_row_index=selected_option.rule_item_row_index,
            output_field_row_index=selected_option.output_field_row_index,
            rule_item_field_candidates=self._build_field_candidates(selected_sheet, selected_option.rule_item_row_index),
            output_field_candidates=self._build_field_candidates(selected_sheet, selected_option.output_field_row_index),
            selected_rule_item_columns=selected_option.rule_item_columns,
            selected_output_field_columns=selected_option.output_field_columns,
        )

    def preview_with_options(
        self,
        content: bytes,
        sheet_name: str | None = None,
        rule_item_row_index: int | None = None,
        output_field_row_index: int | None = None,
        rule_item_columns: list[int] | None = None,
        output_field_columns: list[int] | None = None,
        max_rows: int = 30,
        max_columns: int = 20,
    ) -> TemplateRuleImportPreviewResponse:
        sheets = self.reader.read(content)
        if not sheets:
            raise ValueError("规则模板中没有可读取的 sheet")
        selected_sheet = next((sheet for sheet in sheets if sheet.name == sheet_name), sheets[0])
        selected_option = self._build_sheet_option(
            selected_sheet,
            rule_item_row_index=rule_item_row_index,
            output_field_row_index=output_field_row_index,
            rule_item_columns=rule_item_columns,
            output_field_columns=output_field_columns,
        )
        previews = []
        for sheet in sheets:
            option = selected_option if sheet.name == selected_sheet.name else self._build_sheet_option(sheet)
            parsed_rules = self._parse_sheet_rules(
                sheet,
                rule_item_row_index=option.rule_item_row_index,
                rule_item_columns=option.rule_item_columns,
                output_field_columns=option.output_field_columns,
            )
            previews.append(
                TemplateRuleImportSheetPreview(
                    sheet_name=sheet.name,
                    rule_count=len(parsed_rules),
                    sample_rules=parsed_rules[:3],
                )
            )
        return TemplateRuleImportPreviewResponse(
            sheet_names=[sheet.name for sheet in sheets],
            sheets=previews,
            selected_sheet_name=selected_sheet.name,
            rows=self._clip_rows(selected_sheet.rows, max_rows=max_rows, max_columns=max_columns),
            max_rows=min(len(selected_sheet.rows), max_rows),
            max_columns=min(max((len(row) for row in selected_sheet.rows), default=0), max_columns),
            rule_item_row_index=selected_option.rule_item_row_index,
            output_field_row_index=selected_option.output_field_row_index,
            rule_item_field_candidates=self._build_field_candidates(selected_sheet, selected_option.rule_item_row_index),
            output_field_candidates=self._build_field_candidates(selected_sheet, selected_option.output_field_row_index),
            selected_rule_item_columns=selected_option.rule_item_columns,
            selected_output_field_columns=selected_option.output_field_columns,
        )

    def import_selected_sheets(
        self,
        content: bytes,
        selected_sheets: list[str],
        sheet_options: list[TemplateRuleImportSheetOption] | None = None,
    ) -> list[TemplateRuleSetResponse]:
        if not selected_sheets:
            raise ValueError("至少选择一个规则分类 sheet")
        sheets = self.reader.read(content)
        option_map = {
            item.sheet_name: item
            for item in (sheet_options or [])
        }
        imported_rules: list[TemplateRuleSetResponse] = []
        for sheet in sheets:
            if sheet.name not in selected_sheets:
                continue
            option = option_map.get(sheet.name)
            option_outputs = option.outputs if option and option.outputs else None
            resolved_option = self._build_sheet_option(
                sheet,
                rule_item_row_index=option.rule_item_row_index if option else None,
                output_field_row_index=option.output_field_row_index if option else None,
                rule_item_columns=option.rule_item_columns if option else None,
                output_field_columns=option.output_field_columns if option else None,
            )
            for index, parsed_rule in enumerate(
                self._parse_sheet_rules(
                    sheet,
                    rule_item_row_index=resolved_option.rule_item_row_index,
                    rule_item_columns=resolved_option.rule_item_columns,
                    output_field_columns=resolved_option.output_field_columns,
                ),
                start=1,
            ):
                payload = TemplateRuleSetCreate(
                    rule_code=self._build_rule_code(sheet.name, parsed_rule, index),
                    rule_name=self._build_rule_name(parsed_rule),
                    group_name=sheet.name,
                    source_sheet_name=sheet.name,
                    description=f"由规则模板导入，来源 sheet：{sheet.name}",
                    rule_item=parsed_rule["rule_item"],
                    outputs=option_outputs or parsed_rule["outputs"],
                    status="active",
                    version=1,
                )
                created = self.rule_service.create_rule(payload)
                imported_rules.append(TemplateRuleSetResponse.model_validate(created))
        if not imported_rules:
            raise ValueError("未从所选 sheet 中解析到可导入的规则")
        return imported_rules

    def _parse_sheet_rules(
        self,
        sheet: SimpleSheet,
        rule_item_row_index: int | None = None,
        rule_item_columns: list[int] | None = None,
        output_field_columns: list[int] | None = None,
    ) -> list[dict]:
        if not sheet.rows:
            return []
        option = self._build_sheet_option(
            sheet,
            rule_item_row_index=rule_item_row_index,
            rule_item_columns=rule_item_columns,
            output_field_columns=output_field_columns,
        )
        if option.rule_item_row_index is None:
            return []
        resolved_header_row_index = option.rule_item_row_index - 1
        headers = [cell.strip() for cell in sheet.rows[resolved_header_row_index]]
        groups: dict[str, dict] = {}
        carry_values: dict[int, str] = defaultdict(str)

        for row in sheet.rows[resolved_header_row_index + 1:]:
            normalized = self._normalize_row(
                row=row,
                carry_values=carry_values,
                headers=headers,
                rule_item_columns=option.rule_item_columns,
            )
            output_fields = self._resolve_output_fields(row, option.output_field_columns)
            if not any(normalized.values()):
                continue

            table_content = normalized.get("表内容", "")
            if not table_content and not output_fields:
                continue

            rule_item = {
                key: value
                for key, value in normalized.items()
                if key not in {"表内容", "字段"} and value
            }
            if not rule_item:
                continue

            group_key = "|".join([rule_item.get("反馈人", ""), rule_item.get("分公司", ""), rule_item.get("银行名称（与出资方名称一致）", rule_item.get("银行名称", "")), rule_item.get("频次", "")])
            if group_key not in groups:
                groups[group_key] = {
                    "rule_item": rule_item,
                    "outputs": {},
                }

            if not table_content:
                continue

            output_key = self._resolve_output_key(table_content)
            output = groups[group_key]["outputs"].setdefault(
                output_key,
                {
                    "output_key": output_key,
                    "sheet_name": self._resolve_output_sheet_name(table_content),
                    "source_type": "aggregated_summary" if output_key == "summary" else "filtered_detail",
                    "title_rows": ["账单明细信息如下："] if output_key == "detail" else [],
                    "fields": [],
                    "filters": self._build_default_filters(rule_item),
                    "group_by_fields": [],
                    "aggregations": [],
                    "preview_summary_items": [],
                    "sort_by": [],
                },
            )
            for field_name in output_fields:
                self._append_output_field(output, field_name)

        parsed_rules: list[dict] = []
        for item in groups.values():
            outputs = [self._finalize_output_config(output) for output in item["outputs"].values()]
            if outputs:
                parsed_rules.append(
                    {
                        "rule_item": item["rule_item"],
                        "outputs": outputs,
                    }
                )
        return parsed_rules

    def _find_header_row_index(self, rows: list[list[str]]) -> int | None:
        for index, row in enumerate(rows):
            normalized = {cell.strip() for cell in row if cell.strip()}
            if {"反馈人", "分公司", "频次", "表内容", "字段"}.issubset(normalized):
                return index + 1
        return None

    def _normalize_row(
        self,
        row: list[str],
        carry_values: dict[int, str],
        headers: list[str],
        rule_item_columns: list[int],
    ) -> dict[str, str]:
        normalized: dict[str, str] = {}
        for column_index in rule_item_columns:
            header = headers[column_index].strip() if column_index < len(headers) else ""
            if not header:
                continue
            current_value = row[column_index].strip() if column_index < len(row) else ""
            if current_value:
                carry_values[column_index] = current_value
            alias = RULE_META_FIELD_ALIASES.get(header, header)
            normalized[alias] = current_value or carry_values.get(column_index, "")
        return normalized

    def _resolve_output_fields(self, row: list[str], output_field_columns: list[int]) -> list[str]:
        fields: list[str] = []
        for column_index in output_field_columns:
            if column_index >= len(row):
                continue
            value = row[column_index].strip()
            if value:
                fields.append(value)
        return fields

    def _build_sheet_option(
        self,
        sheet: SimpleSheet,
        rule_item_row_index: int | None = None,
        output_field_row_index: int | None = None,
        rule_item_columns: list[int] | None = None,
        output_field_columns: list[int] | None = None,
    ) -> TemplateRuleImportSheetOption:
        resolved_rule_item_row_index = rule_item_row_index or self._find_header_row_index(sheet.rows)
        resolved_rule_item_columns = rule_item_columns or self._infer_rule_item_columns(sheet, resolved_rule_item_row_index)
        resolved_output_field_row_index = output_field_row_index or self._infer_output_field_row_index(sheet, resolved_rule_item_row_index)
        resolved_output_field_columns = output_field_columns or self._infer_output_field_columns(sheet, resolved_output_field_row_index, resolved_rule_item_columns)
        return TemplateRuleImportSheetOption(
            sheet_name=sheet.name,
            rule_item_row_index=resolved_rule_item_row_index if resolved_rule_item_row_index and resolved_rule_item_row_index > 0 else None,
            output_field_row_index=resolved_output_field_row_index if resolved_output_field_row_index and resolved_output_field_row_index > 0 else None,
            rule_item_columns=resolved_rule_item_columns,
            output_field_columns=resolved_output_field_columns,
        )

    def _build_field_candidates(self, sheet: SimpleSheet, row_index: int | None) -> list[TemplateRuleImportFieldCandidate]:
        if not row_index or row_index - 1 >= len(sheet.rows):
            return []
        row = sheet.rows[row_index - 1]
        return [
            TemplateRuleImportFieldCandidate(
                column_index=column_index,
                column_letter=to_column_letter(column_index),
                field_name=value.strip(),
            )
            for column_index, value in enumerate(row)
            if value.strip()
        ]

    def _infer_rule_item_columns(self, sheet: SimpleSheet, rule_item_row_index: int | None) -> list[int]:
        if not rule_item_row_index or rule_item_row_index - 1 >= len(sheet.rows):
            return []
        row = sheet.rows[rule_item_row_index - 1]
        selected_columns = [
            index
            for index, value in enumerate(row)
            if value.strip() in RULE_META_FIELD_ALIASES
        ]
        return selected_columns

    def _infer_output_field_row_index(self, sheet: SimpleSheet, rule_item_row_index: int | None) -> int | None:
        if not rule_item_row_index:
            return None
        next_row_index = rule_item_row_index + 1
        return next_row_index if next_row_index <= len(sheet.rows) else None

    def _infer_output_field_columns(
        self,
        sheet: SimpleSheet,
        output_field_row_index: int | None,
        rule_item_columns: list[int],
    ) -> list[int]:
        if not output_field_row_index or output_field_row_index - 1 >= len(sheet.rows):
            return []
        row = sheet.rows[output_field_row_index - 1]
        return [
            index
            for index, value in enumerate(row)
            if value.strip() and index not in set(rule_item_columns)
        ]

    def _resolve_output_key(self, table_content: str) -> str:
        if "汇总" in table_content:
            return "summary"
        if "明细" in table_content:
            return "detail"
        sanitized = re.sub(r"[^0-9A-Za-z\u4e00-\u9fa5]+", "_", table_content).strip("_")
        return sanitized.lower() or "detail"

    def _resolve_output_sheet_name(self, table_content: str) -> str:
        if "汇总" in table_content:
            return "汇总表"
        if "明细" in table_content:
            return "明细表"
        return table_content.strip() or "Sheet"

    def _build_default_filters(self, rule_item: dict[str, str]) -> list[dict]:
        filters = []
        bank_name = rule_item.get("银行名称（与出资方名称一致）") or rule_item.get("银行名称")
        if bank_name:
            filters.append(
                {
                    "field_name": "出资方名称",
                    "operator": "eq",
                    "value_template": "${银行名称（与出资方名称一致）}",
                }
            )
        if rule_item.get("频次") == "按月":
            filters.append(
                {
                    "field_name": "交易时间",
                    "operator": "month_eq",
                    "value_template": "${__export_month__}",
                }
            )
        return filters

    def _append_output_field(self, output: dict, field_name: str) -> None:
        existing_fields = {item["field_name"] for item in output["fields"]}
        if field_name in existing_fields:
            return
        output["fields"].append(
            {
                "field_name": field_name,
                "display_name": field_name,
                "field_order": len(output["fields"]) + 1,
                "is_enabled": True,
            }
        )

    def _finalize_output_config(self, output: dict) -> TemplateRuleOutputConfigPayload:
        if output["output_key"] == "summary":
            group_by_fields = []
            aggregations = []
            for field in output["fields"]:
                field_name = field["field_name"]
                if field_name in SUMMARY_AGGREGATE_FIELD_NAMES:
                    aggregations.append(
                        {
                            "field_name": field_name,
                            "aggregate_func": "sum",
                            "alias": field_name,
                        }
                    )
                else:
                    group_by_fields.append(field_name)
            output["group_by_fields"] = group_by_fields
            output["aggregations"] = aggregations
        return TemplateRuleOutputConfigPayload(
            output_key=output["output_key"],
            sheet_name=output["sheet_name"],
            source_type=output["source_type"],
            title_rows=output["title_rows"],
            fields=[TemplateRuleOutputFieldPayload(**field) for field in output["fields"]],
            filters=output["filters"],
            group_by_fields=output["group_by_fields"],
            aggregations=output["aggregations"],
            sort_by=output["sort_by"],
        )

    def _build_rule_name(self, parsed_rule: dict) -> str:
        rule_item = parsed_rule["rule_item"]
        bank_name = rule_item.get("银行名称（与出资方名称一致）") or rule_item.get("银行名称") or "未命名银行"
        frequency = rule_item.get("频次") or "未定义频次"
        return f"{bank_name}-{frequency}"

    def _build_rule_code(self, sheet_name: str, parsed_rule: dict, index: int) -> str:
        rule_item = parsed_rule["rule_item"]
        bank_name = rule_item.get("银行名称（与出资方名称一致）") or rule_item.get("银行名称") or f"rule_{index}"
        normalized = re.sub(r"[^0-9A-Za-z\u4e00-\u9fa5]+", "_", f"{sheet_name}_{bank_name}_{index}").strip("_")
        base_code = normalized[:56] if len(normalized) > 56 else normalized
        candidate = base_code or f"rule_{index}"
        suffix = 2
        while self.repository.get_by_code(candidate):
            candidate = f"{base_code[:52]}_{suffix}"
            suffix += 1
        return candidate

    def _clip_rows(self, rows: list[list[str]], max_rows: int = 30, max_columns: int = 20) -> list[list[str]]:
        clipped_rows = rows[:max_rows]
        return [row[:max_columns] for row in clipped_rows]
