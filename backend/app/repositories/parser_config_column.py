from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.parser_config_column import ParserConfigColumn


class ParserConfigColumnRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_by_config_id(self, parser_config_id: int) -> list[ParserConfigColumn]:
        stmt = (
            select(ParserConfigColumn)
            .where(ParserConfigColumn.parser_config_id == parser_config_id)
            .order_by(ParserConfigColumn.column_index.asc())
        )
        return list(self.db.scalars(stmt).all())

    def replace_for_config(
        self,
        parser_config_id: int,
        columns: list[ParserConfigColumn],
    ) -> list[ParserConfigColumn]:
        self.db.execute(
            delete(ParserConfigColumn).where(ParserConfigColumn.parser_config_id == parser_config_id)
        )
        for column in columns:
            self.db.add(column)
        self.db.flush()
        return columns
