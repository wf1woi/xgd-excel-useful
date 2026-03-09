import re
from dataclasses import dataclass


@dataclass(slots=True)
class DetectedColumn:
    column_index: int
    column_letter: str
    header_name: str
    field_name: str
    sample_value: str | None


def to_column_letter(column_index: int) -> str:
    current = column_index + 1
    result = ""
    while current > 0:
        remainder = (current - 1) % 26
        result = chr(65 + remainder) + result
        current = (current - 1) // 26
    return result


def column_letter_to_index(column_letter: str) -> int:
    value = 0
    for char in column_letter.strip().upper():
        if not char.isalpha():
            raise ValueError("data_end_column 格式不正确")
        value = value * 26 + (ord(char) - 64)
    return value - 1


def normalize_header_name(raw_value: object, column_index: int) -> str:
    value = str(raw_value or "").strip()
    return value or f"未命名列{column_index + 1}"


def normalize_field_name(header_name: str, column_index: int, used_names: set[str]) -> str:
    normalized = re.sub(r"\s+", "_", header_name.strip())
    normalized = re.sub(r"[^0-9A-Za-z_\u4e00-\u9fa5]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip("_")

    if not normalized:
        normalized = f"col_{column_index + 1}"
    elif normalized[0].isdigit():
        normalized = f"col_{normalized}"

    candidate = normalized
    suffix = 2
    while candidate in used_names:
        candidate = f"{normalized}_{suffix}"
        suffix += 1

    used_names.add(candidate)
    return candidate


def build_detected_columns(
    rows: list[list[str | int | float | bool | None]],
    header_row_index: int,
    data_start_row_index: int,
    data_end_column: str,
) -> list[DetectedColumn]:
    if not rows:
        return []

    end_column_index = column_letter_to_index(data_end_column)
    header_row = rows[header_row_index - 1] if len(rows) >= header_row_index else []
    sample_row = rows[data_start_row_index - 1] if len(rows) >= data_start_row_index else []
    used_names: set[str] = set()
    detected_columns: list[DetectedColumn] = []

    for column_index in range(end_column_index + 1):
        raw_header = header_row[column_index] if column_index < len(header_row) else None
        raw_sample = sample_row[column_index] if column_index < len(sample_row) else None
        header_name = normalize_header_name(raw_header, column_index)
        field_name = normalize_field_name(header_name, column_index, used_names)
        sample_value = str(raw_sample).strip() if raw_sample not in (None, "") else None
        detected_columns.append(
            DetectedColumn(
                column_index=column_index,
                column_letter=to_column_letter(column_index),
                header_name=header_name,
                field_name=field_name,
                sample_value=sample_value,
            )
        )

    return detected_columns
