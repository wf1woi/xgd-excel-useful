import { getJson, postFormData } from './client'
import type { ImportTask } from '../types'

export function fetchImportTasks(): Promise<ImportTask[]> {
  return getJson<ImportTask[]>('/import-tasks')
}

export function createImportTask(params: {
  parserConfigId: number
  batchCode?: string
  file: File
}): Promise<ImportTask> {
  const formData = new FormData()
  formData.append('parser_config_id', String(params.parserConfigId))
  if (params.batchCode) {
    formData.append('batch_code', params.batchCode)
  }
  formData.append('file', params.file)
  return postFormData<ImportTask>('/import-tasks', formData)
}
