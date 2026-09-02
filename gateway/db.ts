// @ts-ignore
import { DatabaseSync } from 'node:sqlite'
import type { AccessAuthorizationSnapshot } from './types'

export const GATEWAY_SCHEMA_VERSION = 1

export class GatewayDatabase {
  private readonly db: any

  constructor(location: string = ':memory:') {
    this.db = new DatabaseSync(location)
    this.init()
  }

  private init(): void {
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _gateway_schema_version (
        version INTEGER PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS gateway_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_event_queue (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        credential_lookup_hash TEXT NOT NULL,
        access_point_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        snapshot_revision INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gateway_events_status ON gateway_event_queue(status, created_at);
    `)

    const currentVersion = this.db.prepare('SELECT MAX(version) as version FROM _gateway_schema_version').get() as { version: number | null } | undefined
    if (!currentVersion || currentVersion.version === null) {
      this.db.prepare('INSERT INTO _gateway_schema_version (version) VALUES (?)').run(GATEWAY_SCHEMA_VERSION)
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM gateway_meta WHERE key = ?').get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO gateway_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM gateway_meta WHERE key = ?').run(key)
  }

  getHighestAcceptedRevision(): number {
    const raw = this.getMeta('highest_accepted_revision')
    if (!raw) return 0
    const parsed = parseInt(raw, 10)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
  }

  setHighestAcceptedRevision(revision: number): void {
    this.setMeta('highest_accepted_revision', String(revision))
  }

  getActiveSnapshot(): { snapshot: AccessAuthorizationSnapshot; signature: string; revision: number } | null {
    const json = this.getMeta('active_snapshot_json')
    const signature = this.getMeta('active_snapshot_signature')
    if (!json || !signature) return null
    try {
      const snapshot = JSON.parse(json) as AccessAuthorizationSnapshot
      return { snapshot, signature, revision: snapshot.revision }
    } catch {
      return null
    }
  }

  saveActiveSnapshot(snapshot: AccessAuthorizationSnapshot, signature: string): void {
    this.transaction(() => {
      this.setMeta('active_snapshot_json', JSON.stringify(snapshot))
      this.setMeta('active_snapshot_signature', signature)
      this.setHighestAcceptedRevision(snapshot.revision)
    })
  }

  clearActiveSnapshot(): void {
    this.transaction(() => {
      this.deleteMeta('active_snapshot_json')
      this.deleteMeta('active_snapshot_signature')
    })
  }

  close(): void {
    this.db.close()
  }

  get rawDb(): any {
    return this.db
  }
}

