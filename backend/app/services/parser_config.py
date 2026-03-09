import json

from app.models.parser_config import ParserConfig
from app.models.parser_config_column import ParserConfigColumn
from app.repositories.import_batch import ImportBatchRepository
from app.repositories.parser_config_column import ParserConfigColumnRepository
from app.repositories.parser_config import ParserConfigRepository
from app.schemas.parser_config import ParserConfigCreate, ParserConfigUpdate
from app.services.dynamic_detail_table import DynamicDetailTableManager
from app.services.fixed_field import sanitize_fixed_fields


class ParserConfigService:
    def __init__(
        self,
        repository: ParserConfigRepository,
        column_repository: ParserConfigColumnRepository,
        import_batch_repository: ImportBatchRepository,
        table_manager: DynamicDetailTableManager,
    ) -> None:
        self.repository = repository
        self.column_repository = column_repository
        self.import_batch_repository = import_batch_repository
        self.table_manager = table_manager

    def list_configs(self) -> list[ParserConfig]:
        return self.repository.list_all()

    def get_config(self, config_id: int) -> ParserConfig:
        config = self.repository.get_by_id(config_id)
        if config is None:
            raise ValueError("解析配置不存在")
        return config

    def create_config(self, payload: ParserConfigCreate) -> ParserConfig:
        if self.repository.get_by_code(payload.config_code):
            raise ValueError("config_code 已存在")

        entity_data = payload.model_dump(exclude={"detected_columns", "fixed_fields"})
        entity_data["fixed_fields_json"] = json.dumps(
            sanitize_fixed_fields(
                raw_fixed_fields=[item.model_dump() for item in payload.fixed_fields],
                reserved_field_names={column.field_name for column in payload.detected_columns},
            ),
            ensure_ascii=False,
        )
        entity = ParserConfig(**entity_data)
        created = self.repository.create(entity)
        self._replace_columns(created.id, payload.detected_columns)
        return self.get_config(created.id)

    def update_config(self, config_id: int, payload: ParserConfigUpdate) -> ParserConfig:
        entity = self.get_config(config_id)

        update_data = payload.model_dump(exclude_unset=True)
        header_row_index = update_data.get("header_row_index", entity.header_row_index)
        data_start_row_index = update_data.get("data_start_row_index", entity.data_start_row_index)
        if data_start_row_index <= header_row_index:
            raise ValueError("data_start_row_index 必须大于 header_row_index")

        detected_columns = update_data.pop("detected_columns", None)
        fixed_fields = update_data.pop("fixed_fields", None)
        for field, value in update_data.items():
            setattr(entity, field, value)

        if fixed_fields is not None:
            reserved_field_names = {
                column.field_name for column in (detected_columns or entity.columns)
            }
            entity.fixed_fields_json = json.dumps(
                sanitize_fixed_fields(
                    raw_fixed_fields=[item.model_dump() for item in fixed_fields],
                    reserved_field_names=reserved_field_names,
                ),
                ensure_ascii=False,
            )

        updated = self.repository.update(entity)
        if detected_columns is not None:
            self._replace_columns(updated.id, detected_columns)
        return self.get_config(updated.id)

    def _replace_columns(self, config_id: int, columns_payload) -> None:
        columns = [
            ParserConfigColumn(
                parser_config_id=config_id,
                column_index=column.column_index,
                column_letter=column.column_letter,
                header_name=column.header_name,
                field_name=column.field_name,
                sample_value=column.sample_value,
                is_enabled=column.is_enabled,
            )
            for column in columns_payload
        ]
        self.column_repository.replace_for_config(config_id, columns)
        self.repository.db.commit()

    def delete_config(self, config_id: int) -> None:
        entity = self.get_config(config_id)
        detail_table_name = self.table_manager.build_table_name(entity.config_code)
        self.table_manager.drop_table(detail_table_name)
        self.repository.delete(entity)
