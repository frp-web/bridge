/**
 * FrpControlApiBase — common event + version + capability plumbing.
 *
 * Subclasses (FrpClientApi, FrpServerApi) fill in the actual process / config /
 * tunnel delegates and only need to call `emitEvent` whenever an underlying
 * controller changes state.
 */

import type {
  ControlEvent,
  ControlEventListener,
  ControlEventType,
  ControlTarget,
  FrpControlApi,
  NodeCapabilities,
  NodeRole
} from '@frp-bridge/types'
import { EventEmitter } from 'node:events'

export interface ControlBaseOptions {
  nodeId: string
  role: NodeRole
  target: ControlTarget
  capabilities: NodeCapabilities
  /** Used to break event loops when echoing events back through transport. */
  originatorId: string
}

export abstract class FrpControlApiBase implements FrpControlApi {
  readonly nodeId: string
  readonly role: NodeRole
  readonly target: ControlTarget
  readonly capabilities: NodeCapabilities

  protected readonly emitter = new EventEmitter()
  /** Monotonically increasing version counter — used for last-write-wins. */
  protected _version = 0
  /** Used to detect events we sent ourselves and avoid rebroadcasting. */
  protected readonly originatorId: string

  constructor(options: ControlBaseOptions) {
    this.nodeId = options.nodeId
    this.role = options.role
    this.target = options.target
    this.capabilities = options.capabilities
    this.originatorId = options.originatorId
    this.emitter.setMaxListeners(50)
  }

  get version(): number {
    return this._version
  }

  /** Process lifecycle — implemented by subclass. */
  abstract readonly process: import('@frp-bridge/types').FrpProcessApi

  /** Config CRUD — implemented by subclass. */
  abstract readonly config: import('@frp-bridge/types').FrpConfigApi

  /** Tunnel CRUD — implemented by subclass. */
  abstract readonly tunnel: import('@frp-bridge/types').FrpTunnelApi

  on(event: ControlEventType, listener: ControlEventListener): this {
    this.emitter.on(event, listener)
    return this
  }

  off(event: ControlEventType, listener: ControlEventListener): this {
    this.emitter.off(event, listener)
    return this
  }

  emit(evt: ControlEvent): void {
    // Skip self-originated events to avoid rebroadcast loops
    if (evt.originatorId === this.originatorId) {
      this.emitter.emit(evt.type, evt)
      return
    }
    this.emitter.emit(evt.type, evt)
  }

  /** Helper used by subclasses — increments version, emits event, returns version. */
  protected emitEvent(type: ControlEventType, payload: unknown): number {
    this._version++
    const evt: ControlEvent = {
      type,
      target: this.target,
      nodeId: this.nodeId,
      payload,
      version: this._version,
      timestamp: Date.now(),
      originatorId: this.originatorId
    }
    this.emitter.emit(type, evt)
    return this._version
  }

  /** Remove all listeners — used during disposal. */
  dispose(): void {
    this.emitter.removeAllListeners()
  }
}
