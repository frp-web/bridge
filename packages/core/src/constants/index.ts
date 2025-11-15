/**
 * Core constants
 */

import process from 'node:process'

/** GitHub repository owner */
export const GITHUB_OWNER = 'fatedier'

/** GitHub repository name */
export const GITHUB_REPO = 'frp'

/** Platform-specific binary names */
export const BINARY_NAMES = {
  client: process.platform === 'win32' ? 'frpc.exe' : 'frpc',
  server: process.platform === 'win32' ? 'frps.exe' : 'frps'
} as const

/** Platform architecture mapping */
export const ARCH_MAP: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
  arm: 'arm',
  ia32: '386'
}

/** Platform OS mapping */
export const OS_MAP: Record<string, string> = {
  win32: 'windows',
  darwin: 'darwin',
  linux: 'linux',
  freebsd: 'freebsd'
}
