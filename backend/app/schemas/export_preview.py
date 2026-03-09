from pydantic import BaseModel, Field


class ExportPreviewRequest(BaseModel):
    parser_config_id: int = Field(ge=1)
    import_batch_code: str | None = Field(default=None, min_length=1, max_length=64)
    template_rule_id: int = Field(ge=1)
    output_key: str | None = Field(default=None, min_length=1, max_length=64)
    export_month: str | None = Field(default=None, min_length=4, max_length=16)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=100, ge=1, le=500)


class ExportPreviewSheetSummary(BaseModel):
    output_key: str
    sheet_name: str
    source_type: str


class ExportPreviewResponse(BaseModel):
    parser_config_name: str
    import_batch_code: str
    import_file_name: str
    template_rule_name: str
    output_key: str
    output_sheet_name: str
    available_outputs: list[ExportPreviewSheetSummary]
    headers: list[str]
    rows: list[list[str]]
    notes: list[str]
    page: int
    page_size: int
    total: int
    total_pages: int
