from __future__ import annotations

import logging
from dataclasses import dataclass
from math import ceil

from app.engines.rules.preview_rule_engine import PreviewRuleEngine
from app.repositories.import_batch import ImportBatchRepository
from app.repositories.parser_config import ParserConfigRepository
from app.repositories.template_rule_set import TemplateRuleSetRepository
from app.schemas.export_preview import (
    ExportPreviewResponse,
    ExportPreviewSheetSummary,
)
from app.services.dynamic_detail_table import DynamicDetailTableManager
from app.services.fixed_field import build_fixed_field_columns


logger = logging.getLogger(__name__)


@dataclass
class WorkbookSheetPreview:
    output_key: str
    sheet_name: str
    source_type: str
    headers: list[str]
    rows: list[list[str]]
    notes: list[str]


@dataclass
class WorkbookPreview:
    parser_config_name: str
    import_batch_code: str
    import_file_name: str
    template_rule_name: str
    sheets: list[WorkbookSheetPreview]


class ExportPreviewService:
    def __init__(
        self,
        parser_repository: ParserConfigRepository,
        import_batch_repository: ImportBatchRepository,
        template_rule_repository: TemplateRuleSetRepository,
        detail_table_manager: DynamicDetailTableManager,
        rule_engine: PreviewRuleEngine,
    ) -> None:
        self.parser_repository = parser_repository
        self.import_batch_repository = import_batch_repository
        self.template_rule_repository = template_rule_repository
        self.detail_table_manager = detail_table_manager
        self.rule_engine = rule_engine

    def build_preview(
        self,
        parser_config_id: int,
        import_batch_code: str | None,
        template_rule_id: int,
        output_key: str | None = None,
        export_month: str | None = None,
        page: int = 1,
        page_size: int = 100,
    ) -> ExportPreviewResponse:
        workbook = self.build_workbook_preview(
            parser_config_id=parser_config_id,
            import_batch_code=import_batch_code,
            template_rule_id=template_rule_id,
            export_month=export_month,
        )
        active_sheet = self._select_sheet(workbook.sheets, output_key)
        total = len(active_sheet.rows)
        total_pages = max(1, ceil(total / page_size)) if total else 1
        resolved_page = min(page, total_pages)
        start_index = (resolved_page - 1) * page_size
        paged_rows = active_sheet.rows[start_index:start_index + page_size]

        logger.info(
            "Export preview built. parser_config_id=%s template_rule_id=%s batch_code=%s output_key=%s page=%s page_size=%s total=%s",
            parser_config_id,
            template_rule_id,
            workbook.import_batch_code,
            active_sheet.output_key,
            resolved_page,
            page_size,
            total,
        )

        return ExportPreviewResponse(
            parser_config_name=workbook.parser_config_name,
            import_batch_code=workbook.import_batch_code,
            import_file_name=workbook.import_file_name,
            template_rule_name=workbook.template_rule_name,
            output_key=active_sheet.output_key,
            output_sheet_name=active_sheet.sheet_name,
            available_outputs=[
                ExportPreviewSheetSummary(
                    output_key=sheet.output_key,
                    sheet_name=sheet.sheet_name,
                    source_type=sheet.source_type,
                )
                for sheet in workbook.sheets
            ],
            headers=active_sheet.headers,
            rows=paged_rows,
            notes=active_sheet.notes,
            page=resolved_page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
        )

    def build_workbook_preview(
        self,
        parser_config_id: int,
        import_batch_code: str | None,
        template_rule_id: int,
        export_month: str | None = None,
    ) -> WorkbookPreview:
        parser_config = self.parser_repository.get_by_id(parser_config_id)
        if parser_config is None:
            raise ValueError("解析配置不存在")

        template_rule = self.template_rule_repository.get_by_id(template_rule_id)
        if template_rule is None:
            raise ValueError("模板规则不存在")

        import_batches = self._get_import_batches(parser_config_id, import_batch_code)
        available_fields = self._build_available_fields(parser_config)
        records = self.detail_table_manager.fetch_all_rows(
            table_name=import_batches[0].detail_table_name,
            columns=[item["column"] for item in available_fields],
            batch_ids=[item.id for item in import_batches],
        )
        runtime_context = {
            "__export_month__": export_month or "",
        }
        outputs = template_rule.outputs or [self._build_legacy_output_config(available_fields)]
        sheets: list[WorkbookSheetPreview] = []
        for output in outputs:
            headers, rows, rule_notes = self.rule_engine.apply(
                records=records,
                available_fields=[
                    {
                        "field_name": item["field_name"],
                        "header_name": item["header_name"],
                    }
                    for item in available_fields
                ],
                output_config=output,
                rule_item=template_rule.rule_item,
                runtime_context=runtime_context,
            )
            notes = self._build_notes(
                parser_config_name=parser_config.config_name,
                template_rule_name=template_rule.rule_name,
                output_config=output,
                import_file_name=self._build_batch_file_name(import_batches),
                imported_rows=sum(item.imported_rows for item in import_batches),
                rule_notes=rule_notes,
                result_total=len(rows),
            )
            sheets.append(
                WorkbookSheetPreview(
                    output_key=str(output.get("output_key") or "detail"),
                    sheet_name=str(output.get("sheet_name") or "Sheet1"),
                    source_type=str(output.get("source_type") or "filtered_detail"),
                    headers=headers,
                    rows=rows,
                    notes=notes,
                )
            )

        if not sheets:
            raise ValueError("当前模板规则未配置任何导出结果")

        logger.info(
            "Export workbook preview built. parser_config_id=%s template_rule_id=%s batch_code=%s sheets=%s export_month=%s",
            parser_config_id,
            template_rule_id,
            import_batches[0].batch_code,
            len(sheets),
            export_month or "",
        )

        return WorkbookPreview(
            parser_config_name=parser_config.config_name,
            import_batch_code=import_batches[0].batch_code,
            import_file_name=self._build_batch_file_name(import_batches),
            template_rule_name=template_rule.rule_name,
            sheets=sheets,
        )

    def _build_available_fields(self, parser_config) -> list[dict]:
        available_columns = [
            *[column for column in parser_config.columns if column.is_enabled],
            *build_fixed_field_columns(parser_config.fixed_fields),
        ]
        if not available_columns:
            raise ValueError("当前解析配置尚未识别字段结构，请先完成样本校准并保存")
        return [
            {
                "column": column,
                "field_name": column.field_name,
                "header_name": column.header_name,
            }
            for column in available_columns
            if column.is_enabled
        ]

    def _build_legacy_output_config(self, available_fields: list[dict]) -> dict:
        return {
            "output_key": "detail",
            "sheet_name": "明细表",
            "source_type": "filtered_detail",
            "fields": [
                {
                    "field_name": item["field_name"],
                    "display_name": item["header_name"],
                    "field_order": index + 1,
                    "is_enabled": True,
                }
                for index, item in enumerate(available_fields)
            ],
            "filters": [],
            "group_by_fields": [],
            "aggregations": [],
            "sort_by": [],
        }

    def _select_sheet(
        self,
        sheets: list[WorkbookSheetPreview],
        output_key: str | None,
    ) -> WorkbookSheetPreview:
        if output_key:
            matched = next((sheet for sheet in sheets if sheet.output_key == output_key), None)
            if matched is None:
                raise ValueError("指定的输出配置不存在")
            return matched
        return sheets[0]

    def _get_import_batches(self, parser_config_id: int, import_batch_code: str | None):
        if import_batch_code is not None:
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

    def _build_notes(
        self,
        parser_config_name: str,
        template_rule_name: str,
        output_config: dict,
        import_file_name: str,
        imported_rows: int,
        rule_notes: list[str],
        result_total: int,
    ) -> list[str]:
        notes = [
            f"当前结果基于解析配置“{parser_config_name}”、模板规则“{template_rule_name}”、导入文件“{import_file_name}”生成。",
            f"当前批次共导入 {imported_rows} 行，输出 sheet “{output_config.get('sheet_name') or 'Sheet1'}”共 {result_total} 行。",
        ]
        if output_config.get("group_by_fields") or output_config.get("aggregations"):
            notes.append("当前输出已启用汇总规则。")
        notes.extend(rule_notes)
        return notes

    def _build_batch_file_name(self, import_batches) -> str:
        if len(import_batches) == 1:
            return import_batches[0].file_name
        return f"{import_batches[0].batch_code}（{len(import_batches)}个文件）"
