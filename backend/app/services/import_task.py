import logging
from pathlib import Path
from uuid import uuid4

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.import_task import ImportTask
from app.repositories.import_batch import ImportBatchRepository
from app.repositories.import_task import ImportTaskRepository
from app.repositories.parser_config import ParserConfigRepository
from app.repositories.parser_config_column import ParserConfigColumnRepository
from app.schemas.import_task import ImportTaskResponse
from app.services.dynamic_detail_table import DynamicDetailTableManager
from app.services.import_batch import ImportBatchService
from app.engines.excel.importer import ExcelImportEngine


logger = logging.getLogger(__name__)


class ImportTaskService:
    def __init__(
        self,
        task_repository: ImportTaskRepository,
        parser_repository: ParserConfigRepository,
    ) -> None:
        self.task_repository = task_repository
        self.parser_repository = parser_repository

    def create_task(
        self,
        parser_config_id: int,
        batch_code: str,
        file_name: str,
        stored_file_path: str,
    ) -> ImportTaskResponse:
        parser_config = self.parser_repository.get_by_id(parser_config_id)
        if parser_config is None:
            raise ValueError("解析配置不存在")

        task = ImportTask(
            parser_config_id=parser_config_id,
            batch_code=batch_code,
            file_name=file_name,
            stored_file_path=stored_file_path,
            status="pending",
            progress_percent=0,
            progress_message="等待后台处理",
            imported_rows=0,
            error_message=None,
        )
        entity = self.task_repository.create(task)
        return ImportTaskResponse.model_validate(entity)

    def list_tasks(self, limit: int = 20) -> list[ImportTaskResponse]:
        return [ImportTaskResponse.model_validate(item) for item in self.task_repository.list_recent(limit)]

    def get_task(self, task_id: int) -> ImportTaskResponse:
        entity = self.task_repository.get_by_id(task_id)
        if entity is None:
            raise ValueError("导入任务不存在")
        return ImportTaskResponse.model_validate(entity)

    def delete_task(self, task_id: int) -> None:
        entity = self.task_repository.get_by_id(task_id)
        if entity is None:
            raise ValueError("导入任务不存在")
        if entity.status in {"pending", "running"}:
            raise ValueError("正在执行中的导入任务暂不支持删除")

        stored_file_path = entity.stored_file_path
        self.task_repository.delete(entity)

        if stored_file_path:
            file_path = Path(stored_file_path)
            try:
                if file_path.exists():
                    file_path.unlink()
            except OSError:
                logger.warning("Failed to delete import task file. task_id=%s path=%s", task_id, stored_file_path)

    def update_progress(
        self,
        task_id: int,
        progress_percent: int,
        progress_message: str,
        *,
        imported_rows: int | None = None,
        error_message: str | None = None,
        status: str | None = None,
    ) -> None:
        entity = self.task_repository.get_by_id(task_id)
        if entity is None:
            return
        entity.progress_percent = max(0, min(progress_percent, 100))
        entity.progress_message = progress_message
        if imported_rows is not None:
            entity.imported_rows = imported_rows
        if error_message is not None:
            entity.error_message = error_message
        if status is not None:
            entity.status = status
        self.task_repository.update(entity)


def save_import_task_file(file_name: str, content: bytes) -> str:
    settings = get_settings()
    task_upload_dir = settings.upload_dir / "import_tasks"
    task_upload_dir.mkdir(parents=True, exist_ok=True)
    source_path = Path(file_name)
    safe_name = source_path.name
    file_path = task_upload_dir / f"{source_path.stem}_{uuid4().hex[:8]}{source_path.suffix}"
    file_path.write_bytes(content)
    return file_path.as_posix()


def run_import_task(task_id: int, engine) -> None:
    db = SessionLocal()
    task_repository = ImportTaskRepository(db)
    parser_repository = ParserConfigRepository(db)
    task_service = ImportTaskService(task_repository, parser_repository)
    column_repository = ParserConfigColumnRepository(db)
    batch_repository = ImportBatchRepository(db)
    table_manager = DynamicDetailTableManager(engine)
    import_batch_service = ImportBatchService(
        parser_repository=parser_repository,
        column_repository=column_repository,
        batch_repository=batch_repository,
        import_engine=ExcelImportEngine(),
        table_manager=table_manager,
    )

    try:
        task = task_repository.get_by_id(task_id)
        if task is None:
            return

        task_service.update_progress(task_id, 5, "正在读取文件", status="running")
        file_path = Path(task.stored_file_path)
        if not file_path.exists():
            raise ValueError("导入文件不存在，无法继续处理")

        content = file_path.read_bytes()

        def on_progress(processed_rows: int, total_rows: int) -> None:
            if total_rows > 0:
                progress_ratio = min(processed_rows / total_rows, 1)
                progress_percent = 10 + int(progress_ratio * 70)
                message = f"正在解析数据 {processed_rows}/{total_rows}"
            else:
                progress_percent = 50
                message = f"正在解析数据 {processed_rows} 行"
            task_service.update_progress(task_id, progress_percent, message, status="running")

        response = import_batch_service.create_batch(
            file_name=task.file_name,
            parser_config_id=task.parser_config_id,
            batch_code=task.batch_code,
            content=content,
            progress_callback=on_progress,
        )
        task_service.update_progress(
            task_id,
            100,
            "导入完成",
            imported_rows=response.imported_rows,
            status="success",
        )
    except Exception as exc:
        logger.exception("Import task failed. task_id=%s", task_id)
        task_service.update_progress(
            task_id,
            100,
            "导入失败",
            status="failed",
            error_message=str(exc),
        )
    finally:
        db.close()
