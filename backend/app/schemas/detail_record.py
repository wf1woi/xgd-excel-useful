from pydantic import BaseModel, Field


class DetailRecordColumnResponse(BaseModel):
    column_letter: str
    header_name: str
    field_name: str


class DetailRecordPageResponse(BaseModel):
    parser_config_name: str
    import_batch_code: str
    columns: list[DetailRecordColumnResponse]
    rows: list[dict[str, str | int | None]]
    page: int
    page_size: int
    total: int
    total_pages: int
    filter_field_name: str | None
    filter_keyword: str | None


class DetailRecordQuery(BaseModel):
    parser_config_id: int = Field(ge=1)
    import_batch_code: str | None = Field(default=None, min_length=1, max_length=64)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=100, ge=1, le=500)
    filter_field_name: str | None = Field(default=None, min_length=1, max_length=128)
    filter_keyword: str | None = Field(default=None, min_length=1, max_length=255)
