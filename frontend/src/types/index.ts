export type ModuleStatus = '规划中' | '开发中' | '已完成'

export type ParserConfig = {
  id: number
  config_code: string
  config_name: string
  sheet_name: string
  header_row_index: number
  data_start_row_index: number
  data_end_column: string
  ignore_empty_row: boolean
  column_mapping_json: string
  columns: ParserConfigColumn[]
  fixed_fields: ParserConfigFixedField[]
  status: 'active' | 'inactive'
  version: number
  remark: string | null
  created_at: string
  updated_at: string
}

export type ParserConfigColumn = {
  id?: number
  column_index: number
  column_letter: string
  header_name: string
  field_name: string
  sample_value: string | null
  is_enabled: boolean
  created_at?: string
  updated_at?: string
}

export type ParserConfigFixedField = {
  field_name: string
  field_key: string
  field_value: string
  field_name_source: string | null
  field_value_source: string | null
  follow_excel_value: boolean
  is_enabled: boolean
}

export type ParserConfigCreatePayload = {
  config_code: string
  config_name: string
  sheet_name: string
  header_row_index: number
  data_start_row_index: number
  data_end_column: string
  ignore_empty_row: boolean
  column_mapping_json: string
  detected_columns: ParserConfigColumn[]
  fixed_fields: ParserConfigFixedField[]
  status: 'active' | 'inactive'
  version: number
  remark: string
}

export type ExcelPreview = {
  sheet_names: string[]
  selected_sheet_name: string
  max_rows: number
  max_columns: number
  sheet_max_rows: number
  sheet_max_columns: number
  is_truncated_rows: boolean
  is_truncated_columns: boolean
  detected_columns: ParserConfigColumn[]
  rows: Array<Array<string | number | boolean | null>>
}

export type TemplateRuleOutputField = {
  field_name: string
  display_name: string
  field_order: number
  is_enabled: boolean
}

export type TemplateRuleFilter = {
  field_name: string
  operator: string
  value?: string | null
  value_template?: string | null
}

export type TemplateRuleAggregation = {
  field_name: string
  aggregate_func: string
  alias: string
}

export type TemplateRulePreviewSummary = {
  field_name: string
  label: string
  aggregate_func: string
}

export type TemplateRuleOutputConfig = {
  output_key: string
  sheet_name: string
  source_type: string
  title_rows: string[]
  fields: TemplateRuleOutputField[]
  filters: TemplateRuleFilter[]
  group_by_fields: string[]
  aggregations: TemplateRuleAggregation[]
  preview_summary_items: TemplateRulePreviewSummary[]
  sort_by: Array<{ field_name?: string; field?: string; direction: string }>
}

export type TemplateRuleSet = {
  id: number
  rule_code: string
  rule_name: string
  group_name: string
  source_sheet_name: string
  description: string | null
  rule_item: Record<string, string>
  outputs: TemplateRuleOutputConfig[]
  status: 'active' | 'inactive'
  version: number
  created_at: string
  updated_at: string
}

export type TemplateRuleCreatePayload = {
  rule_code: string
  rule_name: string
  group_name: string
  source_sheet_name: string
  description: string
  rule_item: Record<string, string>
  outputs: TemplateRuleOutputConfig[]
  status: 'active' | 'inactive'
  version: number
}

export type TemplateRuleImportSheetPreview = {
  sheet_name: string
  rule_count: number
  sample_rules: Array<{
    rule_item: Record<string, string>
    outputs: TemplateRuleOutputConfig[]
  }>
}

export type TemplateRuleImportPreviewResult = {
  sheet_names: string[]
  sheets: TemplateRuleImportSheetPreview[]
  selected_sheet_name: string
  rows: string[][]
  max_rows: number
  max_columns: number
  rule_item_row_index?: number | null
  output_field_row_index?: number | null
  rule_item_field_candidates: Array<{
    column_index: number
    column_letter: string
    field_name: string
  }>
  output_field_candidates: Array<{
    column_index: number
    column_letter: string
    field_name: string
  }>
  selected_rule_item_columns: number[]
  selected_output_field_columns: number[]
}

export type TemplateRulePageResult = {
  items: TemplateRuleSet[]
  page: number
  page_size: number
  total: number
  total_pages: number
}

export type ExportPreviewPayload = {
  parser_config_id: number
  import_batch_code?: string
  template_rule_id: number
  output_key?: string
  export_month?: string
  page?: number
  page_size?: number
}

export type ExportPreviewResult = {
  parser_config_name: string
  import_batch_code: string
  import_file_name: string
  template_rule_name: string
  output_key: string
  output_sheet_name: string
  available_outputs: Array<{
    output_key: string
    sheet_name: string
    source_type: string
  }>
  headers: string[]
  rows: string[][]
  statistics: Array<{
    label: string
    field_name: string
    aggregate_func: string
    value: string
  }>
  notes: string[]
  page: number
  page_size: number
  total: number
  total_pages: number
}

export type ImportBatch = {
  id: number
  batch_code: string
  parser_config_id: number
  file_name: string
  sheet_name: string
  detail_table_name: string
  status: string
  imported_rows: number
  error_message: string | null
  created_at: string
  updated_at: string
}

export type ImportBatchCreateResult = {
  id: number
  batch_code: string
  parser_config_id: number
  file_name: string
  sheet_name: string
  detail_table_name: string
  status: string
  imported_rows: number
  columns: ParserConfigColumn[]
}

export type ImportBatchGroup = {
  batch_code: string
  parser_config_id: number
  file_count: number
  file_names: string[]
  imported_rows: number
  status: string
  created_at: string
}

export type ImportTask = {
  id: number
  parser_config_id: number
  batch_code: string
  file_name: string
  status: 'pending' | 'running' | 'success' | 'failed'
  progress_percent: number
  progress_message: string | null
  imported_rows: number
  error_message: string | null
  created_at: string
  updated_at: string
}

export type DetailRecordColumn = {
  column_letter: string
  header_name: string
  field_name: string
}

export type DetailRecordPageResult = {
  parser_config_name: string
  import_batch_code: string
  columns: DetailRecordColumn[]
  rows: Array<Record<string, string | number | null>>
  page: number
  page_size: number
  total: number
  total_pages: number
  filter_field_name: string | null
  filter_keyword: string | null
}
