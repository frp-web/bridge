/**
 * Reconnect strategies for RpcClient.
 */

export interface ReconnectStrategy {
  shouldReconnect: (attempt: number) => boolean
  getDelay: (attempt: number) => number
  onMaxAttemptsReached?: () => void
}

export class FixedIntervalStrategy implements ReconnectStrategy {
  constructor(private readonly interval: number = 5000, private readonly maxAttempts: number = Infinity) {}
  shouldReconnect(attempt: number): boolean { return attempt < this.maxAttempts }
  getDelay(): number { return this.interval }
}

export class LinearBackoffStrategy implements ReconnectStrategy {
  constructor(private readonly base: number = 1000, private readonly step: number = 1000, private readonly maxAttempts: number = Infinity) {}
  shouldReconnect(attempt: number): boolean { return attempt < this.maxAttempts }
  getDelay(attempt: number): number { return this.base + attempt * this.step }
}

export class ExponentialBackoffStrategy implements ReconnectStrategy {
  constructor(private readonly base: number = 1000, private readonly factor: number = 2, private readonly maxDelay: number = 30000, private readonly maxAttempts: number = Infinity) {}
  shouldReconnect(attempt: number): boolean { return attempt < this.maxAttempts }
  getDelay(attempt: number): number {
    const delay = this.base * (this.factor ** attempt)
    return Math.min(delay, this.maxDelay)
  }
}
