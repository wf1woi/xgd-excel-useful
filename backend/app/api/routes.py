import json
import logging

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.parser_config import ParserConfigRepository
from app.repositories.parser_config_column import ParserConfigColumnRepository
from app.repositories.import_batch import ImportBatchRepository
from app.repositories.import_task import ImportTaskRepository
from app.repositories.template_rule_set import TemplateRuleSetRepository
from app.schemas.common import ApiResponse
from app.schemas.detail_record import DetailRecordPageResponse
from app.schemas.export_preview import ExportPreviewRequest, ExportPreviewResponse
from app.schemas.excel_preview import ExcelPreviewResponse
from app.schemas.health import HealthResponse
from app.schemas.import_batch import ImportBatchCreateResponse, ImportBatchResponse
from app.schemas.import_task import ImportTaskResponse
from app.schemas.parser_config import (
    ParserConfigCreate,
    ParserConfigResponse,
    ParserConfigUpdate,
)
from app.schemas.template_rule_set import (
    TemplateRuleBatchDeleteRequest,
    TemplateRuleImportCommitRequest,
    TemplateRuleImportPreviewResponse,
    TemplateRulePageResponse,
    TemplateRuleSetCreate,
    TemplateRuleSetResponse,
    TemplateRuleSetUpdate,
)
from app.services.excel_preview import ExcelPreviewService
from app.services.export_excel import ExportExcelService
from app.services.export_preview import ExportPreviewService
from app.services.import_batch import ImportBatchService
from app.services.import_task import ImportTaskService, run_import_task, save_import_task_file
from app.services.parser_config import ParserConfigService
from app.services.template_rule_set import TemplateRuleSetService
from app.services.template_rule_import import TemplateRuleImportService
from app.services.dynamic_detail_table import DynamicDetailTableManager
from app.services.detail_record import DetailRecordService
from app.engines.excel.preview import ExcelPreviewEngine
from app.engines.excel.importer import ExcelImportEngine
from app.engines.excel.simple_xlsx_reader import SimpleXlsxReader
from app.engines.rules.preview_rule_engine import PreviewRuleEngine
from app.core.database import engine
from app.core.config import get_settings
from app.core.schema_patch import ensure_template_rule_set_dynamic_columns

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health_check() -> HealthResponse:
    return HealthResponse(status="ok", service="xgd-excel-useful-backend")


def get_parser_config_service(db: Session = Depends(get_db)) -> ParserConfigService:
    return ParserConfigService(
        ParserConfigRepository(db),
        ParserConfigColumnRepository(db),
        ImportBatchRepository(db),
        DynamicDetailTableManager(engine),
    )


def get_excel_preview_service() -> ExcelPreviewService:
    return ExcelPreviewService(ExcelPreviewEngine())


def get_template_rule_set_service(
    db: Session = Depends(get_db),
) -> TemplateRuleSetService:
    ensure_template_rule_set_dynamic_columns()
    return TemplateRuleSetService(TemplateRuleSetRepository(db))


def get_export_preview_service(
    db: Session = Depends(get_db),
) -> ExportPreviewService:
    return ExportPreviewService(
        parser_repository=ParserConfigRepository(db),
        import_batch_repository=ImportBatchRepository(db),
        template_rule_repository=TemplateRuleSetRepository(db),
        detail_table_manager=DynamicDetailTableManager(engine),
        rule_engine=PreviewRuleEngine(),
    )


def get_template_rule_import_service(
    db: Session = Depends(get_db),
) -> TemplateRuleImportService:
    ensure_template_rule_set_dynamic_columns()
    repository = TemplateRuleSetRepository(db)
    return TemplateRuleImportService(
        reader=SimpleXlsxReader(),
        repository=repository,
        rule_service=TemplateRuleSetService(repository),
    )


def get_import_batch_service(db: Session = Depends(get_db)) -> ImportBatchService:
    return ImportBatchService(
        parser_repository=ParserConfigRepository(db),
        column_repository=ParserConfigColumnRepository(db),
        batch_repository=ImportBatchRepository(db),
        import_engine=ExcelImportEngine(),
        table_manager=DynamicDetailTableManager(engine),
    )


def get_import_task_service(db: Session = Depends(get_db)) -> ImportTaskService:
    return ImportTaskService(ImportTaskRepository(db), ParserConfigRepository(db))


def get_export_excel_service() -> ExportExcelService:
    settings = get_settings()
    return ExportExcelService(settings.export_dir)


def get_detail_record_service(
    db: Session = Depends(get_db),
) -> DetailRecordService:
    return DetailRecordService(
        parser_repository=ParserConfigRepository(db),
        import_batch_repository=ImportBatchRepository(db),
        detail_table_manager=DynamicDetailTableManager(engine),
    )


@router.get(
    "/parser-configs",
    response_model=ApiResponse[list[ParserConfigResponse]],
    tags=["parser-config"],
)
def list_parser_configs(
    service: ParserConfigService = Depends(get_parser_config_service),
) -> ApiResponse[list[ParserConfigResponse]]:
    data = [ParserConfigResponse.model_validate(item) for item in service.list_configs()]
    return ApiResponse(data=data)


@router.post(
    "/parser-configs",
    response_model=ApiResponse[ParserConfigResponse],
    status_code=status.HTTP_201_CREATED,
    tags=["parser-config"],
)
def create_parser_config(
    payload: ParserConfigCreate,
    service: ParserConfigService = Depends(get_parser_config_service),
) -> ApiResponse[ParserConfigResponse]:
    try:
        entity = service.create_config(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ApiResponse(message="created", data=ParserConfigResponse.model_validate(entity))


@router.get(
    "/parser-configs/{config_id}",
    response_model=ApiResponse[ParserConfigResponse],
    tags=["parser-config"],
)
def get_parser_config(
    config_id: int,
    service: ParserConfigService = Depends(get_parser_config_service),
) -> ApiResponse[ParserConfigResponse]:
    try:
        entity = service.get_config(config_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ApiResponse(data=ParserConfigResponse.model_validate(entity))


@router.put(
    "/parser-configs/{config_id}",
    response_model=ApiResponse[ParserConfigResponse],
    tags=["parser-config"],
)
def update_parser_config(
    config_id: int,
    payload: ParserConfigUpdate,
    service: ParserConfigService = Depends(get_parser_config_service),
) -> ApiResponse[ParserConfigResponse]:
    try:
        entity = service.update_config(config_id, payload)
    except ValueError as exc:
        if "不存在" in str(exc):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ApiResponse(message="updated", data=ParserConfigResponse.model_validate(entity))


@router.delete(
    "/parser-configs/{config_id}",
    response_model=ApiResponse[dict[str, bool]],
    tags=["parser-config"],
)
def delete_parser_config(
    config_id: int,
    service: ParserConfigService = Depends(get_parser_config_service),
) -> ApiResponse[dict[str, bool]]:
    try:
        service.delete_config(config_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ApiResponse(message="deleted", data={"deleted": True})


@router.post(
    "/parser-configs/sample-preview",
    response_model=ApiResponse[ExcelPreviewResponse],
    tags=["parser-config"],
)
async def preview_parser_config_sample(
    file: UploadFile = File(...),
    sheet_name: str | None = Form(default=None),
    max_rows: int = Form(default=50),
    max_columns: int = Form(default=26),
    service: ExcelPreviewService = Depends(get_excel_preview_service),
) -> ApiResponse[ExcelPreviewResponse]:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")

    if not file.filename.lower().endswith((".xlsx", ".xlsm", ".xltx", ".xltm")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 Excel 文件")

    if max_rows < 1 or max_rows > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_rows 必须在 1 到 200 之间")
    if max_columns < 1 or max_columns > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_columns 必须在 1 到 100 之间")

    content = await file.read()
    try:
        preview = service.preview(
            content=content,
            sheet_name=sheet_name,
            max_rows=max_rows,
            max_columns=max_columns,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Excel 解析失败: {exc}") from exc
    finally:
        await file.close()

    return ApiResponse(data=preview)


@router.get(
    "/template-rules",
    response_model=ApiResponse[TemplateRulePageResponse],
    tags=["template-rule"],
)
def list_template_rules(
    page: int = 1,
    page_size: int = 20,
    keyword: str | None = None,
    service: TemplateRuleSetService = Depends(get_template_rule_set_service),
) -> ApiResponse[TemplateRulePageResponse]:
    if page < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page 必须大于等于 1")
    if page_size < 1 or page_size > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page_size 必须在 1 到 100 之间")
    data = service.list_rule_page(page=page, page_size=page_size, keyword=keyword)
    return ApiResponse(data=data)


@router.post(
    "/template-rules/import-preview",
    response_model=ApiResponse[TemplateRuleImportPreviewResponse],
    tags=["template-rule"],
)
async def preview_template_rule_import(
    file: UploadFile = File(...),
    sheet_name: str | None = Form(default=None),
    rule_item_row_index: int | None = Form(default=None),
    output_field_row_index: int | None = Form(default=None),
    rule_item_columns_json: str | None = Form(default=None),
    output_field_columns_json: str | None = Form(default=None),
    max_rows: int = Form(default=30),
    max_columns: int = Form(default=20),
    service: TemplateRuleImportService = Depends(get_template_rule_import_service),
) -> ApiResponse[TemplateRuleImportPreviewResponse]:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="规则模板仅支持 .xlsx 文件")

    content = await file.read()
    try:
        rule_item_columns: list[int] = []
        output_field_columns: list[int] = []
        if rule_item_columns_json:
            parsed_rule_item_columns = json.loads(rule_item_columns_json)
            if not isinstance(parsed_rule_item_columns, list):
                raise ValueError("rule_item_columns_json 格式错误")
            rule_item_columns = [int(value) for value in parsed_rule_item_columns]
        if output_field_columns_json:
            parsed_output_field_columns = json.loads(output_field_columns_json)
            if not isinstance(parsed_output_field_columns, list):
                raise ValueError("output_field_columns_json 格式错误")
            output_field_columns = [int(value) for value in parsed_output_field_columns]
        data = service.preview_with_options(
            content=content,
            sheet_name=sheet_name,
            rule_item_row_index=rule_item_row_index,
            output_field_row_index=output_field_row_index,
            rule_item_columns=rule_item_columns,
            output_field_columns=output_field_columns,
            max_rows=max_rows,
            max_columns=max_columns,
        )
    except ValueError as exc:
        logger.warning("Template rule import preview rejected. file_name=%s, error=%s", file.filename, exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Template rule import preview failed. file_name=%s", file.filename)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"规则导入预览失败: {exc}") from exc
    finally:
        await file.close()

    return ApiResponse(data=data)


@router.post(
    "/template-rules/import-commit",
    response_model=ApiResponse[list[TemplateRuleSetResponse]],
    status_code=status.HTTP_201_CREATED,
    tags=["template-rule"],
)
async def commit_template_rule_import(
    file: UploadFile = File(...),
    selected_sheets: str = Form(...),
    service: TemplateRuleImportService = Depends(get_template_rule_import_service),
) -> ApiResponse[list[TemplateRuleSetResponse]]:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="规则模板仅支持 .xlsx 文件")

    content = await file.read()
    try:
        payload = TemplateRuleImportCommitRequest.model_validate_json(selected_sheets)
        data = service.import_selected_sheets(content, payload.selected_sheets, payload.sheet_options)
    except ValueError as exc:
        logger.warning("Template rule import commit rejected. file_name=%s, error=%s", file.filename, exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Template rule import commit failed. file_name=%s", file.filename)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"规则导入失败: {exc}") from exc
    finally:
        await file.close()

    return ApiResponse(message="created", data=data)


@router.post(
    "/template-rules",
    response_model=ApiResponse[TemplateRuleSetResponse],
    status_code=status.HTTP_201_CREATED,
    tags=["template-rule"],
)
def create_template_rule(
    payload: TemplateRuleSetCreate,
    service: TemplateRuleSetService = Depends(get_template_rule_set_service),
) -> ApiResponse[TemplateRuleSetResponse]:
    try:
        entity = service.create_rule(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ApiResponse(message="created", data=TemplateRuleSetResponse.model_validate(entity))


@router.get(
    "/template-rules/{rule_id}",
    response_model=ApiResponse[TemplateRuleSetResponse],
    tags=["template-rule"],
)
def get_template_rule(
    rule_id: int,
    service: TemplateRuleSetService = Depends(get_template_rule_set_service),
) -> ApiResponse[TemplateRuleSetResponse]:
    try:
        entity = service.get_rule(rule_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ApiResponse(data=TemplateRuleSetResponse.model_validate(entity))


@router.put(
    "/template-rules/{rule_id}",
    response_model=ApiResponse[TemplateRuleSetResponse],
    tags=["template-rule"],
)
def update_template_rule(
    rule_id: int,
    payload: TemplateRuleSetUpdate,
    service: TemplateRuleSetService = Depends(get_template_rule_set_service),
) -> ApiResponse[TemplateRuleSetResponse]:
    try:
        entity = service.update_rule(rule_id, payload)
    except ValueError as exc:
        if "不存在" in str(exc):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ApiResponse(message="updated", data=TemplateRuleSetResponse.model_validate(entity))


@router.delete(
    "/template-rules/{rule_id}",
    response_model=ApiResponse[dict[str, bool]],
    tags=["template-rule"],
)
def delete_template_rule(
    rule_id: int,
    service: TemplateRuleSetService = Depends(get_template_rule_set_service),
) -> ApiResponse[dict[str, bool]]:
    try:
        service.delete_rule(rule_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ApiResponse(message="deleted", data={"deleted": True})


@router.post(
    "/template-rules/batch-delete",
    response_model=ApiResponse[dict[str, int]],
    tags=["template-rule"],
)
def batch_delete_template_rules(
    payload: TemplateRuleBatchDeleteRequest,
    service: TemplateRuleSetService = Depends(get_template_rule_set_service),
) -> ApiResponse[dict[str, int]]:
    try:
        deleted_count = service.delete_rules(payload.rule_ids)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ApiResponse(message="deleted", data={"deleted_count": deleted_count})


@router.post(
    "/exports/preview",
    response_model=ApiResponse[ExportPreviewResponse],
    tags=["export-preview"],
)
def preview_export(
    payload: ExportPreviewRequest,
    service: ExportPreviewService = Depends(get_export_preview_service),
) -> ApiResponse[ExportPreviewResponse]:
    try:
        data = service.build_preview(
            parser_config_id=payload.parser_config_id,
            import_batch_code=payload.import_batch_code,
            template_rule_id=payload.template_rule_id,
            output_key=payload.output_key,
            export_month=payload.export_month,
            page=payload.page,
            page_size=payload.page_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ApiResponse(data=data)


@router.get(
    "/detail-records",
    response_model=ApiResponse[DetailRecordPageResponse],
    tags=["detail-record"],
)
def list_detail_records(
    parser_config_id: int,
    import_batch_code: str | None = None,
    page: int = 1,
    page_size: int = 100,
    filter_field_name: str | None = None,
    filter_keyword: str | None = None,
    service: DetailRecordService = Depends(get_detail_record_service),
) -> ApiResponse[DetailRecordPageResponse]:
    try:
        data = service.query_page(
            parser_config_id=parser_config_id,
            import_batch_code=import_batch_code,
            page=page,
            page_size=page_size,
            filter_field_name=filter_field_name,
            filter_keyword=filter_keyword,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ApiResponse(data=data)


@router.post(
    "/exports/excel",
    tags=["export-preview"],
)
def export_excel(
    payload: ExportPreviewRequest,
    preview_service: ExportPreviewService = Depends(get_export_preview_service),
    export_service: ExportExcelService = Depends(get_export_excel_service),
):
    try:
        workbook_preview = preview_service.build_workbook_preview(
            parser_config_id=payload.parser_config_id,
            import_batch_code=payload.import_batch_code,
            template_rule_id=payload.template_rule_id,
            export_month=payload.export_month,
        )
        file_path = export_service.build_file(workbook_preview)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return FileResponse(
        path=file_path,
        filename=file_path.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.post(
    "/import-tasks",
    response_model=ApiResponse[ImportTaskResponse],
    status_code=status.HTTP_202_ACCEPTED,
    tags=["import-task"],
)
async def create_import_task(
    background_tasks: BackgroundTasks,
    parser_config_id: int = Form(...),
    batch_code: str | None = Form(default=None),
    file: UploadFile = File(...),
    service: ImportTaskService = Depends(get_import_task_service),
) -> ApiResponse[ImportTaskResponse]:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")

    if not file.filename.lower().endswith((".xlsx", ".xlsm", ".xltx", ".xltm")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 Excel 文件")

    content = await file.read()
    try:
        resolved_batch_code = ImportBatchService._resolve_batch_code(batch_code)
        stored_file_path = save_import_task_file(file.filename, content)
        task = service.create_task(
            parser_config_id=parser_config_id,
            batch_code=resolved_batch_code,
            file_name=file.filename,
            stored_file_path=stored_file_path,
        )
    except ValueError as exc:
        logger.warning("Create import task rejected. parser_config_id=%s, file_name=%s, error=%s", parser_config_id, file.filename, exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Create import task failed. parser_config_id=%s, file_name=%s", parser_config_id, file.filename)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"导入任务创建失败: {exc}") from exc
    finally:
        await file.close()

    background_tasks.add_task(run_import_task, task.id, engine)
    return ApiResponse(message="accepted", data=task)


@router.get(
    "/import-tasks",
    response_model=ApiResponse[list[ImportTaskResponse]],
    tags=["import-task"],
)
def list_import_tasks(
    limit: int = 20,
    service: ImportTaskService = Depends(get_import_task_service),
) -> ApiResponse[list[ImportTaskResponse]]:
    return ApiResponse(data=service.list_tasks(limit=limit))


@router.get(
    "/import-tasks/{task_id}",
    response_model=ApiResponse[ImportTaskResponse],
    tags=["import-task"],
)
def get_import_task(
    task_id: int,
    service: ImportTaskService = Depends(get_import_task_service),
) -> ApiResponse[ImportTaskResponse]:
    try:
        task = service.get_task(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ApiResponse(data=task)


@router.delete(
    "/import-tasks/{task_id}",
    response_model=ApiResponse[dict[str, bool]],
    tags=["import-task"],
)
def delete_import_task(
    task_id: int,
    service: ImportTaskService = Depends(get_import_task_service),
) -> ApiResponse[dict[str, bool]]:
    try:
        service.delete_task(task_id)
    except ValueError as exc:
        if "不存在" in str(exc):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ApiResponse(message="deleted", data={"deleted": True})


@router.post(
    "/import-batches",
    response_model=ApiResponse[ImportBatchCreateResponse],
    status_code=status.HTTP_201_CREATED,
    tags=["import-batch"],
)
async def create_import_batch(
    parser_config_id: int = Form(...),
    batch_code: str | None = Form(default=None),
    file: UploadFile = File(...),
    service: ImportBatchService = Depends(get_import_batch_service),
) -> ApiResponse[ImportBatchCreateResponse]:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")

    if not file.filename.lower().endswith((".xlsx", ".xlsm", ".xltx", ".xltm")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 Excel 文件")

    content = await file.read()
    try:
        data = service.create_batch(
            file_name=file.filename,
            parser_config_id=parser_config_id,
            batch_code=batch_code,
            content=content,
        )
    except ValueError as exc:
        logger.warning("Create import batch rejected. parser_config_id=%s, file_name=%s, error=%s", parser_config_id, file.filename, exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Create import batch failed. parser_config_id=%s, file_name=%s", parser_config_id, file.filename)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"明细导入失败: {exc}") from exc
    finally:
        await file.close()

    return ApiResponse(message="created", data=data)


@router.get(
    "/import-batches",
    response_model=ApiResponse[list[ImportBatchResponse]],
    tags=["import-batch"],
)
def list_import_batches(
    limit: int = 20,
    service: ImportBatchService = Depends(get_import_batch_service),
) -> ApiResponse[list[ImportBatchResponse]]:
    return ApiResponse(data=service.list_batches(limit=limit))


@router.delete(
    "/import-batches/{batch_code}",
    response_model=ApiResponse[dict[str, bool]],
    tags=["import-batch"],
)
def delete_import_batch(
    batch_code: str,
    service: ImportBatchService = Depends(get_import_batch_service),
) -> ApiResponse[dict[str, bool]]:
    try:
        service.delete_batch(batch_code)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ApiResponse(message="deleted", data={"deleted": True})
