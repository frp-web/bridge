/**
 * FRP Bridge Error Handling
 *
 * This module provides unified error handling for FRP Bridge operations.
 * All errors extend FrpBridgeErrorBase for consistent error structure.
 */

// Re-export base error and categories
export { FrpBridgeErrorBase, GenericError } from './base-error'
export type { FrpBridgeErrorBase as Error } from './base-error'

export {
  BinaryNotFoundError,
  ConfigInvalidError,
  ConfigNotFoundError,
  DownloadFailedError,
  ExtractionFailedError,
  ModeError,
  NotFoundError,
  PlatformError,
  ProcessAlreadyRunningError,
  ProcessNotRunningError,
  ProcessStartFailedError,
  ValidationError,
  VersionFetchError
} from './categories'

/**
 * @deprecated Use ConfigInvalidError instead
 */
export class FrpBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'FrpBridgeError'
  }
}

/** Error codes */
export enum ErrorCode {
  BINARY_NOT_FOUND = 'BINARY_NOT_FOUND',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  CONFIG_INVALID = 'CONFIG_INVALID',
  PROCESS_ALREADY_RUNNING = 'PROCESS_ALREADY_RUNNING',
  PROCESS_NOT_RUNNING = 'PROCESS_NOT_RUNNING',
  PROCESS_START_FAILED = 'PROCESS_START_FAILED',
  UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM',
  VERSION_FETCH_FAILED = 'VERSION_FETCH_FAILED',
  MODE_ERROR = 'MODE_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR'
}
