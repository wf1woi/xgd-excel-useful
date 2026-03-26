import json
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TemplateRuleOutputFieldPayload(BaseModel):
    field_name: str = Field(min_length=1, max_length=255)
    display_name: str = Field(min_length=1, max_length=255)
    field_order: int = Field(default=1, ge=1)
    is_enabled: bool = True


class TemplateRuleAggregationPayload(BaseModel):
    field_name: str = Field(min_length=1, max_length=255)
    aggregate_func: str = Field(min_length=1, max_length=32)
    alias: str = Field(min_length=1, max_length=255)


class TemplateRuleFilterPayload(BaseModel):
    field_name: str = Field(min_length=1, max_length=255)
    operator: str = Field(min_length=1, max_length=32)
    value: str | None = None
    value_template: str | None = None


class TemplateRulePreviewSummaryPayload(BaseModel):
    field_name: str = Field(min_length=1, max_length=255)
    label: str = Field(min_length=1, max_length=255)
    aggregate_func: str = Field(default="sum", min_length=1, max_length=32)


class TemplateRuleOutputConfigPayload(BaseModel):
    output_key: str = Field(min_length=1, max_length=64)
    sheet_name: str = Field(min_length=1, max_length=128)
    source_type: str = Field(min_length=1, max_length=64)
    title_rows: list[str] = Field(default_factory=list)
    fields: list[TemplateRuleOutputFieldPayload] = Field(default_factory=list)
    filters: list[TemplateRuleFilterPayload] = Field(default_factory=list)
    group_by_fields: list[str] = Field(default_factory=list)
    aggregations: list[TemplateRuleAggregationPayload] = Field(default_factory=list)
    preview_summary_items: list[TemplateRulePreviewSummaryPayload] = Field(default_factory=list)
    sort_by: list[dict] = Field(default_factory=list)


class TemplateRuleSetBase(BaseModel):
    rule_code: str = Field(min_length=2, max_length=64)
    rule_name: str = Field(min_length=2, max_length=128)
    group_name: str = Field(default="默认分类", min_length=1, max_length=128)
    source_sheet_name: str = Field(default="Sheet1", min_length=1, max_length=128)
    description: str | None = None
    rule_item: dict[str, str] = Field(default_factory=dict)
    outputs: list[TemplateRuleOutputConfigPayload] = Field(default_factory=list)
    status: str = Field(default="active", pattern="^(active|inactive)$")
    version: int = Field(default=1, ge=1)

    @field_validator("rule_item", mode="before")
    @classmethod
    def normalize_rule_item(cls, value):
        if isinstance(value, dict):
            return {str(key): "" if item is None else str(item) for key, item in value.items()}
        return {}


class TemplateRuleSetCreate(TemplateRuleSetBase):
    pass


class TemplateRuleSetUpdate(BaseModel):
    rule_name: str | None = Field(default=None, min_length=2, max_length=128)
    group_name: str | None = Field(default=None, min_length=1, max_length=128)
    source_sheet_name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    rule_item: dict[str, str] | None = None
    outputs: list[TemplateRuleOutputConfigPayload] | None = None
    status: str | None = Field(default=None, pattern="^(active|inactive)$")
    version: int | None = Field(default=None, ge=1)

    @field_validator("rule_item", mode="before")
    @classmethod
    def normalize_rule_item(cls, value):
        if value is None:
            return None
        if isinstance(value, dict):
            return {str(key): "" if item is None else str(item) for key, item in value.items()}
        return {}


class TemplateRuleSetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rule_code: str
    rule_name: str
    group_name: str
    source_sheet_name: str
    description: str | None
    rule_item: dict[str, str]
    outputs: list[TemplateRuleOutputConfigPayload]
    status: str
    version: int
    created_at: datetime
    updated_at: datetime

    @field_validator("rule_item", mode="before")
    @classmethod
    def parse_rule_item(cls, value):
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return value or {}

    @field_validator("outputs", mode="before")
    @classmethod
    def parse_outputs(cls, value):
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return []
            if not isinstance(parsed, dict):
                return []
            outputs = parsed.get("outputs")
            return outputs if isinstance(outputs, list) else []
        if isinstance(value, dict):
            outputs = value.get("outputs")
            return outputs if isinstance(outputs, list) else []
        return value or []


class TemplateRuleImportSheetPreview(BaseModel):
    sheet_name: str
    rule_count: int
    sample_rules: list[dict]


class TemplateRuleImportFieldCandidate(BaseModel):
    column_index: int
    column_letter: str
    field_name: str


class TemplateRuleImportSheetOption(BaseModel):
    sheet_name: str = Field(min_length=1, max_length=128)
    rule_item_row_index: int | None = Field(default=None, ge=1)
    output_field_row_index: int | None = Field(default=None, ge=1)
    rule_item_columns: list[int] = Field(default_factory=list)
    output_field_columns: list[int] = Field(default_factory=list)
    outputs: list[TemplateRuleOutputConfigPayload] = Field(default_factory=list)


class TemplateRuleImportPreviewResponse(BaseModel):
    sheet_names: list[str]
    sheets: list[TemplateRuleImportSheetPreview]
    selected_sheet_name: str
    rows: list[list[str]]
    max_rows: int
    max_columns: int
    rule_item_row_index: int | None = None
    output_field_row_index: int | None = None
    rule_item_field_candidates: list[TemplateRuleImportFieldCandidate] = Field(default_factory=list)
    output_field_candidates: list[TemplateRuleImportFieldCandidate] = Field(default_factory=list)
    selected_rule_item_columns: list[int] = Field(default_factory=list)
    selected_output_field_columns: list[int] = Field(default_factory=list)


class TemplateRuleImportCommitRequest(BaseModel):
    selected_sheets: list[str] = Field(default_factory=list)
    sheet_options: list[TemplateRuleImportSheetOption] = Field(default_factory=list)


class TemplateRulePageResponse(BaseModel):
    items: list[TemplateRuleSetResponse]
    page: int
    page_size: int
    total: int
    total_pages: int


class TemplateRuleBatchDeleteRequest(BaseModel):
    rule_ids: list[int] = Field(default_factory=list)
