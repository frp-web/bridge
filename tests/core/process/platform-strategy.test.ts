/**
 * Unit tests for Platform Strategy
 */

import type { PlatformStrategy } from '../../../packages/core/src/process/platform/platform-strategy'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformStrategyFactory, UnixPlatformStrategy, WindowsPlatformStrategy } from '../../../packages/core/src/process/platform/platform-strategy'

// Mock executeCommand and commandExists
vi.mock('../../../packages/core/src/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packages/core/src/utils')>()
  return {
    ...actual,
    executeCommand: vi.fn(),
    commandExists: vi.fn()
  }
})

// Mock fs module for chmodSync
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    chmodSync: vi.fn()
  }
})

describe('platform strategy', () => {
  describe('windows platform strategy', () => {
    let strategy: PlatformStrategy

    beforeEach(() => {
      strategy = new WindowsPlatformStrategy()
    })

    it('should return zip as archive extension', () => {
      expect(strategy.getArchiveExtension()).toBe('zip')
    })

    it('should be no-op for setExecutable', () => {
      // Should not throw
      expect(() => strategy.setExecutable('/path/to/binary')).not.toThrow()
    })

    it('should extract zip archive', async () => {
      const { executeCommand, commandExists } = await import('../../../packages/core/src/utils')
      vi.mocked(commandExists).mockResolvedValue(true)
      vi.mocked(executeCommand).mockResolvedValue(undefined)

      await strategy.extractArchive('/path/to/archive.zip', '/target/dir')

      expect(commandExists).toHaveBeenCalledWith('unzip')
      expect(executeCommand).toHaveBeenCalledWith('unzip -o "/path/to/archive.zip" -d "/target/dir"')
    })

    it('should throw error if unzip is not available', async () => {
      const { commandExists } = await import('../../../packages/core/src/utils')
      vi.mocked(commandExists).mockResolvedValue(false)

      await expect(strategy.extractArchive('/path/to/archive.zip', '/target/dir')).rejects.toThrow('unzip is required')
    })
  })

  describe('unix platform strategy', () => {
    let strategy: PlatformStrategy

    beforeEach(() => {
      strategy = new UnixPlatformStrategy()
    })

    it('should return tar.gz as archive extension', () => {
      expect(strategy.getArchiveExtension()).toBe('tar.gz')
    })

    it('should set executable permission', () => {
      // Just verify it doesn't throw
      expect(() => strategy.setExecutable('/path/to/binary')).not.toThrow()
    })

    it('should extract tar.gz archive', async () => {
      const { executeCommand, commandExists } = await import('../../../packages/core/src/utils')
      vi.mocked(commandExists).mockImplementation(cmd => Promise.resolve(cmd === 'gzip' || cmd === 'tar'))
      vi.mocked(executeCommand).mockResolvedValue(undefined)

      await strategy.extractArchive('/path/to/archive.tar.gz', '/target/dir')

      expect(commandExists).toHaveBeenCalledWith('gzip')
      expect(commandExists).toHaveBeenCalledWith('tar')
      expect(executeCommand).toHaveBeenCalledWith('tar -xzf "/path/to/archive.tar.gz" -C "/target/dir"')
    })

    it('should throw error if gzip or tar is not available', async () => {
      const { commandExists } = await import('../../../packages/core/src/utils')
      vi.mocked(commandExists).mockResolvedValue(false)

      await expect(strategy.extractArchive('/path/to/archive.tar.gz', '/target/dir')).rejects.toThrow('gzip and tar are required')
    })
  })

  describe('platform strategy factory', () => {
    it('should create WindowsPlatformStrategy on win32', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', {
        value: 'win32'
      })

      const strategy = PlatformStrategyFactory.create()
      expect(strategy).toBeInstanceOf(WindowsPlatformStrategy)

      Object.defineProperty(process, 'platform', {
        value: originalPlatform
      })
    })

    it('should create UnixPlatformStrategy on non-win32', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', {
        value: 'linux'
      })

      const strategy = PlatformStrategyFactory.create()
      expect(strategy).toBeInstanceOf(UnixPlatformStrategy)

      Object.defineProperty(process, 'platform', {
        value: originalPlatform
      })
    })
  })

  describe('strategy interface compliance', () => {
    it('should ensure all strategies implement the interface', () => {
      const windowsStrategy = new WindowsPlatformStrategy()
      const unixStrategy = new UnixPlatformStrategy()

      // Test Windows strategy
      expect(typeof windowsStrategy.extractArchive).toBe('function')
      expect(typeof windowsStrategy.setExecutable).toBe('function')
      expect(typeof windowsStrategy.getArchiveExtension).toBe('function')

      // Test Unix strategy
      expect(typeof unixStrategy.extractArchive).toBe('function')
      expect(typeof unixStrategy.setExecutable).toBe('function')
      expect(typeof unixStrategy.getArchiveExtension).toBe('function')
    })
  })
})
