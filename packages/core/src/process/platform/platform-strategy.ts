/**
 * Platform-specific strategy for FRP binary operations
 * Implements Strategy pattern for cross-platform compatibility
 */

import { chmodSync } from 'node:fs'
import process from 'node:process'
import { ExtractionFailedError } from '../../errors'
import { commandExists, executeCommand } from '../../utils'

export interface PlatformStrategy {
  /**
   * Extract archive file to target directory
   * @param archivePath - Path to archive file
   * @param targetDir - Target extraction directory
   */
  extractArchive: (archivePath: string, targetDir: string) => Promise<void>

  /**
   * Set executable permission on binary file
   * @param path - Path to binary file
   */
  setExecutable: (path: string) => void

  /**
   * Get archive extension for current platform
   */
  getArchiveExtension: () => string
}

/**
 * Windows platform implementation
 */
export class WindowsPlatformStrategy implements PlatformStrategy {
  async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    const hasUnzip = await commandExists('unzip')
    if (!hasUnzip) {
      throw new ExtractionFailedError('unzip is required for extraction on Windows')
    }
    await executeCommand(`unzip -o "${archivePath}" -d "${targetDir}"`)
  }

  setExecutable(_path: string): void {
    // No-op on Windows
  }

  getArchiveExtension(): string {
    return 'zip'
  }
}

/**
 * Unix platform implementation (Linux, macOS, etc.)
 */
export class UnixPlatformStrategy implements PlatformStrategy {
  async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    const hasGzip = await commandExists('gzip')
    const hasTar = await commandExists('tar')
    if (!hasGzip || !hasTar) {
      throw new ExtractionFailedError('gzip and tar are required for extraction')
    }
    await executeCommand(`tar -xzf "${archivePath}" -C "${targetDir}"`)
  }

  setExecutable(path: string): void {
    chmodSync(path, 0o755)
  }

  getArchiveExtension(): string {
    return 'tar.gz'
  }
}

/**
 * Factory for creating platform-specific strategies
 */
export class PlatformStrategyFactory {
  static create(): PlatformStrategy {
    return process.platform === 'win32'
      ? new WindowsPlatformStrategy()
      : new UnixPlatformStrategy()
  }
}
