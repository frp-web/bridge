/**
 * FRP process management utilities
 */

import type { ClientConfig, ProxyConfig, ServerConfig } from '@frp-bridge/types'
import type { ChildProcess } from 'node:child_process'
import type { RuntimeLogger } from '../runtime'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { consola } from 'consola'
import { join } from 'pathe'
import { BINARY_NAMES } from '../constants'
import { ErrorCode, FrpBridgeError } from '../errors'
import { commandExists, downloadFile, ensureDir, executeCommand, getDownloadUrl, getLatestVersion, getPlatform, parseToml, toToml } from '../utils'

export interface FrpProcessManagerOptions {
  /** Working directory for FRP files */
  workDir?: string
  /** FRP version (defaults to latest) */
  version?: string
  /** Mode: client or server */
  mode: 'client' | 'server'
  /** Optional logger */
  logger?: RuntimeLogger
}

export interface NodeInfo {
  /** Node ID */
  id: string
  /** Node name */
  name: string
  /** Server address */
  serverAddr: string
  /** Server port */
  serverPort?: number
  /** Authentication token */
  token?: string
  /** Additional config */
  config?: Partial<ClientConfig | ServerConfig>
}

/**
 * Manages FRP client/server lifecycle, config, and tunnels
 */
export class FrpProcessManager {
  private readonly workDir: string
  private version: string | null = null
  private readonly mode: 'client' | 'server'
  private readonly specifiedVersion?: string
  private readonly logger: RuntimeLogger
  private process: ChildProcess | null = null
  private configPath: string
  private binaryPath: string

  constructor(options: FrpProcessManagerOptions) {
    this.mode = options.mode
    this.specifiedVersion = options.version
    this.workDir = options.workDir || join(homedir(), '.frp-bridge')
    this.logger = options.logger ?? consola.withTag('FrpProcessManager')

    ensureDir(this.workDir)

    this.configPath = join(this.workDir, `frp${this.mode === 'client' ? 'c' : 's'}.toml`)
    // Binary path will be set after version is determined
    this.binaryPath = ''
  }

  /** Ensure version is fetched and binary path is set */
  private async ensureVersion(): Promise<void> {
    if (!this.version) {
      this.version = this.specifiedVersion || await getLatestVersion()
      const binaryName = this.mode === 'client' ? BINARY_NAMES.client : BINARY_NAMES.server
      this.binaryPath = join(this.workDir, 'bin', this.version, binaryName)
    }
  }

  /** Download FRP binary for current platform */
  async downloadFrpBinary(): Promise<void> {
    await this.ensureVersion()

    const platform = getPlatform()
    const url = getDownloadUrl(this.version!, platform)
    const isWindows = platform.startsWith('windows_')
    const archiveExt = isWindows ? 'zip' : 'tar.gz'
    const archivePath = join(this.workDir, `frp_${this.version}.${archiveExt}`)
    const binDir = join(this.workDir, 'bin', this.version!)

    ensureDir(binDir)

    // Download archive
    await downloadFile(url, archivePath)

    // Extract binary
    const extractDir = join(this.workDir, 'temp')
    ensureDir(extractDir)

    if (isWindows) {
      // Windows: extract zip
      const hasUnzip = await commandExists('unzip')
      if (!hasUnzip) {
        throw new FrpBridgeError('unzip is required for extraction on Windows', ErrorCode.EXTRACTION_FAILED)
      }
      await executeCommand(`unzip -o "${archivePath}" -d "${extractDir}"`)
    }
    else {
      // Unix: extract tar.gz
      const hasGzip = await commandExists('gzip')
      const hasTar = await commandExists('tar')
      if (!hasGzip || !hasTar) {
        throw new FrpBridgeError('gzip and tar are required for extraction', ErrorCode.EXTRACTION_FAILED)
      }
      await executeCommand(`tar -xzf "${archivePath}" -C "${extractDir}"`)
    }

    // Move binary to destination
    const extractedDir = join(extractDir, `frp_${this.version}_${platform}`)
    const sourceBinary = join(extractedDir, this.mode === 'client' ? BINARY_NAMES.client : BINARY_NAMES.server)

    if (!existsSync(sourceBinary)) {
      throw new FrpBridgeError(`Binary not found: ${sourceBinary}`, ErrorCode.BINARY_NOT_FOUND)
    }

    // Copy to destination
    const fs = await import('fs-extra')
    await fs.copy(sourceBinary, this.binaryPath)

    // Set executable permission (Unix only)
    if (!isWindows) {
      chmodSync(this.binaryPath, 0o755)
    }

    // Cleanup
    await fs.remove(archivePath)
    await fs.remove(extractDir)
  }

  /** Update FRP binary to latest version */
  async updateFrpBinary(newVersion?: string): Promise<void> {
    await this.ensureVersion()

    const targetVersion = newVersion || await getLatestVersion()

    if (targetVersion === this.version) {
      return
    }

    // Backup current binary if exists
    if (existsSync(this.binaryPath)) {
      const backupPath = `${this.binaryPath}.bak`
      const fs = await import('fs-extra')
      await fs.copy(this.binaryPath, backupPath)
    }

    // Update version and binary path
    this.version = targetVersion
    const binaryName = this.mode === 'client' ? BINARY_NAMES.client : BINARY_NAMES.server
    this.binaryPath = join(this.workDir, 'bin', this.version, binaryName)

    await this.downloadFrpBinary()
  }

  /** Check if binary exists */
  hasBinary(): boolean {
    return existsSync(this.binaryPath)
  }

  /** Get current configuration */
  getConfig(): ClientConfig | ServerConfig | null {
    if (!existsSync(this.configPath)) {
      return null
    }

    const content = readFileSync(this.configPath, 'utf-8')
    return parseToml(content) as ClientConfig | ServerConfig
  }

  /** Update configuration */
  updateConfig(config: Partial<ClientConfig | ServerConfig>): void {
    const current = this.getConfig() || {}
    const merged = { ...current, ...config }
    const content = toToml(merged)

    writeFileSync(this.configPath, content, 'utf-8')
  }

  /** Backup configuration */
  async backupConfig(): Promise<string> {
    if (!existsSync(this.configPath)) {
      throw new FrpBridgeError('Config file does not exist', ErrorCode.CONFIG_NOT_FOUND)
    }

    const timestamp = Date.now()
    const backupPath = `${this.configPath}.${timestamp}.bak`

    const fs = await import('fs-extra')
    await fs.copy(this.configPath, backupPath)

    return backupPath
  }

  /** Start FRP process */
  async start(): Promise<void> {
    await this.ensureVersion()

    if (this.process) {
      throw new FrpBridgeError('Process already running', ErrorCode.PROCESS_ALREADY_RUNNING)
    }

    if (!this.hasBinary()) {
      await this.downloadFrpBinary()
    }

    if (!existsSync(this.configPath)) {
      throw new FrpBridgeError('Config file does not exist', ErrorCode.CONFIG_NOT_FOUND)
    }

    this.process = spawn(this.binaryPath, ['-c', this.configPath], {
      stdio: 'inherit'
    })

    this.process.on('error', (err) => {
      this.logger.error('FRP process error', { error: err })
      this.process = null
    })

    this.process.on('exit', (code) => {
      if (code !== 0) {
        this.logger.error('FRP process exited with non-zero code', { code })
      }
      this.process = null
    })
  }

  /** Stop FRP process */
  async stop(): Promise<void> {
    if (!this.process) {
      return
    }

    return new Promise((resolve) => {
      this.process!.on('exit', () => {
        this.process = null
        resolve()
      })

      this.process!.kill('SIGTERM')

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL')
        }
      }, 5000)
    })
  }

  /** Check if process is running */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  /** Add node (for client mode) */
  addNode(node: NodeInfo): void {
    if (this.mode !== 'client') {
      throw new FrpBridgeError('Nodes can only be added in client mode', ErrorCode.MODE_ERROR)
    }

    const config = this.getConfig() as ClientConfig || {}

    config.serverAddr = node.serverAddr
    config.serverPort = node.serverPort || 7000

    if (node.token) {
      config.auth = { ...config.auth, token: node.token }
    }

    if (node.config) {
      Object.assign(config, node.config)
    }

    this.updateConfig(config)
  }

  /** Get node info */
  getNode(): NodeInfo | null {
    if (this.mode !== 'client') {
      throw new FrpBridgeError('Nodes are only available in client mode', ErrorCode.MODE_ERROR)
    }

    const config = this.getConfig() as ClientConfig
    if (!config || !config.serverAddr) {
      return null
    }

    return {
      id: 'default',
      name: 'default',
      serverAddr: config.serverAddr,
      serverPort: config.serverPort,
      token: config.auth?.token
    }
  }

  /** Update node info */
  updateNode(node: Partial<NodeInfo>): void {
    if (this.mode !== 'client') {
      throw new FrpBridgeError('Nodes can only be updated in client mode', ErrorCode.MODE_ERROR)
    }

    const config = this.getConfig() as ClientConfig || {}

    if (node.serverAddr) {
      config.serverAddr = node.serverAddr
    }

    if (node.serverPort) {
      config.serverPort = node.serverPort
    }

    if (node.token) {
      config.auth = { ...config.auth, token: node.token }
    }

    if (node.config) {
      Object.assign(config, node.config)
    }

    this.updateConfig(config)
  }

  /** Remove node */
  removeNode(): void {
    if (this.mode !== 'client') {
      throw new FrpBridgeError('Nodes can only be removed in client mode', ErrorCode.MODE_ERROR)
    }

    if (existsSync(this.configPath)) {
      unlinkSync(this.configPath)
    }
  }

  /** Add tunnel (proxy) */
  addTunnel(proxy: ProxyConfig): void {
    if (this.mode !== 'client') {
      throw new Error('Tunnels can only be added in client mode')
    }

    const content = existsSync(this.configPath) ? readFileSync(this.configPath, 'utf-8') : ''
    const proxyToml = toToml({ [proxy.name]: proxy })

    const newContent = content ? `${content}\n\n${proxyToml}` : proxyToml
    writeFileSync(this.configPath, newContent, 'utf-8')
  }

  /** Get tunnel by name */
  getTunnel(name: string): ProxyConfig | null {
    if (this.mode !== 'client') {
      throw new Error('Tunnels are only available in client mode')
    }

    if (!existsSync(this.configPath)) {
      return null
    }

    const content = readFileSync(this.configPath, 'utf-8')
    const parsed = parseToml(content)

    return parsed[name] as ProxyConfig || null
  }

  /** Update tunnel */
  updateTunnel(name: string, proxy: Partial<ProxyConfig>): void {
    if (this.mode !== 'client') {
      throw new FrpBridgeError('Tunnels can only be updated in client mode', ErrorCode.MODE_ERROR)
    }

    if (!existsSync(this.configPath)) {
      throw new FrpBridgeError('Config file does not exist', ErrorCode.CONFIG_NOT_FOUND)
    }

    const content = readFileSync(this.configPath, 'utf-8')
    const parsed = parseToml(content)

    if (!parsed[name]) {
      throw new FrpBridgeError(`Tunnel ${name} not found`, ErrorCode.NOT_FOUND)
    }

    parsed[name] = { ...parsed[name], ...proxy }
    const newContent = toToml(parsed)

    writeFileSync(this.configPath, newContent, 'utf-8')
  }

  /** Remove tunnel */
  removeTunnel(name: string): void {
    if (this.mode !== 'client') {
      throw new FrpBridgeError('Tunnels can only be removed in client mode', ErrorCode.MODE_ERROR)
    }

    if (!existsSync(this.configPath)) {
      return
    }

    const content = readFileSync(this.configPath, 'utf-8')
    const parsed = parseToml(content)

    delete parsed[name]
    const newContent = toToml(parsed)

    writeFileSync(this.configPath, newContent, 'utf-8')
  }

  /** List all tunnels */
  listTunnels(): ProxyConfig[] {
    if (this.mode !== 'client') {
      throw new FrpBridgeError('Tunnels are only available in client mode', ErrorCode.MODE_ERROR)
    }

    if (!existsSync(this.configPath)) {
      return []
    }

    const content = readFileSync(this.configPath, 'utf-8')
    const parsed = parseToml(content)

    // Filter out non-proxy sections (common config)
    const tunnels: ProxyConfig[] = []
    for (const [_key, value] of Object.entries(parsed)) {
      if (typeof value === 'object' && value !== null && 'type' in value) {
        tunnels.push(value as ProxyConfig)
      }
    }

    return tunnels
  }
}
