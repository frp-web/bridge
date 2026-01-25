/**
 * Unit tests for RPC Message Types
 */

import { describe, expect, it } from 'vitest'
import {
  isPingMessage,
  isPongMessage,
  isRegisterMessage,
  isRpcRequest,
  isRpcResponse,
  RpcMessageType
} from '../../packages/core/src/rpc/message-types'

describe('rPC message types', () => {
  describe('type guards', () => {
    it('should identify register messages', () => {
      const msg = {
        type: 'register',
        nodeId: 'node-1',
        payload: { version: '1.0.0' }
      }
      expect(isRegisterMessage(msg)).toBe(true)
      expect(isRpcRequest(msg)).toBe(false)
      expect(isPingMessage(msg)).toBe(false)
    })

    it('should identify RPC requests', () => {
      const msg = {
        id: 'req-1',
        method: 'test.method',
        params: { foo: 'bar' }
      }
      expect(isRpcRequest(msg)).toBe(true)
      expect(isRegisterMessage(msg)).toBe(false)
      expect(isRpcResponse(msg)).toBe(false)
    })

    it('should identify RPC responses', () => {
      const msg = {
        id: 'req-1',
        status: 'success',
        result: { data: 'value' }
      }
      expect(isRpcResponse(msg)).toBe(true)
      expect(isRpcRequest(msg)).toBe(false)
      expect(isPingMessage(msg)).toBe(false)
    })

    it('should identify ping messages', () => {
      const msg = {
        type: 'ping',
        timestamp: Date.now()
      }
      expect(isPingMessage(msg)).toBe(true)
      expect(isPongMessage(msg)).toBe(false)
      expect(isRegisterMessage(msg)).toBe(false)
    })

    it('should identify pong messages', () => {
      const msg = {
        type: 'pong',
        timestamp: Date.now()
      }
      expect(isPongMessage(msg)).toBe(true)
      expect(isPingMessage(msg)).toBe(false)
      expect(isRpcRequest(msg)).toBe(false)
    })

    it('should reject invalid messages', () => {
      expect(isRegisterMessage(null)).toBe(false)
      expect(isRegisterMessage(undefined)).toBe(false)
      expect(isRpcRequest({})).toBe(false)
      expect(isRpcResponse({})).toBe(false)
      expect(isPingMessage({ type: 'invalid' })).toBe(false)
    })
  })

  describe('message type enum', () => {
    it('should have correct values', () => {
      expect(RpcMessageType.REGISTER).toBe('register')
      expect(RpcMessageType.COMMAND).toBe('command')
      expect(RpcMessageType.RESPONSE).toBe('response')
      expect(RpcMessageType.PING).toBe('ping')
      expect(RpcMessageType.PONG).toBe('pong')
    })
  })
})
