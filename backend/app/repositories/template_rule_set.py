from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.template_rule_set import TemplateRuleSet


class TemplateRuleSetRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_all(self) -> list[TemplateRuleSet]:
        stmt = select(TemplateRuleSet).order_by(TemplateRuleSet.id.desc())
        return list(self.db.scalars(stmt).all())

    def list_page(self, page: int, page_size: int, keyword: str | None = None) -> tuple[list[TemplateRuleSet], int]:
        stmt = select(TemplateRuleSet)
        count_stmt = select(func.count()).select_from(TemplateRuleSet)
        if keyword:
            pattern = f"%{keyword.strip()}%"
            condition = or_(
                TemplateRuleSet.rule_code.ilike(pattern),
                TemplateRuleSet.rule_name.ilike(pattern),
                TemplateRuleSet.group_name.ilike(pattern),
                TemplateRuleSet.source_sheet_name.ilike(pattern),
                TemplateRuleSet.rule_item_json.ilike(pattern),
                TemplateRuleSet.rule_config_json.ilike(pattern),
            )
            stmt = stmt.where(condition)
            count_stmt = count_stmt.where(condition)
        total = int(self.db.scalar(count_stmt) or 0)
        stmt = (
            stmt
            .order_by(TemplateRuleSet.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self.db.scalars(stmt).all()), total

    def get_by_id(self, rule_id: int) -> TemplateRuleSet | None:
        return self.db.get(TemplateRuleSet, rule_id)

    def get_by_code(self, rule_code: str) -> TemplateRuleSet | None:
        stmt = select(TemplateRuleSet).where(TemplateRuleSet.rule_code == rule_code)
        return self.db.scalar(stmt)

    def create(self, entity: TemplateRuleSet) -> TemplateRuleSet:
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return entity

    def update(self, entity: TemplateRuleSet) -> TemplateRuleSet:
        self.db.add(entity)
        self.db.commit()
        self.db.refresh(entity)
        return entity

    def delete(self, entity: TemplateRuleSet) -> None:
        self.db.delete(entity)
        self.db.commit()

    def delete_by_ids(self, rule_ids: list[int]) -> int:
        if not rule_ids:
            return 0
        stmt = select(TemplateRuleSet).where(TemplateRuleSet.id.in_(rule_ids))
        entities = list(self.db.scalars(stmt).all())
        for entity in entities:
            self.db.delete(entity)
        self.db.commit()
        return len(entities)
