import type { ConfigSnapshot, SnapshotStorage } from './contracts'
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { ensureDir } from '../utils'

function isConfigSnapshot(value: unknown): value is ConfigSnapshot {
  return Boolean(value) && typeof value === 'object' && 'version' in (value as Record<string, unknown>)
}

export class FileSnapshotStorage implements SnapshotStorage {
  constructor(private readonly directory: string) {
    ensureDir(directory)
  }

  async save(snapshot: ConfigSnapshot): Promise<void> {
    if (typeof snapshot.version !== 'number') {
      throw new TypeError('Snapshot version must be a number when using FileSnapshotStorage')
    }

    ensureDir(this.directory)
    const payload = JSON.stringify(snapshot, null, 2)
    await writeFile(this.buildPath(snapshot.version), payload, 'utf-8')
  }

  async load(version: number): Promise<ConfigSnapshot | undefined> {
    const target = this.buildPath(version)
    if (!existsSync(target)) {
      return undefined
    }

    const content = await readFile(target, 'utf-8')
    const parsed = JSON.parse(content) as ConfigSnapshot

    if (!isConfigSnapshot(parsed)) {
      throw new TypeError(`Invalid snapshot schema at version ${version}`)
    }

    return parsed
  }

  async list(): Promise<ConfigSnapshot[]> {
    ensureDir(this.directory)
    const entries = await readdir(this.directory)
    const snapshots: ConfigSnapshot[] = []

    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue
      }
      const content = await readFile(join(this.directory, entry), 'utf-8')
      const parsed = JSON.parse(content) as ConfigSnapshot
      if (isConfigSnapshot(parsed)) {
        snapshots.push(parsed)
      }
    }

    return snapshots.sort((a, b) => a.version - b.version)
  }

  private buildPath(version: number): string {
    return join(this.directory, `${version}.json`)
  }
}
