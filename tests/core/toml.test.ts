/**
 * Unit tests for TOML module
 */

import { describe, expect, it } from 'vitest'
import { isValidToml, parse, safeParse, stringify } from '../../packages/core/src/toml'

describe('toml module', () => {
  describe('parse', () => {
    it('should parse simple key-value pairs', () => {
      const toml = `
        name = "test"
        port = 8080
        enabled = true
      `

      const result = parse(toml)
      expect(result).toEqual({
        name: 'test',
        port: 8080,
        enabled: true
      })
    })

    it('should parse nested sections', () => {
      const toml = `
        [server]
        host = "localhost"
        port = 8080

        [database]
        type = "mysql"
        name = "test_db"
      `

      const result = parse(toml)
      expect(result).toEqual({
        server: {
          host: 'localhost',
          port: 8080
        },
        database: {
          type: 'mysql',
          name: 'test_db'
        }
      })
    })

    it('should parse array sections', () => {
      const toml = `
        [[proxies]]
        name = "ssh"
        type = "tcp"
        localPort = 22

        [[proxies]]
        name = "web"
        type = "http"
        localPort = 80
      `

      const result = parse(toml)
      expect(result).toEqual({
        proxies: [
          {
            name: 'ssh',
            type: 'tcp',
            localPort: 22
          },
          {
            name: 'web',
            type: 'http',
            localPort: 80
          }
        ]
      })
    })

    it('should parse FRP client config', () => {
      const toml = `
        serverAddr = "127.0.0.1"
        serverPort = 7000

        [[proxies]]
        name = "ssh"
        type = "tcp"
        localIP = "127.0.0.1"
        localPort = 22
        remotePort = 6000
      `

      const result = parse(toml)
      expect(result.serverAddr).toBe('127.0.0.1')
      expect(result.serverPort).toBe(7000)
      expect(Array.isArray(result.proxies)).toBe(true)
      expect(result.proxies[0].name).toBe('ssh')
    })

    it('should parse FRP server config with dashboard', () => {
      const toml = `
        bindPort = 7000
        vhostHTTPPort = 80

        [webServer]
        addr = "0.0.0.0"
        port = 7500
        user = "admin"
        password = "admin"
      `

      const result = parse(toml)
      expect(result.bindPort).toBe(7000)
      expect(result.vhostHTTPPort).toBe(80)
      expect(result.webServer.addr).toBe('0.0.0.0')
      expect(result.webServer.port).toBe(7500)
      expect(result.webServer.user).toBe('admin')
      expect(result.webServer.password).toBe('admin')
    })

    it('should throw error for invalid TOML', () => {
      const invalidToml = `
        [invalid
        name = "test"
      `

      expect(() => parse(invalidToml)).toThrow('Failed to parse TOML')
    })
  })

  describe('stringify', () => {
    it('should stringify simple object', () => {
      const obj = {
        name: 'test',
        port: 8080,
        enabled: true
      }

      const result = stringify(obj)
      expect(result).toContain('name = "test"')
      expect(result).toContain('port = 8080')
      expect(result).toContain('enabled = true')
    })

    it('should stringify nested objects', () => {
      const obj = {
        server: {
          host: 'localhost',
          port: 8080
        }
      }

      const result = stringify(obj)
      expect(result).toContain('[server]')
      expect(result).toContain('host = "localhost"')
      expect(result).toContain('port = 8080')
    })

    it('should stringify array of objects', () => {
      const obj = {
        proxies: [
          { name: 'ssh', type: 'tcp', localPort: 22 },
          { name: 'web', type: 'http', localPort: 80 }
        ]
      }

      const result = stringify(obj)
      expect(result).toContain('[[proxies]]')
      expect(result).toContain('name = "ssh"')
      expect(result).toContain('name = "web"')
    })

    it('should stringify FRP client config', () => {
      const obj = {
        serverAddr: '127.0.0.1',
        serverPort: 7000,
        proxies: [
          {
            name: 'ssh',
            type: 'tcp',
            localIP: '127.0.0.1',
            localPort: 22,
            remotePort: 6000
          }
        ]
      }

      const result = stringify(obj)
      expect(result).toContain('serverAddr = "127.0.0.1"')
      expect(result).toContain('serverPort = 7000')
      expect(result).toContain('[[proxies]]')
    })

    it('should throw error for unserializable objects', () => {
      const obj = {
        fn: () => {}
      }

      // smol-toml rejects functions
      expect(() => stringify(obj as any)).toThrow()
    })
  })

  describe('isValidToml', () => {
    it('should return true for valid TOML', () => {
      const validToml = `
        name = "test"
        port = 8080
      `
      expect(isValidToml(validToml)).toBe(true)
    })

    it('should return false for invalid TOML', () => {
      const invalidToml = `
        [invalid
        name = "test"
      `
      expect(isValidToml(invalidToml)).toBe(false)
    })

    it('should return true for empty string', () => {
      // smol-toml parses empty string as {}
      expect(isValidToml('')).toBe(true)
    })
  })

  describe('safeParse', () => {
    it('should return parsed object for valid TOML', () => {
      const toml = `
        name = "test"
        port = 8080
      `
      const result = safeParse(toml)
      expect(result).toEqual({
        name: 'test',
        port: 8080
      })
    })

    it('should return null for invalid TOML', () => {
      const invalidToml = `
        [invalid
        name = "test"
      `
      const result = safeParse(invalidToml)
      expect(result).toBe(null)
    })

    it('should return empty object for empty string', () => {
      // smol-toml parses empty string as {}
      const result = safeParse('')
      expect(result).toEqual({})
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve data through parse and stringify', () => {
      const original = {
        serverAddr: '127.0.0.1',
        serverPort: 7000,
        auth: {
          token: 'test_token'
        },
        proxies: [
          {
            name: 'ssh',
            type: 'tcp',
            localIP: '127.0.0.1',
            localPort: 22,
            remotePort: 6000
          },
          {
            name: 'web',
            type: 'http',
            localPort: 80
          }
        ]
      }

      const toml = stringify(original)
      const parsed = parse(toml)

      expect(parsed).toEqual(original)
    })

    it('should handle complex nested structures', () => {
      const original = {
        bindPort: 7000,
        vhostHTTPPort: 80,
        webServer: {
          addr: '0.0.0.0',
          port: 7500,
          user: 'admin',
          password: 'admin'
        }
      }

      const toml = stringify(original)
      const parsed = parse(toml)

      expect(parsed).toEqual(original)
    })
  })
})
