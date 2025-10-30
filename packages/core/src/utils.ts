/**
 * Utility functions
 */

import { exec as execCallback } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import process from 'node:process'
import { promisify } from 'node:util'
import { ARCH_MAP, GITHUB_OWNER, GITHUB_REPO, OS_MAP } from './constants'

const exec = promisify(execCallback)

/** Get latest FRP version from GitHub releases */
export async function getLatestVersion(): Promise<string> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

  return new Promise((resolve, reject) => {
    httpsGet(url, {
      headers: {
        'User-Agent': 'frp-bridge'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to fetch latest version: ${response.statusCode}`))
        return
      }

      let data = ''
      response.on('data', chunk => data += chunk)
      response.on('end', () => {
        try {
          const release = JSON.parse(data)
          const version = release.tag_name?.replace(/^v/, '') || '0.65.0'
          resolve(version)
        }
        catch (err) {
          reject(err)
        }
      })
    }).on('error', reject)
  })
}

/** Get platform identifier for FRP release */
export function getPlatform(): string {
  const platform = OS_MAP[process.platform]
  const arch = ARCH_MAP[process.arch]

  if (!platform || !arch) {
    throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`)
  }

  return `${platform}_${arch}`
}

/** Get GitHub release download URL */
export function getDownloadUrl(version: string, platform: string): string {
  const isWindows = platform.startsWith('windows_')
  const ext = isWindows ? 'zip' : 'tar.gz'
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/frp_${version}_${platform}.${ext}`
}

/** Download file from URL */
export async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const httpLib = url.startsWith('https') ? httpsGet : httpGet

    httpLib(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          file.close()
          downloadFile(redirectUrl, dest).then(resolve).catch(reject)
          return
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`))
        return
      }

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        resolve()
      })
    }).on('error', (err) => {
      file.close()
      reject(err)
    })
  })
}

/** Execute command */
export async function executeCommand(command: string): Promise<{ stdout: string, stderr: string }> {
  return exec(command)
}

/** Check if command exists */
export async function commandExists(command: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await exec(`where ${command}`)
    }
    else {
      await exec(`which ${command}`)
    }
    return true
  }
  catch {
    return false
  }
}

/** Ensure directory exists */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/** Parse TOML-like config to JSON */
export function parseToml(content: string): Record<string, any> {
  const lines = content.split('\n')
  const result: Record<string, any> = {}
  let currentSection = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Section header
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1)
      if (!result[currentSection]) {
        result[currentSection] = {}
      }
      continue
    }

    // Key-value pair
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim()
      let value: any = trimmed.slice(eqIndex + 1).trim()

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1)
      }

      // Parse numbers and booleans
      if (value === 'true')
        value = true
      else if (value === 'false')
        value = false
      else if (!Number.isNaN(Number(value)))
        value = Number(value)

      if (currentSection) {
        result[currentSection][key] = value
      }
      else {
        result[key] = value
      }
    }
  }

  return result
}

/** Convert JSON to TOML-like config */
export function toToml(obj: Record<string, any>): string {
  const lines: string[] = []

  // Process top-level keys first (non-object values)
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      lines.push(formatTomlValue(key, value))
    }
  }

  // Process sections (object values)
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      lines.push('')
      lines.push(`[${key}]`)
      for (const [subKey, subValue] of Object.entries(value)) {
        lines.push(formatTomlValue(subKey, subValue))
      }
    }
  }

  return lines.join('\n')
}

function formatTomlValue(key: string, value: any): string {
  if (typeof value === 'string') {
    return `${key} = "${value}"`
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return `${key} = ${value}`
  }
  if (Array.isArray(value)) {
    return `${key} = [${value.map(v => typeof v === 'string' ? `"${v}"` : v).join(', ')}]`
  }
  return `${key} = "${String(value)}"`
}
