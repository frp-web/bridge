/**
 * Utility functions
 */

import { exec as execCallback } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import process from 'node:process'
import { promisify } from 'node:util'
import { ARCH_MAP, GITHUB_OWNER, GITHUB_REPO, OS_MAP } from '../constants'
import { PlatformError } from '../errors'

// Export proxy utilities
export * from './proxy-utils'

const V_REGEX = /^v/

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
          const version = release.tag_name?.replace(V_REGEX, '') || '0.65.0'
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
    throw new PlatformError(`Unsupported platform: ${process.platform}-${process.arch}`)
  }

  return `${platform}_${arch}`
}

/** Get GitHub release download URL */
export function getDownloadUrl(version: string, platform: string): string {
  const isWindows = platform.startsWith('windows_')
  const ext = isWindows ? 'zip' : 'tar.gz'
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/frp_${version}_${platform}.${ext}`
}

/** Download file from URL with redirect limit */
export async function downloadFile(url: string, dest: string, maxRedirects = 5): Promise<void> {
  if (maxRedirects <= 0) {
    return Promise.reject(new Error('Maximum redirect limit reached'))
  }

  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const httpLib = url.startsWith('https') ? httpsGet : httpGet

    httpLib(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          file.close()
          downloadFile(redirectUrl, dest, maxRedirects - 1).then(resolve).catch(reject)
          return
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`))
        file.close()
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

/** Find existing FRP version in work directory */
export function findExistingVersion(workDir: string): string | null {
  const binDir = `${workDir}/bin`

  if (!existsSync(binDir)) {
    return null
  }

  try {
    const versions = readdirSync(binDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

    return versions.length > 0 ? versions[0] : null
  }
  catch {
    return null
  }
}

/**
 * Omit undefined values from an object
 * Returns a new object with only defined values
 */
export function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value
    }
  }
  return result
}
