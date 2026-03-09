from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class ImportTask(Base, TimestampMixin):
    __tablename__ = "import_task"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parser_config_id: Mapped[int] = mapped_column(
        ForeignKey("parser_config.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    batch_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_file_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress_message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    parser_config: Mapped["ParserConfig"] = relationship()
