/**
 * ControlRouter — 把 command 消息路由到本侧 FrpControlApi（或转发到目标 peer）。
 *
 * 路由规则：
 *   1) originatorId === self.nodeId → 拒（LOOP）
 *   2) target === self.nodeId       → 终结，调本地 api[action]()
 *   3) target !== self.nodeId       → S 中继：pushTo(target)
 *
 * action 字符串格式：`<target>.<group>.<method>`（例：`frpc.tunnel.add`）
 * 其中 `<target>` 是 `frps | frpc`，仅用于校验目标 api 类型是否匹配本节点。
 */

import type { CommandMessage, ConnectionIdentity, FrpControlApi } from '@frp-bridge/types'

export interface RouterDeps {
  selfNodeId: string
  selfApi: FrpControlApi
  /** S 侧用：根据 nodeId 查连接，供 pushTo(target) */
  getPeerTransport: (nodeId: string) => { send: (data: string) => Promise<void> } | undefined
  /** S 侧用：转发消息后由对端回 ack（这里不需要本路由关心） */
}

export type HandleResult
  = | { kind: 'done', ok: true, value?: unknown }
    | { kind: 'done', ok: false, error: { code: string, message: string } }
    | { kind: 'forwarded' }

const KNOWN_GROUPS = new Set(['process', 'config', 'tunnel'])
const KNOWN_TARGETS = new Set(['frpc', 'frps'])

export class ControlRouter {
  constructor(private readonly deps: RouterDeps) {}

  async handle(msg: CommandMessage, _identity: ConnectionIdentity): Promise<HandleResult> {
    // 1) 回环防护
    if (msg.originatorId === this.deps.selfNodeId) {
      return {
        kind: 'done',
        ok: false,
        error: { code: 'LOOP', message: 'originator is self' }
      }
    }

    // 2) target === self → 终结
    if (msg.target === this.deps.selfNodeId) {
      try {
        const value = await this.invokeLocal(msg)
        return { kind: 'done', ok: true, value }
      }
      catch (err) {
        const e = err as Error & { code?: string }
        return {
          kind: 'done',
          ok: false,
          error: { code: e.code ?? 'HANDLER_ERROR', message: e.message }
        }
      }
    }

    // 3) S 中继：转发给目标 peer
    const peerConn = this.deps.getPeerTransport(msg.target)
    if (!peerConn) {
      return {
        kind: 'done',
        ok: false,
        error: { code: 'UNKNOWN_NODE', message: msg.target }
      }
    }
    // 由调用方（RpcServer）负责 pushTo，因为需要序列化 + 保留 msg.id
    return { kind: 'forwarded' }
  }

  private async invokeLocal(msg: CommandMessage): Promise<unknown> {
    const parts = msg.action.split('.')
    if (parts.length !== 3) {
      throw Object.assign(new Error(`action must be <target>.<group>.<method>, got "${msg.action}"`), { code: 'INVALID_ACTION' })
    }
    const [target, group, method] = parts as [string, string, string]
    if (!KNOWN_TARGETS.has(target)) {
      throw Object.assign(new Error(`unknown target "${target}"`), { code: 'UNKNOWN_TARGET' })
    }
    if (!KNOWN_GROUPS.has(group)) {
      throw Object.assign(new Error(`unknown group "${group}"`), { code: 'UNKNOWN_GROUP' })
    }
    if (target !== this.deps.selfApi.target) {
      throw Object.assign(
        new Error(`target "${target}" does not match self "${this.deps.selfApi.target}"`),
        { code: 'TARGET_MISMATCH' }
      )
    }

    const groupApi = (this.deps.selfApi as unknown as Record<string, Record<string, unknown> | undefined>)[group]
    if (!groupApi) {
      throw Object.assign(new Error(`${group} not found`), { code: 'UNKNOWN_ACTION' })
    }
    const fn = (groupApi as Record<string, unknown>)[method]
    if (typeof fn !== 'function') {
      throw Object.assign(new Error(`${group}.${method} not found`), { code: 'UNKNOWN_ACTION' })
    }
    return await (fn as (...args: unknown[]) => Promise<unknown>).apply(groupApi, msg.payload)
  }
}
