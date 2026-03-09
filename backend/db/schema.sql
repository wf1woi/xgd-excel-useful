PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS parser_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_code VARCHAR(64) NOT NULL,
    config_name VARCHAR(128) NOT NULL,
    sheet_name VARCHAR(128) NOT NULL DEFAULT 'Sheet1',
    header_row_index INTEGER NOT NULL DEFAULT 1,
    data_start_row_index INTEGER NOT NULL DEFAULT 2,
    data_end_column VARCHAR(16) NOT NULL DEFAULT 'Z',
    ignore_empty_row BOOLEAN NOT NULL DEFAULT 1,
    column_mapping_json TEXT NOT NULL DEFAULT '{}',
    fixed_fields_json TEXT NOT NULL DEFAULT '[]',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    remark TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_parser_config_config_code ON parser_config (config_code);
CREATE INDEX IF NOT EXISTS ix_parser_config_config_code ON parser_config (config_code);

CREATE TABLE IF NOT EXISTS parser_config_column (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parser_config_id INTEGER NOT NULL,
    column_index INTEGER NOT NULL,
    column_letter VARCHAR(16) NOT NULL,
    header_name VARCHAR(255) NOT NULL,
    field_name VARCHAR(255) NOT NULL,
    sample_value VARCHAR(500),
    is_enabled BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parser_config_id) REFERENCES parser_config (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_parser_config_column_parser_config_id ON parser_config_column (parser_config_id);

CREATE TABLE IF NOT EXISTS import_batch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code VARCHAR(64) NOT NULL,
    parser_config_id INTEGER NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    sheet_name VARCHAR(128) NOT NULL,
    detail_table_name VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'success',
    imported_rows INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parser_config_id) REFERENCES parser_config (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_import_batch_batch_code ON import_batch (batch_code);
CREATE INDEX IF NOT EXISTS ix_import_batch_parser_config_id ON import_batch (parser_config_id);

CREATE TABLE IF NOT EXISTS import_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parser_config_id INTEGER NOT NULL,
    batch_code VARCHAR(64) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    stored_file_path TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    progress_percent INTEGER NOT NULL DEFAULT 0,
    progress_message VARCHAR(255),
    imported_rows INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parser_config_id) REFERENCES parser_config (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_import_task_parser_config_id ON import_task (parser_config_id);
CREATE INDEX IF NOT EXISTS ix_import_task_batch_code ON import_task (batch_code);
CREATE INDEX IF NOT EXISTS ix_import_task_status ON import_task (status);

CREATE TABLE IF NOT EXISTS template_rule_set (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_code VARCHAR(64) NOT NULL,
    rule_name VARCHAR(128) NOT NULL,
    group_name VARCHAR(128) NOT NULL DEFAULT '默认分类',
    source_sheet_name VARCHAR(128) NOT NULL DEFAULT 'Sheet1',
    description TEXT,
    rule_item_json TEXT NOT NULL DEFAULT '{}',
    rule_config_json TEXT NOT NULL DEFAULT '{}',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_rule_set_rule_code ON template_rule_set (rule_code);
CREATE INDEX IF NOT EXISTS ix_template_rule_set_rule_code ON template_rule_set (rule_code);
