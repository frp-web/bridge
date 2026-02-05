import type { WebSocket } from 'ws'
import type { RuntimeLogger } from '../runtime'
import { Buffer } from 'node:buffer'

export function normalizeWebSocketData(data: WebSocket.RawData): string {
  if (typeof data === 'string') {
    return data
  }
  if (Buffer.isBuffer(data)) {
    return data.toString()
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data)).toString()
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data.map(item => (Buffer.isBuffer(item) ? item : Buffer.from(item)))).toString()
  }
  return Buffer.from(data as Buffer).toString()
}

export function safeParse(
  data: WebSocket.RawData,
  logger?: Partial<RuntimeLogger>
): any | undefined {
  try {
    const text = normalizeWebSocketData(data)
    return JSON.parse(text)
  }
  catch (error) {
    logger?.warn?.('parse message failed', error as Record<string, unknown>)
    return undefined
  }
}
