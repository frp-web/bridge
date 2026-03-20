import { defineConfig } from 'rolldown'
import { mergeDefaultRolldownConfig } from '../../scripts/rolldown.common'

export default defineConfig(mergeDefaultRolldownConfig({
  input: ['src/index', 'src/process', 'src/runtime']
}))
