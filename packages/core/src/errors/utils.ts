/**
 * Error utility functions for consistent error handling
 */

import { FrpBridgeErrorBase, GenericError } from './base-error'

/**
 * Convert any error to FrpBridgeErrorBase or GenericError
 */
export function toFrpBridgeError(error: unknown): FrpBridgeErrorBase {
  if (error instanceof FrpBridgeErrorBase) {
    return error
  }

  if (error instanceof Error) {
    return new GenericError(error.message, 'UNKNOWN_ERROR', error)
  }

  if (typeof error === 'object' && error !== null) {
    const obj = error as { code?: string, message?: string, details?: unknown }
    if (obj.code && obj.message) {
      return new GenericError(obj.message, obj.code, obj.details)
    }
  }

  return new GenericError(String(error), 'UNKNOWN_ERROR')
}

/**
 * Convert error to JSON-serializable object
 */
export function errorToJSON(error: unknown): { code: string, message: string, details?: unknown } {
  const frpError = toFrpBridgeError(error)
  return frpError.toJSON()
}

/**
 * Check if error is a specific error type by code
 */
export function isErrorCode(error: unknown, code: string): boolean {
  const frpError = toFrpBridgeError(error)
  return frpError.code === code
}

/**
 * Check if error is a specific error instance
 */
export function isErrorType<T extends FrpBridgeErrorBase>(
  error: unknown,
  ErrorClass: new (...args: any[]) => T
): error is T {
  return error instanceof ErrorClass
}

/**
 * Get error code from any error
 */
export function getErrorCode(error: unknown): string {
  const frpError = toFrpBridgeError(error)
  return frpError.code
}

/**
 * Get error message from any error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  const frpError = toFrpBridgeError(error)
  return frpError.message
}
