from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class ParserConfigColumn(Base, TimestampMixin):
    __tablename__ = "parser_config_column"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parser_config_id: Mapped[int] = mapped_column(
        ForeignKey("parser_config.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    column_index: Mapped[int] = mapped_column(Integer, nullable=False)
    column_letter: Mapped[str] = mapped_column(String(16), nullable=False)
    header_name: Mapped[str] = mapped_column(String(255), nullable=False)
    field_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sample_value: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    parser_config: Mapped["ParserConfig"] = relationship(back_populates="columns")
