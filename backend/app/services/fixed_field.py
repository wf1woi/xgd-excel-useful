import re
from dataclasses import dataclass
from typing import Any

from openpyxl.worksheet.worksheet import Worksheet


CELL_REF_PATTERN = re.compile(r"^[A-Za-z]+[1-9]\d*$")


@dataclass(frozen=True)
class FixedFieldColumn:
    column_index: int
    column_letter: str
    header_name: str
    field_name: str
    sample_value: str | None
    is_enabled: bool


def normalize_storage_field_name(raw_value: str, fallback_index: int, used_names: set[str]) -> str:
    base_name = (
        raw_value.strip()
        .replace(" ", "_")
        .replace("\t", "_")
    )
    normalized = re.sub(r"[^0-9A-Za-z_\u4e00-\u9fa5]+", "_", base_name)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    candidate = normalized or f"fixed_field_{fallback_index + 1}"
    if candidate[0].isdigit():
        candidate = f"col_{candidate}"

    unique_name = candidate
    suffix = 2
    while unique_name in used_names:
        unique_name = f"{candidate}_{suffix}"
        suffix += 1
    used_names.add(unique_name)
    return unique_name


def sanitize_fixed_fields(
    raw_fixed_fields: list[dict[str, Any]] | None,
    reserved_field_names: set[str] | None = None,
) -> list[dict[str, str | bool | None]]:
    reserved_names = set(reserved_field_names or set())
    sanitized: list[dict[str, str | bool | None]] = []

    for index, raw_field in enumerate(raw_fixed_fields or []):
        field_name = str(raw_field.get("field_name") or "").strip()
        field_value = str(raw_field.get("field_value") or "").strip()
        field_name_source = _normalize_optional_text(raw_field.get("field_name_source"))
        field_value_source = _normalize_optional_text(raw_field.get("field_value_source"))
        follow_excel_value = bool(raw_field.get("follow_excel_value", True))
        is_enabled = bool(raw_field.get("is_enabled", True))

        if not field_name and not field_name_source:
            continue
        if not field_value and not field_value_source:
            continue
        if follow_excel_value and not field_value_source:
            continue
        if not follow_excel_value and not field_value and not field_value_source:
            continue

        key_seed = str(raw_field.get("field_key") or field_name or field_name_source or f"fixed_field_{index + 1}")
        field_key = normalize_storage_field_name(key_seed, index, reserved_names)

        sanitized.append(
            {
                "field_name": field_name,
                "field_key": field_key,
                "field_value": field_value,
                "field_name_source": field_name_source,
                "field_value_source": field_value_source,
                "follow_excel_value": follow_excel_value,
                "is_enabled": is_enabled,
            }
        )

    return sanitized


def build_fixed_field_columns(raw_fixed_fields: list[dict[str, Any]] | None) -> list[FixedFieldColumn]:
    columns: list[FixedFieldColumn] = []
    for index, item in enumerate(raw_fixed_fields or []):
        if not bool(item.get("is_enabled", True)):
            continue
        columns.append(
            FixedFieldColumn(
                column_index=-1 - index,
                column_letter="固定",
                header_name=str(item.get("field_name") or item.get("field_key") or f"固定字段{index + 1}"),
                field_name=str(item.get("field_key") or f"fixed_field_{index + 1}"),
                sample_value=_normalize_optional_text(item.get("field_value")),
                is_enabled=True,
            )
        )
    return columns


def resolve_fixed_field_values(
    worksheet: Worksheet,
    raw_fixed_fields: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    resolved_fields: list[dict[str, str]] = []
    for index, item in enumerate(raw_fixed_fields or []):
        if not bool(item.get("is_enabled", True)):
            continue

        field_key = str(item.get("field_key") or f"fixed_field_{index + 1}").strip()
        if not field_key:
            continue

        resolved_fields.append(
            {
                "field_key": field_key,
                "field_name": _resolve_value(worksheet, item.get("field_name_source"), item.get("field_name")),
                "field_value": _resolve_field_value(
                    worksheet,
                    item.get("field_value_source"),
                    item.get("field_value"),
                    bool(item.get("follow_excel_value", True)),
                ),
            }
        )

    return resolved_fields


def _resolve_value(worksheet: Worksheet, source: Any, fallback_value: Any) -> str:
    normalized_source = _normalize_optional_text(source)
    if normalized_source and CELL_REF_PATTERN.fullmatch(normalized_source):
        value = worksheet[normalized_source.upper()].value
        return "" if value in (None, "") else str(value).strip()
    return str(fallback_value or "").strip()


def _resolve_field_value(
    worksheet: Worksheet,
    source: Any,
    fallback_value: Any,
    follow_excel_value: bool,
) -> str:
    if follow_excel_value:
        return _resolve_value(worksheet, source, "")
    return _resolve_value(worksheet, source, fallback_value)


def _normalize_optional_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None
