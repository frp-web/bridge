/**
 * RPC 重连策略
 * 提供可配置的重连机制，包括指数退避
 */

/**
 * 重连策略接口
 */
export interface ReconnectStrategy {
  /**
   * 判断是否应该重连
   */
  shouldReconnect: (attempt: number) => boolean

  /**
   * 获取重连延迟时间（毫秒）
   */
  getDelay: (attempt: number) => number

  /**
   * 达到最大重连次数时的回调
   */
  onMaxAttemptsReached: () => void
}

/**
 * 指数退避重连策略
 */
export class ExponentialBackoffStrategy implements ReconnectStrategy {
  constructor(
    private maxAttempts = 10,
    private baseDelay = 1000,
    private maxDelay = 30000,
    private logger?: { error?: (msg: string, data?: unknown) => void }
  ) {}

  shouldReconnect(attempt: number): boolean {
    return attempt < this.maxAttempts
  }

  getDelay(attempt: number): number {
    const delay = Math.min(
      this.baseDelay * 2 ** attempt,
      this.maxDelay
    )
    // 添加随机抖动（±25%）避免惊群效应
    const jitter = delay * 0.25 * (Math.random() * 2 - 1)
    return Math.max(0, Math.floor(delay + jitter))
  }

  onMaxAttemptsReached(): void {
    const msg = `Max reconnection attempts reached (${this.maxAttempts})`
    this.logger?.error?.(msg)
    console.error(`[RpcClient] ${msg}`)
  }
}

/**
 * 固定间隔重连策略
 */
export class FixedIntervalStrategy implements ReconnectStrategy {
  constructor(
    private maxAttempts = 10,
    private interval = 5000,
    private logger?: { error?: (msg: string, data?: unknown) => void }
  ) {}

  shouldReconnect(attempt: number): boolean {
    return attempt < this.maxAttempts
  }

  getDelay(): number {
    return this.interval
  }

  onMaxAttemptsReached(): void {
    const msg = `Max reconnection attempts reached (${this.maxAttempts})`
    this.logger?.error?.(msg)
    console.error(`[RpcClient] ${msg}`)
  }
}

/**
 * 线性增长重连策略
 */
export class LinearBackoffStrategy implements ReconnectStrategy {
  constructor(
    private maxAttempts = 10,
    private baseDelay = 1000,
    private increment = 1000,
    private maxDelay = 30000,
    private logger?: { error?: (msg: string, data?: unknown) => void }
  ) {}

  shouldReconnect(attempt: number): boolean {
    return attempt < this.maxAttempts
  }

  getDelay(attempt: number): number {
    const delay = Math.min(
      this.baseDelay + (attempt * this.increment),
      this.maxDelay
    )
    return delay
  }

  onMaxAttemptsReached(): void {
    const msg = `Max reconnection attempts reached (${this.maxAttempts})`
    this.logger?.error?.(msg)
    console.error(`[RpcClient] ${msg}`)
  }
}

/**
 * 无限重连策略（永不停止）
 */
export class InfiniteReconnectStrategy implements ReconnectStrategy {
  constructor(
    private baseDelay = 1000,
    private maxDelay = 30000
  ) {}

  shouldReconnect(): boolean {
    return true
  }

  getDelay(attempt: number): number {
    return Math.min(
      this.baseDelay * 2 ** attempt,
      this.maxDelay
    )
  }

  onMaxAttemptsReached(): void {
    // 永不停止，不需要回调
  }
}
