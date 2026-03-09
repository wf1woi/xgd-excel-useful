from pydantic import BaseModel, Field


class ExcelDetectedColumn(BaseModel):
    column_index: int
    column_letter: str
    header_name: str
    field_name: str
    sample_value: str | None = None


class ExcelPreviewResponse(BaseModel):
    sheet_names: list[str]
    selected_sheet_name: str
    max_rows: int
    max_columns: int
    sheet_max_rows: int
    sheet_max_columns: int
    is_truncated_rows: bool
    is_truncated_columns: bool
    detected_columns: list[ExcelDetectedColumn] = []
    rows: list[list[str | int | float | bool | None]]


class ExcelPreviewQuery(BaseModel):
    sheet_name: str | None = None
    max_rows: int = Field(default=50, ge=1, le=200)
    max_columns: int = Field(default=26, ge=1, le=100)
