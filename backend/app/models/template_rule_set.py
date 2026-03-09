import json

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class TemplateRuleSet(Base, TimestampMixin):
    __tablename__ = "template_rule_set"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    rule_name: Mapped[str] = mapped_column(String(128), nullable=False)
    group_name: Mapped[str] = mapped_column(String(128), default="默认分类", nullable=False)
    source_sheet_name: Mapped[str] = mapped_column(String(128), default="Sheet1", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_item_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    rule_config_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    @property
    def rule_item(self) -> dict[str, str]:
        try:
            parsed = json.loads(self.rule_item_json or "{}")
        except json.JSONDecodeError:
            return {}
        if not isinstance(parsed, dict):
            return {}
        return {str(key): "" if value is None else str(value) for key, value in parsed.items()}

    @property
    def outputs(self) -> list[dict]:
        try:
            parsed = json.loads(self.rule_config_json or "{}")
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, dict):
            return []
        outputs = parsed.get("outputs")
        return outputs if isinstance(outputs, list) else []
