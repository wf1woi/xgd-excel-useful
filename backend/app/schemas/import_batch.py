from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.parser_config import ParserConfigColumnResponse


class ImportBatchCreateResponse(BaseModel):
    id: int
    batch_code: str
    parser_config_id: int
    file_name: str
    sheet_name: str
    detail_table_name: str
    status: str
    imported_rows: int
    columns: list[ParserConfigColumnResponse]


class ImportBatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    batch_code: str
    parser_config_id: int
    file_name: str
    sheet_name: str
    detail_table_name: str
    status: str
    imported_rows: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class ImportBatchListResponse(BaseModel):
    items: list[ImportBatchResponse]


class ImportBatchQuery(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
