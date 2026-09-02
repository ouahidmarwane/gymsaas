import { GatewayDatabase } from './db'
import { GatewayEventQueue } from './event-queue'
import { OfflineAuthorizationEvaluator } from './evaluator'
import { SnapshotVerifier } from './snapshot-verifier'
import { GatewayM2MSigner } from './signer'
import { GatewayHttpClient } from './client'
import type {
  AccessAuthorizationSnapshot,
  AccessReason,
  AuthorizationRequest,
  AuthorizationResult,
  GatewayHealthState,
  GatewayIdentity,
  SecretStore,
} from './types'

export interface AccessGatewayRuntimeOptions {
  serverBaseUrl: string
  gatewayId?: string
  branchId?: string
  secretStore: SecretStore
  db?: GatewayDatabase
  dbPath?: string
  fetchFn?: typeof fetch
  version?: string
  queueDegradedThreshold?: number
}

export class AccessGatewayRuntime {
  public readonly serverBaseUrl: string
  public readonly secretStore: SecretStore
  public readonly db: GatewayDatabase
  public readonly eventQueue: GatewayEventQueue
  public readonly version: string
  public readonly queueDegradedThreshold: number

  private identity: GatewayIdentity | null = null
  private signer: GatewayM2MSigner | null = null
  private verifier: SnapshotVerifier | null = null
  private httpClient: GatewayHttpClient
  private evaluator: OfflineAuthorizationEvaluator | null = null
  private healthState: GatewayHealthState = 'UNENROLLED'
  private clockOffsetMs: number = 0

  constructor(options: AccessGatewayRuntimeOptions) {
    this.serverBaseUrl = options.serverBaseUrl.replace(/\/+$/, '')
    this.secretStore = options.secretStore
    this.db = options.db || new GatewayDatabase(options.dbPath || ':memory:')
    this.eventQueue = new GatewayEventQueue(this.db)
    this.version = options.version || '1.0.0'
    this.queueDegradedThreshold = options.queueDegradedThreshold || 1000

    this.httpClient = new GatewayHttpClient(undefined, options.fetchFn)

    if (options.gatewayId) {
      this.db.setMeta('gateway_id', options.gatewayId)
    }
    if (options.branchId) {
      this.db.setMeta('branch_id', options.branchId)
    }
  }

  async init(): Promise<void> {
    // 1. Recover in-flight events
    this.eventQueue.recoverInFlight()

    // 2. Load identity from DB and secret storage
    const gatewayId = this.db.getMeta('gateway_id')
    const branchId = this.db.getMeta('branch_id') || undefined
    const snapshotVerificationKey = this.db.getMeta('snapshot_verification_key')
    const privateKey = await this.secretStore.getMachinePrivateKey()

    if (gatewayId && snapshotVerificationKey && privateKey) {
      this.identity = { gatewayId, branchId, snapshotVerificationKey }
      this.signer = new GatewayM2MSigner(gatewayId, () => this.secretStore.getMachinePrivateKey())
      this.verifier = new SnapshotVerifier(snapshotVerificationKey)
      this.httpClient = new GatewayHttpClient(this.signer, this.httpClient.fetchFn)

      // 3. Load active snapshot from persistence
      const active = this.db.getActiveSnapshot()
      if (active) {
        const verifyRes = await this.verifier.verifySnapshot(
          active.snapshot,
          active.signature,
          branchId,
          Date.now() + this.clockOffsetMs
        )
        if (verifyRes.valid) {
          this.evaluator = new OfflineAuthorizationEvaluator(active.snapshot)
          this.healthState = 'OFFLINE_VALID_SNAPSHOT'
        } else {
          this.evaluator = null
          this.healthState = 'OFFLINE_NO_VALID_SNAPSHOT'
        }
      } else {
        this.evaluator = null
        this.healthState = 'OFFLINE_NO_VALID_SNAPSHOT'
      }
    } else {
      this.identity = null
      this.signer = null
      this.verifier = null
      this.evaluator = null
      this.healthState = 'UNENROLLED'
    }
  }

  getHealth(): GatewayHealthState {
    if (this.healthState === 'ONLINE' || this.healthState === 'OFFLINE_VALID_SNAPSHOT') {
      const pending = this.eventQueue.getPendingCount()
      if (pending >= this.queueDegradedThreshold) {
        return 'DEGRADED_QUEUE'
      }
    }
    return this.healthState
  }

  getIdentity(): GatewayIdentity | null {
    return this.identity
  }

  getActiveRevision(): number {
    return this.evaluator?.revision ?? 0
  }

  getHighestAcceptedRevision(): number {
    return this.db.getHighestAcceptedRevision()
  }

  async enroll(token: string): Promise<void> {
    const gatewayId = this.db.getMeta('gateway_id')
    if (!gatewayId) {
      throw new Error('GATEWAY_ID_NOT_CONFIGURED')
    }

    const res = await this.httpClient.enroll(this.serverBaseUrl, gatewayId, token)

    // Atomic persistence of identity & secret
    await this.secretStore.setMachinePrivateKey(res.machinePrivateKey)
    this.db.transaction(() => {
      this.db.setMeta('gateway_id', res.gatewayId)
      this.db.setMeta('snapshot_verification_key', res.snapshotVerificationKey)
    })

    await this.init()
  }

  async authorizeCredential(request: AuthorizationRequest): Promise<AuthorizationResult> {
    const occurredAt = request.occurredAt || new Date().toISOString()
    const eventId = crypto.randomUUID()

    let lookupHash = request.lookupHash
    if (!lookupHash && request.credential) {
      const type = request.credentialType || 'rfid'
      const rawString = `${type}::${request.credential}`
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawString))
      lookupHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
    }

    if (!lookupHash) {
      const result: AuthorizationResult = {
        decision: 'deny',
        reasonCode: 'CREDENTIAL_UNKNOWN',
        eventId,
        snapshotRevision: this.evaluator?.revision ?? 0,
        occurredAt,
      }
      this.eventQueue.enqueue({
        id: eventId,
        occurredAt,
        credentialLookupHash: '0'.repeat(64),
        accessPointId: request.accessPointId,
        decision: result.decision,
        reasonCode: result.reasonCode,
        snapshotRevision: result.snapshotRevision,
      })
      return result
    }

    // Check if snapshot exists and is unexpired
    if (!this.evaluator) {
      const result: AuthorizationResult = {
        decision: 'deny',
        reasonCode: 'SYSTEM_ERROR',
        eventId,
        snapshotRevision: 0,
        occurredAt,
      }
      this.eventQueue.enqueue({
        id: eventId,
        occurredAt,
        credentialLookupHash: lookupHash,
        accessPointId: request.accessPointId,
        decision: result.decision,
        reasonCode: result.reasonCode,
        snapshotRevision: result.snapshotRevision,
      })
      return result
    }

    const nowMs = Date.parse(occurredAt) || (Date.now() + this.clockOffsetMs)
    const validUntilMs = Date.parse(this.evaluator.validUntil)
    if (Number.isNaN(validUntilMs) || validUntilMs <= nowMs) {
      const result: AuthorizationResult = {
        decision: 'deny',
        reasonCode: 'SYSTEM_ERROR',
        eventId,
        snapshotRevision: this.evaluator.revision,
        occurredAt,
      }
      this.eventQueue.enqueue({
        id: eventId,
        occurredAt,
        credentialLookupHash: lookupHash,
        accessPointId: request.accessPointId,
        decision: result.decision,
        reasonCode: result.reasonCode,
        snapshotRevision: result.snapshotRevision,
      })
      return result
    }

    // Pure offline evaluation
    const evalResult = this.evaluator.evaluate({
      lookupHash,
      accessPointId: request.accessPointId,
      occurredAt,
    })

    const finalResult: AuthorizationResult = {
      decision: evalResult.decision,
      reasonCode: evalResult.reasonCode,
      eventId,
      snapshotRevision: this.evaluator.revision,
      occurredAt,
      ...(evalResult.memberId ? { memberId: evalResult.memberId } : {}),
    }

    // Synchronously persist event in SQLite before returning
    this.eventQueue.enqueue({
      id: eventId,
      occurredAt,
      credentialLookupHash: lookupHash,
      accessPointId: request.accessPointId,
      decision: finalResult.decision,
      reasonCode: finalResult.reasonCode,
      snapshotRevision: finalResult.snapshotRevision,
    })

    return finalResult
  }

  async sync(): Promise<{ heartbeat: boolean; snapshotUpdated: boolean; eventsUploaded: number }> {
    if (!this.identity || !this.signer || !this.verifier) {
      this.healthState = 'UNENROLLED'
      return { heartbeat: false, snapshotUpdated: false, eventsUploaded: 0 }
    }

    let heartbeatSuccess = false
    let snapshotUpdated = false
    let eventsUploaded = 0

    // 1. Heartbeat
    try {
      const queueDepth = this.eventQueue.getPendingCount()
      const hbRes = await this.httpClient.heartbeat(
        this.serverBaseUrl,
        {
          version: this.version,
          queueDepth,
          snapshotRevision: this.evaluator?.revision ?? 0,
          health: {
            ok: this.evaluator !== null,
            details: this.evaluator ? 'Snapshot active' : 'No valid snapshot',
          },
        },
        this.clockOffsetMs
      )

      if (hbRes.status === 200 && hbRes.data) {
        heartbeatSuccess = true
        if (hbRes.data.serverTime) {
          const serverTimeMs = Date.parse(hbRes.data.serverTime)
          if (!Number.isNaN(serverTimeMs)) {
            this.clockOffsetMs = serverTimeMs - Date.now()
          }
        }

        if (hbRes.data.gatewayStatus === 'revoked') {
          this.healthState = 'REVOKED'
          return { heartbeat: true, snapshotUpdated: false, eventsUploaded: 0 }
        }

        this.healthState = queueDepth >= this.queueDegradedThreshold ? 'DEGRADED_QUEUE' : 'ONLINE'

        // Check if snapshot sync needed
        const desiredRevision = hbRes.data.desiredSnapshotRevision ?? 0
        const currentRevision = this.evaluator?.revision ?? 0
        if (hbRes.data.syncRequired || desiredRevision > currentRevision || !this.evaluator) {
          snapshotUpdated = await this.syncSnapshot()
        }
      } else if (hbRes.status === 401) {
        this.healthState = 'AUTH_FAILURE'
        return { heartbeat: false, snapshotUpdated: false, eventsUploaded: 0 }
      } else if (hbRes.status === 403) {
        this.healthState = 'REVOKED'
        return { heartbeat: false, snapshotUpdated: false, eventsUploaded: 0 }
      } else {
        this.healthState = this.evaluator ? 'OFFLINE_VALID_SNAPSHOT' : 'OFFLINE_NO_VALID_SNAPSHOT'
      }
    } catch {
      this.healthState = this.evaluator ? 'OFFLINE_VALID_SNAPSHOT' : 'OFFLINE_NO_VALID_SNAPSHOT'
    }

    // 2. Upload pending events if online
    if (this.healthState === 'ONLINE' || this.healthState === 'DEGRADED_QUEUE') {
      eventsUploaded = await this.uploadQueuedEvents()
    }

    return { heartbeat: heartbeatSuccess, snapshotUpdated, eventsUploaded }
  }

  private async syncSnapshot(): Promise<boolean> {
    if (!this.verifier) return false
    const highestAccepted = this.db.getHighestAcceptedRevision()
    const snapRes = await this.httpClient.fetchSnapshot(
      this.serverBaseUrl,
      this.evaluator ? highestAccepted : null,
      this.clockOffsetMs
    )

    if (snapRes.status === 304) {
      return false
    }

    if (snapRes.status === 200 && 'snapshot' in snapRes) {
      const { snapshot, signature } = snapRes

      // 1. Schema & signature verification
      const verifyRes = await this.verifier.verifySnapshot(
        snapshot,
        signature,
        this.identity?.branchId,
        Date.now() + this.clockOffsetMs
      )
      if (!verifyRes.valid) {
        console.warn('[GATEWAY_SECURITY_ALERT] Snapshot rejected: verification failed', verifyRes.reason)
        return false
      }

      // 2. Anti-rollback check
      const currentHighest = this.db.getHighestAcceptedRevision()
      if (snapshot.revision < currentHighest) {
        console.warn('[GATEWAY_SECURITY_ALERT] Snapshot rejected: revision rollback attempt', {
          incomingRevision: snapshot.revision,
          highestAcceptedRevision: currentHighest,
        })
        return false
      }

      if (snapshot.revision === currentHighest && this.evaluator) {
        const active = this.db.getActiveSnapshot()
        if (active && active.signature !== signature) {
          console.warn('[GATEWAY_SECURITY_ALERT] Snapshot rejected: conflicting content at equal revision', {
            revision: snapshot.revision,
          })
          return false
        }
      }

      // 3. Atomic activation & persistence
      this.db.saveActiveSnapshot(snapshot, signature)
      this.evaluator = new OfflineAuthorizationEvaluator(snapshot)
      if (this.identity && !this.identity.branchId) {
        this.identity.branchId = snapshot.branchId
        this.db.setMeta('branch_id', snapshot.branchId)
      }
      return true
    }

    return false
  }

  private async uploadQueuedEvents(): Promise<number> {
    const batch = this.eventQueue.peekBatch(100)
    if (batch.length === 0) return 0

    const ids = batch.map(e => e.id)
    this.eventQueue.markInFlight(ids)

    try {
      const res = await this.httpClient.uploadEvents(
        this.serverBaseUrl,
        {
          events: batch.map(e => ({
            id: e.id,
            occurredAt: e.occurredAt,
            credentialLookupHash: e.credentialLookupHash,
            accessPointId: e.accessPointId,
            decision: e.decision,
            reasonCode: e.reasonCode,
            snapshotRevision: e.snapshotRevision,
          })),
        },
        this.clockOffsetMs
      )

      if (res.status === 200 && res.data) {
        const acceptedCount = res.data.accepted || 0
        const acceptedIds = ids.slice(0, acceptedCount)
        const duplicateIds = res.data.duplicates || []
        this.eventQueue.acknowledge(acceptedIds, duplicateIds)
        return acceptedCount + duplicateIds.length
      } else {
        this.eventQueue.revertInFlight(ids)
        return 0
      }
    } catch {
      this.eventQueue.revertInFlight(ids)
      return 0
    }
  }

  close(): void {
    this.db.close()
  }
}

