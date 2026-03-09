export const apiBaseUrl = 'http://127.0.0.1:8000/api'

type ApiEnvelope<T> = {
  success: boolean
  message: string
  data: T
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T> | { detail?: string }
  if (!response.ok) {
    throw new Error('detail' in payload && payload.detail ? payload.detail : '请求失败')
  }
  return (payload as ApiEnvelope<T>).data
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`)
  return parseResponse<T>(response)
}

export async function postJson<TRequest, TResponse>(
  path: string,
  body: TRequest,
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return parseResponse<TResponse>(response)
}

export async function putJson<TRequest, TResponse>(
  path: string,
  body: TRequest,
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return parseResponse<TResponse>(response)
}

export async function deleteJson<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'DELETE',
  })
  return parseResponse<TResponse>(response)
}

export async function postFormData<TResponse>(
  path: string,
  body: FormData,
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    body,
  })
  return parseResponse<TResponse>(response)
}

export async function postBinary(
  path: string,
  body: unknown,
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = (await response.json()) as { detail?: string }
    throw new Error(payload.detail || '请求失败')
  }

  const disposition = response.headers.get('content-disposition') || ''
  const matched =
    disposition.match(/filename\*=utf-8''([^;]+)/i) ||
    disposition.match(/filename=\"?([^\";]+)\"?/)
  return {
    blob: await response.blob(),
    fileName: matched?.[1] ? decodeURIComponent(matched[1]) : 'export.xlsx',
  }
}
