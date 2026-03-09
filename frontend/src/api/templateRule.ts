import { deleteJson, getJson, postFormData, postJson, putJson } from './client'
import type {
  TemplateRuleCreatePayload,
  TemplateRuleImportPreviewResult,
  TemplateRulePageResult,
  TemplateRuleSet,
} from '../types'

export async function fetchTemplateRules(page = 1, pageSize = 20, keyword = ''): Promise<TemplateRulePageResult> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  if (keyword.trim()) {
    query.set('keyword', keyword.trim())
  }
  const data = await getJson<TemplateRulePageResult | TemplateRuleSet[]>(`/template-rules?${query.toString()}`)
  if (Array.isArray(data)) {
    const total = data.length
    return {
      items: data,
      page: 1,
      page_size: total || pageSize,
      total,
      total_pages: 1,
    }
  }
  return data
}

export function createTemplateRule(payload: TemplateRuleCreatePayload): Promise<TemplateRuleSet> {
  return postJson<TemplateRuleCreatePayload, TemplateRuleSet>('/template-rules', payload)
}

export function updateTemplateRule(
  ruleId: number,
  payload: Partial<TemplateRuleCreatePayload>,
): Promise<TemplateRuleSet> {
  return putJson<Partial<TemplateRuleCreatePayload>, TemplateRuleSet>(`/template-rules/${ruleId}`, payload)
}

export function deleteTemplateRule(ruleId: number): Promise<{ deleted: boolean }> {
  return deleteJson<{ deleted: boolean }>(`/template-rules/${ruleId}`)
}

export function batchDeleteTemplateRules(ruleIds: number[]): Promise<{ deleted_count: number }> {
  return postJson<{ rule_ids: number[] }, { deleted_count: number }>('/template-rules/batch-delete', {
    rule_ids: ruleIds,
  })
}

export function previewTemplateRuleImport(
  file: File,
  options?: {
    sheetName?: string
    ruleItemRowIndex?: number | null
    outputFieldRowIndex?: number | null
    ruleItemColumns?: number[]
    outputFieldColumns?: number[]
  },
): Promise<TemplateRuleImportPreviewResult> {
  const formData = new FormData()
  formData.append('file', file)
  if (options?.sheetName) {
    formData.append('sheet_name', options.sheetName)
  }
  if (options?.ruleItemRowIndex) {
    formData.append('rule_item_row_index', String(options.ruleItemRowIndex))
  }
  if (options?.outputFieldRowIndex) {
    formData.append('output_field_row_index', String(options.outputFieldRowIndex))
  }
  if (options?.ruleItemColumns) {
    formData.append('rule_item_columns_json', JSON.stringify(options.ruleItemColumns))
  }
  if (options?.outputFieldColumns) {
    formData.append('output_field_columns_json', JSON.stringify(options.outputFieldColumns))
  }
  return postFormData<TemplateRuleImportPreviewResult>('/template-rules/import-preview', formData)
}

export function commitTemplateRuleImport(
  file: File,
  selectedSheets: string[],
  sheetOptions?: Array<{
    sheet_name: string
    rule_item_row_index?: number
    output_field_row_index?: number
    rule_item_columns?: number[]
    output_field_columns?: number[]
    outputs?: TemplateRuleCreatePayload['outputs']
  }>,
): Promise<TemplateRuleSet[]> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('selected_sheets', JSON.stringify({ selected_sheets: selectedSheets, sheet_options: sheetOptions ?? [] }))
  return postFormData<TemplateRuleSet[]>('/template-rules/import-commit', formData)
}
