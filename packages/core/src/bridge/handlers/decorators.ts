/**
 * Command Handler Decorators
 * 提供可复用的横切关注点（验证、错误处理、模式检查等）
 */

import type { CommandHandler, CommandResult } from '../../runtime'
import { ModeError, ValidationError } from '../../errors'

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * 验证器函数类型
 */
export type Validator<T> = (payload: T) => ValidationResult

/**
 * 外部依赖（从 command-handlers.ts 导入）
 */
export interface CommandDependencies {
  process: import('../../process').FrpProcessManager
  nodeManager?: import('../../node').NodeManager
  rpcServer?: import('../../rpc').RpcServer
  mode: 'client' | 'server'
}

/**
 * 仅限 Server 模式
 */
export function withServerModeOnly<T>(
  handler: CommandHandler<T>,
  deps: CommandDependencies
): CommandHandler<T> {
  return async (command, ctx) => {
    if (deps.mode !== 'server') {
      throw new ModeError('This operation is only available in server mode')
    }
    return handler(command, ctx)
  }
}

/**
 * 仅限 Client 模式
 */
export function withClientModeOnly<T>(
  handler: CommandHandler<T>,
  deps: CommandDependencies
): CommandHandler<T> {
  return async (command, ctx) => {
    if (deps.mode !== 'client') {
      throw new ModeError('This operation is only available in client mode')
    }
    return handler(command, ctx)
  }
}

/**
 * 验证装饰器
 */
export function withValidation<T>(
  validator: Validator<T>
): (handler: CommandHandler<T>, deps: CommandDependencies) => CommandHandler<T> {
  return (handler, _deps) => async (command, ctx) => {
    const result = validator(command.payload as T)
    if (!result.valid) {
      throw new ValidationError(result.error || 'Validation failed')
    }
    return handler(command, ctx)
  }
}

/**
 * 错误处理装饰器
 */
export function withErrorHandling<T>(
  handler: CommandHandler<T>,
  _deps: CommandDependencies
): CommandHandler<T> {
  return async (command, ctx) => {
    try {
      return await handler(command, ctx)
    }
    catch (error) {
      return handleError(error)
    }
  }
}

/**
 * 需要进程运行中
 */
export function withProcessRunning<T>(
  handler: CommandHandler<T>,
  deps: CommandDependencies
): CommandHandler<T> {
  return async (command, ctx) => {
    if (!deps.process.isRunning()) {
      throw new ModeError('FRP process is not running')
    }
    return handler(command, ctx)
  }
}

/**
 * 需要进程已停止
 */
export function withProcessStopped<T>(
  handler: CommandHandler<T>,
  deps: CommandDependencies
): CommandHandler<T> {
  return async (command, ctx) => {
    if (deps.process.isRunning()) {
      throw new ModeError('FRP process is already running')
    }
    return handler(command, ctx)
  }
}

/**
 * 需要 RPC Server（仅 Server 模式）
 */
export function withRpcServer<T>(
  handler: CommandHandler<T>,
  deps: CommandDependencies
): CommandHandler<T> {
  return async (command, ctx) => {
    if (!deps.rpcServer) {
      throw new ModeError('RPC server not available')
    }
    return handler(command, ctx)
  }
}

/**
 * 需要节点管理器（仅 Server 模式）
 */
export function withNodeManager<T>(
  handler: CommandHandler<T>,
  deps: CommandDependencies
): CommandHandler<T> {
  return async (command, ctx) => {
    if (!deps.nodeManager) {
      throw new ModeError('Node manager not available')
    }
    return handler(command, ctx)
  }
}

/**
 * 装饰器组合
 */
export function compose<T>(
  ...decorators: ((handler: CommandHandler<T>, deps: CommandDependencies) => CommandHandler<T>)[]
): (handler: CommandHandler<T>, deps: CommandDependencies) => CommandHandler<T> {
  return (handler, deps) =>
    decorators.reduceRight(
      (h, decorator) => decorator(h, deps),
      handler
    )
}

/**
 * 错误处理辅助函数
 */
function handleError(error: unknown): CommandResult {
  if (error instanceof ValidationError) {
    return {
      status: 'failed',
      error: {
        code: error.code as any,
        message: error.message
      }
    }
  }

  if (error instanceof ModeError) {
    return {
      status: 'failed',
      error: {
        code: error.code as any,
        message: error.message
      }
    }
  }

  if (error instanceof Error) {
    return {
      status: 'failed',
      error: {
        code: 'RUNTIME_ERROR' as any,
        message: error.message
      }
    }
  }

  return {
    status: 'failed',
    error: {
      code: 'UNKNOWN_ERROR' as any,
      message: 'An unknown error occurred'
    }
  }
}

/**
 * 常用验证器
 */
export const Validators = {
  /**
   * 验证 payload 存在
   */
  required: <T>(fieldName = 'payload'): Validator<T> => (payload) => {
    if (!payload) {
      return { valid: false, error: `${fieldName} is required` }
    }
    return { valid: true }
  },

  /**
   * 验证字符串字段
   */
  string: <T>(field: keyof T): Validator<T> => (payload) => {
    const value = payload[field]
    if (!value || typeof value !== 'string' || !value.trim()) {
      return { valid: false, error: `${String(field)} is required and must be a non-empty string` }
    }
    return { valid: true }
  },

  /**
   * 验证数字字段
   */
  number: <T>(field: keyof T, min?: number, max?: number): Validator<T> => (payload) => {
    const value = (payload as any)[field]
    if (typeof value !== 'number') {
      return { valid: false, error: `${String(field)} must be a number` }
    }
    if (min !== undefined && value < min) {
      return { valid: false, error: `${String(field)} must be >= ${min}` }
    }
    if (max !== undefined && value > max) {
      return { valid: false, error: `${String(field)} must be <= ${max}` }
    }
    return { valid: true }
  },

  /**
   * 组合多个验证器
   */
  all: <T>(...validators: Validator<T>[]): Validator<T> => (payload) => {
    for (const validator of validators) {
      const result = validator(payload)
      if (!result.valid) {
        return result
      }
    }
    return { valid: true }
  }
}
