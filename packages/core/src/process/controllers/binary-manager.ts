/**
 * BinaryManager - FRP 二进制文件的下载、安装、版本管理
 * 负责二进制文件的生命周期管理
 */

import type { RuntimeLogger } from '../../runtime'
import { existsSync } from 'node:fs'
import { consola } from 'consola'
import { join } from 'pathe'
import { BINARY_NAMES } from '../../constants'
import { BinaryNotFoundError } from '../../errors'
import { downloadFile, ensureDir, findExistingVersion, getDownloadUrl, getLatestVersion, getPlatform } from '../../utils'
import { PlatformStrategyFactory } from '../platform/platform-strategy'

export interface BinaryManagerOptions {
  /** Working directory for FRP files */
  workDir: string
  /** Mode: client or server */
  mode: 'client' | 'server'
  /** Optional logger */
  logger?: RuntimeLogger
}

/**
 * BinaryManager 管理 FRP 二进制文件
 */
export class BinaryManager {
  private readonly workDir: string
  private readonly mode: 'client' | 'server'
  private readonly logger: RuntimeLogger
  private readonly platformStrategy = PlatformStrategyFactory.create()
  private version: string | null = null
  private binaryPath: string = ''

  constructor(options: BinaryManagerOptions) {
    this.workDir = options.workDir
    this.mode = options.mode
    this.logger = options.logger ?? consola.withTag('BinaryManager')
  }

  /**
   * Ensure binary is installed, returns binary path
   */
  async ensureInstalled(version?: string): Promise<string> {
    if (!this.version) {
      this.version = version || findExistingVersion(this.workDir) || ''
      const binaryName = this.mode === 'client' ? BINARY_NAMES.client : BINARY_NAMES.server
      this.binaryPath = join(this.workDir, 'bin', this.version, binaryName)
    }

    if (!this.hasBinary()) {
      await this.download()
    }

    return this.binaryPath
  }

  /**
   * Download FRP binary
   */
  async download(version?: string): Promise<void> {
    const targetVersion = version || this.version || await this.getLatest()

    const platform = getPlatform()
    const url = getDownloadUrl(targetVersion, platform)
    const archiveExt = this.platformStrategy.getArchiveExtension()
    const archivePath = join(this.workDir, `frp_${targetVersion}.${archiveExt}`)
    const binDir = join(this.workDir, 'bin', targetVersion)

    ensureDir(binDir)

    // Download archive
    await downloadFile(url, archivePath)

    // Extract using platform strategy
    const extractDir = join(this.workDir, 'temp')
    ensureDir(extractDir)
    await this.platformStrategy.extractArchive(archivePath, extractDir)

    // Move binary to destination
    const extractedDir = join(extractDir, `frp_${targetVersion}_${platform}`)
    const sourceBinary = join(extractedDir, this.mode === 'client' ? BINARY_NAMES.client : BINARY_NAMES.server)

    if (!existsSync(sourceBinary)) {
      throw new BinaryNotFoundError(`Binary not found: ${sourceBinary}`)
    }

    // Copy to destination
    const fs = await import('fs-extra')
    await fs.copy(sourceBinary, this.binaryPath)

    // Set executable permission
    this.platformStrategy.setExecutable(this.binaryPath)

    // Update version info
    this.version = targetVersion
    const binaryName = this.mode === 'client' ? BINARY_NAMES.client : BINARY_NAMES.server
    this.binaryPath = join(this.workDir, 'bin', targetVersion, binaryName)

    // Cleanup
    await fs.remove(archivePath)
    await fs.remove(extractDir)
  }

  /**
   * Update to specific version
   */
  async update(version: string): Promise<void> {
    const currentVersion = this.version
    if (currentVersion === version) {
      return
    }

    // Backup current binary if exists
    if (this.hasBinary()) {
      const backupPath = `${this.binaryPath}.bak`
      const fs = await import('fs-extra')
      await fs.copy(this.binaryPath, backupPath)
    }

    // Download new version
    await this.download(version)
  }

  /**
   * Get installed version
   */
  getInstalledVersion(): string | null {
    return this.version
  }

  /**
   * Get binary path
   */
  getBinaryPath(): string {
    return this.binaryPath
  }

  /**
   * Check if binary exists
   */
  hasBinary(): boolean {
    return existsSync(this.binaryPath)
  }

  /**
   * Remove binary
   */
  async remove(version?: string): Promise<void> {
    const targetVersion = version || this.version
    if (!targetVersion) {
      return
    }

    const binaryName = this.mode === 'client' ? BINARY_NAMES.client : BINARY_NAMES.server
    const binaryPath = join(this.workDir, 'bin', targetVersion, binaryName)

    if (existsSync(binaryPath)) {
      const fs = await import('fs-extra')
      await fs.remove(binaryPath)
    }

    if (targetVersion === this.version) {
      this.version = null
      this.binaryPath = ''
    }
  }

  /**
   * Get latest available version
   */
  async getLatest(): Promise<string> {
    return getLatestVersion()
  }

  /**
   * Check for updates
   */
  async checkUpdate(): Promise<{ current: string | null, latest: string }> {
    const latest = await this.getLatest()
    return {
      current: this.version,
      latest
    }
  }
}
