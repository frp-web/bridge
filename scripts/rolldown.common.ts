import type { RolldownOptions } from 'rolldown'
import { defu } from 'defu'
import { dts } from 'rolldown-plugin-dts'

const commonBuildConfig: RolldownOptions = {
  platform: 'node',
  plugins: [dts()],
  output: {
    dir: 'dist',
    format: 'es',
    minify: true
  }
}

export function mergeDefaultRolldownConfig(config: RolldownOptions): RolldownOptions {
  return defu(
    config,
    commonBuildConfig
  )
}
