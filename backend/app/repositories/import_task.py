from datetime import timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.import_task import ImportTask
from app.utils.timezone import shanghai_now_naive


class ImportTaskRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, entity: ImportTask) -> ImportTask:
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return entity

    def get_by_id(self, task_id: int) -> ImportTask | None:
        return self.db.get(ImportTask, task_id)

    def list_recent(self, limit: int = 20) -> list[ImportTask]:
        stmt = select(ImportTask).order_by(ImportTask.id.desc()).limit(limit)
        return list(self.db.scalars(stmt).all())

    def update(self, entity: ImportTask) -> ImportTask:
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return entity

    def delete(self, entity: ImportTask) -> None:
        self.db.delete(entity)
        self.db.commit()

    def claim_next_pending(self) -> ImportTask | None:
        stmt = (
            select(ImportTask)
            .where(ImportTask.status == "pending")
            .order_by(ImportTask.id.asc())
            .limit(1)
        )
        entity = self.db.scalar(stmt)
        if entity is None:
            return None
        entity.status = "running"
        entity.progress_percent = max(int(entity.progress_percent or 0), 1)
        entity.progress_message = "已进入处理队列，准备开始导入"
        entity.error_message = None
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return entity

    def acquire_queue_lock(self, lock_name: str = "import_task_queue", timeout_seconds: int = 3600) -> bool:
        now = shanghai_now_naive()
        expired_before = now - timedelta(seconds=timeout_seconds)
        self.db.execute(
            text(
                "DELETE FROM import_task_queue_lock "
                "WHERE lock_name = :lock_name AND locked_at < :expired_before"
            ),
            {
                "lock_name": lock_name,
                "expired_before": expired_before,
            },
        )
        result = self.db.execute(
            text(
                "INSERT OR IGNORE INTO import_task_queue_lock (lock_name, locked_at) "
                "VALUES (:lock_name, :locked_at)"
            ),
            {
                "lock_name": lock_name,
                "locked_at": now,
            },
        )
        self.db.commit()
        return bool(getattr(result, "rowcount", 0))

    def release_queue_lock(self, lock_name: str = "import_task_queue") -> None:
        self.db.execute(
            text("DELETE FROM import_task_queue_lock WHERE lock_name = :lock_name"),
            {"lock_name": lock_name},
        )
        self.db.commit()
