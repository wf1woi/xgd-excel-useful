from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.core.config import get_settings
from app.core.database import engine

SCHEMA_SQL_PATH = Path(__file__).resolve().parents[2] / "db" / "schema.sql"

EXPECTED_SCHEMA: dict[str, set[str]] = {
    "parser_config": {
        "id",
        "config_code",
        "config_name",
        "sheet_name",
        "header_row_index",
        "data_start_row_index",
        "data_end_column",
        "ignore_empty_row",
        "column_mapping_json",
        "fixed_fields_json",
        "status",
        "version",
        "remark",
        "created_at",
        "updated_at",
    },
    "parser_config_column": {
        "id",
        "parser_config_id",
        "column_index",
        "column_letter",
        "header_name",
        "field_name",
        "sample_value",
        "is_enabled",
        "created_at",
        "updated_at",
    },
    "import_batch": {
        "id",
        "batch_code",
        "parser_config_id",
        "file_name",
        "sheet_name",
        "detail_table_name",
        "status",
        "imported_rows",
        "error_message",
        "created_at",
        "updated_at",
    },
    "import_task": {
        "id",
        "parser_config_id",
        "batch_code",
        "file_name",
        "stored_file_path",
        "status",
        "progress_percent",
        "progress_message",
        "imported_rows",
        "error_message",
        "created_at",
        "updated_at",
    },
    "template_rule_set": {
        "id",
        "rule_code",
        "rule_name",
        "group_name",
        "source_sheet_name",
        "description",
        "rule_item_json",
        "rule_config_json",
        "status",
        "version",
        "created_at",
        "updated_at",
    },
}

# 只做向前兼容的缺列补齐；不处理删列和改类型。
COLUMN_PATCHES: dict[str, dict[str, str]] = {
    "parser_config": {
        "fixed_fields_json": "ALTER TABLE parser_config ADD COLUMN fixed_fields_json TEXT NOT NULL DEFAULT '[]'",
    },
    "import_batch": {
        "batch_code": "ALTER TABLE import_batch ADD COLUMN batch_code VARCHAR(64)",
    },
    "template_rule_set": {
        "group_name": "ALTER TABLE template_rule_set ADD COLUMN group_name VARCHAR(128) NOT NULL DEFAULT '默认分类'",
        "source_sheet_name": "ALTER TABLE template_rule_set ADD COLUMN source_sheet_name VARCHAR(128) NOT NULL DEFAULT 'Sheet1'",
        "rule_item_json": "ALTER TABLE template_rule_set ADD COLUMN rule_item_json TEXT NOT NULL DEFAULT '{}'",
    },
}

POST_PATCH_SQL: tuple[str, ...] = (
    "UPDATE parser_config SET fixed_fields_json = '[]' WHERE fixed_fields_json IS NULL OR fixed_fields_json = ''",
    "UPDATE import_batch SET batch_code = 'legacy_' || id WHERE batch_code IS NULL OR batch_code = ''",
    "UPDATE template_rule_set SET group_name = '默认分类' WHERE group_name IS NULL OR group_name = ''",
    "UPDATE template_rule_set SET source_sheet_name = 'Sheet1' WHERE source_sheet_name IS NULL OR source_sheet_name = ''",
    "UPDATE template_rule_set SET rule_item_json = '{}' WHERE rule_item_json IS NULL OR rule_item_json = ''",
    "CREATE INDEX IF NOT EXISTS ix_import_batch_batch_code ON import_batch (batch_code)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_parser_config_config_code ON parser_config (config_code)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_template_rule_set_rule_code ON template_rule_set (rule_code)",
)


def ensure_schema(target_engine: Engine | None = None) -> None:
    db_engine = target_engine or engine
    logger = logging.getLogger(__name__)
    settings = get_settings()

    _execute_schema_sql(db_engine)
    _apply_column_patches(db_engine)
    _validate_schema(db_engine)

    logger.info("Database schema ready. schema=%s db=%s", SCHEMA_SQL_PATH, settings.db_path)


def _execute_schema_sql(target_engine: Engine) -> None:
    statements = [
        statement.strip()
        for statement in SCHEMA_SQL_PATH.read_text(encoding="utf-8").split(";")
        if statement.strip()
    ]
    with target_engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _apply_column_patches(target_engine: Engine) -> None:
    with target_engine.begin() as connection:
        for table_name, expected_columns in EXPECTED_SCHEMA.items():
            existing_columns = _get_columns(connection, table_name)
            if not existing_columns:
                continue
            missing_columns = expected_columns - existing_columns
            if not missing_columns:
                continue
            table_patches = COLUMN_PATCHES.get(table_name, {})
            for column_name in sorted(missing_columns):
                patch_sql = table_patches.get(column_name)
                if not patch_sql:
                    raise RuntimeError(f"表 {table_name} 缺少列 {column_name}，且没有可用补丁")
                connection.execute(text(patch_sql))

        for statement in POST_PATCH_SQL:
            connection.execute(text(statement))


def _validate_schema(target_engine: Engine) -> None:
    with target_engine.begin() as connection:
        for table_name, expected_columns in EXPECTED_SCHEMA.items():
            existing_columns = _get_columns(connection, table_name)
            if not existing_columns:
                raise RuntimeError(f"基础表缺失: {table_name}")
            missing_columns = sorted(expected_columns - existing_columns)
            if missing_columns:
                raise RuntimeError(f"表结构校验失败: {table_name} 缺少列 {', '.join(missing_columns)}")


def _get_columns(connection, table_name: str) -> set[str]:
    result = connection.execute(text(f"PRAGMA table_info({table_name})"))
    return {row[1] for row in result.fetchall()}
