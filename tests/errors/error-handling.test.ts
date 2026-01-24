/**
 * Unit tests for Error Handling
 */

import { describe, expect, it } from 'vitest'
import {
  BinaryNotFoundError,
  ConfigInvalidError,
  ConfigNotFoundError,
  DownloadFailedError,
  ExtractionFailedError,
  FrpBridgeErrorBase,
  GenericError,
  ModeError,
  NotFoundError,
  PlatformError,
  ProcessNotRunningError,
  ValidationError,
  VersionFetchError
} from '../../packages/core/src/errors'
import { errorToJSON, getErrorCode, getErrorMessage, isErrorCode, isErrorType, toFrpBridgeError } from '../../packages/core/src/errors/utils'

describe('error handling', () => {
  describe('error classes', () => {
    it('should create ConfigInvalidError', () => {
      const error = new ConfigInvalidError('Invalid config', { field: 'port' })
      expect(error.code).toBe('CONFIG_INVALID')
      expect(error.message).toBe('Invalid config')
      expect(error.statusCode).toBe(400)
      expect(error.details).toEqual({ field: 'port' })
    })

    it('should create ConfigNotFoundError', () => {
      const error = new ConfigNotFoundError('Config not found')
      expect(error.code).toBe('CONFIG_NOT_FOUND')
      expect(error.statusCode).toBe(400)
    })

    it('should create ProcessNotRunningError', () => {
      const error = new ProcessNotRunningError('Process not running')
      expect(error.code).toBe('PROCESS_NOT_RUNNING')
      expect(error.statusCode).toBe(409)
    })

    it('should create BinaryNotFoundError', () => {
      const error = new BinaryNotFoundError('Binary not found')
      expect(error.code).toBe('BINARY_NOT_FOUND')
      expect(error.statusCode).toBe(500)
    })

    it('should create DownloadFailedError', () => {
      const error = new DownloadFailedError('Download failed')
      expect(error.code).toBe('DOWNLOAD_FAILED')
      expect(error.statusCode).toBe(500)
    })

    it('should create ExtractionFailedError', () => {
      const error = new ExtractionFailedError('Extraction failed')
      expect(error.code).toBe('EXTRACTION_FAILED')
      expect(error.statusCode).toBe(500)
    })

    it('should create VersionFetchError', () => {
      const error = new VersionFetchError('Version fetch failed')
      expect(error.code).toBe('VERSION_FETCH_FAILED')
      expect(error.statusCode).toBe(503)
    })

    it('should create ValidationError', () => {
      const error = new ValidationError('Validation failed')
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.statusCode).toBe(400)
    })

    it('should create ModeError', () => {
      const error = new ModeError('Mode error')
      expect(error.code).toBe('MODE_ERROR')
      expect(error.statusCode).toBe(409)
    })

    it('should create NotFoundError', () => {
      const error = new NotFoundError('Resource not found')
      expect(error.code).toBe('NOT_FOUND')
      expect(error.statusCode).toBe(404)
    })

    it('should create PlatformError', () => {
      const error = new PlatformError('Unsupported platform')
      expect(error.code).toBe('UNSUPPORTED_PLATFORM')
      expect(error.statusCode).toBe(500)
    })
  })

  describe('error utilities', () => {
    it('should convert Error to FrpBridgeErrorBase', () => {
      const error = new Error('Test error')
      const frpError = toFrpBridgeError(error)

      expect(frpError).toBeInstanceOf(FrpBridgeErrorBase)
      expect(frpError.message).toBe('Test error')
      expect(frpError.code).toBe('UNKNOWN_ERROR')
    })

    it('should return same error if already FrpBridgeErrorBase', () => {
      const error = new ConfigInvalidError('Invalid config')
      const frpError = toFrpBridgeError(error)

      expect(frpError).toBe(error)
    })

    it('should convert error object to FrpBridgeErrorBase', () => {
      const error = { code: 'TEST_ERROR', message: 'Test error' }
      const frpError = toFrpBridgeError(error)

      expect(frpError).toBeInstanceOf(GenericError)
      expect(frpError.code).toBe('TEST_ERROR')
      expect(frpError.message).toBe('Test error')
    })

    it('should convert unknown to GenericError', () => {
      const error = 'Unknown error'
      const frpError = toFrpBridgeError(error)

      expect(frpError).toBeInstanceOf(GenericError)
      expect(frpError.message).toBe('Unknown error')
    })

    it('should convert error to JSON', () => {
      const error = new ConfigInvalidError('Invalid config', { field: 'port' })
      const json = errorToJSON(error)

      expect(json).toEqual({
        code: 'CONFIG_INVALID',
        message: 'Invalid config',
        statusCode: 400,
        details: { field: 'port' }
      })
    })

    it('should check error code', () => {
      const error = new ConfigInvalidError('Invalid config')

      expect(isErrorCode(error, 'CONFIG_INVALID')).toBe(true)
      expect(isErrorCode(error, 'OTHER_ERROR')).toBe(false)
    })

    it('should check error type', () => {
      const error = new ConfigInvalidError('Invalid config')

      expect(isErrorType(error, ConfigInvalidError)).toBe(true)
      expect(isErrorType(error, ValidationError)).toBe(false)
    })

    it('should get error code', () => {
      const error = new ConfigInvalidError('Invalid config')
      expect(getErrorCode(error)).toBe('CONFIG_INVALID')
    })

    it('should get error message from Error', () => {
      const error = new Error('Test error')
      expect(getErrorMessage(error)).toBe('Test error')
    })

    it('should get error message from string', () => {
      expect(getErrorMessage('Test error')).toBe('Test error')
    })

    it('should get error message from FrpBridgeErrorBase', () => {
      const error = new ConfigInvalidError('Invalid config')
      expect(getErrorMessage(error)).toBe('Invalid config')
    })
  })

  describe('error toJSON', () => {
    it('should serialize error without details', () => {
      const error = new ConfigInvalidError('Invalid config')
      const json = error.toJSON()

      expect(json).toEqual({
        code: 'CONFIG_INVALID',
        message: 'Invalid config',
        statusCode: 400
      })
    })

    it('should serialize error with details', () => {
      const error = new ConfigInvalidError('Invalid config', { field: 'port', value: 'abc' })
      const json = error.toJSON()

      expect(json).toEqual({
        code: 'CONFIG_INVALID',
        message: 'Invalid config',
        statusCode: 400,
        details: { field: 'port', value: 'abc' }
      })
    })
  })
})
