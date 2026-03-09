import { deleteJson, getJson, postFormData } from './client'
import type { ImportBatch, ImportBatchCreateResult } from '../types'

export function fetchImportBatches(): Promise<ImportBatch[]> {
  return getJson<ImportBatch[]>('/import-batches')
}

export function createImportBatch(params: {
  parserConfigId: number
  batchCode?: string
  file: File
}): Promise<ImportBatchCreateResult> {
  const formData = new FormData()
  formData.append('parser_config_id', String(params.parserConfigId))
  if (params.batchCode) {
    formData.append('batch_code', params.batchCode)
  }
  formData.append('file', params.file)
  return postFormData<ImportBatchCreateResult>('/import-batches', formData)
}

export function deleteImportBatch(batchCode: string): Promise<{ deleted: boolean }> {
  return deleteJson<{ deleted: boolean }>(`/import-batches/${encodeURIComponent(batchCode)}`)
}
