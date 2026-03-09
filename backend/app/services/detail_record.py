from math import ceil

from app.repositories.import_batch import ImportBatchRepository
from app.repositories.parser_config import ParserConfigRepository
from app.schemas.detail_record import DetailRecordColumnResponse, DetailRecordPageResponse
from app.services.dynamic_detail_table import DynamicDetailTableManager
from app.services.fixed_field import build_fixed_field_columns


class DetailRecordService:
    def __init__(
        self,
        parser_repository: ParserConfigRepository,
        import_batch_repository: ImportBatchRepository,
        detail_table_manager: DynamicDetailTableManager,
    ) -> None:
        self.parser_repository = parser_repository
        self.import_batch_repository = import_batch_repository
        self.detail_table_manager = detail_table_manager

    def query_page(
        self,
        parser_config_id: int,
        import_batch_code: str | None,
        page: int,
        page_size: int,
        filter_field_name: str | None,
        filter_keyword: str | None,
    ) -> DetailRecordPageResponse:
        parser_config = self.parser_repository.get_by_id(parser_config_id)
        if parser_config is None:
            raise ValueError("解析配置不存在")

        columns = [
            *[column for column in parser_config.columns if column.is_enabled],
            *build_fixed_field_columns(parser_config.fixed_fields),
        ]
        if not columns:
            raise ValueError("当前解析配置尚未识别字段结构，请先完成样本校准并保存")

        import_batches = self._get_import_batches(parser_config_id, import_batch_code)
        normalized_filter_field_name = self._normalize_filter_field_name(columns, filter_field_name)
        detail_table_name = import_batches[0].detail_table_name
        batch_ids = [item.id for item in import_batches]

        total = self.detail_table_manager.count_rows(
            table_name=detail_table_name,
            batch_ids=batch_ids,
            filter_field_name=normalized_filter_field_name,
            filter_keyword=filter_keyword,
        )
        total_pages = max(1, ceil(total / page_size)) if total else 1
        resolved_page = min(page, total_pages)
        rows = self.detail_table_manager.fetch_rows_page(
            table_name=detail_table_name,
            columns=columns,
            batch_ids=batch_ids,
            page=resolved_page,
            page_size=page_size,
            filter_field_name=normalized_filter_field_name,
            filter_keyword=filter_keyword,
        )

        return DetailRecordPageResponse(
            parser_config_name=parser_config.config_name,
            import_batch_code=import_batches[0].batch_code,
            columns=[
                DetailRecordColumnResponse(
                    column_letter=column.column_letter,
                    header_name=column.header_name,
                    field_name=column.field_name,
                )
                for column in columns
            ],
            rows=rows,
            page=resolved_page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
            filter_field_name=normalized_filter_field_name,
            filter_keyword=filter_keyword,
        )

    def _get_import_batches(self, parser_config_id: int, import_batch_code: str | None):
        if import_batch_code:
            import_batches = self.import_batch_repository.list_by_parser_config_and_batch_code(
                parser_config_id,
                import_batch_code,
            )
            if not import_batches:
                raise ValueError("导入批次不存在或与解析配置不匹配")
            return import_batches

        latest_batch_code = self.import_batch_repository.get_latest_batch_code_by_parser_config_id(parser_config_id)
        if latest_batch_code is None:
            raise ValueError("当前解析配置还没有导入批次，请先导入 Excel")
        return self.import_batch_repository.list_by_parser_config_and_batch_code(
            parser_config_id,
            latest_batch_code,
        )

    def _normalize_filter_field_name(self, columns, filter_field_name: str | None) -> str | None:
        if not filter_field_name:
            return None

        matched_column = next(
            (
                column
                for column in columns
                if column.field_name == filter_field_name or column.header_name == filter_field_name
            ),
            None,
        )
        if matched_column is None:
            raise ValueError("过滤字段不存在")
        return matched_column.field_name
