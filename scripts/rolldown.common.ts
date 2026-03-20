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
    entryFileNames: '[name].mjs',
    minify: true
  }
}

export function mergeDefaultRolldownConfig(config: RolldownOptions): RolldownOptions {
  return defu(
    config,
    commonBuildConfig
  )
}
