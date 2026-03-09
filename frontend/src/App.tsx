import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { fetchDetailRecords } from './api/detailRecord'
import { downloadExportExcel, generateExportPreview } from './api/exportPreview'
import { deleteImportBatch, fetchImportBatches } from './api/importBatch'
import { createImportTask, fetchImportTasks } from './api/importTask'
import {
  createParserConfig,
  deleteParserConfig,
  fetchParserConfigs,
  previewSampleExcel,
  updateParserConfig,
} from './api/parserConfig'
import {
  batchDeleteTemplateRules,
  commitTemplateRuleImport,
  createTemplateRule,
  deleteTemplateRule,
  fetchTemplateRules,
  previewTemplateRuleImport,
  updateTemplateRule,
} from './api/templateRule'
import type {
  DetailRecordPageResult,
  ExcelPreview,
  ExportPreviewResult,
  ImportBatch,
  ImportBatchGroup,
  ImportTask,
  ParserConfig,
  ParserConfigColumn,
  ParserConfigCreatePayload,
  ParserConfigFixedField,
  TemplateRuleAggregation,
  TemplateRuleCreatePayload,
  TemplateRuleFilter,
  TemplateRuleImportPreviewResult,
  TemplateRuleOutputConfig,
  TemplateRuleOutputField,
  TemplateRuleSet,
} from './types'

const initialParserForm: ParserConfigCreatePayload = {
  config_code: '',
  config_name: '',
  sheet_name: 'Sheet1',
  header_row_index: 1,
  data_start_row_index: 2,
  data_end_column: 'Z',
  ignore_empty_row: true,
  column_mapping_json: '{}',
  detected_columns: [],
  fixed_fields: [],
  status: 'active',
  version: 1,
  remark: '',
}

const initialTemplateForm: TemplateRuleCreatePayload = {
  rule_code: '',
  rule_name: '',
  group_name: '默认分类',
  source_sheet_name: 'Sheet1',
  description: '',
  rule_item: {
    反馈人: '',
    分公司: '',
    银行名称: '',
    频次: '',
  },
  outputs: [
    {
      output_key: 'detail',
      sheet_name: '明细表',
      source_type: 'filtered_detail',
      title_rows: [],
      fields: [],
      filters: [],
      group_by_fields: [],
      aggregations: [],
      sort_by: [],
    },
  ],
  status: 'active',
  version: 1,
}

type ViewMode = 'parser' | 'import' | 'detail' | 'template' | 'preview'
type ParserDialogMode = 'detail' | 'form' | 'sample' | null
type TemplateDialogMode = 'detail' | 'form' | 'import' | null
type SelectionMode = 'header' | 'dataStart' | 'endColumn' | null
type TemplateImportSelectionMode =
  | 'rule_item_row'
  | 'output_field_row'
  | null
type ConfirmDialogState = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => Promise<void>
} | null

type CalibrationSuggestion = {
  headerRowIndex: number
  dataStartRowIndex: number
  dataEndColumn: string
}

type FixedFieldEditableKey =
  | 'field_name'
  | 'field_key'
  | 'field_value'
  | 'field_name_source'
  | 'field_value_source'

function toColumnLetter(columnIndex: number): string {
  let current = columnIndex + 1
  let result = ''

  while (current > 0) {
    const remainder = (current - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    current = Math.floor((current - 1) / 26)
  }

  return result
}

function getSelectionModeLabel(mode: SelectionMode): string {
  if (mode === 'header') return '第 1 步：点左侧行号设置标题行'
  if (mode === 'dataStart') return '第 2 步：点左侧行号设置数据起始行'
  if (mode === 'endColumn') return '第 3 步：点顶部列头设置结束列'
  return '已完成，可返回表单保存'
}

function getNonEmptyCellCount(row: Array<string | number | boolean | null>): number {
  return row.filter((cell) => String(cell ?? '').trim() !== '').length
}

function getLastNonEmptyColumnIndex(row: Array<string | number | boolean | null>): number {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if (String(row[index] ?? '').trim() !== '') {
      return index
    }
  }

  return -1
}

function isMostlyTextRow(row: Array<string | number | boolean | null>): boolean {
  const values = row
    .map((cell) => String(cell ?? '').trim())
    .filter((cell) => cell !== '')

  if (values.length === 0) {
    return false
  }

  const textLikeCount = values.filter((cell) => /[A-Za-z\u4e00-\u9fa5]/.test(cell)).length
  return textLikeCount / values.length >= 0.6
}

function inferCalibrationSuggestion(preview: ExcelPreview): CalibrationSuggestion | null {
  let bestRowIndex = -1
  let bestScore = -1

  preview.rows.forEach((row, rowIndex) => {
    const nonEmptyCount = getNonEmptyCellCount(row)
    if (nonEmptyCount < 2) {
      return
    }

    const nextRow = preview.rows[rowIndex + 1] ?? []
    const nextNonEmptyCount = getNonEmptyCellCount(nextRow)
    const hasDataAfter = nextNonEmptyCount >= Math.max(2, nonEmptyCount - 2)
    const score =
      nonEmptyCount * 10 +
      (isMostlyTextRow(row) ? 12 : 0) +
      (hasDataAfter ? 20 : 0) +
      (rowIndex > 0 ? rowIndex : 0)

    if (score > bestScore) {
      bestScore = score
      bestRowIndex = rowIndex
    }
  })

  if (bestRowIndex < 0) {
    return null
  }

  const headerRow = preview.rows[bestRowIndex] ?? []
  const dataRowIndex = Math.min(bestRowIndex + 1, Math.max(bestRowIndex, preview.rows.length - 1))
  const dataStartRowIndex = Math.max(bestRowIndex + 2, dataRowIndex + 1)
  const endColumnIndex = Math.max(
    getLastNonEmptyColumnIndex(headerRow),
    getLastNonEmptyColumnIndex(preview.rows[dataRowIndex] ?? []),
  )

  return {
    headerRowIndex: bestRowIndex + 1,
    dataStartRowIndex,
    dataEndColumn: toColumnLetter(Math.max(endColumnIndex, 0)),
  }
}

function columnLetterToIndex(columnLetter: string): number {
  return columnLetter
    .trim()
    .toUpperCase()
    .split('')
    .reduce((result, char) => result * 26 + (char.charCodeAt(0) - 64), 0) - 1
}

function normalizeHeaderName(value: string | number | boolean | null, columnIndex: number): string {
  const text = String(value ?? '').trim()
  return text || `未命名列${columnIndex + 1}`
}

function normalizeFieldName(headerName: string, columnIndex: number, usedNames: Set<string>): string {
  const baseName = headerName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^0-9A-Za-z_\u4e00-\u9fa5]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const normalizedBase = baseName ? (/^\d/.test(baseName) ? `col_${baseName}` : baseName) : `col_${columnIndex + 1}`

  let candidate = normalizedBase
  let suffix = 2
  while (usedNames.has(candidate)) {
    candidate = `${normalizedBase}_${suffix}`
    suffix += 1
  }
  usedNames.add(candidate)
  return candidate
}

function trimCellValue(value: string | number | boolean | null | undefined): string {
  return String(value ?? '').trim()
}

function toCellReference(columnIndex: number, rowIndex: number): string {
  return `${toColumnLetter(columnIndex)}${rowIndex + 1}`
}

function createEmptyOutputField(fieldOrder: number): TemplateRuleOutputField {
  return {
    field_name: '',
    display_name: '',
    field_order: fieldOrder,
    is_enabled: true,
  }
}

function createEmptyFilter(): TemplateRuleFilter {
  return {
    field_name: '',
    operator: 'eq',
    value: '',
    value_template: '',
  }
}

function createEmptyAggregation(): TemplateRuleAggregation {
  return {
    field_name: '',
    aggregate_func: 'sum',
    alias: '',
  }
}

function createEmptyOutputConfig(index: number): TemplateRuleOutputConfig {
  const outputKey = index === 0 ? 'detail' : `output_${index + 1}`
  return {
    output_key: outputKey,
    sheet_name: index === 0 ? '明细表' : `输出表${index + 1}`,
    source_type: 'filtered_detail',
    title_rows: [],
    fields: [],
    filters: [],
    group_by_fields: [],
    aggregations: [],
    sort_by: [],
  }
}

function buildTemplateFormFromRule(rule: TemplateRuleSet): TemplateRuleCreatePayload {
  return {
    rule_code: rule.rule_code,
    rule_name: rule.rule_name,
    group_name: rule.group_name,
    source_sheet_name: rule.source_sheet_name,
    description: rule.description || '',
    rule_item: { ...rule.rule_item },
    outputs: rule.outputs.map((output) => ({
      ...output,
      title_rows: [...output.title_rows],
      fields: output.fields.map((field) => ({ ...field })),
      filters: output.filters.map((filter) => ({ ...filter })),
      group_by_fields: [...output.group_by_fields],
      aggregations: output.aggregations.map((item) => ({ ...item })),
      sort_by: output.sort_by.map((item) => ({ ...item })),
    })),
    status: rule.status,
    version: rule.version,
  }
}

function cloneTemplateOutputs(outputs: TemplateRuleOutputConfig[]): TemplateRuleOutputConfig[] {
  return outputs.map((output) => ({
    ...output,
    title_rows: [...output.title_rows],
    fields: output.fields.map((field) => ({ ...field })),
    filters: output.filters.map((filter) => ({ ...filter })),
    group_by_fields: [...output.group_by_fields],
    aggregations: output.aggregations.map((item) => ({ ...item })),
    sort_by: output.sort_by.map((item) => ({ ...item })),
  }))
}

function normalizeTemplateRule(rule: TemplateRuleSet): TemplateRuleSet {
  return {
    ...rule,
    group_name: rule.group_name || '默认分类',
    source_sheet_name: rule.source_sheet_name || 'Sheet1',
    rule_item: rule.rule_item || {},
    outputs: Array.isArray(rule.outputs) ? rule.outputs : [],
  }
}

function normalizeFixedFieldLabel(label: string): string {
  return label.replace(/[：:]+$/u, '').trim()
}

function parseCellReference(reference: string): { rowIndex: number; columnIndex: number } | null {
  const matched = reference.trim().toUpperCase().match(/^([A-Z]+)([1-9]\d*)$/)
  if (!matched) {
    return null
  }

  return {
    columnIndex: columnLetterToIndex(matched[1]),
    rowIndex: Number(matched[2]) - 1,
  }
}

function getPreviewCellValue(preview: ExcelPreview | null, reference: string): string {
  if (!preview) {
    return ''
  }

  const resolved = parseCellReference(reference)
  if (!resolved) {
    return ''
  }

  return trimCellValue(preview.rows[resolved.rowIndex]?.[resolved.columnIndex] ?? '')
}

function buildFixedFieldKey(
  seed: string,
  fixedFieldIndex: number,
  detectedColumns: ParserConfigColumn[],
  existingFields: ParserConfigFixedField[],
): string {
  const usedNames = new Set<string>(detectedColumns.map((column) => column.field_name))
  existingFields.forEach((field, index) => {
    if (index !== fixedFieldIndex && field.field_key.trim()) {
      usedNames.add(field.field_key.trim())
    }
  })
  return normalizeFieldName(seed || `fixed_field_${fixedFieldIndex + 1}`, fixedFieldIndex, usedNames)
}

function buildDetectedFixedFields(
  preview: ExcelPreview | null,
  headerRowIndex: number,
  detectedColumns: ParserConfigColumn[],
): ParserConfigFixedField[] {
  if (!preview || headerRowIndex <= 1) {
    return []
  }

  const candidates: ParserConfigFixedField[] = []
  const usedKeys = new Set<string>(detectedColumns.map((column) => column.field_name))
  const dedupe = new Set<string>()
  const lastHeaderRowIndex = Math.max(0, headerRowIndex - 2)

  for (let rowIndex = 0; rowIndex <= lastHeaderRowIndex; rowIndex += 1) {
    const row = preview.rows[rowIndex] ?? []
    const nextRow = preview.rows[rowIndex + 1] ?? []

    for (let columnIndex = 0; columnIndex < Math.max(row.length - 1, 0); columnIndex += 1) {
      const leftValue = trimCellValue(row[columnIndex])
      const rightValue = trimCellValue(row[columnIndex + 1])
      if (!/[：:]$/u.test(leftValue) || !rightValue) {
        continue
      }

      const fieldName = normalizeFixedFieldLabel(leftValue)
      if (!fieldName) {
        continue
      }

      const uniqueId = `${toCellReference(columnIndex, rowIndex)}|${toCellReference(columnIndex + 1, rowIndex)}|${fieldName}|${rightValue}`
      if (dedupe.has(uniqueId)) {
        continue
      }
      dedupe.add(uniqueId)

      candidates.push({
        field_name: fieldName,
        field_key: normalizeFieldName(fieldName, candidates.length, usedKeys),
        field_value: rightValue,
        field_name_source: toCellReference(columnIndex, rowIndex),
        field_value_source: toCellReference(columnIndex + 1, rowIndex),
        follow_excel_value: true,
        is_enabled: true,
      })
    }

    const currentNonEmptyCount = getNonEmptyCellCount(row)
    const nextNonEmptyCount = getNonEmptyCellCount(nextRow)
    if (currentNonEmptyCount > 2 || nextNonEmptyCount > 2) {
      continue
    }

    for (let columnIndex = 0; columnIndex < Math.max(row.length, nextRow.length); columnIndex += 1) {
      const topValue = trimCellValue(row[columnIndex])
      const bottomValue = trimCellValue(nextRow[columnIndex])
      if (!topValue || !bottomValue || /[：:]$/u.test(topValue)) {
        continue
      }

      const uniqueId = `${toCellReference(columnIndex, rowIndex)}|${toCellReference(columnIndex, rowIndex + 1)}|${topValue}|${bottomValue}`
      if (dedupe.has(uniqueId)) {
        continue
      }
      dedupe.add(uniqueId)

      candidates.push({
        field_name: topValue,
        field_key: normalizeFieldName(topValue, candidates.length, usedKeys),
        field_value: bottomValue,
        field_name_source: toCellReference(columnIndex, rowIndex),
        field_value_source: toCellReference(columnIndex, rowIndex + 1),
        follow_excel_value: true,
        is_enabled: true,
      })
    }
  }

  return candidates
}

function mergeFixedFields(
  currentFields: ParserConfigFixedField[],
  detectedFields: ParserConfigFixedField[],
  detectedColumns: ParserConfigColumn[],
): ParserConfigFixedField[] {
  const detectedFieldMap = new Map<string, ParserConfigFixedField>()
  detectedFields.forEach((field) => {
    const sourceKey = `${field.field_name_source ?? ''}|${field.field_value_source ?? ''}`
    detectedFieldMap.set(sourceKey, field)
  })

  const merged = detectedFields.map((field, index) => {
    const sourceKey = `${field.field_name_source ?? ''}|${field.field_value_source ?? ''}`
    const current = currentFields.find(
      (item) => `${item.field_name_source ?? ''}|${item.field_value_source ?? ''}` === sourceKey,
    )
    if (!current) {
      return field
    }
      return {
        ...field,
        ...current,
        field_name: current.field_name || field.field_name,
        field_value: current.field_value || field.field_value,
        field_key: current.field_key || buildFixedFieldKey(field.field_name, index, detectedColumns, currentFields),
        follow_excel_value: current.follow_excel_value ?? true,
        is_enabled: current.is_enabled,
      }
  })

  currentFields.forEach((field) => {
    const sourceKey = `${field.field_name_source ?? ''}|${field.field_value_source ?? ''}`
    if (!detectedFieldMap.has(sourceKey)) {
      merged.push(field)
    }
  })

  return merged
}

function buildDetectedColumns(
  preview: ExcelPreview | null,
  headerRowIndex: number,
  dataStartRowIndex: number,
  dataEndColumn: string,
): ParserConfigColumn[] {
  if (!preview) {
    return []
  }

  const headerRow = preview.rows[headerRowIndex - 1] ?? []
  const sampleRow = preview.rows[dataStartRowIndex - 1] ?? []
  const endColumnIndex = Math.max(columnLetterToIndex(dataEndColumn), 0)
  const usedNames = new Set<string>()

  return Array.from({ length: endColumnIndex + 1 }).map((_, columnIndex) => {
    const headerName = normalizeHeaderName(headerRow[columnIndex] ?? null, columnIndex)
    return {
      column_index: columnIndex,
      column_letter: toColumnLetter(columnIndex),
      header_name: headerName,
      field_name: normalizeFieldName(headerName, columnIndex, usedNames),
      sample_value:
        sampleRow[columnIndex] === null || sampleRow[columnIndex] === undefined || sampleRow[columnIndex] === ''
          ? null
          : String(sampleRow[columnIndex]),
      is_enabled: true,
    }
  })
}

function App() {
  const previousActiveImportTaskIdsRef = useRef<number[]>([])
  const previewTemplateSelectRef = useRef<HTMLDivElement | null>(null)
  const [activeView, setActiveView] = useState<ViewMode>('parser')

  const [configs, setConfigs] = useState<ParserConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null)
  const [editingConfigId, setEditingConfigId] = useState<number | null>(null)
  const [parserDialogMode, setParserDialogMode] = useState<ParserDialogMode>(null)
  const [parserForm, setParserForm] = useState<ParserConfigCreatePayload>(initialParserForm)
  const [preview, setPreview] = useState<ExcelPreview | null>(null)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(null)
  const [parserListError, setParserListError] = useState('')
  const [parserFormError, setParserFormError] = useState('')
  const [sampleError, setSampleError] = useState('')
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(true)
  const [isSavingParser, setIsSavingParser] = useState(false)
  const [isPreviewingSample, setIsPreviewingSample] = useState(false)

  const [templateRules, setTemplateRules] = useState<TemplateRuleSet[]>([])
  const [selectedTemplateRuleId, setSelectedTemplateRuleId] = useState<number | null>(null)
  const [selectedTemplateRuleIds, setSelectedTemplateRuleIds] = useState<number[]>([])
  const [editingTemplateRuleId, setEditingTemplateRuleId] = useState<number | null>(null)
  const [templateDialogMode, setTemplateDialogMode] = useState<TemplateDialogMode>(null)
  const [templateForm, setTemplateForm] = useState<TemplateRuleCreatePayload>(initialTemplateForm)
  const [templateImportPreview, setTemplateImportPreview] = useState<TemplateRuleImportPreviewResult | null>(null)
  const [templateImportFile, setTemplateImportFile] = useState<File | null>(null)
  const [selectedImportSheets, setSelectedImportSheets] = useState<string[]>([])
  const [templateImportActiveSheet, setTemplateImportActiveSheet] = useState('')
  const [templateImportRuleItemRowMap, setTemplateImportRuleItemRowMap] = useState<Record<string, number | null>>({})
  const [templateImportOutputFieldRowMap, setTemplateImportOutputFieldRowMap] = useState<Record<string, number | null>>({})
  const [templateImportRuleItemColumnsMap, setTemplateImportRuleItemColumnsMap] = useState<Record<string, number[]>>({})
  const [templateImportOutputFieldColumnsMap, setTemplateImportOutputFieldColumnsMap] = useState<Record<string, number[]>>({})
  const [templateImportOutputOverrides, setTemplateImportOutputOverrides] = useState<Record<string, TemplateRuleOutputConfig[]>>({})
  const [templateImportSelectionMode, setTemplateImportSelectionMode] = useState<TemplateImportSelectionMode>(null)
  const [templateListError, setTemplateListError] = useState('')
  const [templateFormError, setTemplateFormError] = useState('')
  const [templateImportError, setTemplateImportError] = useState('')
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isImportPreviewingTemplate, setIsImportPreviewingTemplate] = useState(false)
  const [isImportingTemplate, setIsImportingTemplate] = useState(false)
  const [templatePage, setTemplatePage] = useState(1)
  const [templatePageInput, setTemplatePageInput] = useState('1')
  const [templateTotalPages, setTemplateTotalPages] = useState(1)
  const [templateTotal, setTemplateTotal] = useState(0)
  const templatePageSize = 20

  const [importBatches, setImportBatches] = useState<ImportBatch[]>([])
  const [importParserConfigId, setImportParserConfigId] = useState<number | ''>('')
  const [importBatchCode, setImportBatchCode] = useState('')
  const [importError, setImportError] = useState('')
  const [isLoadingImports, setIsLoadingImports] = useState(true)
  const [isImportingBatch, setIsImportingBatch] = useState(false)
  const [selectedImportFileSummary, setSelectedImportFileSummary] = useState('')
  const [importTasks, setImportTasks] = useState<ImportTask[]>([])
  const [isLoadingImportTasks, setIsLoadingImportTasks] = useState(true)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null)
  const [isConfirmingAction, setIsConfirmingAction] = useState(false)

  const [previewBuilderParserId, setPreviewBuilderParserId] = useState<number | ''>('')
  const [previewBuilderImportBatchCode, setPreviewBuilderImportBatchCode] = useState<string>('')
  const [previewBuilderTemplateId, setPreviewBuilderTemplateId] = useState<number | ''>('')
  const [previewBuilderOutputKey, setPreviewBuilderOutputKey] = useState('')
  const [previewBuilderExportMonth, setPreviewBuilderExportMonth] = useState('')
  const [previewTemplateKeyword, setPreviewTemplateKeyword] = useState('')
  const [previewTemplateOptions, setPreviewTemplateOptions] = useState<TemplateRuleSet[]>([])
  const [previewTemplatePage, setPreviewTemplatePage] = useState(1)
  const [previewTemplateTotalPages, setPreviewTemplateTotalPages] = useState(1)
  const [isLoadingPreviewTemplateOptions, setIsLoadingPreviewTemplateOptions] = useState(false)
  const [previewTemplateDropdownOpen, setPreviewTemplateDropdownOpen] = useState(false)
  const [previewResult, setPreviewResult] = useState<ExportPreviewResult | null>(null)
  const [previewBuildError, setPreviewBuildError] = useState('')
  const [isBuildingPreview, setIsBuildingPreview] = useState(false)
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false)
  const [previewPage, setPreviewPage] = useState(1)
  const [previewPageInput, setPreviewPageInput] = useState('1')
  const previewPageSize = 100
  const [detailViewerParserId, setDetailViewerParserId] = useState<number | ''>('')
  const [detailViewerBatchCode, setDetailViewerBatchCode] = useState('')
  const [detailFilterFieldName, setDetailFilterFieldName] = useState('')
  const [detailFilterKeyword, setDetailFilterKeyword] = useState('')
  const [detailPage, setDetailPage] = useState(1)
  const [detailPageInput, setDetailPageInput] = useState('1')
  const [detailResult, setDetailResult] = useState<DetailRecordPageResult | null>(null)
  const [detailError, setDetailError] = useState('')
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const detailPageSize = 100

  const selectedConfig = useMemo(
    () => configs.find((item) => item.id === selectedConfigId) ?? null,
    [configs, selectedConfigId],
  )
  const selectedTemplateRule = useMemo(
    () => templateRules.find((item) => item.id === selectedTemplateRuleId) ?? null,
    [templateRules, selectedTemplateRuleId],
  )
  const previewSelectedTemplateRule = useMemo(
    () => (
      previewTemplateOptions.find((item) => item.id === Number(previewBuilderTemplateId))
      ?? templateRules.find((item) => item.id === Number(previewBuilderTemplateId))
      ?? null
    ),
    [previewBuilderTemplateId, previewTemplateOptions, templateRules],
  )
  const selectedTemplateOutputs = useMemo(
    () => previewSelectedTemplateRule?.outputs ?? [],
    [previewSelectedTemplateRule],
  )
  const activeTemplateImportSheet = useMemo(
    () => templateImportPreview?.sheets.find((sheet) => sheet.sheet_name === templateImportActiveSheet) ?? null,
    [templateImportActiveSheet, templateImportPreview],
  )
  const activeTemplateImportSampleRule = useMemo(
    () => activeTemplateImportSheet?.sample_rules?.[0] ?? null,
    [activeTemplateImportSheet],
  )
  const activeTemplateImportRuleItemRowIndex = useMemo(
    () => templateImportRuleItemRowMap[templateImportActiveSheet] ?? templateImportPreview?.rule_item_row_index ?? null,
    [templateImportActiveSheet, templateImportPreview?.rule_item_row_index, templateImportRuleItemRowMap],
  )
  const activeTemplateImportOutputFieldRowIndex = useMemo(
    () => templateImportOutputFieldRowMap[templateImportActiveSheet] ?? templateImportPreview?.output_field_row_index ?? null,
    [templateImportActiveSheet, templateImportOutputFieldRowMap, templateImportPreview?.output_field_row_index],
  )
  const activeTemplateImportRuleItemColumns = useMemo(
    () => templateImportRuleItemColumnsMap[templateImportActiveSheet] ?? templateImportPreview?.selected_rule_item_columns ?? [],
    [templateImportActiveSheet, templateImportPreview?.selected_rule_item_columns, templateImportRuleItemColumnsMap],
  )
  const activeTemplateImportOutputFieldColumns = useMemo(
    () => templateImportOutputFieldColumnsMap[templateImportActiveSheet] ?? templateImportPreview?.selected_output_field_columns ?? [],
    [templateImportActiveSheet, templateImportOutputFieldColumnsMap, templateImportPreview?.selected_output_field_columns],
  )
  const activeTemplateImportOutputs = useMemo(
    () => {
      if (!templateImportActiveSheet) {
        return []
      }
      return templateImportOutputOverrides[templateImportActiveSheet]
        ?? cloneTemplateOutputs(activeTemplateImportSampleRule?.outputs ?? [])
    },
    [activeTemplateImportSampleRule, templateImportActiveSheet, templateImportOutputOverrides],
  )
  const selectedDetailConfig = useMemo(
    () => configs.find((item) => item.id === detailViewerParserId) ?? null,
    [configs, detailViewerParserId],
  )
  const pageTitle =
    activeView === 'parser'
      ? '解析配置管理'
      : activeView === 'import'
        ? '明细导入'
        : activeView === 'detail'
          ? '导入明细查看'
        : activeView === 'template'
          ? '模板规则管理'
          : '预览导出'
  const previewColumnCount = useMemo(() => {
    if (!preview) {
      return 0
    }
    return preview.rows.reduce((max, row) => Math.max(max, row.length), 0)
  }, [preview])
  const calibrationSuggestion = useMemo(() => {
    if (!preview) {
      return null
    }

    return inferCalibrationSuggestion(preview)
  }, [preview])
  const activeDetectedColumns = useMemo(
    () => buildDetectedColumns(preview, parserForm.header_row_index, parserForm.data_start_row_index, parserForm.data_end_column),
    [parserForm.data_end_column, parserForm.data_start_row_index, parserForm.header_row_index, preview],
  )
  const activeDetectedFixedFields = useMemo(
    () => buildDetectedFixedFields(preview, parserForm.header_row_index, activeDetectedColumns),
    [activeDetectedColumns, parserForm.header_row_index, preview],
  )
  const importBatchGroups = useMemo<ImportBatchGroup[]>(() => {
    const grouped = new Map<string, ImportBatchGroup>()
    for (const batch of importBatches) {
      const current = grouped.get(batch.batch_code)
      if (current) {
        current.file_count += 1
        current.file_names.push(batch.file_name)
        current.imported_rows += batch.imported_rows
        if (batch.created_at > current.created_at) {
          current.created_at = batch.created_at
        }
      } else {
        grouped.set(batch.batch_code, {
          batch_code: batch.batch_code,
          parser_config_id: batch.parser_config_id,
          file_count: 1,
          file_names: [batch.file_name],
          imported_rows: batch.imported_rows,
          status: batch.status,
          created_at: batch.created_at,
        })
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [importBatches])
  const previewAvailableBatchGroups = useMemo(() => {
    if (!previewBuilderParserId) {
      return importBatchGroups
    }
    return importBatchGroups.filter((item) => item.parser_config_id === Number(previewBuilderParserId))
  }, [importBatchGroups, previewBuilderParserId])
  const detailAvailableBatchGroups = useMemo(() => {
    if (!detailViewerParserId) {
      return importBatchGroups
    }
    return importBatchGroups.filter((item) => item.parser_config_id === Number(detailViewerParserId))
  }, [detailViewerParserId, importBatchGroups])

  useEffect(() => {
    if (!preview) {
      return
    }

    setParserForm((current) => ({
      ...current,
      detected_columns: activeDetectedColumns,
      fixed_fields: mergeFixedFields(current.fixed_fields, activeDetectedFixedFields, activeDetectedColumns),
    }))
  }, [activeDetectedColumns, activeDetectedFixedFields, preview])

  useEffect(() => {
    void loadConfigs()
    void loadImportBatches()
    void loadImportTasks()
  }, [])

  useEffect(() => {
    void loadTemplateRules(templatePage)
  }, [templatePage])

  useEffect(() => {
    if (!templateImportActiveSheet || !activeTemplateImportSampleRule) {
      return
    }
    setTemplateImportOutputOverrides((current) => (
      current[templateImportActiveSheet]
        ? current
        : {
            ...current,
            [templateImportActiveSheet]: cloneTemplateOutputs(activeTemplateImportSampleRule.outputs ?? []),
          }
    ))
  }, [activeTemplateImportSampleRule, templateImportActiveSheet])

  useEffect(() => {
    const hasActiveImportTask = importTasks.some((task) => task.status === 'pending' || task.status === 'running')
    if (!hasActiveImportTask) {
      return
    }

    const timer = window.setInterval(() => {
      void loadImportTasks(true)
    }, 2000)

    return () => window.clearInterval(timer)
  }, [importTasks])

  useEffect(() => {
    const currentActiveTaskIds = importTasks
      .filter((task) => task.status === 'pending' || task.status === 'running')
      .map((task) => task.id)
    const completedTaskIds = previousActiveImportTaskIdsRef.current.filter(
      (taskId) => !currentActiveTaskIds.includes(taskId),
    )

    previousActiveImportTaskIdsRef.current = currentActiveTaskIds

    if (completedTaskIds.length > 0) {
      void loadImportBatches(true)
    }
  }, [importTasks])

  useEffect(() => {
    if (!previewBuilderParserId && configs.length > 0) {
      setPreviewBuilderParserId(configs[0].id)
    }
    if (!importParserConfigId && configs.length > 0) {
      setImportParserConfigId(configs[0].id)
    }
    if (!detailViewerParserId && configs.length > 0) {
      setDetailViewerParserId(configs[0].id)
    }
  }, [configs, detailViewerParserId, importParserConfigId, previewBuilderParserId])

  useEffect(() => {
    if (previewAvailableBatchGroups.length === 0) {
      setPreviewBuilderImportBatchCode('')
      return
    }

    setPreviewBuilderImportBatchCode((current) => {
      if (current && previewAvailableBatchGroups.some((item) => item.batch_code === current)) {
        return current
      }
      return previewAvailableBatchGroups[0].batch_code
    })
  }, [previewAvailableBatchGroups])

  useEffect(() => {
    if (detailAvailableBatchGroups.length === 0) {
      setDetailViewerBatchCode('')
      return
    }

    setDetailViewerBatchCode((current) => {
      if (current && detailAvailableBatchGroups.some((item) => item.batch_code === current)) {
        return current
      }
      return detailAvailableBatchGroups[0].batch_code
    })
  }, [detailAvailableBatchGroups])

  useEffect(() => {
    if (!previewBuilderTemplateId && previewTemplateOptions.length > 0) {
      setPreviewBuilderTemplateId(previewTemplateOptions[0].id)
    }
  }, [previewBuilderTemplateId, previewTemplateOptions])

  useEffect(() => {
    const selectedRule = previewSelectedTemplateRule
    if (!selectedRule) {
      setPreviewBuilderOutputKey('')
      return
    }
    setPreviewBuilderOutputKey((current) => {
      const outputs = selectedRule.outputs ?? []
      if (current && outputs.some((item) => item.output_key === current)) {
        return current
      }
      return outputs[0]?.output_key ?? ''
    })
  }, [previewSelectedTemplateRule])

  useEffect(() => {
    if (previewResult?.available_outputs?.length) {
      setPreviewBuilderOutputKey(previewResult.output_key)
    }
  }, [previewResult])

  useEffect(() => {
    if (!previewTemplateDropdownOpen) {
      return
    }

    function handleDocumentClick(event: MouseEvent) {
      if (!previewTemplateSelectRef.current) {
        return
      }
      if (!previewTemplateSelectRef.current.contains(event.target as Node)) {
        setPreviewTemplateDropdownOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPreviewTemplateDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [previewTemplateDropdownOpen])

  useEffect(() => {
    if (activeView !== 'preview') {
      setPreviewTemplateDropdownOpen(false)
    }
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'preview') {
      return
    }
    const timer = window.setTimeout(() => {
      void loadPreviewTemplateOptions(1, previewTemplateKeyword, false)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeView, previewTemplateKeyword])
  async function loadConfigs() {
    setIsLoadingConfigs(true)
    setParserListError('')
    try {
      const data = await fetchParserConfigs()
      setConfigs(data)
      setSelectedConfigId((current) => current ?? data[0]?.id ?? null)
    } catch (error) {
      setParserListError(error instanceof Error ? error.message : '配置列表加载失败')
    } finally {
      setIsLoadingConfigs(false)
    }
  }

  async function loadTemplateRules(page = templatePage) {
    setIsLoadingTemplates(true)
    setTemplateListError('')
    try {
      const data = await fetchTemplateRules(page, templatePageSize)
      const items = data.items.map(normalizeTemplateRule)
      setTemplateRules(items)
      setSelectedTemplateRuleId((current) => {
        if (current && items.some((item) => item.id === current)) {
          return current
        }
        return items[0]?.id ?? null
      })
      setSelectedTemplateRuleIds((current) => current.filter((ruleId) => items.some((item) => item.id === ruleId)))
      setTemplatePage(data.page)
      setTemplatePageInput(String(data.page))
      setTemplateTotalPages(data.total_pages)
      setTemplateTotal(data.total)
    } catch (error) {
      setTemplateListError(error instanceof Error ? error.message : '模板规则列表加载失败')
    } finally {
      setIsLoadingTemplates(false)
    }
  }

  async function loadPreviewTemplateOptions(
    page = 1,
    keyword = previewTemplateKeyword,
    append = false,
  ) {
    setIsLoadingPreviewTemplateOptions(true)
    setPreviewBuildError('')
    try {
      const data = await fetchTemplateRules(page, 20, keyword)
      const items = data.items.map(normalizeTemplateRule)
      setPreviewTemplateOptions((current) => {
        if (!append) {
          return items
        }
        const existingIds = new Set(current.map((item) => item.id))
        return [...current, ...items.filter((item) => !existingIds.has(item.id))]
      })
      setPreviewTemplatePage(data.page)
      setPreviewTemplateTotalPages(data.total_pages)
      if (!previewBuilderTemplateId && items[0]) {
        setPreviewBuilderTemplateId(items[0].id)
      }
    } catch (error) {
      setPreviewBuildError(error instanceof Error ? error.message : '模板规则选项加载失败')
    } finally {
      setIsLoadingPreviewTemplateOptions(false)
    }
  }

  async function loadImportBatches(silent = false) {
    if (!silent) {
      setIsLoadingImports(true)
      setImportError('')
    }
    try {
      const data = await fetchImportBatches()
      setImportBatches(data)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入批次加载失败')
    } finally {
      if (!silent) {
        setIsLoadingImports(false)
      }
    }
  }

  async function loadImportTasks(silent = false) {
    if (!silent) {
      setIsLoadingImportTasks(true)
      setImportError('')
    }
    try {
      const data = await fetchImportTasks()
      setImportTasks(data)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入任务加载失败')
    } finally {
      if (!silent) {
        setIsLoadingImportTasks(false)
      }
    }
  }

  function resetParserForm() {
    setEditingConfigId(null)
    setParserForm(initialParserForm)
    setPreview(null)
    setSelectedFileName('')
    setSelectionMode(null)
    setParserFormError('')
    setSampleError('')
  }

  function openCreateParserDialog() {
    resetParserForm()
    setParserDialogMode('form')
  }

  function resetTemplateForm() {
    setEditingTemplateRuleId(null)
    setTemplateForm(initialTemplateForm)
    setTemplateFormError('')
  }

  function openCreateTemplateDialog() {
    resetTemplateForm()
    setTemplateDialogMode('form')
  }

  function openEditTemplateDialog(rule: TemplateRuleSet) {
    setSelectedTemplateRuleId(rule.id)
    setEditingTemplateRuleId(rule.id)
    setTemplateForm(buildTemplateFormFromRule(rule))
    setTemplateFormError('')
    setTemplateDialogMode('form')
  }

  function openTemplateImportDialog() {
    setTemplateImportPreview(null)
    setTemplateImportFile(null)
    setSelectedImportSheets([])
    setTemplateImportActiveSheet('')
    setTemplateImportRuleItemRowMap({})
    setTemplateImportOutputFieldRowMap({})
    setTemplateImportRuleItemColumnsMap({})
    setTemplateImportOutputFieldColumnsMap({})
    setTemplateImportOutputOverrides({})
    setTemplateImportSelectionMode(null)
    setTemplateImportError('')
    setTemplateDialogMode('import')
  }

  function openEditParserDialog(config: ParserConfig) {
    setSelectedConfigId(config.id)
    setEditingConfigId(config.id)
    setParserForm({
      config_code: config.config_code,
      config_name: config.config_name,
      sheet_name: config.sheet_name,
      header_row_index: config.header_row_index,
      data_start_row_index: config.data_start_row_index,
      data_end_column: config.data_end_column,
      ignore_empty_row: config.ignore_empty_row,
      column_mapping_json: config.column_mapping_json,
      detected_columns: config.columns,
      fixed_fields: config.fixed_fields.map((field) => ({
        ...field,
        follow_excel_value: field.follow_excel_value ?? true,
      })),
      status: config.status,
      version: config.version,
      remark: config.remark ?? '',
    })
    setParserFormError('')
    setParserDialogMode('form')
  }

  async function handleSaveParser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSavingParser(true)
    setParserFormError('')
    try {
      if (editingConfigId) {
        const updated = await updateParserConfig(editingConfigId, parserForm)
        setConfigs((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        setSelectedConfigId(updated.id)
      } else {
        const created = await createParserConfig(parserForm)
        setConfigs((current) => [created, ...current])
        setSelectedConfigId(created.id)
        setPreviewBuilderParserId(created.id)
      }
      setParserDialogMode(null)
      resetParserForm()
    } catch (error) {
      setParserFormError(error instanceof Error ? error.message : '配置保存失败')
    } finally {
      setIsSavingParser(false)
    }
  }

  async function handleDeleteParser(configId: number) {
    setParserListError('')
    try {
      await deleteParserConfig(configId)
      setConfigs((current) => current.filter((item) => item.id !== configId))
      setImportBatches((current) => current.filter((item) => item.parser_config_id !== configId))
      if (selectedConfigId === configId) {
        setSelectedConfigId(null)
      }
    } catch (error) {
      setParserListError(error instanceof Error ? error.message : '配置删除失败')
    }
  }

  async function handlePreviewFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setSelectedFileName(file.name)
    setIsPreviewingSample(true)
    setSampleError('')
    try {
      const data = await previewSampleExcel({ file, maxRows: 20, maxColumns: 30 })
      const suggestion = inferCalibrationSuggestion(data)
      const nextHeaderRowIndex = suggestion?.headerRowIndex
      const nextDataStartRowIndex = suggestion?.dataStartRowIndex
      const nextDataEndColumn = suggestion?.dataEndColumn
      setPreview(data)
      setSelectionMode(null)
      setParserForm((current) => ({
        ...(() => {
          const resolvedHeaderRowIndex = nextHeaderRowIndex ?? current.header_row_index
          const resolvedDataStartRowIndex = nextDataStartRowIndex ?? current.data_start_row_index
          const resolvedDataEndColumn = nextDataEndColumn ?? current.data_end_column
          const nextDetectedColumns = buildDetectedColumns(
            data,
            resolvedHeaderRowIndex,
            resolvedDataStartRowIndex,
            resolvedDataEndColumn,
          )

          return {
            ...current,
            sheet_name: data.selected_sheet_name,
            header_row_index: resolvedHeaderRowIndex,
            data_start_row_index: resolvedDataStartRowIndex,
            data_end_column: resolvedDataEndColumn,
            detected_columns: nextDetectedColumns,
            fixed_fields: mergeFixedFields(
              current.fixed_fields,
              buildDetectedFixedFields(data, resolvedHeaderRowIndex, nextDetectedColumns),
              nextDetectedColumns,
            ),
          }
        })(),
      }))
    } catch (error) {
      setPreview(null)
      setSampleError(error instanceof Error ? error.message : '样本预览失败')
    } finally {
      setIsPreviewingSample(false)
      event.target.value = ''
    }
  }

  function handlePreviewRowSelect(rowIndex: number) {
    if (!preview || !selectionMode) {
      return
    }

    const rowNumber = rowIndex + 1
    if (selectionMode === 'header') {
      setParserForm((current) => ({
        ...current,
        header_row_index: rowNumber,
        data_start_row_index:
          current.data_start_row_index <= rowNumber ? rowNumber + 1 : current.data_start_row_index,
      }))
      setSelectionMode('dataStart')
      return
    }

    if (selectionMode === 'dataStart') {
      setParserForm((current) => ({
        ...current,
        data_start_row_index: Math.max(rowNumber, current.header_row_index + 1),
      }))
      setSelectionMode('endColumn')
    }
  }

  function handlePreviewColumnSelect(columnIndex: number) {
    if (selectionMode !== 'endColumn') {
      return
    }

    setParserForm((current) => ({
      ...current,
      data_end_column: toColumnLetter(columnIndex),
    }))
    setSelectionMode(null)
  }

  function applyCalibrationSuggestion() {
    if (!calibrationSuggestion) {
      return
    }

    setParserForm((current) => ({
      ...current,
      header_row_index: calibrationSuggestion.headerRowIndex,
      data_start_row_index: calibrationSuggestion.dataStartRowIndex,
      data_end_column: calibrationSuggestion.dataEndColumn,
    }))
    setSelectionMode(null)
  }

  function handleAddFixedField() {
    setParserForm((current) => ({
      ...current,
      fixed_fields: [
        ...current.fixed_fields,
        {
          field_name: '',
          field_key: buildFixedFieldKey(
            `fixed_field_${current.fixed_fields.length + 1}`,
            current.fixed_fields.length,
            current.detected_columns,
            current.fixed_fields,
          ),
          field_value: '',
          field_name_source: null,
          field_value_source: null,
          follow_excel_value: false,
          is_enabled: true,
        },
      ],
    }))
  }

  function handleFixedFieldChange(index: number, field: FixedFieldEditableKey, value: string) {
    setParserForm((current) => {
      const nextFields = current.fixed_fields.map((item, fieldIndex) => {
        if (fieldIndex !== index) {
          return item
        }

        const nextField: ParserConfigFixedField = { ...item }

        if (field === 'field_name_source' || field === 'field_value_source') {
          nextField[field] = value.trim() || null
        } else if (field === 'field_key') {
          nextField.field_key = value
        } else {
          nextField[field] = value
        }

        if (field === 'field_name' || field === 'field_value') {
          nextField[field] = value
        }

        if (field === 'field_name_source' || field === 'field_value_source') {
          const resolvedValue = getPreviewCellValue(preview, value)
          if (resolvedValue) {
            if (field === 'field_name_source') {
              nextField.field_name = resolvedValue
            } else {
              nextField.field_value = resolvedValue
            }
          }
        }

        if (field === 'field_name' || field === 'field_name_source') {
          const keySeed = nextField.field_name || nextField.field_name_source || item.field_key
          nextField.field_key = buildFixedFieldKey(keySeed, index, current.detected_columns, current.fixed_fields)
        } else if (field === 'field_key') {
          nextField.field_key = buildFixedFieldKey(value || item.field_name || item.field_name_source || `fixed_field_${index + 1}`, index, current.detected_columns, current.fixed_fields)
        }

        return nextField
      })

      return {
        ...current,
        fixed_fields: nextFields,
      }
    })
  }

  function handleToggleFixedField(index: number) {
    setParserForm((current) => ({
      ...current,
      fixed_fields: current.fixed_fields.map((item, fieldIndex) => (
        fieldIndex === index ? { ...item, is_enabled: !item.is_enabled } : item
      )),
    }))
  }

  function handleToggleFollowExcelValue(index: number) {
    setParserForm((current) => ({
      ...current,
      fixed_fields: current.fixed_fields.map((item, fieldIndex) => {
        if (fieldIndex !== index) {
          return item
        }

        const nextFollowExcelValue = !item.follow_excel_value
        return {
          ...item,
          follow_excel_value: nextFollowExcelValue,
          field_value: nextFollowExcelValue && item.field_value_source
            ? getPreviewCellValue(preview, item.field_value_source) || item.field_value
            : item.field_value,
        }
      }),
    }))
  }

  function handleRemoveFixedField(index: number) {
    setParserForm((current) => ({
      ...current,
      fixed_fields: current.fixed_fields.filter((_, fieldIndex) => fieldIndex !== index),
    }))
  }

  function handleTemplateRuleItemChange(key: string, value: string) {
    setTemplateForm((current) => ({
      ...current,
      rule_item: {
        ...current.rule_item,
        [key]: value,
      },
    }))
  }

  function handleTemplateRuleItemRename(oldKey: string, newKey: string) {
    setTemplateForm((current) => {
      const entries = Object.entries(current.rule_item)
      const nextRuleItem: Record<string, string> = {}
      for (const [key, value] of entries) {
        if (key === oldKey) {
          nextRuleItem[newKey || oldKey] = value
        } else {
          nextRuleItem[key] = value
        }
      }
      return {
        ...current,
        rule_item: nextRuleItem,
      }
    })
  }

  function handleTemplateRuleItemRemove(key: string) {
    setTemplateForm((current) => {
      const nextRuleItem = { ...current.rule_item }
      delete nextRuleItem[key]
      return {
        ...current,
        rule_item: nextRuleItem,
      }
    })
  }

  function handleAddTemplateRuleItem() {
    const nextIndex = Object.keys(templateForm.rule_item).length + 1
    handleTemplateRuleItemChange(`字段${nextIndex}`, '')
  }

  function updateTemplateOutput(
    outputIndex: number,
    updater: (output: TemplateRuleOutputConfig) => TemplateRuleOutputConfig,
  ) {
    setTemplateForm((current) => ({
      ...current,
      outputs: current.outputs.map((output, index) => (index === outputIndex ? updater(output) : output)),
    }))
  }

  function handleAddTemplateOutput() {
    setTemplateForm((current) => ({
      ...current,
      outputs: [...current.outputs, createEmptyOutputConfig(current.outputs.length)],
    }))
  }

  function handleRemoveTemplateOutput(outputIndex: number) {
    setTemplateForm((current) => ({
      ...current,
      outputs: current.outputs.filter((_, index) => index !== outputIndex),
    }))
  }

  function updateTemplateImportOutputs(
    sheetName: string,
    updater: (outputs: TemplateRuleOutputConfig[]) => TemplateRuleOutputConfig[],
  ) {
    setTemplateImportOutputOverrides((current) => ({
      ...current,
      [sheetName]: updater(current[sheetName] ?? cloneTemplateOutputs(activeTemplateImportSampleRule?.outputs ?? [])),
    }))
  }

  function updateTemplateImportOutput(
    sheetName: string,
    outputIndex: number,
    updater: (output: TemplateRuleOutputConfig) => TemplateRuleOutputConfig,
  ) {
    updateTemplateImportOutputs(sheetName, (outputs) => outputs.map((output, index) => (index === outputIndex ? updater(output) : output)))
  }

  function handleAddTemplateImportOutput(sheetName: string) {
    updateTemplateImportOutputs(sheetName, (outputs) => [...outputs, createEmptyOutputConfig(outputs.length)])
  }

  function handleRemoveTemplateImportOutput(sheetName: string, outputIndex: number) {
    updateTemplateImportOutputs(sheetName, (outputs) => outputs.filter((_, index) => index !== outputIndex))
  }

  async function handlePreviewTemplateImportFile(
    file: File,
    options?: {
      sheetName?: string
      ruleItemRowIndex?: number | null
      outputFieldRowIndex?: number | null
      ruleItemColumns?: number[]
      outputFieldColumns?: number[]
    },
  ) {
    setIsImportPreviewingTemplate(true)
    setTemplateImportError('')
    try {
      const previewData = await previewTemplateRuleImport(file, options)
      const nextSheetName = previewData.selected_sheet_name
      setTemplateImportFile(file)
      setTemplateImportPreview(previewData)
      setTemplateImportActiveSheet(nextSheetName)
      setTemplateImportRuleItemRowMap((current) => ({
        ...current,
        [nextSheetName]: previewData.rule_item_row_index ?? options?.ruleItemRowIndex ?? null,
      }))
      setTemplateImportOutputFieldRowMap((current) => ({
        ...current,
        [nextSheetName]: previewData.output_field_row_index ?? options?.outputFieldRowIndex ?? null,
      }))
      setTemplateImportRuleItemColumnsMap((current) => ({
        ...current,
        [nextSheetName]: previewData.selected_rule_item_columns ?? options?.ruleItemColumns ?? [],
      }))
      setTemplateImportOutputFieldColumnsMap((current) => ({
        ...current,
        [nextSheetName]: previewData.selected_output_field_columns ?? options?.outputFieldColumns ?? [],
      }))
      setSelectedImportSheets((current) => current.length > 0 ? current : previewData.sheet_names)
      setTemplateImportOutputOverrides((current) => {
        const next = { ...current }
        for (const sheet of previewData.sheets) {
          next[sheet.sheet_name] = next[sheet.sheet_name] && sheet.sheet_name !== nextSheetName
            ? next[sheet.sheet_name]
            : cloneTemplateOutputs(sheet.sample_rules?.[0]?.outputs ?? [])
        }
        return next
      })
    } catch (error) {
      setTemplateImportError(error instanceof Error ? error.message : '规则导入预览失败')
    } finally {
      setIsImportPreviewingTemplate(false)
    }
  }

  async function handleCommitTemplateImport() {
    if (!templateImportFile) {
      setTemplateImportError('请先选择规则模板文件')
      return
    }
    if (selectedImportSheets.length === 0) {
      setTemplateImportError('至少选择一个规则分类 sheet')
      return
    }

    setIsImportingTemplate(true)
    setTemplateImportError('')
    try {
      const created = (await commitTemplateRuleImport(
        templateImportFile,
        selectedImportSheets,
        selectedImportSheets.map((sheetName) => ({
          sheet_name: sheetName,
          rule_item_row_index: templateImportRuleItemRowMap[sheetName] ?? undefined,
          output_field_row_index: templateImportOutputFieldRowMap[sheetName] ?? undefined,
          rule_item_columns: templateImportRuleItemColumnsMap[sheetName] ?? [],
          output_field_columns: templateImportOutputFieldColumnsMap[sheetName] ?? [],
          outputs: templateImportOutputOverrides[sheetName] ?? [],
        })),
      )).map(normalizeTemplateRule)
      if (created[0]) {
        setSelectedTemplateRuleId(created[0].id)
        setPreviewBuilderTemplateId(created[0].id)
      }
      setTemplateDialogMode(null)
      setTemplateImportPreview(null)
      setTemplateImportFile(null)
      setSelectedImportSheets([])
      setTemplateImportActiveSheet('')
      setTemplateImportRuleItemRowMap({})
      setTemplateImportOutputFieldRowMap({})
      setTemplateImportRuleItemColumnsMap({})
      setTemplateImportOutputFieldColumnsMap({})
      setTemplateImportOutputOverrides({})
      setTemplateImportSelectionMode(null)
      setTemplatePage(1)
      await loadTemplateRules(1)
    } catch (error) {
      setTemplateImportError(error instanceof Error ? error.message : '规则导入失败')
    } finally {
      setIsImportingTemplate(false)
    }
  }

  async function refreshTemplateImportPreview(next?: {
    sheetName?: string
    ruleItemRowIndex?: number | null
    outputFieldRowIndex?: number | null
    ruleItemColumns?: number[]
    outputFieldColumns?: number[]
  }) {
    if (!templateImportFile) {
      return
    }
    const nextSheetName = next?.sheetName ?? templateImportActiveSheet
    await handlePreviewTemplateImportFile(templateImportFile, {
      sheetName: nextSheetName,
      ruleItemRowIndex: next?.ruleItemRowIndex ?? templateImportRuleItemRowMap[nextSheetName] ?? undefined,
      outputFieldRowIndex: next?.outputFieldRowIndex ?? templateImportOutputFieldRowMap[nextSheetName] ?? undefined,
      ruleItemColumns: next?.ruleItemColumns ?? templateImportRuleItemColumnsMap[nextSheetName] ?? [],
      outputFieldColumns: next?.outputFieldColumns ?? templateImportOutputFieldColumnsMap[nextSheetName] ?? [],
    })
  }

  function handleSelectTemplateImportRow(rowIndex: number) {
    const nextRowIndex = rowIndex + 1
    if (templateImportSelectionMode === 'rule_item_row') {
      setTemplateImportRuleItemRowMap((current) => ({
        ...current,
        [templateImportActiveSheet]: nextRowIndex,
      }))
      setTemplateImportRuleItemColumnsMap((current) => ({
        ...current,
        [templateImportActiveSheet]: [],
      }))
      void refreshTemplateImportPreview({ ruleItemRowIndex: nextRowIndex, ruleItemColumns: [] })
      return
    }
    if (templateImportSelectionMode === 'output_field_row') {
      setTemplateImportOutputFieldRowMap((current) => ({
        ...current,
        [templateImportActiveSheet]: nextRowIndex,
      }))
      setTemplateImportOutputFieldColumnsMap((current) => ({
        ...current,
        [templateImportActiveSheet]: [],
      }))
      void refreshTemplateImportPreview({ outputFieldRowIndex: nextRowIndex, outputFieldColumns: [] })
    }
  }

  function toggleTemplateImportRuleItemColumn(columnIndex: number) {
    const nextColumns = activeTemplateImportRuleItemColumns.includes(columnIndex)
      ? activeTemplateImportRuleItemColumns.filter((item) => item !== columnIndex)
      : [...activeTemplateImportRuleItemColumns, columnIndex].sort((a, b) => a - b)
    setTemplateImportRuleItemColumnsMap((current) => ({
      ...current,
      [templateImportActiveSheet]: nextColumns,
    }))
    void refreshTemplateImportPreview({ ruleItemColumns: nextColumns })
  }

  function toggleTemplateImportOutputFieldColumn(columnIndex: number) {
    const nextColumns = activeTemplateImportOutputFieldColumns.includes(columnIndex)
      ? activeTemplateImportOutputFieldColumns.filter((item) => item !== columnIndex)
      : [...activeTemplateImportOutputFieldColumns, columnIndex].sort((a, b) => a - b)
    setTemplateImportOutputFieldColumnsMap((current) => ({
      ...current,
      [templateImportActiveSheet]: nextColumns,
    }))
    void refreshTemplateImportPreview({ outputFieldColumns: nextColumns })
  }

  function handleSelectPreviewTemplateRule(rule: TemplateRuleSet) {
    setPreviewBuilderTemplateId(rule.id)
    setPreviewTemplateKeyword(rule.rule_name)
    setPreviewTemplateDropdownOpen(false)
    setPreviewTemplateOptions((current) => (
      current.some((item) => item.id === rule.id) ? current : [rule, ...current]
    ))
  }

  async function handleSaveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSavingTemplate(true)
    setTemplateFormError('')
    try {
      const payload = {
        ...templateForm,
        outputs: templateForm.outputs.map((output) => ({
          ...output,
          fields: output.fields.map((field, fieldIndex) => ({
            ...field,
            field_order: field.field_order || fieldIndex + 1,
            display_name: field.display_name || field.field_name,
          })),
        })),
      }

      if (editingTemplateRuleId) {
        const updated = normalizeTemplateRule(await updateTemplateRule(editingTemplateRuleId, payload))
        setSelectedTemplateRuleId(updated.id)
        setPreviewBuilderTemplateId(updated.id)
        await loadTemplateRules(templatePage)
      } else {
        const created = normalizeTemplateRule(await createTemplateRule(payload))
        setSelectedTemplateRuleId(created.id)
        setPreviewBuilderTemplateId(created.id)
        setTemplatePage(1)
        await loadTemplateRules(1)
      }
      resetTemplateForm()
      setTemplateDialogMode(null)
    } catch (error) {
      setTemplateFormError(error instanceof Error ? error.message : '模板规则保存失败')
    } finally {
      setIsSavingTemplate(false)
    }
  }

  async function handleDeleteTemplate(ruleId: number) {
    setTemplateListError('')
    try {
      await deleteTemplateRule(ruleId)
      setTemplateRules((current) => current.filter((item) => item.id !== ruleId))
      setSelectedTemplateRuleIds((current) => current.filter((item) => item !== ruleId))
      if (selectedTemplateRuleId === ruleId) {
        setSelectedTemplateRuleId(null)
      }
      await loadTemplateRules(templatePage)
    } catch (error) {
      setTemplateListError(error instanceof Error ? error.message : '模板规则删除失败')
    }
  }

  async function handleBatchDeleteTemplateRules() {
    setTemplateListError('')
    try {
      await batchDeleteTemplateRules(selectedTemplateRuleIds)
      setSelectedTemplateRuleIds([])
      setSelectedTemplateRuleId(null)
      await loadTemplateRules(templatePage)
    } catch (error) {
      setTemplateListError(error instanceof Error ? error.message : '模板规则批量删除失败')
    }
  }

  function toggleTemplateRuleSelection(ruleId: number) {
    setSelectedTemplateRuleIds((current) => (
      current.includes(ruleId)
        ? current.filter((item) => item !== ruleId)
        : [...current, ruleId]
    ))
  }

  function toggleTemplateRuleSelectionAll() {
    if (templateRules.length === 0) {
      return
    }
    setSelectedTemplateRuleIds((current) => (
      current.length === templateRules.length ? [] : templateRules.map((item) => item.id)
    ))
  }

  async function handleJumpTemplatePage() {
    const targetPage = Number(templatePageInput)
    if (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > templateTotalPages) {
      setTemplateListError(`页码必须在 1 到 ${templateTotalPages} 之间`)
      return
    }
    setTemplatePage(targetPage)
  }

  async function handleBuildPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!previewBuilderParserId || !previewBuilderTemplateId) {
      setPreviewBuildError('请选择解析配置和模板规则')
      return
    }

    setIsBuildingPreview(true)
    setPreviewBuildError('')
    try {
      const data = await generateExportPreview({
        parser_config_id: Number(previewBuilderParserId),
        import_batch_code: previewBuilderImportBatchCode || undefined,
        template_rule_id: Number(previewBuilderTemplateId),
        output_key: previewBuilderOutputKey || undefined,
        export_month: previewBuilderExportMonth || undefined,
        page: previewPage,
        page_size: previewPageSize,
      })
      setPreviewResult(data)
      setPreviewPage(data.page)
      setPreviewPageInput(String(data.page))
    } catch (error) {
      setPreviewBuildError(error instanceof Error ? error.message : '预览生成失败')
      setPreviewResult(null)
    } finally {
      setIsBuildingPreview(false)
    }
  }

  async function loadPreviewPage(targetPage: number) {
    if (!previewBuilderParserId || !previewBuilderTemplateId) {
      setPreviewBuildError('请选择解析配置和模板规则')
      return
    }

    setIsBuildingPreview(true)
    setPreviewBuildError('')
    try {
      const data = await generateExportPreview({
        parser_config_id: Number(previewBuilderParserId),
        import_batch_code: previewBuilderImportBatchCode || undefined,
        template_rule_id: Number(previewBuilderTemplateId),
        output_key: previewBuilderOutputKey || undefined,
        export_month: previewBuilderExportMonth || undefined,
        page: targetPage,
        page_size: previewPageSize,
      })
      setPreviewResult(data)
      setPreviewPage(data.page)
      setPreviewPageInput(String(data.page))
    } catch (error) {
      setPreviewBuildError(error instanceof Error ? error.message : '预览生成失败')
    } finally {
      setIsBuildingPreview(false)
    }
  }

  async function handleJumpPreviewPage() {
    if (!previewResult) {
      return
    }

    const targetPage = Number(previewPageInput)
    if (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > previewResult.total_pages) {
      setPreviewBuildError(`页码必须在 1 到 ${previewResult.total_pages} 之间`)
      return
    }

    setPreviewPage(targetPage)
    await loadPreviewPage(targetPage)
  }

  async function loadDetailRecords(params?: {
    page?: number
    parserConfigId?: number
    batchCode?: string
    filterFieldName?: string
    filterKeyword?: string
  }) {
    const parserConfigId = Number(params?.parserConfigId ?? detailViewerParserId)
    const batchCode = params?.batchCode ?? detailViewerBatchCode
    const page = params?.page ?? detailPage
    const filterFieldName = params?.filterFieldName ?? detailFilterFieldName
    const filterKeyword = params?.filterKeyword ?? detailFilterKeyword

    if (!parserConfigId || !batchCode) {
      setDetailError('请选择解析配置和导入批次')
      setDetailResult(null)
      return
    }

    setIsLoadingDetail(true)
    setDetailError('')
    try {
      const data = await fetchDetailRecords({
        parserConfigId,
        importBatchCode: batchCode,
        page,
        pageSize: detailPageSize,
        filterFieldName: filterFieldName || undefined,
        filterKeyword: filterKeyword || undefined,
      })
      setDetailResult(data)
      setDetailPage(data.page)
      setDetailPageInput(String(data.page))
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '明细数据加载失败')
      setDetailResult(null)
    } finally {
      setIsLoadingDetail(false)
    }
  }

  async function handleSearchDetailRecords(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDetailPage(1)
    await loadDetailRecords({ page: 1 })
  }

  async function handleJumpDetailPage() {
    if (!detailResult) {
      return
    }

    const targetPage = Number(detailPageInput)
    if (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > detailResult.total_pages) {
      setDetailError(`页码必须在 1 到 ${detailResult.total_pages} 之间`)
      return
    }

    setDetailPage(targetPage)
    await loadDetailRecords({ page: targetPage })
  }

  function handleDownloadPreviewCsv() {
    if (!previewResult) {
      return
    }

    const lines = [
      previewResult.headers.join(','),
      ...previewResult.rows.map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','),
      ),
    ]

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${previewResult.parser_config_name}-${previewResult.template_rule_name}-preview.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleDownloadPreviewExcel() {
    if (!previewBuilderParserId || !previewBuilderTemplateId) {
      setPreviewBuildError('请选择解析配置和模板规则')
      return
    }

    setIsDownloadingExcel(true)
    setPreviewBuildError('')
    try {
      await downloadExportExcel({
        parser_config_id: Number(previewBuilderParserId),
        import_batch_code: previewBuilderImportBatchCode || undefined,
        template_rule_id: Number(previewBuilderTemplateId),
        output_key: previewBuilderOutputKey || undefined,
        export_month: previewBuilderExportMonth || undefined,
      })
    } catch (error) {
      setPreviewBuildError(error instanceof Error ? error.message : 'Excel 导出失败')
    } finally {
      setIsDownloadingExcel(false)
    }
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) {
      return
    }

    if (!importParserConfigId) {
      setImportError('请先选择解析配置')
      event.target.value = ''
      return
    }

    const parserConfigId = Number(importParserConfigId)
    const initialBatchCode = importBatchCode.trim()
    let currentBatchCode = initialBatchCode
    let lastTask: ImportTask | null = null

    setSelectedImportFileSummary(
      files.length === 1 ? files[0].name : `已选择 ${files.length} 个文件`,
    )
    setIsImportingBatch(true)
    setImportError('')

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        setSelectedImportFileSummary(
          files.length === 1
            ? `正在导入 ${file.name}`
            : `正在导入 ${index + 1}/${files.length}: ${file.name}`,
        )
        lastTask = await createImportTask({
          parserConfigId,
          batchCode: currentBatchCode || undefined,
          file,
        })
        currentBatchCode = lastTask.batch_code
      }

      if (!lastTask) {
        return
      }

      await loadImportTasks()
      await loadImportBatches()
      setPreviewBuilderParserId(lastTask.parser_config_id)
      setPreviewBuilderImportBatchCode(lastTask.batch_code)
      setImportBatchCode(lastTask.batch_code)
      setSelectedImportFileSummary(
        files.length === 1
          ? `${files[0].name} 已提交后台导入`
          : `${files.length} 个文件已提交到批次 ${lastTask.batch_code}`,
      )
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '明细导入失败')
    } finally {
      setIsImportingBatch(false)
      event.target.value = ''
    }
  }

  async function handleDeleteImportBatch(batchCode: string) {
    setImportError('')
    try {
      await deleteImportBatch(batchCode)
      setImportBatches((current) => current.filter((item) => item.batch_code !== batchCode))
      if (previewBuilderImportBatchCode === batchCode) {
        setPreviewBuilderImportBatchCode('')
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入批次删除失败')
    }
  }

  function openDeleteConfirm(state: ConfirmDialogState) {
    setConfirmDialog(state)
  }

  async function handleConfirmAction() {
    if (!confirmDialog) {
      return
    }

    setIsConfirmingAction(true)
    try {
      await confirmDialog.onConfirm()
      setConfirmDialog(null)
    } finally {
      setIsConfirmingAction(false)
    }
  }
  return (
    <div className="app-shell">
      <header className="page-header">
        <h1>{pageTitle}</h1>
        <div className="top-tabs">
          <button type="button" className={`top-tab ${activeView === 'parser' ? 'top-tab--active' : ''}`} onClick={() => setActiveView('parser')}>解析配置</button>
          <button type="button" className={`top-tab ${activeView === 'import' ? 'top-tab--active' : ''}`} onClick={() => setActiveView('import')}>明细导入</button>
          <button type="button" className={`top-tab ${activeView === 'detail' ? 'top-tab--active' : ''}`} onClick={() => setActiveView('detail')}>明细查看</button>
          <button type="button" className={`top-tab ${activeView === 'template' ? 'top-tab--active' : ''}`} onClick={() => setActiveView('template')}>模板规则</button>
          <button type="button" className={`top-tab ${activeView === 'preview' ? 'top-tab--active' : ''}`} onClick={() => setActiveView('preview')}>预览导出</button>
        </div>
      </header>

      {activeView === 'parser' ? (
        <main className="admin-page">
          <section className="panel">
            <div className="panel-toolbar">
              <h2>解析配置</h2>
              <div className="toolbar-actions">
                <button type="button" className="ghost-button" onClick={() => void loadConfigs()}>刷新</button>
                <button type="button" className="ghost-button" onClick={() => setParserDialogMode('sample')}>样本校准</button>
                <button type="button" className="primary-button" onClick={openCreateParserDialog}>新建配置</button>
              </div>
            </div>
            {parserListError ? <p className="state-text state-text--error">{parserListError}</p> : null}
            <div className="table-shell">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>配置名称</th>
                    <th>编码</th>
                    <th>Sheet</th>
                    <th>字段数</th>
                    <th>标题行</th>
                    <th>起始行</th>
                    <th>结束列</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingConfigs ? (
                    <tr><td colSpan={9} className="table-empty">正在加载...</td></tr>
                  ) : configs.length === 0 ? (
                    <tr><td colSpan={9} className="table-empty">暂无数据</td></tr>
                  ) : (
                    configs.map((config) => (
                      <tr key={config.id} className={config.id === selectedConfigId ? 'admin-row--active' : ''}>
                        <td>{config.config_name}</td>
                        <td className="cell-code">{config.config_code}</td>
                        <td>{config.sheet_name}</td>
                        <td>{config.columns.length}</td>
                        <td>{config.header_row_index}</td>
                        <td>{config.data_start_row_index}</td>
                        <td>{config.data_end_column}</td>
                        <td><span className={`status-chip status-chip--${config.status}`}>{config.status}</span></td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="text-button" onClick={() => { setSelectedConfigId(config.id); setParserDialogMode('detail') }}>查看</button>
                            <button type="button" className="text-button" onClick={() => openEditParserDialog(config)}>编辑</button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                openDeleteConfirm({
                                  title: '删除解析配置',
                                  message: `确认删除解析配置“${config.config_name}”？将同时删除对应动态明细表和相关导入批次。`,
                                  confirmLabel: '确认删除',
                                  onConfirm: async () => {
                                    await handleDeleteParser(config.id)
                                  },
                                })
                              }
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      ) : null}

      {activeView === 'import' ? (
        <main className="admin-page">
            <section className="panel">
              <div className="panel-toolbar">
                <h2>明细导入</h2>
                <div className="toolbar-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void loadImportTasks()
                      void loadImportBatches()
                    }}
                  >
                    刷新
                  </button>
                </div>
              </div>
            <form className="compact-form">
              <label>
                <span>解析配置</span>
                <select value={importParserConfigId} onChange={(event) => setImportParserConfigId(event.target.value ? Number(event.target.value) : '')}>
                  <option value="">请选择</option>
                  {configs.map((config) => (<option key={config.id} value={config.id}>{config.config_name}</option>))}
                </select>
              </label>
              <label>
                <span>批次号</span>
                <input value={importBatchCode} onChange={(event) => setImportBatchCode(event.target.value)} placeholder="留空自动生成，同批次多文件请填相同批次号" />
              </label>
              <label className="config-form__wide upload-box">
                <input type="file" multiple accept=".xlsx,.xlsm,.xltx,.xltm" onChange={handleImportFile} />
                <span>{selectedImportFileSummary || '选择一个或多个明细 Excel 并立即导入'}</span>
              </label>
            </form>
              {isImportingBatch ? <p className="state-text">{selectedImportFileSummary || '正在导入...'}</p> : null}
              {importError ? <p className="state-text state-text--error">{importError}</p> : null}
            </section>

            <section className="panel">
              <div className="panel-toolbar"><h2>最近导入任务</h2></div>
              <div className="table-shell">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>文件名</th>
                      <th>批次号</th>
                      <th>状态</th>
                      <th>进度</th>
                      <th>结果</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingImportTasks ? (
                      <tr><td colSpan={6} className="table-empty">正在加载...</td></tr>
                    ) : importTasks.length === 0 ? (
                      <tr><td colSpan={6} className="table-empty">暂无导入任务</td></tr>
                    ) : (
                      importTasks.map((task) => (
                        <tr key={task.id}>
                          <td>{task.file_name}</td>
                          <td className="cell-code">{task.batch_code}</td>
                          <td>
                            <span className={`status-chip status-chip--${task.status === 'success' ? 'active' : task.status === 'failed' ? 'inactive' : 'pending'}`}>
                              {task.status}
                            </span>
                          </td>
                          <td>
                            <div className="progress-cell">
                              <div className="progress-bar">
                                <div className="progress-bar__value" style={{ width: `${task.progress_percent}%` }} />
                              </div>
                              <span>{task.progress_percent}%</span>
                            </div>
                            <div className="task-message">{task.progress_message || '-'}</div>
                          </td>
                          <td className={task.error_message ? 'cell-error' : ''}>
                            {task.error_message || (task.imported_rows > 0 ? `${task.imported_rows} 行` : '-')}
                          </td>
                          <td>{task.created_at.replace('T', ' ').slice(0, 19)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-toolbar"><h2>最近导入批次</h2></div>
            <div className="table-shell">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>批次号</th>
                    <th>文件数</th>
                    <th>文件名</th>
                    <th>解析配置</th>
                    <th>导入行数</th>
                    <th>状态</th>
                    <th>时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingImports ? (
                    <tr><td colSpan={8} className="table-empty">正在加载...</td></tr>
                  ) : importBatchGroups.length === 0 ? (
                    <tr><td colSpan={8} className="table-empty">暂无导入批次</td></tr>
                  ) : (
                    importBatchGroups.map((batch) => (
                      <tr key={batch.batch_code}>
                        <td className="cell-code">{batch.batch_code}</td>
                        <td>{batch.file_count}</td>
                        <td>{batch.file_names.join('，')}</td>
                        <td>{configs.find((item) => item.id === batch.parser_config_id)?.config_name || batch.parser_config_id}</td>
                        <td>{batch.imported_rows}</td>
                        <td><span className={`status-chip status-chip--${batch.status === 'success' ? 'active' : 'inactive'}`}>{batch.status}</span></td>
                        <td>{batch.created_at.replace('T', ' ').slice(0, 19)}</td>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              openDeleteConfirm({
                                title: '删除导入批次',
                                message: `确认删除批次“${batch.batch_code}”？将删除该批次下 ${batch.file_count} 个文件导入的全部数据。`,
                                confirmLabel: '确认删除',
                                onConfirm: async () => {
                                  await handleDeleteImportBatch(batch.batch_code)
                                },
                              })
                            }
                          >
                            删除批次
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      ) : null}

      {activeView === 'detail' ? (
        <main className="admin-page">
          <section className="panel detail-result-panel">
            <div className="panel-toolbar">
              <h2>导入明细查看</h2>
              <div className="toolbar-actions">
                <button type="button" className="ghost-button" onClick={() => void loadDetailRecords()}>刷新</button>
              </div>
            </div>
            <form className="compact-form detail-filter-form" onSubmit={(event) => void handleSearchDetailRecords(event)}>
              <label className="detail-filter-field">
                <span>解析配置</span>
                <select
                  value={detailViewerParserId}
                  onChange={(event) => {
                    setDetailViewerParserId(event.target.value ? Number(event.target.value) : '')
                    setDetailPage(1)
                    setDetailResult(null)
                  }}
                >
                  <option value="">请选择</option>
                  {configs.map((config) => (<option key={config.id} value={config.id}>{config.config_name}</option>))}
                </select>
              </label>
              <label className="detail-filter-field">
                <span>导入批次</span>
                <select
                  value={detailViewerBatchCode}
                  onChange={(event) => {
                    setDetailViewerBatchCode(event.target.value)
                    setDetailPage(1)
                    setDetailResult(null)
                  }}
                >
                  <option value="">请选择</option>
                  {detailAvailableBatchGroups.map((batch) => (
                    <option key={batch.batch_code} value={batch.batch_code}>
                      {batch.batch_code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="detail-filter-field">
                <span>过滤字段</span>
                <select value={detailFilterFieldName} onChange={(event) => setDetailFilterFieldName(event.target.value)}>
                  <option value="">全部</option>
                  {(selectedDetailConfig?.columns ?? []).map((column) => (
                    <option key={column.field_name} value={column.field_name}>
                      {column.header_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="detail-filter-field">
                <span>关键字</span>
                <input value={detailFilterKeyword} onChange={(event) => setDetailFilterKeyword(event.target.value)} placeholder="输入后按字段过滤" />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary-button" disabled={isLoadingDetail}>
                  {isLoadingDetail ? '查询中...' : '查询'}
                </button>
              </div>
            </form>
            {detailError ? <p className="state-text state-text--error">{detailError}</p> : null}
          </section>

          <section className="panel">
            <div className="panel-toolbar">
              <h2>明细数据</h2>
              <div className="toolbar-actions">
                <span className="state-text">每页 {detailPageSize} 条</span>
                {detailResult ? <span className="state-text">共 {detailResult.total} 条</span> : null}
              </div>
            </div>
            <div className="table-shell table-shell--detail">
              <table className="admin-table admin-table--sticky">
                <thead>
                  <tr>
                    <th className="sticky-column">序号</th>
                    {(detailResult?.columns ?? []).map((column) => (
                      <th key={column.field_name}>{column.header_name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoadingDetail ? (
                    <tr><td colSpan={(detailResult?.columns.length ?? 0) + 1} className="table-empty">正在加载...</td></tr>
                  ) : !detailResult ? (
                    <tr><td colSpan={2} className="table-empty">请选择批次后查询</td></tr>
                  ) : detailResult.rows.length === 0 ? (
                    <tr><td colSpan={detailResult.columns.length + 1} className="table-empty">暂无数据</td></tr>
                  ) : (
                    detailResult.rows.map((row, rowIndex) => (
                      <tr key={`detail-row-${row['row_number'] ?? rowIndex}`}>
                        <td className="sticky-column sticky-column--body">{String(row['row_number'] ?? '')}</td>
                        {detailResult.columns.map((column) => (
                          <td key={`detail-cell-${rowIndex}-${column.field_name}`}>
                            {row[column.field_name] === null || row[column.field_name] === undefined ? '' : String(row[column.field_name])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {detailResult ? (
              <div className="pagination-bar">
                <button
                  type="button"
                  className="ghost-button pagination-bar__button"
                  disabled={detailResult.page <= 1 || isLoadingDetail}
                  onClick={() => {
                    const targetPage = detailResult.page - 1
                    setDetailPage(targetPage)
                    void loadDetailRecords({ page: targetPage })
                  }}
                >
                  上一页
                </button>
                <span className="state-text pagination-bar__status">
                  第 {detailResult.page} / {detailResult.total_pages} 页
                </span>
                <input
                  className="pagination-bar__input"
                  value={detailPageInput}
                  onChange={(event) => setDetailPageInput(event.target.value.replace(/\D/g, ''))}
                  placeholder="页码"
                />
                <button
                  type="button"
                  className="ghost-button pagination-bar__button"
                  disabled={isLoadingDetail}
                  onClick={() => void handleJumpDetailPage()}
                >
                  跳转
                </button>
                <button
                  type="button"
                  className="ghost-button pagination-bar__button"
                  disabled={detailResult.page >= detailResult.total_pages || isLoadingDetail}
                  onClick={() => {
                    const targetPage = detailResult.page + 1
                    setDetailPage(targetPage)
                    void loadDetailRecords({ page: targetPage })
                  }}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </section>
        </main>
      ) : null}

      {activeView === 'template' ? (
        <main className="admin-page">
          <section className="panel">
            <div className="panel-toolbar">
              <h2>模板规则</h2>
              <div className="toolbar-actions">
                <button type="button" className="ghost-button" onClick={() => void loadTemplateRules(templatePage)}>刷新</button>
                <button type="button" className="ghost-button" onClick={openTemplateImportDialog}>导入规则</button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={selectedTemplateRuleIds.length === 0}
                  onClick={() =>
                    openDeleteConfirm({
                      title: '批量删除模板规则',
                      message: `确认删除已选中的 ${selectedTemplateRuleIds.length} 条模板规则？删除后无法恢复。`,
                      confirmLabel: '确认批量删除',
                      onConfirm: async () => {
                        await handleBatchDeleteTemplateRules()
                      },
                    })
                  }
                >
                  批量删除
                </button>
                <button type="button" className="primary-button" onClick={openCreateTemplateDialog}>新建规则</button>
              </div>
            </div>
            {templateListError ? <p className="state-text state-text--error">{templateListError}</p> : null}
            <div className="table-shell">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={templateRules.length > 0 && selectedTemplateRuleIds.length === templateRules.length}
                        onChange={toggleTemplateRuleSelectionAll}
                      />
                    </th>
                    <th>分类</th>
                    <th>规则名称</th>
                    <th>银行名称</th>
                    <th>频次</th>
                    <th>导出配置</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingTemplates ? (
                    <tr><td colSpan={8} className="table-empty">正在加载...</td></tr>
                  ) : templateRules.length === 0 ? (
                    <tr><td colSpan={8} className="table-empty">暂无数据</td></tr>
                  ) : (
                    templateRules.map((rule) => (
                      <tr key={rule.id} className={rule.id === selectedTemplateRuleId ? 'admin-row--active' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedTemplateRuleIds.includes(rule.id)}
                            onChange={() => toggleTemplateRuleSelection(rule.id)}
                          />
                        </td>
                        <td>{rule.group_name}</td>
                        <td>{rule.rule_name}</td>
                        <td>{rule.rule_item['银行名称（与出资方名称一致）'] || rule.rule_item['银行名称'] || '-'}</td>
                        <td>{rule.rule_item['频次'] || '-'}</td>
                        <td>{(rule.outputs ?? []).map((item) => item.sheet_name).join(' / ') || '-'}</td>
                        <td><span className={`status-chip status-chip--${rule.status}`}>{rule.status}</span></td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="text-button" onClick={() => { setSelectedTemplateRuleId(rule.id); setTemplateDialogMode('detail') }}>查看</button>
                            <button type="button" className="text-button" onClick={() => openEditTemplateDialog(rule)}>编辑</button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                openDeleteConfirm({
                                  title: '删除模板规则',
                                  message: `确认删除模板规则“${rule.rule_name}”？删除后无法恢复。`,
                                  confirmLabel: '确认删除',
                                  onConfirm: async () => {
                                    await handleDeleteTemplate(rule.id)
                                  },
                                })
                              }
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination-bar">
              <button
                type="button"
                className="ghost-button pagination-bar__button"
                disabled={templatePage <= 1 || isLoadingTemplates}
                onClick={() => setTemplatePage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <p className="pagination-bar__status">{`第 ${templatePage} / ${templateTotalPages} 页，共 ${templateTotal} 条`}</p>
              <input
                className="pagination-bar__input"
                value={templatePageInput}
                onChange={(event) => setTemplatePageInput(event.target.value.replace(/\D/g, ''))}
                placeholder="页码"
              />
              <button
                type="button"
                className="ghost-button pagination-bar__button"
                disabled={isLoadingTemplates}
                onClick={() => void handleJumpTemplatePage()}
              >
                跳转
              </button>
              <button
                type="button"
                className="ghost-button pagination-bar__button"
                disabled={templatePage >= templateTotalPages || isLoadingTemplates}
                onClick={() => setTemplatePage((current) => Math.min(templateTotalPages, current + 1))}
              >
                下一页
              </button>
            </div>
          </section>
        </main>
      ) : null}

      {activeView === 'preview' ? (
        <main className="preview-page">
          <section className="panel">
            <div className="panel-toolbar"><h2>预览导出</h2></div>
            <form className="compact-form" onSubmit={handleBuildPreview}>
              <label>
                <span>解析配置</span>
                <select value={previewBuilderParserId} onChange={(event) => setPreviewBuilderParserId(event.target.value ? Number(event.target.value) : '')}>
                  <option value="">请选择</option>
                  {configs.map((config) => (<option key={config.id} value={config.id}>{config.config_name}</option>))}
                </select>
              </label>
              <label>
                <span>导入批次</span>
                <select value={previewBuilderImportBatchCode} onChange={(event) => setPreviewBuilderImportBatchCode(event.target.value)}>
                  <option value="">自动取最新</option>
                  {previewAvailableBatchGroups.map((batch) => (
                    <option key={batch.batch_code} value={batch.batch_code}>{`${batch.batch_code} (${batch.file_count}个文件)`}</option>
                  ))}
                </select>
              </label>
              <div className="form-field">
                <span>模板规则</span>
                <div className="search-select" ref={previewTemplateSelectRef}>
                  <input
                    value={previewTemplateKeyword}
                    placeholder="输入规则名称/银行名称搜索"
                    onFocus={() => setPreviewTemplateDropdownOpen(true)}
                    onChange={(event) => {
                      setPreviewTemplateKeyword(event.target.value)
                      setPreviewTemplateDropdownOpen(true)
                    }}
                  />
                  {previewTemplateDropdownOpen ? (
                    <div className="search-select__panel">
                      {previewSelectedTemplateRule ? (
                        <div className="search-select__current">
                          {`当前已选：${previewSelectedTemplateRule.rule_name}`}
                        </div>
                      ) : null}
                      <div className="search-select__list">
                        {previewTemplateOptions.map((rule) => (
                          <button
                            key={rule.id}
                            type="button"
                            className={rule.id === previewBuilderTemplateId ? 'search-select__option search-select__option--active' : 'search-select__option'}
                            onClick={() => handleSelectPreviewTemplateRule(rule)}
                          >
                            <span>{rule.rule_name}</span>
                            <small>{rule.rule_item['银行名称（与出资方名称一致）'] || rule.rule_item['银行名称'] || '-'}</small>
                          </button>
                        ))}
                        {!isLoadingPreviewTemplateOptions && previewTemplateOptions.length === 0 ? (
                          <div className="search-select__empty">暂无匹配规则</div>
                        ) : null}
                      </div>
                      <div className="search-select__actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void loadPreviewTemplateOptions(previewTemplatePage + 1, previewTemplateKeyword, true)}
                          disabled={isLoadingPreviewTemplateOptions || previewTemplatePage >= previewTemplateTotalPages}
                        >
                          {isLoadingPreviewTemplateOptions ? '加载中...' : previewTemplatePage >= previewTemplateTotalPages ? '已全部加载' : '加载更多'}
                        </button>
                        <button type="button" className="ghost-button" onClick={() => setPreviewTemplateDropdownOpen(false)}>收起</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <label>
                <span>导出结果</span>
                <select value={previewBuilderOutputKey} onChange={(event) => setPreviewBuilderOutputKey(event.target.value)}>
                  <option value="">默认首个输出</option>
                  {(previewSelectedTemplateRule?.outputs ?? []).map((output) => (
                    <option key={output.output_key} value={output.output_key}>{`${output.sheet_name} (${output.output_key})`}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>导出月份</span>
                <input value={previewBuilderExportMonth} onChange={(event) => setPreviewBuilderExportMonth(event.target.value)} placeholder="2026-01" />
              </label>
              <div className="toolbar-actions toolbar-actions--end"><button type="submit" className="primary-button" disabled={isBuildingPreview}>{isBuildingPreview ? '生成中...' : '生成预览'}</button></div>
            </form>
            {previewBuildError ? <p className="state-text state-text--error">{previewBuildError}</p> : null}
          </section>

          <section className="panel detail-result-panel">
            <div className="panel-toolbar">
              <h2>预览结果</h2>
              <div className="toolbar-actions">
                <button type="button" className="ghost-button" onClick={handleDownloadPreviewCsv} disabled={!previewResult}>导出 CSV</button>
                <button type="button" className="primary-button" onClick={() => void handleDownloadPreviewExcel()} disabled={isDownloadingExcel || !previewResult}>
                  {isDownloadingExcel ? '导出中...' : '导出 Excel'}
                </button>
              </div>
            </div>
            {!previewResult ? (
              <div className="table-empty table-empty--panel">暂无预览结果</div>
            ) : (
              <>
                <div className="preview-summary preview-summary--top">
                  <span>{previewResult.parser_config_name}</span>
                  <span>{previewResult.import_file_name}</span>
                  <span>{previewResult.template_rule_name}</span>
                  <span>{previewResult.output_sheet_name}</span>
                  <span>共 {previewResult.total} 行</span>
                </div>
                <div className="table-shell table-shell--detail">
                  <table className="admin-table admin-table--sticky">
                    <thead><tr>{previewResult.headers.map((header) => (<th key={header}>{header}</th>))}</tr></thead>
                    <tbody>
                      {previewResult.rows.map((row, rowIndex) => (
                        <tr key={`preview-row-${rowIndex}`}>{row.map((cell, cellIndex) => (<td key={`preview-cell-${rowIndex}-${cellIndex}`}>{cell}</td>))}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination-bar">
                  <button
                    type="button"
                    className="ghost-button pagination-bar__button"
                    disabled={previewResult.page <= 1 || isBuildingPreview}
                    onClick={() => {
                      const targetPage = previewResult.page - 1
                      setPreviewPage(targetPage)
                      void loadPreviewPage(targetPage)
                    }}
                  >
                    上一页
                  </button>
                  <span className="state-text pagination-bar__status">
                    第 {previewResult.page} / {previewResult.total_pages} 页
                  </span>
                  <input
                    className="pagination-bar__input"
                    value={previewPageInput}
                    onChange={(event) => setPreviewPageInput(event.target.value.replace(/\D/g, ''))}
                    placeholder="页码"
                  />
                  <button
                    type="button"
                    className="ghost-button pagination-bar__button"
                    disabled={isBuildingPreview}
                    onClick={() => void handleJumpPreviewPage()}
                  >
                    跳转
                  </button>
                  <button
                    type="button"
                    className="ghost-button pagination-bar__button"
                    disabled={previewResult.page >= previewResult.total_pages || isBuildingPreview}
                    onClick={() => {
                      const targetPage = previewResult.page + 1
                      setPreviewPage(targetPage)
                      void loadPreviewPage(targetPage)
                    }}
                  >
                    下一页
                  </button>
                </div>
              </>
            )}
          </section>
        </main>
      ) : null}
      {parserDialogMode === 'detail' && selectedConfig ? (
        <div className="dialog-backdrop" onClick={() => setParserDialogMode(null)}>
          <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <h2>配置详情</h2>
              <div className="toolbar-actions">
                <button type="button" className="ghost-button" onClick={() => openEditParserDialog(selectedConfig)}>编辑</button>
                <button type="button" className="ghost-button" onClick={() => setParserDialogMode(null)}>关闭</button>
              </div>
            </div>
            <dl className="detail-grid">
              <div><dt>配置名称</dt><dd>{selectedConfig.config_name}</dd></div>
              <div><dt>配置编码</dt><dd>{selectedConfig.config_code}</dd></div>
              <div><dt>Sheet</dt><dd>{selectedConfig.sheet_name}</dd></div>
              <div><dt>标题行</dt><dd>{selectedConfig.header_row_index}</dd></div>
              <div><dt>起始行</dt><dd>{selectedConfig.data_start_row_index}</dd></div>
              <div><dt>结束列</dt><dd>{selectedConfig.data_end_column}</dd></div>
              <div><dt>识别字段数</dt><dd>{selectedConfig.columns.length}</dd></div>
              <div><dt>状态</dt><dd>{selectedConfig.status}</dd></div>
              <div><dt>备注</dt><dd>{selectedConfig.remark || '-'}</dd></div>
            </dl>
            <div className="column-preview">
              <div className="column-preview__header">
                <strong>字段结构</strong>
              </div>
              <div className="table-shell">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>列</th>
                      <th>Excel 标题</th>
                      <th>物理字段</th>
                      <th>样例值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedConfig.columns.length === 0 ? (
                      <tr><td colSpan={4} className="table-empty">暂无字段结构，请先做样本校准并保存</td></tr>
                    ) : (
                      selectedConfig.columns.map((column) => (
                        <tr key={column.id ?? `${column.field_name}-${column.column_index}`}>
                          <td>{column.column_letter}</td>
                          <td>{column.header_name}</td>
                          <td className="cell-code">{column.field_name}</td>
                          <td>{column.sample_value || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="column-preview">
              <div className="column-preview__header">
                <strong>固定字段</strong>
              </div>
              <div className="table-shell">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>启用</th>
                      <th>字段名</th>
                      <th>字段值</th>
                      <th>值跟随 Excel</th>
                      <th>字段名来源</th>
                      <th>字段值来源</th>
                      <th>物理字段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedConfig.fixed_fields.length === 0 ? (
                      <tr><td colSpan={7} className="table-empty">暂无固定字段</td></tr>
                    ) : (
                      selectedConfig.fixed_fields.map((field, index) => (
                        <tr key={`${field.field_key}-${index}`}>
                          <td>{field.is_enabled ? '是' : '否'}</td>
                          <td>{field.field_name || '-'}</td>
                          <td>{field.field_value || '-'}</td>
                          <td>{(field.follow_excel_value ?? true) ? '是' : '否'}</td>
                          <td>{field.field_name_source || '-'}</td>
                          <td>{field.field_value_source || '-'}</td>
                          <td className="cell-code">{field.field_key}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {parserDialogMode === 'form' ? (
        <div className="dialog-backdrop" onClick={() => setParserDialogMode(null)}>
          <section className="dialog-panel dialog-panel--wide dialog-panel--sample" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <h2>{editingConfigId ? '编辑解析配置' : '新建解析配置'}</h2>
              <div className="toolbar-actions">
                <button type="button" className="ghost-button" onClick={() => setParserDialogMode('sample')}>打开样本校准</button>
                <button type="button" className="ghost-button" onClick={() => setParserDialogMode(null)}>关闭</button>
              </div>
            </div>
            <form className="config-form config-form--sticky-footer" onSubmit={handleSaveParser}>
              <label><span>配置编码</span><input value={parserForm.config_code} onChange={(event) => setParserForm({ ...parserForm, config_code: event.target.value })} required /></label>
              <label><span>配置名称</span><input value={parserForm.config_name} onChange={(event) => setParserForm({ ...parserForm, config_name: event.target.value })} required /></label>
              <label><span>Sheet</span><input value={parserForm.sheet_name} onChange={(event) => setParserForm({ ...parserForm, sheet_name: event.target.value })} /></label>
              <label><span>标题行</span><input type="number" min={1} value={parserForm.header_row_index} onChange={(event) => setParserForm({ ...parserForm, header_row_index: Number(event.target.value) })} /></label>
              <label><span>起始行</span><input type="number" min={1} value={parserForm.data_start_row_index} onChange={(event) => setParserForm({ ...parserForm, data_start_row_index: Number(event.target.value) })} /></label>
              <label><span>结束列</span><input value={parserForm.data_end_column} onChange={(event) => setParserForm({ ...parserForm, data_end_column: event.target.value.toUpperCase() })} /></label>
              <div className="config-form__wide">
                <span>字段结构</span>
                <div className="column-preview">
                  <div className="column-preview__header">
                    <strong>{parserForm.detected_columns.length} 个字段</strong>
                    <span className="state-text">通过样本校准自动识别，不需要手工做英文映射</span>
                  </div>
                  <div className="table-shell">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>列</th>
                          <th>Excel 标题</th>
                          <th>物理字段</th>
                          <th>样例值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parserForm.detected_columns.length === 0 ? (
                          <tr><td colSpan={4} className="table-empty">请先打开样本校准，系统会自动识别字段结构</td></tr>
                        ) : (
                          parserForm.detected_columns.map((column) => (
                            <tr key={`${column.field_name}-${column.column_index}`}>
                              <td>{column.column_letter}</td>
                              <td>{column.header_name}</td>
                              <td className="cell-code">{column.field_name}</td>
                              <td>{column.sample_value || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="config-form__wide">
                <div className="column-preview">
                  <div className="column-preview__header">
                    <strong>固定字段</strong>
                    <button type="button" className="ghost-button" onClick={handleAddFixedField}>新增固定字段</button>
                  </div>
                  <div className="table-shell">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>启用</th>
                          <th>字段名</th>
                          <th>字段值</th>
                          <th>值跟随 Excel</th>
                          <th>字段名来源</th>
                          <th>字段值来源</th>
                          <th>物理字段</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parserForm.fixed_fields.length === 0 ? (
                          <tr><td colSpan={8} className="table-empty">样本校准识别后可直接勾选，也可手动新增</td></tr>
                        ) : (
                          parserForm.fixed_fields.map((field, index) => (
                            <tr key={`${field.field_key}-${index}`}>
                              <td><input type="checkbox" checked={field.is_enabled} onChange={() => handleToggleFixedField(index)} /></td>
                              <td><input value={field.field_name} onChange={(event) => handleFixedFieldChange(index, 'field_name', event.target.value)} /></td>
                              <td><input value={field.field_value} disabled={field.follow_excel_value} onChange={(event) => handleFixedFieldChange(index, 'field_value', event.target.value)} /></td>
                              <td><input type="checkbox" checked={field.follow_excel_value} onChange={() => handleToggleFollowExcelValue(index)} /></td>
                              <td><input value={field.field_name_source ?? ''} onChange={(event) => handleFixedFieldChange(index, 'field_name_source', event.target.value)} placeholder="A8 或直接留空" /></td>
                              <td><input value={field.field_value_source ?? ''} onChange={(event) => handleFixedFieldChange(index, 'field_value_source', event.target.value)} placeholder="B7 或直接留空" /></td>
                              <td><input className="cell-code-input" value={field.field_key} onChange={(event) => handleFixedFieldChange(index, 'field_key', event.target.value)} /></td>
                              <td><button type="button" className="text-button" onClick={() => handleRemoveFixedField(index)}>删除</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <label className="config-form__wide"><span>备注</span><input value={parserForm.remark} onChange={(event) => setParserForm({ ...parserForm, remark: event.target.value })} /></label>
              <label className="checkbox-field"><input type="checkbox" checked={parserForm.ignore_empty_row} onChange={(event) => setParserForm({ ...parserForm, ignore_empty_row: event.target.checked })} /><span>忽略空行</span></label>
              {parserFormError ? <p className="state-text state-text--error">{parserFormError}</p> : null}
              <div className="form-actions form-actions--sticky"><button className="primary-button" type="submit" disabled={isSavingParser}>{isSavingParser ? '保存中...' : '保存'}</button></div>
            </form>
          </section>
        </div>
      ) : null}

      {parserDialogMode === 'sample' ? (
        <div className="dialog-backdrop" onClick={() => setParserDialogMode(null)}>
          <section className="dialog-panel dialog-panel--wide" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <h2>样本校准</h2>
              <div className="toolbar-actions">
                <button type="button" className="ghost-button" onClick={() => setParserDialogMode('form')}>返回表单</button>
                <button type="button" className="ghost-button" onClick={() => setParserDialogMode(null)}>关闭</button>
              </div>
            </div>
            <label className="upload-box"><input type="file" accept=".xlsx,.xlsm,.xltx,.xltm" onChange={handlePreviewFile} /><span>{selectedFileName || '选择 Excel 文件'}</span></label>
            {sampleError ? <p className="state-text state-text--error">{sampleError}</p> : null}
            {isPreviewingSample ? <p className="state-text">正在解析...</p> : null}
            {preview ? (
              <div className="preview-panel preview-panel--sample">
                <div className="selection-status">
                  <div className="selection-status__item">
                    <span>Sheet</span>
                    <strong>{preview.selected_sheet_name}</strong>
                  </div>
                  <div className="selection-status__item">
                    <span>标题行</span>
                    <strong>{parserForm.header_row_index}</strong>
                  </div>
                  <div className="selection-status__item">
                    <span>起始行</span>
                    <strong>{parserForm.data_start_row_index}</strong>
                  </div>
                  <div className="selection-status__item">
                    <span>结束列</span>
                    <strong>{parserForm.data_end_column}</strong>
                  </div>
                </div>
                <div className="preview-meta">
                  <span>
                    当前预览 {preview.rows.length} 行 / {previewColumnCount} 列
                  </span>
                  <span>
                    原表 {preview.sheet_max_rows} 行 / {preview.sheet_max_columns} 列
                  </span>
                  {preview.is_truncated_rows || preview.is_truncated_columns ? (
                    <span className="preview-meta__warn">
                      当前为截断预览，仅用于快速校准
                    </span>
                  ) : null}
                </div>
                {calibrationSuggestion ? (
                  <div className="recommend-bar">
                    <span>
                      推荐: 标题行 {calibrationSuggestion.headerRowIndex} / 起始行 {calibrationSuggestion.dataStartRowIndex} / 结束列 {calibrationSuggestion.dataEndColumn}
                    </span>
                    <button type="button" className="ghost-button" onClick={applyCalibrationSuggestion}>
                      一键套用
                    </button>
                  </div>
                ) : null}
                <div className="column-preview sample-card">
                  <div className="column-preview__header">
                    <strong>自动识别字段</strong>
                    <span className="state-text">{activeDetectedColumns.length} 个字段</span>
                  </div>
                  <div className="table-shell table-shell--sample-meta">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>列</th>
                          <th>Excel 标题</th>
                          <th>物理字段</th>
                          <th>样例值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDetectedColumns.map((column) => (
                          <tr key={`${column.field_name}-${column.column_index}`}>
                            <td>{column.column_letter}</td>
                            <td>{column.header_name}</td>
                            <td className="cell-code">{column.field_name}</td>
                            <td>{column.sample_value || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="column-preview sample-card">
                  <div className="column-preview__header">
                    <strong>固定字段</strong>
                    <div className="toolbar-actions">
                      <button type="button" className="ghost-button" onClick={handleAddFixedField}>新增固定字段</button>
                    </div>
                  </div>
                  <div className="table-shell table-shell--sample-meta">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>启用</th>
                          <th>字段名</th>
                          <th>字段值</th>
                          <th>值跟随 Excel</th>
                          <th>字段名来源</th>
                          <th>字段值来源</th>
                          <th>物理字段</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parserForm.fixed_fields.length === 0 ? (
                          <tr><td colSpan={8} className="table-empty">当前未识别到固定字段，可手动新增或填写单元格引用</td></tr>
                        ) : (
                          parserForm.fixed_fields.map((field, index) => (
                            <tr key={`${field.field_key}-${index}`}>
                              <td><input type="checkbox" checked={field.is_enabled} onChange={() => handleToggleFixedField(index)} /></td>
                              <td><input value={field.field_name} onChange={(event) => handleFixedFieldChange(index, 'field_name', event.target.value)} /></td>
                              <td><input value={field.field_value} disabled={field.follow_excel_value} onChange={(event) => handleFixedFieldChange(index, 'field_value', event.target.value)} /></td>
                              <td><input type="checkbox" checked={field.follow_excel_value} onChange={() => handleToggleFollowExcelValue(index)} /></td>
                              <td><input value={field.field_name_source ?? ''} onChange={(event) => handleFixedFieldChange(index, 'field_name_source', event.target.value)} placeholder="A8" /></td>
                              <td><input value={field.field_value_source ?? ''} onChange={(event) => handleFixedFieldChange(index, 'field_value_source', event.target.value)} placeholder="B7" /></td>
                              <td><input className="cell-code-input" value={field.field_key} onChange={(event) => handleFixedFieldChange(index, 'field_key', event.target.value)} /></td>
                              <td><button type="button" className="text-button" onClick={() => handleRemoveFixedField(index)}>删除</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="selection-toolbar">
                  <div className="selection-toolbar__intro">
                    <strong>{getSelectionModeLabel(selectionMode)}</strong>
                  </div>
                  <div className="selection-toolbar__actions">
                    <button type="button" className={`tool-button ${selectionMode === 'header' ? 'tool-button--active' : ''}`} onClick={() => setSelectionMode('header')}>标题行</button>
                    <button type="button" className={`tool-button ${selectionMode === 'dataStart' ? 'tool-button--active' : ''}`} onClick={() => setSelectionMode('dataStart')}>数据起始行</button>
                    <button type="button" className={`tool-button ${selectionMode === 'endColumn' ? 'tool-button--active' : ''}`} onClick={() => setSelectionMode('endColumn')}>结束列</button>
                  </div>
                </div>
                <div className="table-shell table-shell--sample-preview">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th className="preview-table__corner">行</th>
                        {Array.from({ length: previewColumnCount }).map((_, columnIndex) => (
                          <th key={`column-head-${columnIndex}`} className="preview-table__header-cell">
                            <button
                              type="button"
                              className={`column-marker ${parserForm.data_end_column === toColumnLetter(columnIndex) ? 'column-marker--active' : ''} ${selectionMode === 'endColumn' ? 'column-marker--selectable' : ''}`}
                              onClick={() => handlePreviewColumnSelect(columnIndex)}
                            >
                              {toColumnLetter(columnIndex)}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, rowIndex) => (
                        <tr key={`row-${rowIndex}`}>
                          <td className={`preview-table__index ${parserForm.header_row_index === rowIndex + 1 ? 'preview-table__index--header' : ''} ${parserForm.data_start_row_index === rowIndex + 1 ? 'preview-table__index--data' : ''}`}>
                            <button type="button" className={`row-marker ${selectionMode === 'header' || selectionMode === 'dataStart' ? 'row-marker--selectable' : ''}`} onClick={() => handlePreviewRowSelect(rowIndex)}>
                              {rowIndex + 1}
                            </button>
                          </td>
                          {Array.from({ length: previewColumnCount }).map((_, cellIndex) => (
                            <td key={`cell-${rowIndex}-${cellIndex}`}>
                              <button
                                type="button"
                                className={`cell-button ${parserForm.data_end_column === toColumnLetter(cellIndex) ? 'cell-button--selected' : ''} ${selectionMode === 'endColumn' ? 'cell-button--selectable' : ''}`}
                                onClick={() => handlePreviewColumnSelect(cellIndex)}
                              >
                                <span className="cell-button__value">{row[cellIndex] === null || row[cellIndex] === undefined ? '' : String(row[cellIndex])}</span>
                              </button>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <div className="table-empty table-empty--panel">上传文件后显示预览</div>}
          </section>
        </div>
      ) : null}
      {templateDialogMode === 'detail' && selectedTemplateRule ? (
        <div className="dialog-backdrop" onClick={() => setTemplateDialogMode(null)}>
          <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header"><h2>规则详情</h2><button type="button" className="ghost-button" onClick={() => setTemplateDialogMode(null)}>关闭</button></div>
            <dl className="detail-grid">
              <div><dt>规则名称</dt><dd>{selectedTemplateRule.rule_name}</dd></div>
              <div><dt>规则编码</dt><dd>{selectedTemplateRule.rule_code}</dd></div>
              <div><dt>分类</dt><dd>{selectedTemplateRule.group_name}</dd></div>
              <div><dt>来源 Sheet</dt><dd>{selectedTemplateRule.source_sheet_name}</dd></div>
              <div><dt>版本</dt><dd>{selectedTemplateRule.version}</dd></div>
              <div><dt>状态</dt><dd>{selectedTemplateRule.status}</dd></div>
              <div><dt>描述</dt><dd>{selectedTemplateRule.description || '-'}</dd></div>
            </dl>
            <section className="detail-section">
              <h3>规则项</h3>
              <div className="key-value-grid">
                {Object.entries(selectedTemplateRule.rule_item).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value || '-'}</dd>
                  </div>
                ))}
              </div>
            </section>
            <section className="detail-section">
              <h3>导出配置</h3>
              <div className="stack-list">
                {selectedTemplateOutputs.map((output) => (
                  <article key={output.output_key} className="config-card">
                    <div className="config-card__title">{`${output.sheet_name} (${output.output_key})`}</div>
                    <div className="config-card__meta">{`${output.source_type} | 字段 ${output.fields.length} 个 | 过滤 ${output.filters.length} 条`}</div>
                    {output.group_by_fields.length > 0 ? <div className="config-card__meta">{`分组: ${output.group_by_fields.join('、')}`}</div> : null}
                    {output.aggregations.length > 0 ? <div className="config-card__meta">{`聚合: ${output.aggregations.map((item) => `${item.alias}:${item.aggregate_func}`).join('；')}`}</div> : null}
                  </article>
                ))}
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {templateDialogMode === 'form' ? (
        <div className="dialog-backdrop" onClick={() => setTemplateDialogMode(null)}>
          <section className="dialog-panel dialog-panel--wide" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header"><h2>{editingTemplateRuleId ? '编辑模板规则' : '新建模板规则'}</h2><button type="button" className="ghost-button" onClick={() => setTemplateDialogMode(null)}>关闭</button></div>
            <form className="config-form" onSubmit={handleSaveTemplate}>
              <label><span>规则编码</span><input value={templateForm.rule_code} onChange={(event) => setTemplateForm({ ...templateForm, rule_code: event.target.value })} required /></label>
              <label><span>规则名称</span><input value={templateForm.rule_name} onChange={(event) => setTemplateForm({ ...templateForm, rule_name: event.target.value })} required /></label>
              <label><span>规则分类</span><input value={templateForm.group_name} onChange={(event) => setTemplateForm({ ...templateForm, group_name: event.target.value })} required /></label>
              <label><span>来源 Sheet</span><input value={templateForm.source_sheet_name} onChange={(event) => setTemplateForm({ ...templateForm, source_sheet_name: event.target.value })} required /></label>
              <label className="config-form__wide"><span>描述</span><input value={templateForm.description} onChange={(event) => setTemplateForm({ ...templateForm, description: event.target.value })} /></label>
              <div className="config-form__wide editor-block">
                <div className="editor-block__header">
                  <h3>规则项</h3>
                  <button type="button" className="ghost-button" onClick={handleAddTemplateRuleItem}>新增字段</button>
                </div>
                <div className="stack-list">
                  {Object.entries(templateForm.rule_item).map(([key, value]) => (
                    <div key={key} className="inline-grid">
                      <input value={key} onChange={(event) => handleTemplateRuleItemRename(key, event.target.value)} placeholder="字段名" />
                      <input value={value} onChange={(event) => handleTemplateRuleItemChange(key, event.target.value)} placeholder="字段值" />
                      <button type="button" className="ghost-button" onClick={() => handleTemplateRuleItemRemove(key)}>删除</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="config-form__wide editor-block">
                <div className="editor-block__header">
                  <h3>导出配置</h3>
                  <button type="button" className="ghost-button" onClick={handleAddTemplateOutput}>新增输出</button>
                </div>
                <div className="stack-list">
                  {templateForm.outputs.map((output, outputIndex) => (
                    <article key={`${output.output_key}-${outputIndex}`} className="config-card">
                      <div className="config-card__header">
                        <strong>{`输出 ${outputIndex + 1}`}</strong>
                        <button type="button" className="ghost-button" onClick={() => handleRemoveTemplateOutput(outputIndex)} disabled={templateForm.outputs.length <= 1}>删除输出</button>
                      </div>
                      <div className="config-form config-form--nested">
                        <label><span>输出标识</span><input value={output.output_key} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, output_key: event.target.value }))} required /></label>
                        <label><span>Sheet 名称</span><input value={output.sheet_name} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, sheet_name: event.target.value }))} required /></label>
                        <label><span>数据类型</span><select value={output.source_type} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, source_type: event.target.value }))}>
                          <option value="filtered_detail">明细输出</option>
                          <option value="aggregated_summary">汇总输出</option>
                        </select></label>
                        <label className="config-form__wide"><span>标题行</span><input value={output.title_rows.join(' | ')} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, title_rows: event.target.value.split('|').map((item) => item.trim()).filter(Boolean) }))} placeholder="多行标题用 | 分隔" /></label>
                      </div>
                      <div className="editor-subsection">
                        <div className="editor-block__header">
                          <h4>输出字段</h4>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => updateTemplateOutput(outputIndex, (current) => ({
                              ...current,
                              fields: [...current.fields, createEmptyOutputField(current.fields.length + 1)],
                            }))}
                          >
                            新增字段
                          </button>
                        </div>
                        <div className="stack-list">
                          {output.fields.map((field, fieldIndex) => (
                            <div key={`${output.output_key}-field-${fieldIndex}`} className="inline-grid inline-grid--wide">
                              <input value={field.field_name} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, fields: current.fields.map((item, index) => index === fieldIndex ? { ...item, field_name: event.target.value } : item) }))} placeholder="字段名" />
                              <input value={field.display_name} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, fields: current.fields.map((item, index) => index === fieldIndex ? { ...item, display_name: event.target.value } : item) }))} placeholder="显示名" />
                              <button type="button" className="ghost-button" onClick={() => updateTemplateOutput(outputIndex, (current) => ({ ...current, fields: current.fields.filter((_, index) => index !== fieldIndex).map((item, index) => ({ ...item, field_order: index + 1 })) }))}>删除</button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="editor-subsection">
                        <div className="editor-block__header">
                          <h4>过滤条件</h4>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => updateTemplateOutput(outputIndex, (current) => ({
                              ...current,
                              filters: [...current.filters, createEmptyFilter()],
                            }))}
                          >
                            新增过滤
                          </button>
                        </div>
                        <div className="stack-list">
                          {output.filters.map((filter, filterIndex) => (
                            <div key={`${output.output_key}-filter-${filterIndex}`} className="inline-grid inline-grid--wider">
                              <input value={filter.field_name} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, field_name: event.target.value } : item) }))} placeholder="字段名" />
                              <select value={filter.operator} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, operator: event.target.value } : item) }))}>
                                <option value="eq">等于</option>
                                <option value="contains">包含</option>
                                <option value="neq">不等于</option>
                                <option value="gt">大于</option>
                                <option value="gte">大于等于</option>
                                <option value="lt">小于</option>
                                <option value="lte">小于等于</option>
                                <option value="month_eq">月份等于</option>
                              </select>
                              <input value={filter.value || ''} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, value: event.target.value } : item) }))} placeholder="固定值" />
                              <input value={filter.value_template || ''} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, value_template: event.target.value } : item) }))} placeholder="模板值，如 ${银行名称}" />
                              <button type="button" className="ghost-button" onClick={() => updateTemplateOutput(outputIndex, (current) => ({ ...current, filters: current.filters.filter((_, index) => index !== filterIndex) }))}>删除</button>
                            </div>
                          ))}
                        </div>
                      </div>
                      {output.source_type === 'aggregated_summary' ? (
                        <div className="editor-subsection">
                          <label className="config-form__wide"><span>分组字段</span><input value={output.group_by_fields.join(', ')} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, group_by_fields: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} placeholder="商户号, 商户名" /></label>
                          <div className="editor-block__header">
                            <h4>聚合字段</h4>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => updateTemplateOutput(outputIndex, (current) => ({
                                ...current,
                                aggregations: [...current.aggregations, createEmptyAggregation()],
                              }))}
                            >
                              新增聚合
                            </button>
                          </div>
                          <div className="stack-list">
                            {output.aggregations.map((aggregation, aggregationIndex) => (
                              <div key={`${output.output_key}-aggregation-${aggregationIndex}`} className="inline-grid inline-grid--wide">
                                <input value={aggregation.field_name} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, aggregations: current.aggregations.map((item, index) => index === aggregationIndex ? { ...item, field_name: event.target.value } : item) }))} placeholder="字段名" />
                                <select value={aggregation.aggregate_func} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, aggregations: current.aggregations.map((item, index) => index === aggregationIndex ? { ...item, aggregate_func: event.target.value } : item) }))}>
                                  <option value="sum">sum</option>
                                  <option value="count">count</option>
                                  <option value="max">max</option>
                                  <option value="min">min</option>
                                </select>
                                <input value={aggregation.alias} onChange={(event) => updateTemplateOutput(outputIndex, (current) => ({ ...current, aggregations: current.aggregations.map((item, index) => index === aggregationIndex ? { ...item, alias: event.target.value } : item) }))} placeholder="输出别名" />
                                <button type="button" className="ghost-button" onClick={() => updateTemplateOutput(outputIndex, (current) => ({ ...current, aggregations: current.aggregations.filter((_, index) => index !== aggregationIndex) }))}>删除</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
              {templateFormError ? <p className="state-text state-text--error">{templateFormError}</p> : null}
              <div className="form-actions"><button className="primary-button" type="submit" disabled={isSavingTemplate}>{isSavingTemplate ? '保存中...' : '保存'}</button></div>
            </form>
          </section>
        </div>
      ) : null}

      {templateDialogMode === 'import' ? (
        <div className="dialog-backdrop" onClick={() => setTemplateDialogMode(null)}>
          <section className="dialog-panel dialog-panel--import" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header"><h2>导入规则模板</h2><button type="button" className="ghost-button" onClick={() => setTemplateDialogMode(null)}>关闭</button></div>
            <div className="stack-list">
              <label className="config-form__wide">
                <span>规则模板 Excel</span>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      setSelectedImportSheets([])
                      setTemplateImportRuleItemRowMap({})
                      setTemplateImportOutputFieldRowMap({})
                      setTemplateImportRuleItemColumnsMap({})
                      setTemplateImportOutputFieldColumnsMap({})
                      setTemplateImportOutputOverrides({})
                      setTemplateImportSelectionMode(null)
                      void handlePreviewTemplateImportFile(file)
                    }
                  }}
                />
              </label>
              {isImportPreviewingTemplate ? <p className="state-text">正在解析规则模板...</p> : null}
              {templateImportError ? <p className="state-text state-text--error">{templateImportError}</p> : null}
              {templateImportPreview ? (
                <div className="stack-list">
                  <div className="config-card">
                    <div className="config-form config-form--nested">
                      <label>
                        <span>当前 Sheet</span>
                        <div className="sheet-switcher">
                          {templateImportPreview.sheet_names.map((sheetName) => (
                            <button
                              key={sheetName}
                              type="button"
                              className={sheetName === templateImportActiveSheet ? 'sheet-switcher__button sheet-switcher__button--active' : 'sheet-switcher__button'}
                              onClick={() => {
                                setTemplateImportActiveSheet(sheetName)
                                setTemplateImportSelectionMode(null)
                                void refreshTemplateImportPreview({ sheetName })
                              }}
                            >
                              {sheetName}
                            </button>
                          ))}
                        </div>
                      </label>
                      <label>
                        <span>规则项字段行</span>
                        <input value={activeTemplateImportRuleItemRowIndex ?? ''} readOnly placeholder="点击下方行号选择" />
                      </label>
                      <label>
                        <span>导出项字段行</span>
                        <input value={activeTemplateImportOutputFieldRowIndex ?? ''} readOnly placeholder="点击下方行号选择" />
                      </label>
                    </div>
                    <div className="editor-block__header">
                      <h3>Sheet 勾选</h3>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setSelectedImportSheets(templateImportPreview.sheet_names)}
                      >
                        全选
                      </button>
                    </div>
                    <div className="stack-list">
                      {templateImportPreview.sheets.map((sheet) => (
                        <label key={sheet.sheet_name} className="checkbox-inline">
                          <input
                            type="checkbox"
                            checked={selectedImportSheets.includes(sheet.sheet_name)}
                            onChange={(event) => setSelectedImportSheets((current) => event.target.checked ? [...current, sheet.sheet_name] : current.filter((item) => item !== sheet.sheet_name))}
                          />
                          <span>{`${sheet.sheet_name}（规则 ${sheet.rule_count} 条）`}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="config-card">
                    <div className="editor-block__header">
                      <h3>规则项字段</h3>
                      <div className="toolbar-actions">
                        <span className="config-card__meta">先点“选择规则项字段行”，再勾选这一行里的字段名</span>
                        <button type="button" className={templateImportSelectionMode === 'rule_item_row' ? 'tool-button tool-button--active' : 'tool-button'} onClick={() => setTemplateImportSelectionMode('rule_item_row')}>
                          选择规则项字段行
                        </button>
                      </div>
                    </div>
                    <div className="stack-list">
                      {templateImportPreview.rule_item_field_candidates.map((candidate) => (
                        <label key={`template-import-rule-item-column-${candidate.column_index}`} className="checkbox-inline">
                          <input
                            type="checkbox"
                            checked={activeTemplateImportRuleItemColumns.includes(candidate.column_index)}
                            onChange={() => toggleTemplateImportRuleItemColumn(candidate.column_index)}
                          />
                          <span>{`${candidate.column_letter} 列 · ${candidate.field_name}`}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="config-card">
                    <div className="editor-block__header">
                      <h3>导出项字段</h3>
                      <div className="toolbar-actions">
                        <span className="config-card__meta">先点“选择导出项字段行”，再勾选这一行里的字段名</span>
                        <button type="button" className={templateImportSelectionMode === 'output_field_row' ? 'tool-button tool-button--active' : 'tool-button'} onClick={() => setTemplateImportSelectionMode('output_field_row')}>
                          选择导出项字段行
                        </button>
                      </div>
                    </div>
                    <div className="stack-list">
                      {templateImportPreview.output_field_candidates.map((candidate) => (
                        <label key={`template-import-output-column-${candidate.column_index}`} className="checkbox-inline">
                          <input
                            type="checkbox"
                            checked={activeTemplateImportOutputFieldColumns.includes(candidate.column_index)}
                            onChange={() => toggleTemplateImportOutputFieldColumn(candidate.column_index)}
                          />
                          <span>{`${candidate.column_letter} 列 · ${candidate.field_name}`}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="config-card">
                    <div className="editor-block__header">
                      <h3>规则项示例</h3>
                      <span className="config-card__meta">当前 Sheet 的首条样例规则</span>
                    </div>
                    <div className="key-value-grid">
                      {Object.entries(activeTemplateImportSampleRule?.rule_item ?? {}).map(([key, value]) => (
                        <div key={`template-import-rule-item-${key}`}>
                          <dt>{key}</dt>
                          <dd>{value || '-'}</dd>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="config-card">
                    <div className="editor-block__header">
                      <h3>导入预设配置</h3>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          if (!templateImportActiveSheet) {
                            return
                          }
                          handleAddTemplateImportOutput(templateImportActiveSheet)
                        }}
                        disabled={!templateImportActiveSheet}
                      >
                        新增输出
                      </button>
                    </div>
                    <div className="stack-list">
                      {activeTemplateImportOutputs.map((output, outputIndex) => (
                        <article key={`template-import-output-${output.output_key}-${outputIndex}`} className="config-card">
                          <div className="config-card__header">
                            <strong>{`输出 ${outputIndex + 1}`}</strong>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => templateImportActiveSheet && handleRemoveTemplateImportOutput(templateImportActiveSheet, outputIndex)}
                              disabled={!templateImportActiveSheet || activeTemplateImportOutputs.length <= 1}
                            >
                              删除输出
                            </button>
                          </div>
                          <div className="config-form config-form--nested">
                            <label><span>输出标识</span><input value={output.output_key} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, output_key: event.target.value }))} /></label>
                            <label><span>Sheet 名称</span><input value={output.sheet_name} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, sheet_name: event.target.value }))} /></label>
                            <label><span>数据类型</span><select value={output.source_type} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, source_type: event.target.value }))}>
                              <option value="filtered_detail">明细输出</option>
                              <option value="aggregated_summary">汇总输出</option>
                            </select></label>
                            <label className="config-form__wide"><span>标题行</span><input value={output.title_rows.join(' | ')} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, title_rows: event.target.value.split('|').map((item) => item.trim()).filter(Boolean) }))} placeholder="多行标题用 | 分隔" /></label>
                          </div>
                          <div className="editor-subsection">
                            <div className="editor-block__header">
                              <h4>输出字段</h4>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({
                                  ...current,
                                  fields: [...current.fields, createEmptyOutputField(current.fields.length + 1)],
                                }))}
                              >
                                新增字段
                              </button>
                            </div>
                            <div className="stack-list">
                              {output.fields.map((field, fieldIndex) => (
                                <div key={`template-import-output-field-${outputIndex}-${fieldIndex}`} className="inline-grid inline-grid--wide">
                                  <input value={field.field_name} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, fields: current.fields.map((item, index) => index === fieldIndex ? { ...item, field_name: event.target.value } : item) }))} placeholder="字段名" />
                                  <input value={field.display_name} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, fields: current.fields.map((item, index) => index === fieldIndex ? { ...item, display_name: event.target.value } : item) }))} placeholder="显示名" />
                                  <button type="button" className="ghost-button" onClick={() => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, fields: current.fields.filter((_, index) => index !== fieldIndex).map((item, index) => ({ ...item, field_order: index + 1 })) }))}>删除</button>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="editor-subsection">
                            <div className="editor-block__header">
                              <h4>过滤条件</h4>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({
                                  ...current,
                                  filters: [...current.filters, createEmptyFilter()],
                                }))}
                              >
                                新增过滤
                              </button>
                            </div>
                            <div className="stack-list">
                              {output.filters.map((filter, filterIndex) => (
                                <div key={`template-import-output-filter-${outputIndex}-${filterIndex}`} className="inline-grid inline-grid--wider">
                                  <input value={filter.field_name} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, field_name: event.target.value } : item) }))} placeholder="字段名" />
                                  <select value={filter.operator} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, operator: event.target.value } : item) }))}>
                                    <option value="eq">等于</option>
                                    <option value="contains">包含</option>
                                    <option value="neq">不等于</option>
                                    <option value="gt">大于</option>
                                    <option value="gte">大于等于</option>
                                    <option value="lt">小于</option>
                                    <option value="lte">小于等于</option>
                                    <option value="month_eq">月份等于</option>
                                  </select>
                                  <input value={filter.value || ''} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, value: event.target.value } : item) }))} placeholder="固定值" />
                                  <input value={filter.value_template || ''} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, value_template: event.target.value } : item) }))} placeholder="模板值，如 ${银行名称}" />
                                  <button type="button" className="ghost-button" onClick={() => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, filters: current.filters.filter((_, index) => index !== filterIndex) }))}>删除</button>
                                </div>
                              ))}
                            </div>
                          </div>
                          {output.source_type === 'aggregated_summary' ? (
                            <div className="editor-subsection">
                              <label className="config-form__wide"><span>分组字段</span><input value={output.group_by_fields.join(', ')} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, group_by_fields: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} placeholder="商户号, 商户名" /></label>
                              <div className="editor-block__header">
                                <h4>聚合字段</h4>
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({
                                    ...current,
                                    aggregations: [...current.aggregations, createEmptyAggregation()],
                                  }))}
                                >
                                  新增聚合
                                </button>
                              </div>
                              <div className="stack-list">
                                {output.aggregations.map((aggregation, aggregationIndex) => (
                                  <div key={`template-import-output-aggregation-${outputIndex}-${aggregationIndex}`} className="inline-grid inline-grid--wide">
                                    <input value={aggregation.field_name} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, aggregations: current.aggregations.map((item, index) => index === aggregationIndex ? { ...item, field_name: event.target.value } : item) }))} placeholder="字段名" />
                                    <select value={aggregation.aggregate_func} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, aggregations: current.aggregations.map((item, index) => index === aggregationIndex ? { ...item, aggregate_func: event.target.value } : item) }))}>
                                      <option value="sum">sum</option>
                                      <option value="count">count</option>
                                      <option value="max">max</option>
                                      <option value="min">min</option>
                                    </select>
                                    <input value={aggregation.alias} onChange={(event) => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, aggregations: current.aggregations.map((item, index) => index === aggregationIndex ? { ...item, alias: event.target.value } : item) }))} placeholder="输出别名" />
                                    <button type="button" className="ghost-button" onClick={() => templateImportActiveSheet && updateTemplateImportOutput(templateImportActiveSheet, outputIndex, (current) => ({ ...current, aggregations: current.aggregations.filter((_, index) => index !== aggregationIndex) }))}>删除</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="config-card">
                    <div className="editor-block__header">
                      <h3>规则预览表</h3>
                      <span className="config-card__meta">点左侧行号选择“规则项字段行”或“导出项字段行”</span>
                    </div>
                    <div className="table-shell table-shell--detail template-import-grid">
                      <table className="admin-table admin-table--sticky">
                        <thead>
                          <tr>
                            <th>#</th>
                            {Array.from({ length: templateImportPreview.max_columns }, (_, index) => (
                              <th key={`template-import-col-${index}`}>{toColumnLetter(index)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {templateImportPreview.rows.map((row, rowIndex) => (
                            <tr
                              key={`template-import-row-${rowIndex}`}
                              className={
                                activeTemplateImportRuleItemRowIndex === rowIndex + 1 || activeTemplateImportOutputFieldRowIndex === rowIndex + 1
                                  ? 'preview-row--selected'
                                  : ''
                              }
                            >
                              <td>
                                <button type="button" className="text-button" onClick={() => handleSelectTemplateImportRow(rowIndex)}>
                                  {rowIndex + 1}
                                </button>
                              </td>
                              {Array.from({ length: templateImportPreview.max_columns }, (_, columnIndex) => {
                                const cellValue = row[columnIndex] ?? ''
                                const isRuleItemField = activeTemplateImportRuleItemColumns.includes(columnIndex)
                                const isOutputField = activeTemplateImportOutputFieldColumns.includes(columnIndex)
                                return (
                                  <td
                                    key={`template-import-cell-${rowIndex}-${columnIndex}`}
                                    className={
                                      (isRuleItemField && activeTemplateImportRuleItemRowIndex === rowIndex + 1)
                                      || (isOutputField && activeTemplateImportOutputFieldRowIndex === rowIndex + 1)
                                        ? 'preview-cell--column-selected'
                                        : ''
                                    }
                                  >
                                    <button type="button" className="cell-button">
                                      {cellValue}
                                    </button>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="config-card">
                    <div className="editor-block__header">
                      <h3>解析结果预估</h3>
                    </div>
                    <div className="stack-list">
                      {templateImportPreview.sheets.map((sheet) => (
                        <div key={`${sheet.sheet_name}-sample`} className="config-card__meta">
                          {`${sheet.sheet_name}：${sheet.rule_count} 条规则`}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="button" className="primary-button" disabled={isImportingTemplate} onClick={() => void handleCommitTemplateImport()}>
                      {isImportingTemplate ? '导入中...' : '确认导入'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="dialog-backdrop" onClick={() => setConfirmDialog(null)}>
          <section className="dialog-panel dialog-panel--compact" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <h2>{confirmDialog.title}</h2>
              <button type="button" className="ghost-button" onClick={() => setConfirmDialog(null)}>关闭</button>
            </div>
            <p className="confirm-message">{confirmDialog.message}</p>
            <div className="form-actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmDialog(null)} disabled={isConfirmingAction}>取消</button>
              <button type="button" className="primary-button" onClick={() => void handleConfirmAction()} disabled={isConfirmingAction}>
                {isConfirmingAction ? '处理中...' : confirmDialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default App
