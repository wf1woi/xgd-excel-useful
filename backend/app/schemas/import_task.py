from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ImportTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parser_config_id: int
    batch_code: str
    file_name: str
    status: str
    progress_percent: int
    progress_message: str | None
    imported_rows: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime
