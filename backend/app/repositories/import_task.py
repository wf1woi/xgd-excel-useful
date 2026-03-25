from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.import_task import ImportTask


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
