import type { GatewayDatabase } from './db'
import type { AccessReason, QueuedEvent } from './types'

export class GatewayEventQueue {
  private readonly db: GatewayDatabase

  constructor(db: GatewayDatabase) {
    this.db = db
  }

  enqueue(event: {
    id: string
    occurredAt: string
    credentialLookupHash: string
    accessPointId: string
    decision: 'allow' | 'deny'
    reasonCode: AccessReason
    snapshotRevision: number
  }): QueuedEvent {
    const createdAt = new Date().toISOString()
    const raw = this.db.rawDb

    raw.prepare(`
      INSERT INTO gateway_event_queue (
        id, occurred_at, credential_lookup_hash, access_point_id,
        decision, reason_code, snapshot_revision, attempts, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)
    `).run(
      event.id,
      event.occurredAt,
      event.credentialLookupHash,
      event.accessPointId,
      event.decision,
      event.reasonCode,
      event.snapshotRevision,
      createdAt
    )

    return {
      id: event.id,
      occurredAt: event.occurredAt,
      credentialLookupHash: event.credentialLookupHash,
      accessPointId: event.accessPointId,
      decision: event.decision,
      reasonCode: event.reasonCode,
      snapshotRevision: event.snapshotRevision,
      attempts: 0,
      status: 'pending',
      createdAt,
    }
  }

  peekBatch(limit: number = 100): QueuedEvent[] {
    const raw = this.db.rawDb
    const rows = raw.prepare(`
      SELECT id, occurred_at, credential_lookup_hash, access_point_id,
             decision, reason_code, snapshot_revision, attempts, status, created_at
      FROM gateway_event_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as Array<{
      id: string
      occurred_at: string
      credential_lookup_hash: string
      access_point_id: string
      decision: string
      reason_code: string
      snapshot_revision: number
      attempts: number
      status: string
      created_at: string
    }>

    return rows.map(r => ({
      id: r.id,
      occurredAt: r.occurred_at,
      credentialLookupHash: r.credential_lookup_hash,
      accessPointId: r.access_point_id,
      decision: r.decision as 'allow' | 'deny',
      reasonCode: r.reason_code as AccessReason,
      snapshotRevision: r.snapshot_revision,
      attempts: r.attempts,
      status: r.status as 'pending' | 'in_flight',
      createdAt: r.created_at,
    }))
  }

  markInFlight(ids: string[]): void {
    if (ids.length === 0) return
    const raw = this.db.rawDb
    this.db.transaction(() => {
      for (const id of ids) {
        raw.prepare("UPDATE gateway_event_queue SET status = 'in_flight' WHERE id = ?").run(id)
      }
    })
  }

  acknowledge(acceptedIds: string[], duplicateIds: string[]): void {
    const allIds = Array.from(new Set([...acceptedIds, ...duplicateIds]))
    if (allIds.length === 0) return
    const raw = this.db.rawDb
    this.db.transaction(() => {
      for (const id of allIds) {
        raw.prepare('DELETE FROM gateway_event_queue WHERE id = ?').run(id)
      }
    })
  }

  revertInFlight(ids: string[]): void {
    if (ids.length === 0) return
    const raw = this.db.rawDb
    this.db.transaction(() => {
      for (const id of ids) {
        raw.prepare("UPDATE gateway_event_queue SET status = 'pending', attempts = attempts + 1 WHERE id = ?").run(id)
      }
    })
  }

  recoverInFlight(): number {
    const raw = this.db.rawDb
    const result = raw.prepare("UPDATE gateway_event_queue SET status = 'pending' WHERE status = 'in_flight'").run()
    return Number(result.changes || 0)
  }

  getPendingCount(): number {
    const raw = this.db.rawDb
    const row = raw.prepare('SELECT COUNT(*) as count FROM gateway_event_queue WHERE status IN (\'pending\', \'in_flight\')').get() as { count: number } | undefined
    return row?.count ?? 0
  }
}

