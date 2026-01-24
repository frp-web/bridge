/**
 * Base error class for all FRP Bridge errors
 * Provides consistent error structure and handling
 */

export abstract class FrpBridgeErrorBase extends Error {
  /**
   * Error code for programmatic error handling
   */
  abstract readonly code: string

  /**
   * HTTP status code (optional, for API responses)
   */
  readonly statusCode?: number

  /**
   * Additional error details
   */
  readonly details?: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = this.constructor.name
    this.details = details
  }

  /**
   * Convert error to plain object for serialization
   */
  toJSON(): { code: string, message: string, statusCode?: number, details?: unknown } {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details
    }
  }
}

/**
 * Generic error for uncategorized errors
 */
export class GenericError extends FrpBridgeErrorBase {
  readonly code: string

  constructor(message: string, code: string, details?: unknown) {
    super(message, details)
    this.code = code
  }
}
