/**
 * File-based node storage implementation
 * Persists node information to disk
 */

import type { NodeInfo } from '@frp-bridge/types'
import type { NodeStorage } from './node-manager'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'pathe'

/**
 * Stores nodes in JSON files
 * Directory structure:
 * ~/.frp-bridge/runtime/nodes/
 *   ├── nodes.json (index of all nodes)
 *   └── node-{id}.json (individual node data)
 */
export class FileNodeStorage implements NodeStorage {
  private indexPath: string
  private nodeDir: string

  constructor(private storagePath: string) {
    this.nodeDir = storagePath
    this.indexPath = join(storagePath, 'nodes.json')

    // Ensure directory exists
    if (!existsSync(this.nodeDir)) {
      mkdirSync(this.nodeDir, { recursive: true })
    }
  }

  /** Save or update a node */
  async save(node: NodeInfo): Promise<void> {
    const nodeFile = join(this.nodeDir, `node-${node.id}.json`)

    // Write individual node file
    await writeFile(nodeFile, JSON.stringify(node, null, 2), 'utf-8')

    // Update index
    await this.updateIndex(node.id, true)
  }

  /** Delete a node */
  async delete(id: string): Promise<void> {
    const nodeFile = join(this.nodeDir, `node-${id}.json`)

    // Delete individual node file
    try {
      await unlink(nodeFile)
    }
    catch {
      // File might not exist, ignore
    }

    // Update index
    await this.updateIndex(id, false)
  }

  /** Load a single node */
  async load(id: string): Promise<NodeInfo | undefined> {
    const nodeFile = join(this.nodeDir, `node-${id}.json`)

    try {
      const content = await readFile(nodeFile, 'utf-8')
      return JSON.parse(content) as NodeInfo
    }
    catch {
      // File doesn't exist or parse error
      return undefined
    }
  }

  /** Load all nodes */
  async list(): Promise<NodeInfo[]> {
    try {
      const indexContent = await readFile(this.indexPath, 'utf-8')
      const index: string[] = JSON.parse(indexContent)

      const nodes: NodeInfo[] = []
      for (const nodeId of index) {
        try {
          const node = await this.load(nodeId)
          if (node) {
            nodes.push(node)
          }
        }
        catch {
          // Skip nodes that can't be loaded
        }
      }

      return nodes
    }
    catch {
      // Index file doesn't exist or parse error
      return []
    }
  }

  /** Update the index of node IDs */
  private async updateIndex(nodeId: string, add: boolean): Promise<void> {
    let index: string[] = []

    try {
      const indexContent = await readFile(this.indexPath, 'utf-8')
      index = JSON.parse(indexContent)
    }
    catch {
      // Index doesn't exist yet
    }

    if (add) {
      // Add node ID if not already present
      if (!index.includes(nodeId)) {
        index.push(nodeId)
      }
    }
    else {
      // Remove node ID
      index = index.filter(id => id !== nodeId)
    }

    // Write updated index
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8')
  }
}
