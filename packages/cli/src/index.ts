#!/usr/bin/env node

import type { ClientConfig, ServerConfig } from '@frp-bridge/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { FrpBridge } from '@frp-bridge/core'
import { loadingFunction } from '@frp-bridge/shared'
import { cac } from 'cac'
import packageJson from '../package.json'

const cli = cac('frpx')

// Global error handler
process.on('unhandledRejection', (err) => {
  console.error('Error:', err instanceof Error ? err.message : err)
  process.exit(1)
})

// Download frp binary
cli
  .command('download', 'Download frp binary')
  .option('--mode <mode>', 'Mode: client or server', { default: 'client' })
  .option('--version <version>', 'FRP version')
  .action(async (options: { mode: 'client' | 'server', version?: string }) => {
    const bridge = new FrpBridge({ mode: options.mode, version: options.version })
    await loadingFunction('Downloading frp binary...', () => bridge.downloadFrpBinary())
    console.log('Binary downloaded successfully')
  })

// Start frp service
cli
  .command('start <config>', 'Start frp service')
  .option('--mode <mode>', 'Service mode: client or server', { default: 'client' })
  .action(async (configPath: string, options: { mode: 'client' | 'server' }) => {
    const fullPath = resolve(process.cwd(), configPath)
    const config: ClientConfig | ServerConfig = JSON.parse(readFileSync(fullPath, 'utf-8'))

    const bridge = new FrpBridge({ mode: options.mode })
    bridge.updateConfig(config)

    await loadingFunction('Starting frp service...', () => bridge.start())

    console.log('Service started. Press Ctrl+C to stop.')

    // Keep process alive and handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nStopping service...')
      await bridge.stop()
      process.exit(0)
    })
  })

// Stop frp service
cli
  .command('stop', 'Stop frp service')
  .option('--mode <mode>', 'Service mode: client or server', { default: 'client' })
  .action(async (options: { mode: 'client' | 'server' }) => {
    const bridge = new FrpBridge({ mode: options.mode })
    await bridge.stop()
    console.log('Service stopped')
  })

// Backup config
cli
  .command('backup', 'Backup current configuration')
  .option('--mode <mode>', 'Service mode: client or server', { default: 'client' })
  .action(async (options: { mode: 'client' | 'server' }) => {
    const bridge = new FrpBridge({ mode: options.mode })
    const path = await bridge.backupConfig()
    console.log(`Backup saved to: ${path}`)
  })

cli.help()
cli.version(packageJson.version)

cli.parse()
