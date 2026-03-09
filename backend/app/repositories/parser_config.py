from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.parser_config import ParserConfig


class ParserConfigRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_all(self) -> list[ParserConfig]:
        stmt = (
            select(ParserConfig)
            .options(selectinload(ParserConfig.columns))
            .order_by(ParserConfig.id.desc())
        )
        return list(self.db.scalars(stmt).all())

    def get_by_id(self, config_id: int) -> ParserConfig | None:
        stmt = (
            select(ParserConfig)
            .options(selectinload(ParserConfig.columns))
            .where(ParserConfig.id == config_id)
        )
        return self.db.scalar(stmt)

    def get_by_code(self, config_code: str) -> ParserConfig | None:
        stmt = (
            select(ParserConfig)
            .options(selectinload(ParserConfig.columns))
            .where(ParserConfig.config_code == config_code)
        )
        return self.db.scalar(stmt)

    def create(self, entity: ParserConfig) -> ParserConfig:
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return entity

    def update(self, entity: ParserConfig) -> ParserConfig:
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return entity

    def delete(self, entity: ParserConfig) -> None:
        self.db.delete(entity)
        self.db.commit()
