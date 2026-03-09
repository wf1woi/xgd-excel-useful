import { getJson } from './client'
import type { DetailRecordPageResult } from '../types'

export function fetchDetailRecords(params: {
  parserConfigId: number
  importBatchCode?: string
  page?: number
  pageSize?: number
  filterFieldName?: string
  filterKeyword?: string
}): Promise<DetailRecordPageResult> {
  const searchParams = new URLSearchParams()
  searchParams.set('parser_config_id', String(params.parserConfigId))
  if (params.importBatchCode) {
    searchParams.set('import_batch_code', params.importBatchCode)
  }
  searchParams.set('page', String(params.page ?? 1))
  searchParams.set('page_size', String(params.pageSize ?? 100))
  if (params.filterFieldName) {
    searchParams.set('filter_field_name', params.filterFieldName)
  }
  if (params.filterKeyword) {
    searchParams.set('filter_keyword', params.filterKeyword)
  }
  return getJson<DetailRecordPageResult>(`/detail-records?${searchParams.toString()}`)
}
