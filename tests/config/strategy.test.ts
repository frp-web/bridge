/**
 * Unit tests for Config Strategy Pattern
 */

import type { PresetConfig } from '../../packages/frp-bridge/src/preset-config'
import { describe, expect, it } from 'vitest'
import { ConfigStrategyFactory, FrpcConfigStrategy, FrpsConfigStrategy, TomlBuilder } from '../../packages/frp-bridge/src/config/strategy'

describe('tomlBuilder', () => {
  it('should build key-value pairs', () => {
    const builder = new TomlBuilder()
    const result = builder
      .addKeyValue('port', 8080)
      .addKeyValue('host', 'localhost')
      .build()

    expect(result).toBe('port = 8080\nhost = "localhost"')
  })

  it('should add nested key-value', () => {
    const builder = new TomlBuilder()
    const result = builder
      .addNestedKeyValue('auth', 'token', 'secret')
      .build()

    expect(result).toBe('auth.token = "secret"')
  })

  it('should add sections', () => {
    const builder = new TomlBuilder()
    const result = builder
      .addKeyValue('port', 8080)
      .addEmptyLine()
      .addSection('webServer')
      .addKeyValue('addr', '0.0.0.0')
      .build()

    expect(result).toBe('port = 8080\n\n[webServer]\naddr = "0.0.0.0"')
  })

  it('should add multiple lines', () => {
    const builder = new TomlBuilder()
    const result = builder
      .addLines(['line1', 'line2', 'line3'])
      .build()

    expect(result).toBe('line1\nline2\nline3')
  })

  it('should clear builder', () => {
    const builder = new TomlBuilder()
    builder.addKeyValue('port', 8080)
    expect(builder.getLineCount()).toBe(1)

    builder.clear()
    expect(builder.getLineCount()).toBe(0)
    expect(builder.build()).toBe('')
  })
})

describe('frpsConfigStrategy', () => {
  it('should merge frps config with user config', () => {
    const strategy = new FrpsConfigStrategy()
    const presetConfig: PresetConfig = {
      frps: {
        bindPort: 7000,
        vhostHTTPPort: 80,
        dashboardPort: 7500,
        dashboardUser: 'admin',
        dashboardPassword: 'admin'
      }
    }

    const userConfig = '[[proxies]]\nname = "web"\ntype = "http"'
    const result = strategy.merge(presetConfig, userConfig)

    expect(result).toContain('bindPort = 7000')
    expect(result).toContain('vhostHTTPPort = 80')
    expect(result).toContain('[webServer]')
    expect(result).toContain('port = 7500')
    expect(result).toContain('user = "admin"')
    expect(result).toContain('password = "admin"')
    expect(result).toContain('[[proxies]]')
  })

  it('should return user config when no preset config', () => {
    const strategy = new FrpsConfigStrategy()
    const presetConfig: PresetConfig = {}
    const userConfig = '[[proxies]]\nname = "web"'

    const result = strategy.merge(presetConfig, userConfig)
    expect(result).toBe(userConfig)
  })

  it('should validate frps config successfully', () => {
    const strategy = new FrpsConfigStrategy()
    const presetConfig: PresetConfig = {
      frps: {
        bindPort: 7000,
        vhostHTTPPort: 80,
        dashboardPort: 7500
      }
    }

    const result = strategy.validate(presetConfig)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should validate frps config with errors', () => {
    const strategy = new FrpsConfigStrategy()
    const presetConfig: PresetConfig = {
      frps: {
        bindPort: 99999,
        vhostHTTPPort: 0,
        dashboardPort: -1,
        domain: ''
      }
    }

    const result = strategy.validate(presetConfig)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors).toContain('bindPort must be between 1-65535')
  })

  it('should validate when no frps config', () => {
    const strategy = new FrpsConfigStrategy()
    const presetConfig: PresetConfig = {}

    const result = strategy.validate(presetConfig)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

describe('frpcConfigStrategy', () => {
  it('should merge frpc config with user config', () => {
    const strategy = new FrpcConfigStrategy()
    const presetConfig: PresetConfig = {
      frpc: {
        serverAddr: '127.0.0.1',
        serverPort: 7000,
        authToken: 'token123'
      }
    }

    const userConfig = '[[proxies]]\nname = "ssh"\ntype = "tcp"'
    const result = strategy.merge(presetConfig, userConfig)

    expect(result).toContain('serverAddr = "127.0.0.1"')
    expect(result).toContain('serverPort = 7000')
    expect(result).toContain('auth.token = "token123"')
    expect(result).toContain('[[proxies]]')
  })

  it('should return user config when no preset config', () => {
    const strategy = new FrpcConfigStrategy()
    const presetConfig: PresetConfig = {}
    const userConfig = '[[proxies]]\nname = "ssh"'

    const result = strategy.merge(presetConfig, userConfig)
    expect(result).toBe(userConfig)
  })

  it('should validate frpc config successfully', () => {
    const strategy = new FrpcConfigStrategy()
    const presetConfig: PresetConfig = {
      frpc: {
        serverAddr: '127.0.0.1',
        serverPort: 7000
      }
    }

    const result = strategy.validate(presetConfig)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should validate frpc config with errors', () => {
    const strategy = new FrpcConfigStrategy()
    const presetConfig: PresetConfig = {
      frpc: {
        serverPort: 99999,
        serverAddr: ''
      }
    }

    const result = strategy.validate(presetConfig)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors).toContain('serverPort must be between 1-65535')
    expect(result.errors).toContain('serverAddr cannot be empty')
  })
})

describe('configStrategyFactory', () => {
  it('should get frps strategy', () => {
    const strategy = ConfigStrategyFactory.getStrategy('frps')
    expect(strategy).toBeInstanceOf(FrpsConfigStrategy)
  })

  it('should get frpc strategy', () => {
    const strategy = ConfigStrategyFactory.getStrategy('frpc')
    expect(strategy).toBeInstanceOf(FrpcConfigStrategy)
  })

  it('should throw error for unknown type', () => {
    expect(() => {
      ConfigStrategyFactory.getStrategy('unknown' as any)
    }).toThrow('Unknown config type: unknown')
  })

  it('should register custom strategy', () => {
    const customStrategy = {
      merge: () => 'custom config',
      validate: () => ({ valid: true, errors: [] })
    }

    ConfigStrategyFactory.registerStrategy('custom', customStrategy)
    const strategy = ConfigStrategyFactory.getStrategy('custom' as any)

    expect(strategy.merge()).toBe('custom config')
  })
})
