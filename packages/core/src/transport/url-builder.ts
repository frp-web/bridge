/**
 * buildWsUrl — 把用户填的「裸 IP / 域名 / URL」统一拼成 WebSocket URL。
 *
 * 规则：
 *   1. 已带 ws:// / wss:// → 原样返回（仅补 path）
 *   2. 已带 http:// / https:// → 协议换成 ws/wss
 *   3. 裸 IP / 域名 → 补 ws:// + 默认端口 + path
 *   4. 已带端口 → 保留
 */

const DEFAULT_PORT = 3000
const DEFAULT_PATH = '/ws/rpc'

const WS_SCHEME_RE = /^wss?:\/\//
const HTTP_SCHEME_RE = /^https?:\/\//
const HTTP_TO_WS_RE = /^http:\/\//
const HTTPS_TO_WSS_RE = /^https:\/\//
const HOST_PORT_TAIL_RE = /:\d+$/
const WS_WITH_PATH_RE = /^wss?:\/\/[^/]+\//

export function buildWsUrl(input: string, port = DEFAULT_PORT, path = DEFAULT_PATH): string {
  let s = input.trim()
  if (!s) {
    throw new Error('serverUrl is empty')
  }

  // 已带 ws/wss 协议
  if (WS_SCHEME_RE.test(s)) {
    return appendPath(s, path)
  }

  // http/https → ws/wss
  if (HTTP_SCHEME_RE.test(s)) {
    s = s.replace(HTTP_TO_WS_RE, 'ws://').replace(HTTPS_TO_WSS_RE, 'wss://')
    return appendPath(s, path)
  }

  // 裸 host / host:port
  const hasPort = HOST_PORT_TAIL_RE.test(s)
  const hostPart = hasPort ? s : `${s}:${port}`
  return `ws://${hostPart}${path}`
}

function appendPath(url: string, path: string): string {
  // 已有 path → 直接返回
  if (WS_WITH_PATH_RE.test(url)) {
    return url
  }
  return `${url}${path}`
}
