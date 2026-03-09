from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ParserConfigColumnPayload(BaseModel):
    column_index: int = Field(ge=0)
    column_letter: str = Field(min_length=1, max_length=16)
    header_name: str = Field(min_length=1, max_length=255)
    field_name: str = Field(min_length=1, max_length=255)
    sample_value: str | None = None
    is_enabled: bool = True


class ParserConfigColumnResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    column_index: int
    column_letter: str
    header_name: str
    field_name: str
    sample_value: str | None
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class ParserConfigFixedFieldPayload(BaseModel):
    field_name: str = ""
    field_key: str = Field(min_length=1, max_length=255)
    field_value: str = ""
    field_name_source: str | None = None
    field_value_source: str | None = None
    follow_excel_value: bool = True
    is_enabled: bool = True


class ParserConfigFixedFieldResponse(BaseModel):
    field_name: str
    field_key: str
    field_value: str
    field_name_source: str | None
    field_value_source: str | None
    follow_excel_value: bool
    is_enabled: bool


class ParserConfigBase(BaseModel):
    config_code: str = Field(min_length=2, max_length=64)
    config_name: str = Field(min_length=2, max_length=128)
    sheet_name: str = Field(default="Sheet1", min_length=1, max_length=128)
    header_row_index: int = Field(default=1, ge=1)
    data_start_row_index: int = Field(default=2, ge=1)
    data_end_column: str = Field(default="Z", min_length=1, max_length=16)
    ignore_empty_row: bool = True
    column_mapping_json: str = "{}"
    detected_columns: list[ParserConfigColumnPayload] = Field(default_factory=list)
    fixed_fields: list[ParserConfigFixedFieldPayload] = Field(default_factory=list)
    status: str = Field(default="active", pattern="^(active|inactive)$")
    version: int = Field(default=1, ge=1)
    remark: str | None = None

    @field_validator("data_end_column")
    @classmethod
    def normalize_data_end_column(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("data_start_row_index")
    @classmethod
    def validate_data_start_row_index(cls, value: int, info) -> int:
        header_row_index = info.data.get("header_row_index", 1)
        if value <= header_row_index:
            raise ValueError("data_start_row_index 必须大于 header_row_index")
        return value


class ParserConfigCreate(ParserConfigBase):
    pass


class ParserConfigUpdate(BaseModel):
    config_name: str | None = Field(default=None, min_length=2, max_length=128)
    sheet_name: str | None = Field(default=None, min_length=1, max_length=128)
    header_row_index: int | None = Field(default=None, ge=1)
    data_start_row_index: int | None = Field(default=None, ge=1)
    data_end_column: str | None = Field(default=None, min_length=1, max_length=16)
    ignore_empty_row: bool | None = None
    column_mapping_json: str | None = None
    detected_columns: list[ParserConfigColumnPayload] | None = None
    fixed_fields: list[ParserConfigFixedFieldPayload] | None = None
    status: str | None = Field(default=None, pattern="^(active|inactive)$")
    version: int | None = Field(default=None, ge=1)
    remark: str | None = None

    @field_validator("data_end_column")
    @classmethod
    def normalize_data_end_column(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().upper()


class ParserConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    config_code: str
    config_name: str
    sheet_name: str
    header_row_index: int
    data_start_row_index: int
    data_end_column: str
    ignore_empty_row: bool
    column_mapping_json: str
    columns: list[ParserConfigColumnResponse]
    fixed_fields: list[ParserConfigFixedFieldResponse]
    status: str
    version: int
    remark: str | None
    created_at: datetime
    updated_at: datetime
