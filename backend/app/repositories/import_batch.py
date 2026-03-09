from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.import_batch import ImportBatch


class ImportBatchRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, entity: ImportBatch) -> ImportBatch:
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return entity

    def list_recent(self, limit: int = 20) -> list[ImportBatch]:
        stmt = select(ImportBatch).order_by(ImportBatch.id.desc()).limit(limit)
        return list(self.db.scalars(stmt).all())

    def get_by_id(self, batch_id: int) -> ImportBatch | None:
        return self.db.get(ImportBatch, batch_id)

    def get_latest_by_parser_config_id(self, parser_config_id: int) -> ImportBatch | None:
        stmt = (
            select(ImportBatch)
            .where(ImportBatch.parser_config_id == parser_config_id)
            .order_by(ImportBatch.id.desc())
            .limit(1)
        )
        return self.db.scalar(stmt)

    def list_by_batch_code(self, batch_code: str) -> list[ImportBatch]:
        stmt = (
            select(ImportBatch)
            .where(ImportBatch.batch_code == batch_code)
            .order_by(ImportBatch.id.asc())
        )
        return list(self.db.scalars(stmt).all())

    def list_by_parser_config_and_batch_code(
        self,
        parser_config_id: int,
        batch_code: str,
    ) -> list[ImportBatch]:
        stmt = (
            select(ImportBatch)
            .where(
                ImportBatch.parser_config_id == parser_config_id,
                ImportBatch.batch_code == batch_code,
            )
            .order_by(ImportBatch.id.asc())
        )
        return list(self.db.scalars(stmt).all())

    def get_latest_batch_code_by_parser_config_id(self, parser_config_id: int) -> str | None:
        entity = self.get_latest_by_parser_config_id(parser_config_id)
        return entity.batch_code if entity else None

    def delete_by_batch_code(self, batch_code: str) -> None:
        self.db.execute(delete(ImportBatch).where(ImportBatch.batch_code == batch_code))
        self.db.commit()
