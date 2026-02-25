/**
 * Proxy/_tunnel related utility functions
 */

import { ProxyType } from '@frp-bridge/types'

/**
 * Check if proxy type uses remotePort field
 */
export function typeUsesRemotePort(type: string): boolean {
  return [
    ProxyType.TCP,
    ProxyType.UDP,
    ProxyType.STCP,
    ProxyType.XTCP,
    ProxyType.SUDP,
    ProxyType.TCPMUX
  ].includes(type as ProxyType)
}
