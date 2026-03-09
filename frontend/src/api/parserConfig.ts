import { deleteJson, getJson, postFormData, postJson, putJson } from './client'
import type {
  ExcelPreview,
  ParserConfig,
  ParserConfigCreatePayload,
} from '../types'

export function fetchParserConfigs(): Promise<ParserConfig[]> {
  return getJson<ParserConfig[]>('/parser-configs')
}

export function createParserConfig(
  payload: ParserConfigCreatePayload,
): Promise<ParserConfig> {
  return postJson<ParserConfigCreatePayload, ParserConfig>('/parser-configs', payload)
}

export function updateParserConfig(
  configId: number,
  payload: ParserConfigCreatePayload,
): Promise<ParserConfig> {
  return putJson<ParserConfigCreatePayload, ParserConfig>(`/parser-configs/${configId}`, payload)
}

export function deleteParserConfig(configId: number): Promise<{ deleted: boolean }> {
  return deleteJson<{ deleted: boolean }>(`/parser-configs/${configId}`)
}

export function previewSampleExcel(params: {
  file: File
  sheetName?: string
  maxRows?: number
  maxColumns?: number
}): Promise<ExcelPreview> {
  const formData = new FormData()
  formData.append('file', params.file)
  if (params.sheetName) {
    formData.append('sheet_name', params.sheetName)
  }
  formData.append('max_rows', String(params.maxRows ?? 20))
  formData.append('max_columns', String(params.maxColumns ?? 30))

  return postFormData<ExcelPreview>('/parser-configs/sample-preview', formData)
}
