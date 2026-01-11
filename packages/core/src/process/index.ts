/**
 * FRP process management utilities
 */

import type { ClientConfig, ProxyConfig, ServerConfig } from '@frp-bridge/types'
import type { ChildProcess } from 'node:child_process'
import type { RuntimeLogger } from '../runtime'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { consola } from 'consola'
import { join } from 'pathe'
import { BINARY_NAMES } from '../constants'
import { ErrorCode, FrpBridgeError } from '../errors'
import { commandExists, downloadFile, ensureDir, executeCommand, getDownloadUrl, getLatestVersion, getPlatform, parseToml, toToml } from '../utils'

export interface ProcessEvent {
  type: 'process:started' | 'process:stopped' | 'process:exited' | 'process:error'
  timestamp: number
  payload?: {
    code?: number
    signal?: string
    error?: string
    pid?: number
    uptime?: number
  }
}

export interface FrpProcessManagerOptions {
  /** Working directory for FRP files */
  workDir?: string
  /** Path to config file (overrides default) */
  configPath?: string
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
export class FrpProcessManager extends EventEmitter {
  private readonly workDir: string
  private version: string | null = null
  private readonly mode: 'client' | 'server'
  private readonly specifiedVersion?: string
  private readonly logger: RuntimeLogger
  private process: ChildProcess | null = null
  private configPath: string
  private binaryPath: string
  private uptime: number | null = null
  private isManualStop = false

  constructor(options: FrpProcessManagerOptions) {
    super()
    this.mode = options.mode
    this.specifiedVersion = options.version
    this.workDir = options.workDir || join(homedir(), '.frp-bridge')
    this.configPath = options.configPath || join(this.workDir, `frp${this.mode === 'client' ? 'c' : 's'}.toml`)
    this.logger = options.logger ?? consola.withTag('FrpProcessManager')

    ensureDir(this.workDir)
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
    const current = this.getConfig()
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

  /** Return the absolute config file path */
  getConfigPath(): string {
    return this.configPath
  }

  /** Read raw config file contents */
  getConfigRaw(): string | null {
    if (!existsSync(this.configPath)) {
      return null
    }
    return readFileSync(this.configPath, 'utf-8')
  }

  /** Overwrite config file with provided content */
  updateConfigRaw(content: string): void {
    const targetDir = this.configPath.includes('/') || this.configPath.includes('\\')
      ? this.configPath.substring(0, Math.max(this.configPath.lastIndexOf('/'), this.configPath.lastIndexOf('\\')))
      : this.workDir
    ensureDir(targetDir)
    writeFileSync(this.configPath, content, 'utf-8')
  }

  /** Start FRP process */
  async start(): Promise<void> {
    await this.ensureVersion()

    // Kill existing process if it's still running
    if (this.isRunning()) {
      await this.stop()
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

    this.uptime = Date.now()
    this.isManualStop = false
    this.setupProcessListeners()

    this.emit('process:started', {
      type: 'process:started',
      timestamp: Date.now(),
      payload: {
        pid: this.process?.pid,
        uptime: 0
      }
    } satisfies ProcessEvent)
  }

  /** Stop FRP process */
  async stop(): Promise<void> {
    if (!this.process) {
      return
    }

    this.isManualStop = true
    const proc = this.process

    return new Promise<void>((resolve) => {
      // Only attach listener once
      const exitHandler = () => {
        const uptime = this.uptime ? Date.now() - this.uptime : undefined

        this.emit('process:stopped', {
          type: 'process:stopped',
          timestamp: Date.now(),
          payload: { uptime }
        } satisfies ProcessEvent)

        this.uptime = null
        resolve()
      }

      // Only attach listener if process is still alive
      if (proc.exitCode === null) {
        proc.once('exit', exitHandler)
        proc.kill('SIGTERM')

        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (proc.exitCode === null) {
            this.logger.warn('Process did not exit gracefully, forcing kill')
            proc.kill('SIGKILL')
          }
        }, 5000)
      }
      else {
        // Process already dead
        exitHandler()
      }
    }).finally(() => {
      // Always clear reference after stop completes
      this.process = null
    })
  }

  /** Check if process is running */
  isRunning(): boolean {
    if (!this.process) {
      return false
    }

    // Check if process still exists and hasn't been killed
    // exitCode is null means process is still running
    // signalCode is null means it didn't receive a termination signal
    const running = this.process.exitCode === null && this.process.signalCode === null

    // Clean up stale process reference if process is actually dead
    if (!running) {
      this.process = null
    }

    return running
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
    const parsed = content ? parseToml(content) : {}

    // Ensure proxies array exists
    if (!Array.isArray(parsed.proxies)) {
      parsed.proxies = []
    }

    // Check if tunnel with same name already exists
    const existingIndex = parsed.proxies.findIndex((p: any) => p && p.name === proxy.name)
    if (existingIndex !== -1) {
      throw new FrpBridgeError(`Tunnel ${proxy.name} already exists`, ErrorCode.CONFIG_INVALID)
    }

    // Check if remotePort is already used (only for types that use remotePort)
    const proxyRemotePort = (proxy as any).remotePort
    if (proxyRemotePort && this.typeUsesRemotePort(proxy.type)) {
      const remotePortInUse = parsed.proxies.some((p: any) => {
        const pRemotePort = (p as any).remotePort
        return p && pRemotePort === proxyRemotePort && this.typeUsesRemotePort(p.type)
      })
      if (remotePortInUse) {
        throw new FrpBridgeError(`Remote port ${proxyRemotePort} is already in use`, ErrorCode.CONFIG_INVALID)
      }
    }

    // Add new tunnel to proxies array
    parsed.proxies.push(proxy)

    const newContent = toToml(parsed)
    writeFileSync(this.configPath, newContent, 'utf-8')
  }

  /** Check if proxy type uses remotePort */
  private typeUsesRemotePort(type: string): boolean {
    return ['tcp', 'udp', 'stcp', 'xtcp', 'sudp', 'tcpmux'].includes(type)
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

    // Handle [[proxies]] array syntax (modern format)
    if (Array.isArray(parsed.proxies)) {
      return parsed.proxies.find((p: any) => p && p.name === name) as ProxyConfig || null
    }

    // Handle legacy format where tunnels are individual sections
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

    // Handle [[proxies]] array syntax (modern format)
    if (Array.isArray(parsed.proxies)) {
      const tunnelIndex = parsed.proxies.findIndex((p: any) => p && p.name === name)
      if (tunnelIndex === -1) {
        throw new FrpBridgeError(`Tunnel ${name} not found`, ErrorCode.NOT_FOUND)
      }

      const existingTunnel = parsed.proxies[tunnelIndex]
      const updatedTunnel = { ...existingTunnel, ...proxy }

      // Check if remotePort is being changed and if the new port is already in use
      const newRemotePort = (proxy as any).remotePort
      if (newRemotePort && newRemotePort !== (existingTunnel as any).remotePort) {
        if (this.typeUsesRemotePort(updatedTunnel.type)) {
          const remotePortInUse = parsed.proxies.some((p: any, idx: number) => {
            if (idx === tunnelIndex)
              return false // Skip current tunnel
            const pRemotePort = (p as any).remotePort
            return p && pRemotePort === newRemotePort && this.typeUsesRemotePort(p.type)
          })
          if (remotePortInUse) {
            throw new FrpBridgeError(`Remote port ${newRemotePort} is already in use`, ErrorCode.CONFIG_INVALID)
          }
        }
      }

      parsed.proxies[tunnelIndex] = updatedTunnel
    }
    // Handle legacy format where tunnels are individual sections
    else if (parsed[name]) {
      parsed[name] = { ...parsed[name], ...proxy }
    }
    else {
      throw new FrpBridgeError(`Tunnel ${name} not found`, ErrorCode.NOT_FOUND)
    }

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

    // Handle [[proxies]] array syntax (modern format)
    if (Array.isArray(parsed.proxies)) {
      const tunnelIndex = parsed.proxies.findIndex((p: any) => p && p.name === name)
      if (tunnelIndex !== -1) {
        parsed.proxies.splice(tunnelIndex, 1)
      }
    }
    // Handle legacy format where tunnels are individual sections
    else if (parsed[name]) {
      delete parsed[name]
    }

    const newContent = toToml(parsed)
    writeFileSync(this.configPath, newContent, 'utf-8')
  }

  /** List all tunnels */
  listTunnels(): ProxyConfig[] {
    if (this.mode !== 'client') {
      throw new FrpBridgeError('Tunnels are only available in client mode', ErrorCode.MODE_ERROR)
    }

    if (!existsSync(this.configPath)) {
      this.logger.warn?.('Config file does not exist', { path: this.configPath })
      return []
    }

    const content = readFileSync(this.configPath, 'utf-8')
    const parsed = parseToml(content)

    this.logger.info?.('listTunnels - parsed config:', {
      hasProxies: 'proxies' in parsed,
      isArray: Array.isArray(parsed.proxies),
      length: parsed.proxies?.length,
      proxies: parsed.proxies
    })

    const tunnels: ProxyConfig[] = []

    // Handle [[proxies]] array syntax (modern format)
    if (Array.isArray(parsed.proxies)) {
      for (const proxy of parsed.proxies) {
        if (proxy && typeof proxy === 'object' && 'type' in proxy) {
          tunnels.push(proxy as ProxyConfig)
        }
      }
    }

    // Also handle legacy format where tunnels are defined as individual sections
    // e.g., [ssh], [web] instead of [[proxies]]
    const proxyKeys = new Set(tunnels.map(t => (t as any).name))
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'proxies')
        continue // Skip the proxies array we already processed
      if (typeof value === 'object' && value !== null && 'type' in value && !Array.isArray(value)) {
        // For legacy format, the section name is the proxy name
        const proxy = { ...value, name: (value as any).name || key } as ProxyConfig
        if (!proxyKeys.has(proxy.name)) {
          tunnels.push(proxy)
          proxyKeys.add(proxy.name)
        }
      }
    }

    this.logger.info?.('listTunnels - result:', { tunnelCount: tunnels.length, tunnels })

    return tunnels
  }

  /**
   * Query current process status
   */
  queryProcess() {
    const uptime = this.uptime ? Date.now() - this.uptime : 0

    return {
      pid: this.process?.pid,
      uptime
    }
  }

  private setupProcessListeners(): void {
    if (!this.process) {
      return
    }

    this.process.on('exit', (code, signal) => {
      const uptime = this.uptime ? Date.now() - this.uptime : undefined

      if (!this.isManualStop) {
        this.emit('process:exited', {
          type: 'process:exited',
          timestamp: Date.now(),
          payload: {
            code: code ?? undefined,
            signal: signal ?? undefined,
            uptime
          }
        } satisfies ProcessEvent)
      }

      this.process = null
      this.uptime = null
    })

    this.process.on('error', (error) => {
      this.emit('process:error', {
        type: 'process:error',
        timestamp: Date.now(),
        payload: {
          error: error.message,
          pid: this.process?.pid
        }
      } satisfies ProcessEvent)

      this.logger.error('FRP process error', { error })
    })
  }
}
