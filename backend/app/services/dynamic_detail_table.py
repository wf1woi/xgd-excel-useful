from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.models.parser_config_column import ParserConfigColumn
from app.services.fixed_field import FixedFieldColumn


DetailTableColumn = ParserConfigColumn | FixedFieldColumn


class DynamicDetailTableManager:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def build_table_name(self, config_code: str) -> str:
        safe_code = "".join(char.lower() if char.isalnum() else "_" for char in config_code.strip())
        safe_code = "_".join(filter(None, safe_code.split("_"))) or "config"
        return f"detail_{safe_code}"

    def ensure_table(self, table_name: str, columns: Sequence[DetailTableColumn]) -> None:
        with self.engine.begin() as connection:
            existing_columns = self._get_existing_columns(connection, table_name)
            if not existing_columns:
                statement = self._build_create_table_sql(table_name, columns)
                connection.execute(text(statement))
                return

            for column in columns:
                if column.field_name in existing_columns:
                    continue
                connection.execute(
                    text(
                        f'ALTER TABLE {self._quote_identifier(table_name)} '
                        f'ADD COLUMN {self._quote_identifier(column.field_name)} TEXT'
                    )
                )

    def insert_rows(
        self,
        table_name: str,
        columns: Sequence[DetailTableColumn],
        batch_id: int,
        rows: list[dict[str, str | None]],
    ) -> None:
        if not rows:
            return

        column_names = ["batch_id", "row_number", *[column.field_name for column in columns]]
        placeholders = ", ".join(f":{name}" for name in column_names)
        quoted_columns = ", ".join(self._quote_identifier(name) for name in column_names)
        statement = text(
            f'INSERT INTO {self._quote_identifier(table_name)} ({quoted_columns}) VALUES ({placeholders})'
        )

        payload = []
        for row_number, row in enumerate(rows, start=1):
            record = {"batch_id": batch_id, "row_number": row_number}
            for column in columns:
                record[column.field_name] = row.get(column.field_name)
            payload.append(record)

        with self.engine.begin() as connection:
            connection.execute(statement, payload)

    def fetch_rows(
        self,
        table_name: str,
        columns: Sequence[DetailTableColumn],
        batch_ids: Sequence[int],
        limit: int = 20,
    ) -> list[dict[str, str | None]]:
        if not batch_ids:
            return []
        selected_columns = [column.field_name for column in columns if column.is_enabled]
        quoted_columns = ", ".join(self._quote_identifier(name) for name in selected_columns)
        batch_id_csv = ", ".join(str(int(batch_id)) for batch_id in batch_ids)
        statement = text(
            f'SELECT {quoted_columns} FROM {self._quote_identifier(table_name)} '
            f'WHERE batch_id IN ({batch_id_csv}) ORDER BY batch_id ASC, row_number ASC LIMIT :limit'
        )
        with self.engine.begin() as connection:
            result = connection.execute(statement, {"limit": limit})
            return [dict(row._mapping) for row in result]

    def fetch_all_rows(
        self,
        table_name: str,
        columns: Sequence[DetailTableColumn],
        batch_ids: Sequence[int],
    ) -> list[dict[str, str | None]]:
        if not batch_ids:
            return []
        selected_columns = [column.field_name for column in columns if column.is_enabled]
        quoted_columns = ", ".join(self._quote_identifier(name) for name in selected_columns)
        batch_id_csv = ", ".join(str(int(batch_id)) for batch_id in batch_ids)
        statement = text(
            f'SELECT {quoted_columns} FROM {self._quote_identifier(table_name)} '
            f'WHERE batch_id IN ({batch_id_csv}) ORDER BY batch_id ASC, row_number ASC'
        )
        with self.engine.begin() as connection:
            result = connection.execute(statement)
            return [dict(row._mapping) for row in result]

    def fetch_rows_page(
        self,
        table_name: str,
        columns: Sequence[DetailTableColumn],
        batch_ids: Sequence[int],
        page: int,
        page_size: int,
        filter_field_name: str | None = None,
        filter_keyword: str | None = None,
    ) -> list[dict[str, str | int | None]]:
        if not batch_ids:
            return []

        selected_columns = [column.field_name for column in columns if column.is_enabled]
        quoted_columns = ", ".join(
            [self._quote_identifier("row_number"), *[self._quote_identifier(name) for name in selected_columns]]
        )
        batch_id_csv = ", ".join(str(int(batch_id)) for batch_id in batch_ids)
        where_sql, params = self._build_filter_clause(batch_id_csv, filter_field_name, filter_keyword)
        params.update({
            "limit": page_size,
            "offset": (page - 1) * page_size,
        })
        statement = text(
            f'SELECT {quoted_columns} FROM {self._quote_identifier(table_name)} '
            f'{where_sql} ORDER BY batch_id ASC, row_number ASC LIMIT :limit OFFSET :offset'
        )
        with self.engine.begin() as connection:
            result = connection.execute(statement, params)
            return [dict(row._mapping) for row in result]

    def count_rows(
        self,
        table_name: str,
        batch_ids: Sequence[int],
        filter_field_name: str | None = None,
        filter_keyword: str | None = None,
    ) -> int:
        if not batch_ids:
            return 0

        batch_id_csv = ", ".join(str(int(batch_id)) for batch_id in batch_ids)
        where_sql, params = self._build_filter_clause(batch_id_csv, filter_field_name, filter_keyword)
        statement = text(
            f'SELECT COUNT(1) FROM {self._quote_identifier(table_name)} {where_sql}'
        )
        with self.engine.begin() as connection:
            return int(connection.execute(statement, params).scalar() or 0)

    def delete_rows(self, table_name: str, batch_ids: Sequence[int]) -> None:
        if not batch_ids:
            return
        batch_id_csv = ", ".join(str(int(batch_id)) for batch_id in batch_ids)
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    f'DELETE FROM {self._quote_identifier(table_name)} '
                    f'WHERE batch_id IN ({batch_id_csv})'
                )
            )

    def drop_table(self, table_name: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(text(f'DROP TABLE IF EXISTS {self._quote_identifier(table_name)}'))

    def _build_filter_clause(
        self,
        batch_id_csv: str,
        filter_field_name: str | None,
        filter_keyword: str | None,
    ) -> tuple[str, dict[str, str]]:
        where_sql = f'WHERE batch_id IN ({batch_id_csv})'
        params: dict[str, str] = {}
        if filter_field_name and filter_keyword:
            where_sql += (
                f' AND COALESCE({self._quote_identifier(filter_field_name)}, \'\') LIKE :filter_keyword'
            )
            params["filter_keyword"] = f"%{filter_keyword.strip()}%"
        return where_sql, params

    def _get_existing_columns(self, connection, table_name: str) -> set[str]:
        result = connection.execute(text(f'PRAGMA table_info({self._quote_identifier(table_name)})'))
        rows = result.fetchall()
        return {row[1] for row in rows}

    def _build_create_table_sql(self, table_name: str, columns: Sequence[DetailTableColumn]) -> str:
        parts = [
            'id INTEGER PRIMARY KEY AUTOINCREMENT',
            'batch_id INTEGER NOT NULL',
            'row_number INTEGER NOT NULL',
        ]
        parts.extend(f'{self._quote_identifier(column.field_name)} TEXT' for column in columns)
        return f'CREATE TABLE IF NOT EXISTS {self._quote_identifier(table_name)} ({", ".join(parts)})'

    def _quote_identifier(self, name: str) -> str:
        escaped = name.replace('"', '""')
        return f'"{escaped}"'
