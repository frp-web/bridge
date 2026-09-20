/**
 * Unit tests for transport ReconnectStrategy implementations.
 *
 * Source: packages/core/src/transport/reconnect-strategy.ts
 *
 * API surface (rewritten during the rpc → transport split):
 *   - FixedIntervalStrategy(interval, maxAttempts)
 *   - LinearBackoffStrategy(base, step, maxAttempts)
 *   - ExponentialBackoffStrategy(base, factor, maxDelay, maxAttempts)
 *
 * Differences from the legacy rpc/reconnect-strategy:
 *   - No jitter, no logger injection, no onMaxAttemptsReached hook,
 *     no InfiniteReconnectStrategy (use FixedIntervalStrategy with
 *     maxAttempts = Infinity if you need that behaviour).
 */

import { describe, expect, it } from 'vitest'
import {
  ExponentialBackoffStrategy,
  FixedIntervalStrategy,
  LinearBackoffStrategy
} from '../../packages/core/src/transport/reconnect-strategy'

describe('reconnect strategies', () => {
  describe('fixedIntervalStrategy', () => {
    it('returns the configured interval', () => {
      const strategy = new FixedIntervalStrategy(5000)
      expect(strategy.getDelay()).toBe(5000)
    })

    it('shouldReconnect respects maxAttempts', () => {
      const strategy = new FixedIntervalStrategy(1000, 5)
      expect(strategy.shouldReconnect(0)).toBe(true)
      expect(strategy.shouldReconnect(4)).toBe(true)
      expect(strategy.shouldReconnect(5)).toBe(false)
    })

    it('defaults to infinite attempts', () => {
      const strategy = new FixedIntervalStrategy(100)
      expect(strategy.shouldReconnect(0)).toBe(true)
      expect(strategy.shouldReconnect(Number.MAX_SAFE_INTEGER)).toBe(true)
    })
  })

  describe('linearBackoffStrategy', () => {
    it('grows delay linearly with attempt', () => {
      const strategy = new LinearBackoffStrategy(1000, 500)
      expect(strategy.getDelay(0)).toBe(1000)
      expect(strategy.getDelay(1)).toBe(1500)
      expect(strategy.getDelay(2)).toBe(2000)
      expect(strategy.getDelay(3)).toBe(2500)
    })

    it('shouldReconnect respects maxAttempts', () => {
      const strategy = new LinearBackoffStrategy(1000, 500, 3)
      expect(strategy.shouldReconnect(2)).toBe(true)
      expect(strategy.shouldReconnect(3)).toBe(false)
    })
  })

  describe('exponentialBackoffStrategy', () => {
    it('grows delay as base * factor^attempt', () => {
      const strategy = new ExponentialBackoffStrategy(1000, 2, 60_000)
      expect(strategy.getDelay(0)).toBe(1000)
      expect(strategy.getDelay(1)).toBe(2000)
      expect(strategy.getDelay(2)).toBe(4000)
      expect(strategy.getDelay(3)).toBe(8000)
    })

    it('caps delay at maxDelay', () => {
      const strategy = new ExponentialBackoffStrategy(1000, 2, 3000)
      expect(strategy.getDelay(10)).toBe(3000)
    })

    it('shouldReconnect respects maxAttempts', () => {
      const strategy = new ExponentialBackoffStrategy(1000, 2, 30_000, 5)
      expect(strategy.shouldReconnect(0)).toBe(true)
      expect(strategy.shouldReconnect(4)).toBe(true)
      expect(strategy.shouldReconnect(5)).toBe(false)
    })

    it('defaults to infinite attempts', () => {
      const strategy = new ExponentialBackoffStrategy()
      expect(strategy.shouldReconnect(0)).toBe(true)
      expect(strategy.shouldReconnect(1_000_000)).toBe(true)
    })
  })

  describe('reconnect strategy contract', () => {
    it('all strategies expose shouldReconnect + getDelay', () => {
      const all = [
        new FixedIntervalStrategy(1000, 10),
        new LinearBackoffStrategy(1000, 500, 10),
        new ExponentialBackoffStrategy(1000, 2, 30_000, 10)
      ]
      for (const s of all) {
        expect(typeof s.shouldReconnect).toBe('function')
        expect(typeof s.getDelay).toBe('function')
        expect(s.shouldReconnect(0)).toBe(true)
        expect(typeof s.getDelay(0)).toBe('number')
        expect(s.getDelay(0)).toBeGreaterThanOrEqual(0)
      }
    })
  })
})
