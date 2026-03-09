import json

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class ParserConfig(Base, TimestampMixin):
    __tablename__ = "parser_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    config_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    config_name: Mapped[str] = mapped_column(String(128), nullable=False)
    sheet_name: Mapped[str] = mapped_column(String(128), default="Sheet1", nullable=False)
    header_row_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    data_start_row_index: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    data_end_column: Mapped[str] = mapped_column(String(16), default="Z", nullable=False)
    ignore_empty_row: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    column_mapping_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    fixed_fields_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    columns: Mapped[list["ParserConfigColumn"]] = relationship(
        back_populates="parser_config",
        cascade="all, delete-orphan",
        order_by="ParserConfigColumn.column_index.asc()",
    )
    import_batches: Mapped[list["ImportBatch"]] = relationship(
        back_populates="parser_config",
        cascade="all, delete-orphan",
        order_by="ImportBatch.id.desc()",
    )

    @property
    def fixed_fields(self) -> list[dict[str, str | bool | None]]:
        try:
            parsed = json.loads(self.fixed_fields_json or "[]")
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []

        normalized: list[dict[str, str | bool | None]] = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            normalized.append(
                {
                    "field_name": str(item.get("field_name") or "").strip(),
                    "field_key": str(item.get("field_key") or "").strip(),
                    "field_value": str(item.get("field_value") or "").strip(),
                    "field_name_source": item.get("field_name_source"),
                    "field_value_source": item.get("field_value_source"),
                    "follow_excel_value": bool(item.get("follow_excel_value", True)),
                    "is_enabled": bool(item.get("is_enabled", True)),
                }
            )
        return normalized
