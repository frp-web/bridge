/**
 * ProcessController - 纯粹的进程生命周期管理
 * 负责进程的启动、停止、重启和状态查询，不关心配置、二进制、隧道等业务逻辑
 */

import type { ChildProcess } from 'node:child_process'
import type { RuntimeLogger } from '../../runtime'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { BinaryNotFoundError, ConfigNotFoundError, GenericError } from '../../errors'
import { createLogger } from '../../logging'

export interface ProcessHandle {
  /** Process ID */
  pid: number
  /** Process start time */
  startTime: number
  /** Current running state */
  running: boolean
  /** Process exit code */
  exitCode: number | null
  /** Termination signal */
  signal: NodeJS.Signals | null
  /** Config file path used to start */
  configPath: string
  /** Binary path used */
  binaryPath: string
}

export interface ProcessStatus {
  pid: number
  running: boolean
  uptime: number
  startTime: number
  exitCode: number | null
  signal: string | null
}

export type ProcessEventListener = (event: ProcessControllerEvent) => void

export interface ProcessControllerEvent {
  type: 'process:started' | 'process:stopped' | 'process:exited' | 'process:error'
  timestamp: number
  payload?: {
    code?: number
    signal?: string
    error?: string
    pid?: number
    uptime?: number
    unexpected?: boolean
  }
}

export interface ProcessControllerOptions {
  /** Optional logger */
  logger?: RuntimeLogger
}

/**
 * ProcessController 管理进程的生命周期
 */
export class ProcessController extends EventEmitter {
  private readonly logger: RuntimeLogger
  private readonly log = createLogger('Process')
  private process: ChildProcess | null = null
  private processStartTime: number | null = null
  private currentBinaryPath: string = ''
  private currentConfigPath: string = ''
  private isManualStop = false
  private gracefulTimeout = 5000 // 5 seconds for graceful shutdown

  constructor(options: ProcessControllerOptions = {}) {
    super()
    this.logger = options.logger ?? console
  }

  /**
   * Start a FRP process
   * @param binaryPath - Path to the FRP binary
   * @param configPath - Path to the configuration file
   * @returns ProcessHandle
   */
  async start(binaryPath: string, configPath: string): Promise<ProcessHandle> {
    // 1. Pre-start validation
    this.validateStartPrerequisites(binaryPath, configPath)

    // 2. Kill existing process if running
    if (this.isRunning()) {
      await this.stop()
    }

    // 3. Store paths
    this.currentBinaryPath = binaryPath
    this.currentConfigPath = configPath

    // 4. Spawn the process
    this.log.info('Starting process', { binaryPath, configPath })
    this.process = spawn(binaryPath, ['-c', configPath], {
      stdio: 'inherit'
    })

    this.processStartTime = Date.now()
    this.isManualStop = false

    // 4. Setup event listeners
    this.setupProcessListeners()

    // 5. Emit start event
    const handle = this.createProcessHandle()
    this.log.success('Process started', { pid: handle.pid, configPath })
    this.emit('process:started', {
      type: 'process:started',
      timestamp: Date.now(),
      payload: {
        pid: handle.pid,
        uptime: 0
      }
    } satisfies ProcessControllerEvent)

    return handle
  }

  /**
   * Stop the current process
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return
    }

    this.isManualStop = true
    const proc = this.process
    const pid = proc.pid

    this.log.info('Stopping process', { pid })

    return new Promise<void>((resolve) => {
      const exitHandler = () => {
        const uptime = this.processStartTime ? Date.now() - this.processStartTime : undefined

        this.emit('process:stopped', {
          type: 'process:stopped',
          timestamp: Date.now(),
          payload: { uptime }
        } satisfies ProcessControllerEvent)

        this.processStartTime = null
        this.log.success('Process stopped', { pid, uptime })
        resolve()
      }

      if (proc.exitCode === null) {
        proc.once('exit', exitHandler)
        proc.kill('SIGTERM')

        // Force kill after timeout
        setTimeout(() => {
          if (proc.exitCode === null) {
            this.log.warn('Process did not exit gracefully, forcing kill', { pid })
            proc.kill('SIGKILL')
          }
        }, this.gracefulTimeout)
      }
      else {
        exitHandler()
      }
    }).finally(() => {
      this.process = null
    })
  }

  /**
   * Restart the process
   */
  async restart(binaryPath: string, configPath: string): Promise<ProcessHandle> {
    // Save current config
    const currentBinaryPath = binaryPath
    const currentConfigPath = configPath

    this.log.info('Restarting process', { binaryPath, configPath })

    // Stop if running
    if (this.isRunning()) {
      await this.stop()
    }

    // Wait a bit for resource cleanup
    await new Promise(resolve => setTimeout(resolve, 500))

    // Start with new handle
    return this.start(currentBinaryPath, currentConfigPath)
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    if (!this.process) {
      return false
    }

    const running = this.process.exitCode === null && this.process.signalCode === null

    if (!running) {
      this.process = null
      this.processStartTime = null
    }

    return running
  }

  /**
   * Get current process status
   */
  getStatus(): ProcessStatus | null {
    if (!this.process || !this.processStartTime) {
      return null
    }

    return {
      pid: this.process.pid ?? 0,
      running: this.isRunning(),
      uptime: Date.now() - this.processStartTime,
      startTime: this.processStartTime,
      exitCode: this.process.exitCode,
      signal: this.process.signalCode
    }
  }

  /**
   * Get process PID
   */
  getPid(): number | null {
    return this.process?.pid ?? null
  }

  /**
   * Get process uptime in milliseconds
   */
  getUptime(): number {
    if (!this.processStartTime) {
      return 0
    }
    return Date.now() - this.processStartTime
  }

  private validateStartPrerequisites(binaryPath: string, configPath: string): void {
    if (!existsSync(binaryPath)) {
      throw new BinaryNotFoundError(`Binary not found: ${binaryPath}`)
    }

    if (!existsSync(configPath)) {
      throw new ConfigNotFoundError(`Config file not found: ${configPath}`)
    }
  }

  private setupProcessListeners(): void {
    if (!this.process) {
      return
    }

    this.process.on('exit', (code, signal) => {
      const uptime = this.processStartTime ? Date.now() - this.processStartTime : undefined

      if (!this.isManualStop) {
        this.log.error('Process exited unexpectedly', { code, signal, uptime })
        this.emit('process:exited', {
          type: 'process:exited',
          timestamp: Date.now(),
          payload: {
            code: code ?? undefined,
            signal: signal ?? undefined,
            uptime,
            unexpected: true
          }
        } satisfies ProcessControllerEvent)
      }

      this.process = null
      this.processStartTime = null
    })

    this.process.on('error', (error) => {
      this.log.error('Process error', { error: error.message, pid: this.process?.pid })
      this.emit('process:error', {
        type: 'process:error',
        timestamp: Date.now(),
        payload: {
          error: error.message,
          pid: this.process?.pid
        }
      } satisfies ProcessControllerEvent)

      this.logger.error('Process error', { error })
    })
  }

  private createProcessHandle(): ProcessHandle {
    if (!this.process) {
      throw new GenericError('Process not initialized', 'PROCESS_NOT_INITIALIZED')
    }

    return {
      pid: this.process.pid ?? 0,
      startTime: Date.now(),
      running: true,
      exitCode: null,
      signal: null,
      configPath: this.currentConfigPath,
      binaryPath: this.currentBinaryPath
    }
  }
}
