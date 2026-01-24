/**
 * Categorized error classes for FRP Bridge
 * Each error extends FrpBridgeErrorBase directly
 */

import { FrpBridgeErrorBase } from './base-error'

/**
 * Configuration errors (400 Bad Request)
 */
export class ConfigNotFoundError extends FrpBridgeErrorBase {
  readonly code = 'CONFIG_NOT_FOUND'
  readonly statusCode = 400
}

export class ConfigInvalidError extends FrpBridgeErrorBase {
  readonly code = 'CONFIG_INVALID'
  readonly statusCode = 400
}

/**
 * Process errors
 */
export class ProcessNotRunningError extends FrpBridgeErrorBase {
  readonly code = 'PROCESS_NOT_RUNNING'
  readonly statusCode = 409
}

export class ProcessAlreadyRunningError extends FrpBridgeErrorBase {
  readonly code = 'PROCESS_ALREADY_RUNNING'
  readonly statusCode = 409
}

export class ProcessStartFailedError extends FrpBridgeErrorBase {
  readonly code = 'PROCESS_START_FAILED'
  readonly statusCode = 500
}

/**
 * Binary errors (500 Internal Server Error)
 */
export class BinaryNotFoundError extends FrpBridgeErrorBase {
  readonly code = 'BINARY_NOT_FOUND'
  readonly statusCode = 500
}

export class DownloadFailedError extends FrpBridgeErrorBase {
  readonly code = 'DOWNLOAD_FAILED'
  readonly statusCode = 500
}

export class ExtractionFailedError extends FrpBridgeErrorBase {
  readonly code = 'EXTRACTION_FAILED'
  readonly statusCode = 500
}

/**
 * Network/Version errors (503 Service Unavailable)
 */
export class VersionFetchError extends FrpBridgeErrorBase {
  readonly code = 'VERSION_FETCH_FAILED'
  readonly statusCode = 503
}

/**
 * Validation errors (400 Bad Request)
 */
export class ValidationError extends FrpBridgeErrorBase {
  readonly code = 'VALIDATION_ERROR'
  readonly statusCode = 400
}

/**
 * Mode/State errors (409 Conflict)
 */
export class ModeError extends FrpBridgeErrorBase {
  readonly code = 'MODE_ERROR'
  readonly statusCode = 409
}

/**
 * Resource not found (404 Not Found)
 */
export class NotFoundError extends FrpBridgeErrorBase {
  readonly code = 'NOT_FOUND'
  readonly statusCode = 404
}

/**
 * Platform errors (500 Internal Server Error)
 */
export class PlatformError extends FrpBridgeErrorBase {
  readonly code = 'UNSUPPORTED_PLATFORM'
  readonly statusCode = 500
}
