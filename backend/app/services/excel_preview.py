from app.engines.excel.preview import ExcelPreviewEngine
from app.schemas.excel_preview import ExcelPreviewResponse


class ExcelPreviewService:
    def __init__(self, engine: ExcelPreviewEngine) -> None:
        self.engine = engine

    def preview(
        self,
        content: bytes,
        sheet_name: str | None,
        max_rows: int,
        max_columns: int,
    ) -> ExcelPreviewResponse:
        preview_data = self.engine.preview(
            content=content,
            sheet_name=sheet_name,
            max_rows=max_rows,
            max_columns=max_columns,
        )
        return ExcelPreviewResponse.model_validate(preview_data)
