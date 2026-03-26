import logging
from collections.abc import Callable
from uuid import uuid4

from app.engines.excel.importer import ExcelImportEngine
from app.models.import_batch import ImportBatch
from app.models.parser_config_column import ParserConfigColumn
from app.repositories.import_batch import ImportBatchRepository
from app.repositories.parser_config_column import ParserConfigColumnRepository
from app.repositories.parser_config import ParserConfigRepository
from app.schemas.import_batch import ImportBatchCreateResponse, ImportBatchResponse
from app.schemas.parser_config import ParserConfigColumnResponse
from app.services.dynamic_detail_table import DynamicDetailTableManager
from app.services.fixed_field import build_fixed_field_columns
from app.utils.timezone import shanghai_now


logger = logging.getLogger(__name__)


class ImportBatchService:
    def __init__(
        self,
        parser_repository: ParserConfigRepository,
        column_repository: ParserConfigColumnRepository,
        batch_repository: ImportBatchRepository,
        import_engine: ExcelImportEngine,
        table_manager: DynamicDetailTableManager,
    ) -> None:
        self.parser_repository = parser_repository
        self.column_repository = column_repository
        self.batch_repository = batch_repository
        self.import_engine = import_engine
        self.table_manager = table_manager

    def create_batch(
        self,
        file_name: str,
        parser_config_id: int,
        batch_code: str | None,
        content: bytes,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> ImportBatchCreateResponse:
        parser_config = self.parser_repository.get_by_id(parser_config_id)
        if parser_config is None:
            raise ValueError("解析配置不存在")
        resolved_batch_code = self._resolve_batch_code(batch_code)
        try:
            rows, detected_columns = self.import_engine.extract_rows(
                content=content,
                sheet_name=parser_config.sheet_name,
                header_row_index=parser_config.header_row_index,
                data_start_row_index=parser_config.data_start_row_index,
                data_end_column=parser_config.data_end_column,
                ignore_empty_row=parser_config.ignore_empty_row,
                fixed_fields=parser_config.fixed_fields,
                progress_callback=progress_callback,
            )
            column_entities = [
                ParserConfigColumn(
                    parser_config_id=parser_config.id,
                    column_index=int(column["column_index"]),
                    column_letter=str(column["column_letter"]),
                    header_name=str(column["header_name"]),
                    field_name=str(column["field_name"]),
                    sample_value=(str(column["sample_value"]) if column.get("sample_value") else None),
                    is_enabled=True,
                )
                for column in detected_columns
            ]
            self.column_repository.replace_for_config(parser_config.id, column_entities)
            self.parser_repository.db.commit()

            parser_config = self.parser_repository.get_by_id(parser_config.id)
            if parser_config is None:
                raise ValueError("解析配置不存在")

            detail_table_name = self.table_manager.build_table_name(parser_config.config_code)
            all_columns = [*parser_config.columns, *build_fixed_field_columns(parser_config.fixed_fields)]
            self.table_manager.ensure_table(detail_table_name, all_columns)

            batch = ImportBatch(
                batch_code=resolved_batch_code,
                parser_config_id=parser_config.id,
                file_name=file_name,
                sheet_name=parser_config.sheet_name,
                detail_table_name=detail_table_name,
                status="success",
                imported_rows=len(rows),
            )
            batch = self.batch_repository.create(batch)
            self.table_manager.insert_rows(detail_table_name, all_columns, batch.id, rows)

            return ImportBatchCreateResponse(
                id=batch.id,
                batch_code=batch.batch_code,
                parser_config_id=batch.parser_config_id,
                file_name=batch.file_name,
                sheet_name=batch.sheet_name,
                detail_table_name=batch.detail_table_name,
                status=batch.status,
                imported_rows=batch.imported_rows,
                columns=[ParserConfigColumnResponse.model_validate(column) for column in parser_config.columns],
            )
        except Exception:
            logger.exception(
                "Import batch failed. parser_config_id=%s batch_code=%s file_name=%s",
                parser_config_id,
                resolved_batch_code,
                file_name,
            )
            raise

    def list_batches(self, limit: int = 20) -> list[ImportBatchResponse]:
        return [ImportBatchResponse.model_validate(item) for item in self.batch_repository.list_recent(limit)]

    def delete_batch(self, batch_code: str) -> None:
        batches = self.batch_repository.list_by_batch_code(batch_code)
        if not batches:
            raise ValueError("导入批次不存在")

        table_batches: dict[str, list[int]] = {}
        for batch in batches:
            table_batches.setdefault(batch.detail_table_name, []).append(batch.id)

        for table_name, batch_ids in table_batches.items():
            self.table_manager.delete_rows(table_name, batch_ids)

        self.batch_repository.delete_by_batch_code(batch_code)

    @staticmethod
    def _resolve_batch_code(batch_code: str | None) -> str:
        if batch_code and batch_code.strip():
            return batch_code.strip()
        timestamp = shanghai_now().strftime("%Y%m%d%H%M%S")
        return f"B{timestamp}{uuid4().hex[:4]}"
