import logging

from openpyxl.utils.cell import range_boundaries


def resolve_worksheet_bounds(worksheet, logger: logging.Logger | None = None) -> tuple[int, int]:
    original_max_rows = getattr(worksheet, "max_row", None) or 0
    original_max_columns = getattr(worksheet, "max_column", None) or 0

    if hasattr(worksheet, "reset_dimensions"):
        worksheet.reset_dimensions()

    dimension = worksheet.calculate_dimension(force=True)
    min_col, _min_row, max_col, max_row = range_boundaries(dimension)
    resolved_max_columns = max_col - min_col + 1

    if logger and (
        original_max_rows != max_row or original_max_columns != resolved_max_columns
    ):
        logger.warning(
            "Worksheet dimensions recalculated. sheet=%s, rows=%s->%s, columns=%s->%s",
            getattr(worksheet, "title", ""),
            original_max_rows,
            max_row,
            original_max_columns,
            resolved_max_columns,
        )

    return max_row, resolved_max_columns
