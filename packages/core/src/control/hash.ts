/**
 * Stable content hash for FRP config text. Used by config.apply to track
 * the latest version and detect unchanged writes.
 */

import { createHash } from 'node:crypto'

export function hashConfigRaw(raw: string): string {
  return createHash('sha256').update(raw, 'utf-8').digest('hex').slice(0, 16)
}
