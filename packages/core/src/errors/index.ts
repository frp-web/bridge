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
