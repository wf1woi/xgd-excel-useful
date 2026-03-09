import { postBinary, postJson } from './client'
import type { ExportPreviewPayload, ExportPreviewResult } from '../types'

export function generateExportPreview(
  payload: ExportPreviewPayload,
): Promise<ExportPreviewResult> {
  return postJson<ExportPreviewPayload, ExportPreviewResult>('/exports/preview', payload)
}

export async function downloadExportExcel(payload: ExportPreviewPayload): Promise<void> {
  const { blob, fileName } = await postBinary('/exports/excel', payload)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
