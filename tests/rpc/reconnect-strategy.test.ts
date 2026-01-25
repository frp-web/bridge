/**
 * Unit tests for RPC Reconnect Strategy
 */

import { describe, expect, it, vi } from 'vitest'
import {
  ExponentialBackoffStrategy,
  FixedIntervalStrategy,
  InfiniteReconnectStrategy,
  LinearBackoffStrategy
} from '../../packages/core/src/rpc/reconnect-strategy'

describe('reconnect strategies', () => {
  describe('exponentialBackoffStrategy', () => {
    it('should calculate exponential delays with jitter', () => {
      const strategy = new ExponentialBackoffStrategy(10, 1000, 10000)

      // Attempt 0: baseDelay * 2^0 = 1000ms ± jitter
      const delay0 = strategy.getDelay(0)
      expect(delay0).toBeGreaterThanOrEqual(750)
      expect(delay0).toBeLessThanOrEqual(1250)

      // Attempt 1: baseDelay * 2^1 = 2000ms ± jitter
      const delay1 = strategy.getDelay(1)
      expect(delay1).toBeGreaterThanOrEqual(1500)
      expect(delay1).toBeLessThanOrEqual(2500)

      // Attempt 2: baseDelay * 2^2 = 4000ms ± jitter
      const delay2 = strategy.getDelay(2)
      expect(delay2).toBeGreaterThanOrEqual(3000)
      expect(delay2).toBeLessThanOrEqual(5000)
    })

    it('should cap delay at maxDelay', () => {
      const strategy = new ExponentialBackoffStrategy(10, 1000, 3000)
      // Try multiple times since jitter is involved
      for (let i = 0; i < 10; i++) {
        const delay = strategy.getDelay(10) // Would be 1024000ms without cap
        // With jitter, delay could be up to maxDelay + 25% of maxDelay
        expect(delay).toBeLessThanOrEqual(3750)
      }
    })

    it('should reconnect until max attempts', () => {
      const strategy = new ExponentialBackoffStrategy(5)
      expect(strategy.shouldReconnect(0)).toBe(true)
      expect(strategy.shouldReconnect(4)).toBe(true)
      expect(strategy.shouldReconnect(5)).toBe(false)
    })

    it('should call onMaxAttemptsReached', () => {
      const logger = { error: vi.fn() }
      const strategy = new ExponentialBackoffStrategy(2, 1000, 30000, logger)

      strategy.shouldReconnect(0)
      strategy.shouldReconnect(1)
      const shouldContinue = strategy.shouldReconnect(2)

      expect(shouldContinue).toBe(false)
      // onMaxAttemptsReached is called when we explicitly check after shouldReconnect returns false
      strategy.onMaxAttemptsReached()
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('fixedIntervalStrategy', () => {
    it('should return fixed interval', () => {
      const strategy = new FixedIntervalStrategy(10, 5000)
      expect(strategy.getDelay()).toBe(5000)
    })

    it('should reconnect until max attempts', () => {
      const strategy = new FixedIntervalStrategy(5)
      expect(strategy.shouldReconnect(4)).toBe(true)
      expect(strategy.shouldReconnect(5)).toBe(false)
    })
  })

  describe('linearBackoffStrategy', () => {
    it('should calculate linear delays', () => {
      const strategy = new LinearBackoffStrategy(10, 1000, 500, 10000)

      expect(strategy.getDelay(0)).toBe(1000)
      expect(strategy.getDelay(1)).toBe(1500)
      expect(strategy.getDelay(2)).toBe(2000)
      expect(strategy.getDelay(3)).toBe(2500)
    })

    it('should cap delay at maxDelay', () => {
      const strategy = new LinearBackoffStrategy(10, 1000, 500, 3000)
      const delay = strategy.getDelay(20) // Would be 11000ms without cap
      expect(delay).toBe(3000)
    })
  })

  describe('infiniteReconnectStrategy', () => {
    it('should always reconnect', () => {
      const strategy = new InfiniteReconnectStrategy()
      expect(strategy.shouldReconnect()).toBe(true)
      expect(strategy.shouldReconnect()).toBe(true)
      expect(strategy.shouldReconnect()).toBe(true)
    })

    it('should calculate exponential delays', () => {
      const strategy = new InfiniteReconnectStrategy(1000, 10000)
      expect(strategy.getDelay(0)).toBe(1000)
      expect(strategy.getDelay(1)).toBe(2000)
      expect(strategy.getDelay(2)).toBe(4000)
    })
  })
})
