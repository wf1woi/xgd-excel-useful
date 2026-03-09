from sqlalchemy import text

from app.core.database import engine


def ensure_import_batch_batch_code() -> None:
    with engine.begin() as connection:
        tables = connection.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='import_batch'")).fetchall()
        if not tables:
            return

        columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(import_batch)"))
        }
        if "batch_code" not in columns:
            connection.execute(text("ALTER TABLE import_batch ADD COLUMN batch_code VARCHAR(64)"))
            connection.execute(text("UPDATE import_batch SET batch_code = 'legacy_' || id WHERE batch_code IS NULL OR batch_code = ''"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_import_batch_batch_code ON import_batch (batch_code)"))


def ensure_parser_config_fixed_fields_json() -> None:
    with engine.begin() as connection:
        tables = connection.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='parser_config'")).fetchall()
        if not tables:
            return

        columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(parser_config)"))
        }
        if "fixed_fields_json" not in columns:
            connection.execute(text("ALTER TABLE parser_config ADD COLUMN fixed_fields_json TEXT DEFAULT '[]'"))
            connection.execute(text("UPDATE parser_config SET fixed_fields_json = '[]' WHERE fixed_fields_json IS NULL OR fixed_fields_json = ''"))


def ensure_template_rule_set_dynamic_columns() -> None:
    with engine.begin() as connection:
        tables = connection.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='template_rule_set'")).fetchall()
        if not tables:
            return

        columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(template_rule_set)"))
        }
        if "group_name" not in columns:
            connection.execute(text("ALTER TABLE template_rule_set ADD COLUMN group_name VARCHAR(128) DEFAULT '默认分类'"))
            connection.execute(text("UPDATE template_rule_set SET group_name = '默认分类' WHERE group_name IS NULL OR group_name = ''"))
        if "source_sheet_name" not in columns:
            connection.execute(text("ALTER TABLE template_rule_set ADD COLUMN source_sheet_name VARCHAR(128) DEFAULT 'Sheet1'"))
            connection.execute(text("UPDATE template_rule_set SET source_sheet_name = 'Sheet1' WHERE source_sheet_name IS NULL OR source_sheet_name = ''"))
        if "rule_item_json" not in columns:
            connection.execute(text("ALTER TABLE template_rule_set ADD COLUMN rule_item_json TEXT DEFAULT '{}'"))
            connection.execute(text("UPDATE template_rule_set SET rule_item_json = '{}' WHERE rule_item_json IS NULL OR rule_item_json = ''"))
