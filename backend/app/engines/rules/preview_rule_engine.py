from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any


class PreviewRuleEngine:
    def apply(
        self,
        records: list[dict[str, Any]],
        available_fields: list[dict[str, str]],
        output_config: dict[str, Any],
        rule_item: dict[str, str] | None = None,
        runtime_context: dict[str, str] | None = None,
    ) -> tuple[list[str], list[list[str]], list[str]]:
        field_aliases = self._build_field_aliases(available_fields)
        display_name_map = {
            item["field_name"]: item["header_name"]
            for item in available_fields
        }

        filtered_records, filter_note = self._apply_filters(
            records=records,
            filters=output_config.get("filters"),
            field_aliases=field_aliases,
            rule_item=rule_item or {},
            runtime_context=runtime_context or {},
        )
        source_type = str(output_config.get("source_type") or "filtered_detail")

        if source_type == "aggregated_summary":
            headers, rows, summary_notes = self._apply_aggregation(
                records=filtered_records,
                output_config=output_config,
                field_aliases=field_aliases,
            )
            notes = [note for note in [filter_note, *summary_notes] if note]
            return headers, rows, notes

        sorted_records, sort_note = self._apply_sort(
            records=filtered_records,
            sort_by=output_config.get("sort_by"),
            field_aliases=field_aliases,
        )
        field_defs = self._resolve_output_fields(
            output_config=output_config,
            available_fields=available_fields,
            field_aliases=field_aliases,
            display_name_map=display_name_map,
        )
        headers = [field_def["display_name"] for field_def in field_defs]
        rows = [
            [self._stringify(record.get(field_def["field_name"])) for field_def in field_defs]
            for record in sorted_records
        ]
        notes = [note for note in [filter_note, sort_note] if note]
        return headers, rows, notes

    def _build_field_aliases(self, available_fields: list[dict[str, str]]) -> dict[str, str]:
        aliases: dict[str, str] = {}
        for item in available_fields:
            field_name = item["field_name"]
            header_name = item["header_name"]
            aliases[field_name] = field_name
            aliases[header_name] = field_name
        return aliases

    def _apply_filters(
        self,
        records: list[dict[str, Any]],
        filters: Any,
        field_aliases: dict[str, str],
        rule_item: dict[str, str],
        runtime_context: dict[str, str],
    ) -> tuple[list[dict[str, Any]], str | None]:
        if not isinstance(filters, list) or not filters:
            return records, None

        filtered = list(records)
        applied_count = 0
        for filter_item in filters:
            if not isinstance(filter_item, dict):
                continue
            field_key = filter_item.get("field_name") or filter_item.get("field")
            field_name = field_aliases.get(str(field_key or ""))
            if not field_name:
                continue
            operator = str(filter_item.get("operator") or "eq").lower()
            expected = self._resolve_filter_value(filter_item, rule_item, runtime_context)
            filtered = [
                record
                for record in filtered
                if self._match_filter(record.get(field_name), operator, expected)
            ]
            applied_count += 1

        if applied_count == 0:
            return records, None
        return filtered, f"已应用 {applied_count} 条过滤规则，剩余 {len(filtered)} 行。"

    def _apply_sort(
        self,
        records: list[dict[str, Any]],
        sort_by: Any,
        field_aliases: dict[str, str],
    ) -> tuple[list[dict[str, Any]], str | None]:
        if not isinstance(sort_by, list) or not sort_by:
            return records, None

        sorted_records = list(records)
        applied_fields: list[str] = []
        for sort_item in reversed(sort_by):
            if not isinstance(sort_item, dict):
                continue
            field_key = sort_item.get("field_name") or sort_item.get("field")
            field_name = field_aliases.get(str(field_key or ""))
            if not field_name:
                continue
            direction = str(sort_item.get("direction") or "asc").lower()
            sorted_records.sort(
                key=lambda record: self._sort_key(record.get(field_name)),
                reverse=direction == "desc",
            )
            applied_fields.append(field_name)

        if not applied_fields:
            return records, None
        return sorted_records, f"已按 {', '.join(applied_fields)} 排序。"

    def _resolve_output_fields(
        self,
        output_config: dict[str, Any],
        available_fields: list[dict[str, str]],
        field_aliases: dict[str, str],
        display_name_map: dict[str, str],
    ) -> list[dict[str, str]]:
        fields = output_config.get("fields")
        if isinstance(fields, list) and fields:
            resolved: list[dict[str, str]] = []
            ordered_fields = sorted(
                fields,
                key=lambda item: int(item.get("field_order", 9999)) if isinstance(item, dict) else 9999,
            )
            for field in ordered_fields:
                if not isinstance(field, dict) or not bool(field.get("is_enabled", True)):
                    continue
                field_name = field_aliases.get(str(field.get("field_name") or ""))
                if not field_name:
                    continue
                resolved.append(
                    {
                        "field_name": field_name,
                        "display_name": str(field.get("display_name") or display_name_map.get(field_name) or field_name),
                    }
                )
            if resolved:
                return resolved

        output_fields = output_config.get("output_fields")
        if isinstance(output_fields, list) and output_fields:
            resolved = []
            for field_name in output_fields:
                actual_field = field_aliases.get(str(field_name))
                if not actual_field:
                    continue
                resolved.append(
                    {
                        "field_name": actual_field,
                        "display_name": display_name_map.get(actual_field) or actual_field,
                    }
                )
            if resolved:
                return resolved

        return [
            {
                "field_name": item["field_name"],
                "display_name": item["header_name"],
            }
            for item in available_fields
        ]

    def _apply_aggregation(
        self,
        records: list[dict[str, Any]],
        output_config: dict[str, Any],
        field_aliases: dict[str, str],
    ) -> tuple[list[str], list[list[str]], list[str]]:
        group_by_fields = [
            resolved
            for resolved in (
                field_aliases.get(str(field_name))
                for field_name in output_config.get("group_by_fields", [])
            )
            if resolved
        ]
        aggregations = []
        for item in output_config.get("aggregations", []):
            if not isinstance(item, dict):
                continue
            field_name = field_aliases.get(str(item.get("field_name") or ""))
            if not field_name:
                continue
            aggregations.append(
                {
                    "field_name": field_name,
                    "aggregate_func": str(item.get("aggregate_func") or "sum").lower(),
                    "alias": str(item.get("alias") or field_name),
                }
            )

        grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
        for record in records:
            group_key = tuple(record.get(field_name) for field_name in group_by_fields)
            current = grouped.setdefault(group_key, {})
            for field_name in group_by_fields:
                current[field_name] = record.get(field_name)
            for aggregation in aggregations:
                alias = aggregation["alias"]
                func = aggregation["aggregate_func"]
                numeric_value = self._to_decimal(record.get(aggregation["field_name"]))
                if func == "count":
                    current[alias] = int(current.get(alias, 0)) + 1
                    continue
                if numeric_value is None:
                    continue
                if func == "sum":
                    current[alias] = self._to_decimal(current.get(alias)) or Decimal("0")
                    current[alias] += numeric_value
                elif func == "max":
                    current[alias] = max(
                        self._to_decimal(current.get(alias)) or numeric_value,
                        numeric_value,
                    )
                elif func == "min":
                    current[alias] = min(
                        self._to_decimal(current.get(alias)) or numeric_value,
                        numeric_value,
                    )

        aggregated_records = list(grouped.values())
        sort_by = output_config.get("sort_by")
        sorted_records, sort_note = self._apply_sort(aggregated_records, sort_by, {
            **field_aliases,
            **{item["alias"]: item["alias"] for item in aggregations},
        })
        headers, field_order = self._build_aggregated_headers(output_config, group_by_fields, aggregations, field_aliases)
        rows = [
            [self._stringify(record.get(field_name)) for field_name in field_order]
            for record in sorted_records
        ]
        notes = [
            f"已按 {len(group_by_fields)} 个分组字段聚合，生成 {len(rows)} 行汇总结果。"
            if group_by_fields or aggregations
            else None,
            sort_note,
        ]
        return headers, rows, [note for note in notes if note]

    def _build_aggregated_headers(
        self,
        output_config: dict[str, Any],
        group_by_fields: list[str],
        aggregations: list[dict[str, str]],
        field_aliases: dict[str, str],
    ) -> tuple[list[str], list[str]]:
        fields = output_config.get("fields")
        if isinstance(fields, list) and fields:
            headers: list[str] = []
            field_order: list[str] = []
            aggregation_alias_map = {item["alias"]: item["alias"] for item in aggregations}
            combined_aliases = {**field_aliases, **aggregation_alias_map}
            for item in sorted(fields, key=lambda field: int(field.get("field_order", 1))):
                if not isinstance(item, dict) or not bool(item.get("is_enabled", True)):
                    continue
                field_name = combined_aliases.get(str(item.get("field_name") or ""))
                if not field_name:
                    continue
                headers.append(str(item.get("display_name") or field_name))
                field_order.append(field_name)
            if headers:
                return headers, field_order

        headers = [field_name for field_name in group_by_fields]
        headers.extend(item["alias"] for item in aggregations)
        field_order = [*group_by_fields, *[item["alias"] for item in aggregations]]
        return headers, field_order

    def _resolve_filter_value(
        self,
        filter_item: dict[str, Any],
        rule_item: dict[str, str],
        runtime_context: dict[str, str],
    ) -> str:
        if filter_item.get("value_template"):
            return self._render_template(str(filter_item.get("value_template")), rule_item, runtime_context)
        return "" if filter_item.get("value") is None else str(filter_item.get("value"))

    def _render_template(
        self,
        template: str,
        rule_item: dict[str, str],
        runtime_context: dict[str, str],
    ) -> str:
        rendered = template
        for key, value in {**rule_item, **runtime_context}.items():
            rendered = rendered.replace(f"${{{key}}}", "" if value is None else str(value))
        return rendered

    def _match_filter(self, actual: Any, operator: str, expected: str) -> bool:
        actual_text = "" if actual is None else str(actual).strip()
        expected_text = "" if expected is None else str(expected).strip()
        actual_number = self._to_decimal(actual_text)
        expected_number = self._to_decimal(expected_text)

        if operator == "eq":
            return actual_text == expected_text
        if operator == "neq":
            return actual_text != expected_text
        if operator == "contains":
            return expected_text in actual_text
        if operator == "not_contains":
            return expected_text not in actual_text
        if operator == "in":
            return actual_text in [item.strip() for item in expected_text.split(",") if item.strip()]
        if operator == "gt" and actual_number is not None and expected_number is not None:
            return actual_number > expected_number
        if operator == "gte" and actual_number is not None and expected_number is not None:
            return actual_number >= expected_number
        if operator == "lt" and actual_number is not None and expected_number is not None:
            return actual_number < expected_number
        if operator == "lte" and actual_number is not None and expected_number is not None:
            return actual_number <= expected_number
        if operator == "month_eq":
            actual_month = self._normalize_month(actual_text)
            expected_month = self._normalize_month(expected_text)
            return bool(actual_month and expected_month and actual_month == expected_month)
        return True

    def _normalize_month(self, value: str) -> str | None:
        text = value.strip()
        if not text:
            return None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d", "%Y/%m/%d %H:%M:%S"):
            try:
                dt = datetime.strptime(text, fmt)
                return dt.strftime("%Y-%m")
            except ValueError:
                continue
        normalized = text.replace("年", "-").replace("月", "").replace("/", "-")
        parts = [part for part in normalized.split("-") if part]
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            return f"{int(parts[0]):04d}-{int(parts[1]):02d}"
        return None

    def _sort_key(self, value: Any) -> tuple[int, Any]:
        if value is None or str(value).strip() == "":
            return (1, "")
        number = self._to_decimal(value)
        if number is not None:
            return (0, number)
        return (0, str(value))

    def _to_decimal(self, value: Any) -> Decimal | None:
        if value is None:
            return None
        try:
            text = str(value).replace(",", "").strip()
            if text == "":
                return None
            return Decimal(text)
        except (InvalidOperation, ValueError, TypeError):
            return None

    def _stringify(self, value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, Decimal):
            normalized = value.normalize()
            text = format(normalized, "f")
            return text.rstrip("0").rstrip(".") if "." in text else text
        return str(value)
