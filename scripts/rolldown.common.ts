import type { RolldownOptions } from 'rolldown'
import { defu } from 'defu'
import { dts } from 'rolldown-plugin-dts'

const commonBuildConfig: RolldownOptions = {
  platform: 'node',
  plugins: [dts()],
  external: [
    /node_modules\/(?!@frp-bridge)/
  ],
  output: {
    dir: 'dist',
    format: 'es',
    minify: true,
    cleanDir: true
  }
}

export function mergeDefaultRolldownConfig(config: RolldownOptions): RolldownOptions {
  return defu(
    config,
    commonBuildConfig
  )
}
