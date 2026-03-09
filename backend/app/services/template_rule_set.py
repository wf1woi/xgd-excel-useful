import json
from math import ceil

from app.models.template_rule_set import TemplateRuleSet
from app.repositories.template_rule_set import TemplateRuleSetRepository
from app.schemas.template_rule_set import (
    TemplateRulePageResponse,
    TemplateRuleSetCreate,
    TemplateRuleSetResponse,
    TemplateRuleSetUpdate,
)


class TemplateRuleSetService:
    def __init__(self, repository: TemplateRuleSetRepository) -> None:
        self.repository = repository

    def list_rules(self) -> list[TemplateRuleSet]:
        return self.repository.list_all()

    def list_rule_page(self, page: int, page_size: int, keyword: str | None = None) -> TemplateRulePageResponse:
        items, total = self.repository.list_page(page, page_size, keyword=keyword)
        total_pages = max(1, ceil(total / page_size)) if total else 1
        return TemplateRulePageResponse(
            items=[TemplateRuleSetResponse.model_validate(item) for item in items],
            page=min(page, total_pages),
            page_size=page_size,
            total=total,
            total_pages=total_pages,
        )

    def get_rule(self, rule_id: int) -> TemplateRuleSet:
        entity = self.repository.get_by_id(rule_id)
        if entity is None:
            raise ValueError("模板规则不存在")
        return entity

    def create_rule(self, payload: TemplateRuleSetCreate) -> TemplateRuleSet:
        if self.repository.get_by_code(payload.rule_code):
            raise ValueError("rule_code 已存在")
        entity = TemplateRuleSet(
            rule_code=payload.rule_code,
            rule_name=payload.rule_name,
            group_name=payload.group_name,
            source_sheet_name=payload.source_sheet_name,
            description=payload.description,
            rule_item_json=json.dumps(payload.rule_item, ensure_ascii=False),
            rule_config_json=json.dumps({"outputs": [item.model_dump() for item in payload.outputs]}, ensure_ascii=False),
            status=payload.status,
            version=payload.version,
        )
        return self.repository.create(entity)

    def update_rule(self, rule_id: int, payload: TemplateRuleSetUpdate) -> TemplateRuleSet:
        entity = self.get_rule(rule_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            if field == "rule_item":
                entity.rule_item_json = json.dumps(value or {}, ensure_ascii=False)
                continue
            if field == "outputs":
                entity.rule_config_json = json.dumps({"outputs": value or []}, ensure_ascii=False)
                continue
            setattr(entity, field, value)
        return self.repository.update(entity)

    def delete_rule(self, rule_id: int) -> None:
        entity = self.get_rule(rule_id)
        self.repository.delete(entity)

    def delete_rules(self, rule_ids: list[int]) -> int:
        normalized_ids = sorted({int(rule_id) for rule_id in rule_ids if int(rule_id) > 0})
        if not normalized_ids:
            raise ValueError("请选择至少一条模板规则")
        deleted_count = self.repository.delete_by_ids(normalized_ids)
        if deleted_count == 0:
            raise ValueError("未找到可删除的模板规则")
        return deleted_count
