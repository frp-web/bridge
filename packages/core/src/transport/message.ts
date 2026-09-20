/**
 * ControlMessage 编解码 — WebSocket 帧内是 JSON 字符串。
 */

import type { ControlMessage } from '@frp-bridge/types'
import {
  isAck,
  isCommand,
  isEvent,
  isPing,
  isPong,
  isRegister,
  isSnapshot
} from '@frp-bridge/types'

export class ControlProtocolError extends Error {
  constructor(message: string, public readonly code: string = 'PROTOCOL_ERROR') {
    super(message)
    this.name = 'ControlProtocolError'
  }
}

export function encodeControlMessage(msg: ControlMessage): string {
  return JSON.stringify(msg)
}

export function decodeControlMessage(raw: string): ControlMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch (err) {
    throw new ControlProtocolError(`invalid json: ${(err as Error).message}`, 'PARSE_ERROR')
  }
  if (
    !isRegister(parsed)
    && !isCommand(parsed)
    && !isAck(parsed)
    && !isEvent(parsed)
    && !isSnapshot(parsed)
    && !isPing(parsed)
    && !isPong(parsed)
  ) {
    throw new ControlProtocolError('unknown control message type', 'UNKNOWN_TYPE')
  }
  return parsed
}
