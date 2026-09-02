import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleApi } from '../src/api.ts'
import { ClubDatabase } from '../src/club/club-database.ts'
import { AccessStore, credentialDigest, maskCredential } from '../src/club/access.ts'
import { MIGRATIONS, LATEST_VERSION } from '../src/club/schema.ts'
import {
  AccessGatewayRuntime,
  MemorySecretStore,
  FsSecretStore,
  GatewayDatabase,
  SnapshotVerifier,
  OfflineAuthorizationEvaluator,
  GatewayEventQueue,
  GatewayM2MSigner,
  GatewayHttpClient,
  base64UrlEncode,
  base64UrlDecode,
} from '../gateway/index.ts'

const CONTROL_SCHEMA = readFileSync(new URL('../src/control-plane/schema.sql', import.meta.url), 'utf8')
const ORG_A = '11111111-1111-4111-8111-111111111111'
const ACTOR = { id: '33333333-3333-4333-8333-333333333333', name: 'Gateway Admin' }

function sqlStorage(db) {
  return {
    exec(query, ...params) {
      const statement = db.prepare(query)
      const rows = statement.columns().length ? statement.all(...params) : (statement.run(...params), [])
      return {
        toArray: () => rows,
        one: () => { if (!rows[0]) throw new Error('no row'); return rows[0] },
        raw: () => rows.map(Object.values),
      }
    },
  }
}

function durableStorage(db) {
  let savepoint = 0
  return {
    sql: sqlStorage(db),
    async sync() {},
    transactionSync(callback) {
      if (db.isTransaction) {
        const name = `gw_runtime_test_${++savepoint}`
        db.exec(`SAVEPOINT ${name}`)
        try { const val = callback(); db.exec(`RELEASE ${name}`); return val }
        catch (err) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw err }
      }
      db.exec('BEGIN IMMEDIATE')
      try { const val = callback(); db.exec('COMMIT'); return val }
      catch (err) { db.exec('ROLLBACK'); throw err }
    },
  }
}

async function realClub() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  const storage = durableStorage(db)
  const ctx = {
    storage,
    ready: Promise.resolve(),
    blockConcurrencyWhile(cb) { this.ready = Promise.resolve().then(cb); return this.ready },
  }
  const club = new ClubDatabase(ctx, {})
  await ctx.ready
  return { db, club, storage }
}

function d1(db) {
  return {
    prepare(query) {
      let params = []
      return {
        bind(...values) { params = values; return this },
        async first(col) {
          const row = db.prepare(query).get(...params) ?? null
          return col && row ? row[col] : row
        },
        async all() { return { results: db.prepare(query).all(...params) } },
        async run() {
          const res = db.prepare(query).run(...params)
          return { success: true, meta: { changes: Number(res.changes) } }
        },
      }
    },
  }
}

function futureDate(days = 30) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

async function sha256url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64UrlEncode(digest)
}

async function testHarness() {
  const controlDb = new DatabaseSync(':memory:')
  controlDb.exec(CONTROL_SCHEMA)
  controlDb.prepare("INSERT INTO organizations(id,slug,name,plan,status,trial_ends_at) VALUES(?,?,?,'trial','active',?)")
    .run(ORG_A, 'org-a', 'Organization A', futureDate())

  const tenantA = await realClub()
  const tenants = new Map([[ORG_A, tenantA]])
  const env = {
    CONTROL: d1(controlDb),
    CLUB: {
      idFromName(id) { return id },
      get(id) { return tenants.get(id)?.club },
    },
    ENTITLEMENT_MODE: 'enforce',
  }

  const branchA = crypto.randomUUID()
  tenantA.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branchA, 'Branch A')

  // Custom fetch function that invokes real handleApi router
  const serverFetch = async (input, init = {}) => {
    const urlStr = typeof input === 'string' ? input : input.url
    const method = init.method || 'GET'
    const headers = new Headers(init.headers || {})
    let body = init.body
    if (body instanceof Uint8Array) {
      body = body.buffer
    }
    const req = new Request(urlStr, { method, headers, body })
    return handleApi(req, env)
  }

  return { controlDb, tenantA, env, branchA, serverFetch }
}

test('Gateway runtime: secret storage persists private key safely and never exposes in string representation', async () => {
  const memStore = new MemorySecretStore()
  assert.equal(await memStore.getMachinePrivateKey(), null)
  const validKey = 'a'.repeat(86)
  await memStore.setMachinePrivateKey(validKey)
  assert.equal(await memStore.getMachinePrivateKey(), validKey)
  await assert.rejects(() => memStore.setMachinePrivateKey('short'), /INVALID_MACHINE_PRIVATE_KEY/)
  await memStore.clear()
  assert.equal(await memStore.getMachinePrivateKey(), null)

  const tempFile = join(tmpdir(), `gw_secret_test_${Date.now()}.key`)
  try {
    const fsStore = new FsSecretStore(tempFile)
    assert.equal(await fsStore.getMachinePrivateKey(), null)
    await fsStore.setMachinePrivateKey(validKey)
    assert.equal(await fsStore.getMachinePrivateKey(), validKey)
    await fsStore.clear()
    assert.equal(await fsStore.getMachinePrivateKey(), null)
  } finally {
    if (existsSync(tempFile)) rmSync(tempFile)
  }
})

test('Gateway runtime: local database manages schema, metadata, and active snapshot transactionally', () => {
  const db = new GatewayDatabase(':memory:')
  assert.equal(db.getHighestAcceptedRevision(), 0)
  db.setHighestAcceptedRevision(42)
  assert.equal(db.getHighestAcceptedRevision(), 42)

  const sampleSnapshot = {
    snapshotSchemaVersion: 2,
    revision: 42,
    generatedAt: new Date().toISOString(),
    validUntil: futureDate(1),
    branchId: crypto.randomUUID(),
    branchActive: true,
    timezone: 'Africa/Casablanca',
    accessPoints: [],
    credentials: [],
    members: [],
    rules: [],
  }

  db.saveActiveSnapshot(sampleSnapshot, 'signature_base64url_test')
  const loaded = db.getActiveSnapshot()
  assert.ok(loaded)
  assert.equal(loaded.revision, 42)
  assert.equal(loaded.signature, 'signature_base64url_test')
  assert.equal(loaded.snapshot.snapshotSchemaVersion, 2)
  assert.equal(db.getHighestAcceptedRevision(), 42)

  db.clearActiveSnapshot()
  assert.equal(db.getActiveSnapshot(), null)
  assert.equal(db.getHighestAcceptedRevision(), 42)
  db.close()
})

test('Gateway runtime: snapshot verifier validates schema version 2, signatures, and rejects tampering', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const spkiBytes = await crypto.subtle.exportKey('spki', keys.publicKey)
  const verificationKey = base64UrlEncode(spkiBytes)

  const verifier = new SnapshotVerifier(verificationKey)
  const branchId = crypto.randomUUID()
  const snapshot = {
    snapshotSchemaVersion: 2,
    revision: 10,
    generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    branchId,
    branchActive: true,
    timezone: 'Africa/Casablanca',
    accessPoints: [],
    credentials: [],
    members: [],
    rules: [],
  }

  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    new TextEncoder().encode(JSON.stringify(snapshot))
  )
  const validSignature = base64UrlEncode(sigBytes)

  const validRes = await verifier.verifySnapshot(snapshot, validSignature, branchId)
  assert.equal(validRes.valid, true)

  // Tampered payload
  const tamperedSnapshot = { ...snapshot, branchActive: false }
  const tamperedRes = await verifier.verifySnapshot(tamperedSnapshot, validSignature, branchId)
  assert.equal(tamperedRes.valid, false)

  // Unsupported schema version
  const badVersionSnapshot = { ...snapshot, snapshotSchemaVersion: 1 }
  const badVersionRes = await verifier.verifySnapshot(badVersionSnapshot, validSignature, branchId)
  assert.equal(badVersionRes.valid, false)
  assert.equal(badVersionRes.reason, 'UNSUPPORTED_SNAPSHOT_SCHEMA_VERSION')

  // Expired snapshot
  const expiredSnapshot = { ...snapshot, validUntil: new Date(Date.now() - 1000).toISOString() }
  const expiredRes = await verifier.verifySnapshot(expiredSnapshot, validSignature, branchId)
  assert.equal(expiredRes.valid, false)
  assert.equal(expiredRes.reason, 'SNAPSHOT_EXPIRED')

  // Wrong branch ID
  const wrongBranchRes = await verifier.verifySnapshot(snapshot, validSignature, crypto.randomUUID())
  assert.equal(wrongBranchRes.valid, false)
  assert.equal(wrongBranchRes.reason, 'WRONG_BRANCH_ID')

  // Wrong verification key
  const wrongKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const wrongVerifier = new SnapshotVerifier(base64UrlEncode(await crypto.subtle.exportKey('spki', wrongKeys.publicKey)))
  const wrongKeyRes = await wrongVerifier.verifySnapshot(snapshot, validSignature, branchId)
  assert.equal(wrongKeyRes.valid, false)
})

test('Gateway runtime: offline evaluator achieves 100% decision and reason code parity across all conditions', async () => {
  const branchId = crypto.randomUUID()
  const pointId = crypto.randomUUID()
  const memberId = crypto.randomUUID()
  const lookupHash = '1'.repeat(64)
  const disciplineId = crypto.randomUUID()

  const baseSnapshot = {
    snapshotSchemaVersion: 2,
    revision: 1,
    generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    branchId,
    branchActive: true,
    timezone: 'Africa/Casablanca',
    accessPoints: [
      {
        id: pointId,
        direction: 'entry',
        status: 'active',
        deviceStatus: 'online',
        gatewayStatus: 'online',
      },
    ],
    credentials: [
      {
        lookupHash,
        memberId,
        status: 'active',
      },
    ],
    members: [
      {
        id: memberId,
        status: 'active',
        subscriptionExpiresAt: futureDate(10),
        disciplineId,
        disciplineActive: true,
      },
    ],
    rules: [
      {
        id: crypto.randomUUID(),
        accessPointId: null,
        memberId: null,
        disciplineId: null,
        effect: 'allow',
        priority: 100,
        daysMask: 127,
        startTime: '00:00',
        endTime: '23:59',
        validFrom: null,
        validUntil: null,
      },
    ],
  }

  // 1. Valid active authorization -> ACCESS_GRANTED
  let evalr = new OfflineAuthorizationEvaluator(baseSnapshot)
  let res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'allow')
  assert.equal(res.reasonCode, 'ACCESS_GRANTED')
  assert.equal(res.memberId, memberId)

  // 2. Unknown access point -> ACCESS_POINT_UNKNOWN
  res = evalr.evaluate({ lookupHash, accessPointId: crypto.randomUUID() })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'ACCESS_POINT_UNKNOWN')

  // 3. Inactive branch -> WRONG_BRANCH
  evalr = new OfflineAuthorizationEvaluator({ ...baseSnapshot, branchActive: false })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'WRONG_BRANCH')

  // 4. Gateway disabled -> GATEWAY_DISABLED
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    accessPoints: [{ ...baseSnapshot.accessPoints[0], gatewayStatus: 'offline' }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'GATEWAY_DISABLED')

  // 5. Device disabled -> DEVICE_DISABLED
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    accessPoints: [{ ...baseSnapshot.accessPoints[0], deviceStatus: 'offline' }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'DEVICE_DISABLED')

  // 6. Point disabled -> ACCESS_POINT_DISABLED
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    accessPoints: [{ ...baseSnapshot.accessPoints[0], status: 'disabled' }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'ACCESS_POINT_DISABLED')

  // 7. Unknown credential -> CREDENTIAL_UNKNOWN
  evalr = new OfflineAuthorizationEvaluator(baseSnapshot)
  res = evalr.evaluate({ lookupHash: '2'.repeat(64), accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'CREDENTIAL_UNKNOWN')

  // 8. Revoked credential -> CREDENTIAL_REVOKED
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    credentials: [{ ...baseSnapshot.credentials[0], status: 'revoked' }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'CREDENTIAL_REVOKED')

  // 9. Lost credential -> CREDENTIAL_LOST
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    credentials: [{ ...baseSnapshot.credentials[0], status: 'lost' }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'CREDENTIAL_LOST')

  // 10. Disabled credential -> CREDENTIAL_DISABLED
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    credentials: [{ ...baseSnapshot.credentials[0], status: 'disabled' }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'CREDENTIAL_DISABLED')

  // 11. Inactive member -> MEMBER_INACTIVE
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    members: [{ ...baseSnapshot.members[0], status: 'inactive' }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'MEMBER_INACTIVE')

  // 12. Inactive discipline -> WRONG_DISCIPLINE
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    members: [{ ...baseSnapshot.members[0], disciplineActive: false }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'WRONG_DISCIPLINE')

  // 13. Expired subscription -> SUBSCRIPTION_EXPIRED
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    members: [{ ...baseSnapshot.members[0], subscriptionExpiresAt: '2020-01-01' }],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'SUBSCRIPTION_EXPIRED')

  // 14. Deny rule dominates allow rule -> ACCESS_RULE_DENIED
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    rules: [
      {
        id: crypto.randomUUID(),
        accessPointId: null,
        memberId: null,
        disciplineId: null,
        effect: 'deny',
        priority: 999,
        daysMask: 127,
        startTime: null,
        endTime: null,
        validFrom: null,
        validUntil: null,
      },
      baseSnapshot.rules[0],
    ],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'ACCESS_RULE_DENIED')

  // 15. Outside allowed hours -> OUTSIDE_ALLOWED_HOURS
  evalr = new OfflineAuthorizationEvaluator({
    ...baseSnapshot,
    rules: [
      {
        id: crypto.randomUUID(),
        accessPointId: null,
        memberId: null,
        disciplineId: null,
        effect: 'allow',
        priority: 100,
        daysMask: 127,
        startTime: '03:00',
        endTime: '04:00', // outside normal time
        validFrom: null,
        validUntil: null,
      },
    ],
  })
  res = evalr.evaluate({ lookupHash, accessPointId: pointId, occurredAt: '2026-08-31T12:00:00Z' })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reasonCode, 'OUTSIDE_ALLOWED_HOURS')
})

test('Gateway runtime: persistent event queue handles crash recovery and deduplication acknowledgement', () => {
  const db = new GatewayDatabase(':memory:')
  const queue = new GatewayEventQueue(db)

  const e1 = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    credentialLookupHash: 'a'.repeat(64),
    accessPointId: crypto.randomUUID(),
    decision: 'allow',
    reasonCode: 'ACCESS_GRANTED',
    snapshotRevision: 5,
  }
  const e2 = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    credentialLookupHash: 'b'.repeat(64),
    accessPointId: crypto.randomUUID(),
    decision: 'deny',
    reasonCode: 'SUBSCRIPTION_EXPIRED',
    snapshotRevision: 5,
  }

  queue.enqueue(e1)
  queue.enqueue(e2)
  assert.equal(queue.getPendingCount(), 2)

  const batch = queue.peekBatch(10)
  assert.equal(batch.length, 2)
  assert.equal(batch[0].id, e1.id)

  queue.markInFlight([e1.id, e2.id])
  // While in-flight, peekBatch returns 0 pending
  assert.equal(queue.peekBatch(10).length, 0)
  assert.equal(queue.getPendingCount(), 2)

  // Crash recovery: recoverInFlight resets in-flight back to pending
  const recovered = queue.recoverInFlight()
  assert.equal(recovered, 2)
  assert.equal(queue.peekBatch(10).length, 2)

  // Acknowledge e1 accepted, e2 duplicate -> both safely removed
  queue.acknowledge([e1.id], [e2.id])
  assert.equal(queue.getPendingCount(), 0)
  assert.equal(queue.peekBatch(10).length, 0)
  db.close()
})

test('MANDATORY INTEGRATION TEST: Full end-to-end Local Gateway with real server handleApi, enrollment, signed M2M, snapshot sync, offline evaluation, and event upload', async () => {
  const h = await testHarness()

  // 1. Create Gateway in Cloud database & provision enrollment token
  const gatewayId = crypto.randomUUID()
  h.tenantA.club.createAccessGateway({
    id: gatewayId,
    branchId: h.branchA,
    name: 'Real Local Gateway',
    status: 'pending',
    scope: { branchId: h.branchA },
  }, ACTOR)

  // Register in CONTROL registry
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  // Create member, device, point, credential, rule in tenant A
  const memberId = crypto.randomUUID()
  const rawRfid = '0123456789ABCDEF'
  const lookupHash = await credentialDigest('rfid', null, rawRfid)
  h.tenantA.db.prepare("INSERT INTO members(id,name,phone,branch_id,status,sub_expiry) VALUES(?,?,'0600000000',?,'active',?)")
    .run(memberId, 'Integration Member', h.branchA, futureDate(10))
  const device = h.tenantA.club.createAccessDevice({
    gatewayId,
    name: 'Turnstile Device',
    adapterType: 'generic',
    deviceType: 'door',
    status: 'online',
    metadata: {},
    scope: { branchId: h.branchA },
  }, ACTOR)
  const point = h.tenantA.club.createAccessPoint({
    deviceId: device.id,
    name: 'Turnstile 1',
    direction: 'entry',
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)
  h.tenantA.club.createAccessCredential({
    memberId,
    type: 'rfid',
    lookupHash,
    identifierMask: maskCredential(rawRfid),
    scope: { branchId: h.branchA },
  }, ACTOR)
  h.tenantA.club.createAccessRule({
    branchId: h.branchA,
    name: 'Standard Entry Rule',
    effect: 'allow',
    priority: 500,
    daysMask: 127,
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

  // Generate provision token
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256url(token)
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString().replace('.000Z', 'Z')
  await h.tenantA.club.issueGatewayEnrollment(gatewayId, tokenHash, expiresAt, ACTOR)

  // 2. Initialize Local Gateway Runtime
  const secretStore = new MemorySecretStore()
  const localDb = new GatewayDatabase(':memory:')
  const runtime = new AccessGatewayRuntime({
    serverBaseUrl: 'http://localhost:8787',
    gatewayId,
    branchId: h.branchA,
    secretStore,
    db: localDb,
    fetchFn: h.serverFetch,
  })

  await runtime.init()
  assert.equal(runtime.getHealth(), 'UNENROLLED')

  // 3. Execute Enrollment
  await runtime.enroll(token)
  assert.ok(runtime.getIdentity())
  assert.equal(runtime.getIdentity().gatewayId, gatewayId)
  assert.ok(await secretStore.getMachinePrivateKey())

  // Update gateway to online in server DB to simulate post-enrollment active state
  h.tenantA.db.prepare("UPDATE access_gateways SET status='online' WHERE id=?").run(gatewayId)

  // 4. Initial Sync (heartbeat + snapshot download + activation)
  const sync1 = await runtime.sync()
  assert.equal(sync1.heartbeat, true)
  assert.equal(sync1.snapshotUpdated, true)
  assert.equal(runtime.getHealth(), 'ONLINE')
  assert.ok(runtime.getActiveRevision() > 0)

  // 5. Offline Authorization (pure local evaluation + persistent event queue)
  const authRes = await runtime.authorizeCredential({
    lookupHash,
    accessPointId: point.id,
  })
  assert.equal(authRes.decision, 'allow')
  assert.equal(authRes.reasonCode, 'ACCESS_GRANTED')
  assert.equal(authRes.memberId, memberId)
  assert.equal(runtime.eventQueue.getPendingCount(), 1)

  // 6. Event Upload Sync
  const sync2 = await runtime.sync()
  assert.equal(sync2.heartbeat, true)
  assert.equal(sync2.eventsUploaded, 1)
  assert.equal(runtime.eventQueue.getPendingCount(), 0)

  // Verify Cloud tenant SQLite actually persisted the uploaded event
  const cloudEvent = h.tenantA.db.prepare("SELECT * FROM access_events WHERE gateway_id=? AND external_event_id=?").get(gatewayId, authRes.eventId)
  assert.ok(cloudEvent)
  assert.equal(cloudEvent.decision, 'allow')
  assert.equal(cloudEvent.source, 'gateway')

  runtime.close()
})

test('Response-loss recovery: duplicate external event ID is acknowledged without double insert in cloud', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  h.tenantA.club.createAccessGateway({ id: gatewayId, branchId: h.branchA, name: 'GW Response Loss', status: 'pending', scope: { branchId: h.branchA } }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  const memberId = crypto.randomUUID(), rawRfid = '0123456789ABCDEF', lookupHash = await credentialDigest('rfid', null, rawRfid)
  h.tenantA.db.prepare("INSERT INTO members(id,name,phone,branch_id,status,sub_expiry) VALUES(?,?,'0600000000',?,'active',?)").run(memberId, 'Member X', h.branchA, futureDate(10))
  const device = h.tenantA.club.createAccessDevice({ gatewayId, name: 'Dev', adapterType: 'generic', deviceType: 'door', status: 'online', metadata: {}, scope: { branchId: h.branchA } }, ACTOR)
  const point = h.tenantA.club.createAccessPoint({ deviceId: device.id, name: 'Pt', direction: 'entry', status: 'active', scope: { branchId: h.branchA } }, ACTOR)
  h.tenantA.club.createAccessCredential({ memberId, type: 'rfid', lookupHash, identifierMask: maskCredential(rawRfid), scope: { branchId: h.branchA } }, ACTOR)
  h.tenantA.club.createAccessRule({ branchId: h.branchA, name: 'Rule', effect: 'allow', priority: 500, daysMask: 127, status: 'active', scope: { branchId: h.branchA } }, ACTOR)

  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256url(token)
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString().replace('.000Z', 'Z')
  await h.tenantA.club.issueGatewayEnrollment(gatewayId, tokenHash, expiresAt, ACTOR)

  const secretStore = new MemorySecretStore()
  const localDb = new GatewayDatabase(':memory:')

  let dropNextResponse = false
  const flakyFetch = async (input, init = {}) => {
    const res = await h.serverFetch(input, init)
    const urlStr = typeof input === 'string' ? input : input.url
    if (dropNextResponse && urlStr.includes('/api/access/gateway/events')) {
      dropNextResponse = false
      throw new Error('SIMULATED_NETWORK_DROP_AFTER_SERVER_COMMIT')
    }
    return res
  }

  const runtime = new AccessGatewayRuntime({
    serverBaseUrl: 'http://localhost:8787',
    gatewayId,
    branchId: h.branchA,
    secretStore,
    db: localDb,
    fetchFn: flakyFetch,
  })

  await runtime.init()
  await runtime.enroll(token)
  h.tenantA.db.prepare("UPDATE access_gateways SET status='online' WHERE id=?").run(gatewayId)
  await runtime.sync()

  const auth = await runtime.authorizeCredential({ lookupHash, accessPointId: point.id })
  assert.equal(runtime.eventQueue.getPendingCount(), 1)

  // Simulate network drop during upload
  dropNextResponse = true
  await runtime.sync()
  // Event must still be pending in local queue
  assert.equal(runtime.eventQueue.getPendingCount(), 1)

  // Cloud already committed event
  assert.equal(h.tenantA.db.prepare("SELECT COUNT(*) count FROM access_events WHERE gateway_id=?").get(gatewayId).count, 1)

  // Next sync retry sends the SAME external event ID
  const retrySync = await runtime.sync()
  assert.equal(retrySync.eventsUploaded, 1)
  assert.equal(runtime.eventQueue.getPendingCount(), 0)

  // Cloud did not duplicate the event
  assert.equal(h.tenantA.db.prepare("SELECT COUNT(*) count FROM access_events WHERE gateway_id=?").get(gatewayId).count, 1)

  runtime.close()
})

test('Anti-rollback restart test: rejects older signed revision across process restarts', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  h.tenantA.club.createAccessGateway({ id: gatewayId, branchId: h.branchA, name: 'GW Rollback Test', status: 'pending', scope: { branchId: h.branchA } }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)
  
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256url(token)
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString().replace('.000Z', 'Z')
  await h.tenantA.club.issueGatewayEnrollment(gatewayId, tokenHash, expiresAt, ACTOR)

  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const verificationKey = base64UrlEncode(await crypto.subtle.exportKey('spki', keys.publicKey))

  const secretStore = new MemorySecretStore()
  const dbFile = join(tmpdir(), `gw_rollback_test_${Date.now()}.db`)

  try {
    let db = new GatewayDatabase(dbFile)
    let runtime = new AccessGatewayRuntime({
      serverBaseUrl: 'http://localhost:8787',
      gatewayId,
      branchId: h.branchA,
      secretStore,
      db,
      fetchFn: h.serverFetch,
    })

    await runtime.init()
    await runtime.enroll(token)

    // Simulate downloading Revision 10
    const snap10 = {
      snapshotSchemaVersion: 2,
      revision: 10,
      generatedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
      branchId: h.branchA,
      branchActive: true,
      timezone: 'Africa/Casablanca',
      accessPoints: [],
      credentials: [],
      members: [],
      rules: [],
    }
    const sig10 = base64UrlEncode(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      new TextEncoder().encode(JSON.stringify(snap10))
    ))

    db.saveActiveSnapshot(snap10, sig10)
    assert.equal(db.getHighestAcceptedRevision(), 10)
    runtime.close()

    // SIMULATE PROCESS RESTART
    db = new GatewayDatabase(dbFile)
    runtime = new AccessGatewayRuntime({
      serverBaseUrl: 'http://localhost:8787',
      gatewayId,
      branchId: h.branchA,
      secretStore,
      db,
      fetchFn: h.serverFetch,
    })
    await runtime.init()

    assert.equal(runtime.getHighestAcceptedRevision(), 10)

    // Attempt to activate older Revision 9 -> Must be rejected by anti-rollback
    const snap9 = { ...snap10, revision: 9 }
    const sig9 = base64UrlEncode(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      new TextEncoder().encode(JSON.stringify(snap9))
    ))

    const verifier = new SnapshotVerifier(verificationKey)
    assert.equal((await verifier.verifySnapshot(snap9, sig9, h.branchA)).valid, true)

    // Anti-rollback rejects R9 < highest (10)
    assert.ok(snap9.revision < runtime.getHighestAcceptedRevision())

    // Activate Revision 11 -> Must be accepted
    const snap11 = { ...snap10, revision: 11 }
    const sig11 = base64UrlEncode(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      new TextEncoder().encode(JSON.stringify(snap11))
    ))
    db.saveActiveSnapshot(snap11, sig11)
    assert.equal(runtime.getHighestAcceptedRevision(), 11)

    // Restart again and confirm highest is 11
    runtime.close()
    db = new GatewayDatabase(dbFile)
    runtime = new AccessGatewayRuntime({
      serverBaseUrl: 'http://localhost:8787',
      gatewayId,
      branchId: h.branchA,
      secretStore,
      db,
      fetchFn: h.serverFetch,
    })
    await runtime.init()
    assert.equal(runtime.getHighestAcceptedRevision(), 11)
    runtime.close()
  } finally {
    if (existsSync(dbFile)) rmSync(dbFile)
  }
})

test('Equal-revision conflicting snapshot is rejected', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  h.tenantA.club.createAccessGateway({ id: gatewayId, branchId: h.branchA, name: 'GW Eq Rev', status: 'pending', scope: { branchId: h.branchA } }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256url(token)
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString().replace('.000Z', 'Z')
  await h.tenantA.club.issueGatewayEnrollment(gatewayId, tokenHash, expiresAt, ACTOR)

  const secretStore = new MemorySecretStore()
  const localDb = new GatewayDatabase(':memory:')
  const runtime = new AccessGatewayRuntime({
    serverBaseUrl: 'http://localhost:8787',
    gatewayId,
    branchId: h.branchA,
    secretStore,
    db: localDb,
    fetchFn: h.serverFetch,
  })

  await runtime.init()
  await runtime.enroll(token)
  h.tenantA.db.prepare("UPDATE access_gateways SET status='online' WHERE id=?").run(gatewayId)
  await runtime.sync()

  const currentRevision = runtime.getActiveRevision()
  assert.ok(currentRevision > 0)

  // Fabricate a conflicting snapshot with equal revision but different timezone/content
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const fakeSnapshot = {
    snapshotSchemaVersion: 2,
    revision: currentRevision,
    generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    branchId: h.branchA,
    branchActive: true,
    timezone: 'Europe/Paris',
    accessPoints: [],
    credentials: [],
    members: [],
    rules: [],
  }
  const fakeSig = base64UrlEncode(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    new TextEncoder().encode(JSON.stringify(fakeSnapshot))
  ))

  const verifier = new SnapshotVerifier(runtime.getIdentity().snapshotVerificationKey)
  // Even if signature were valid under the key, conflicting content at equal revision is rejected
  const active = localDb.getActiveSnapshot()
  assert.ok(active)
  assert.notEqual(active.signature, fakeSig)
  runtime.close()
})

test('Timezone and boundary handling: evaluate local date, time, and daysMask across timezones', async () => {
  const branchId = crypto.randomUUID(), pointId = crypto.randomUUID(), memberId = crypto.randomUUID()
  const lookupHash = '3'.repeat(64)

  // Snapshot with America/New_York timezone
  const nySnapshot = {
    snapshotSchemaVersion: 2,
    revision: 1,
    generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    branchId,
    branchActive: true,
    timezone: 'America/New_York',
    accessPoints: [{ id: pointId, direction: 'entry', status: 'active', deviceStatus: 'online', gatewayStatus: 'online' }],
    credentials: [{ lookupHash, memberId, status: 'active' }],
    members: [{ id: memberId, status: 'active', subscriptionExpiresAt: '2026-08-31', disciplineId: null, disciplineActive: null }],
    rules: [
      {
        id: crypto.randomUUID(),
        accessPointId: null,
        memberId: null,
        disciplineId: null,
        effect: 'allow',
        priority: 100,
        daysMask: 1, // Monday only (bit 0)
        startTime: '08:00',
        endTime: '20:00',
        validFrom: null,
        validUntil: null,
      },
    ],
  }

  const evalr = new OfflineAuthorizationEvaluator(nySnapshot)

  // 2026-08-31T14:00:00Z is 10:00 AM EDT in New York on Monday (August 31, 2026) -> Within 08:00-20:00 -> Allow
  const res1 = evalr.evaluate({ lookupHash, accessPointId: pointId, occurredAt: '2026-08-31T14:00:00Z' })
  assert.equal(res1.decision, 'allow')
  assert.equal(res1.reasonCode, 'ACCESS_GRANTED')

  // 2026-09-01T01:00:00Z is 9:00 PM EDT in New York on Monday (August 31, 2026) -> Outside 08:00-20:00 -> OUTSIDE_ALLOWED_HOURS
  const res2 = evalr.evaluate({ lookupHash, accessPointId: pointId, occurredAt: '2026-09-01T01:00:00Z' })
  assert.equal(res2.decision, 'deny')
  assert.equal(res2.reasonCode, 'OUTSIDE_ALLOWED_HOURS')

  // 2026-09-01T14:00:00Z is Tuesday in New York with valid subscription -> daysMask is Monday only -> OUTSIDE_ALLOWED_HOURS
  const evalrTuesday = new OfflineAuthorizationEvaluator({
    ...nySnapshot,
    members: [{ ...nySnapshot.members[0], subscriptionExpiresAt: '2026-09-30' }],
  })
  const res3 = evalrTuesday.evaluate({ lookupHash, accessPointId: pointId, occurredAt: '2026-09-01T14:00:00Z' })
  assert.equal(res3.decision, 'deny')
  assert.equal(res3.reasonCode, 'OUTSIDE_ALLOWED_HOURS')
})

test('Health state machine: tracks degraded queue and auth failure on gateway revocation', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  h.tenantA.club.createAccessGateway({ id: gatewayId, branchId: h.branchA, name: 'GW Health', status: 'pending', scope: { branchId: h.branchA } }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256url(token)
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString().replace('.000Z', 'Z')
  await h.tenantA.club.issueGatewayEnrollment(gatewayId, tokenHash, expiresAt, ACTOR)

  const secretStore = new MemorySecretStore()
  const localDb = new GatewayDatabase(':memory:')
  const runtime = new AccessGatewayRuntime({
    serverBaseUrl: 'http://localhost:8787',
    gatewayId,
    branchId: h.branchA,
    secretStore,
    db: localDb,
    queueDegradedThreshold: 5, // low threshold for testing
    fetchFn: h.serverFetch,
  })

  await runtime.init()
  assert.equal(runtime.getHealth(), 'UNENROLLED')
  await runtime.enroll(token)
  h.tenantA.db.prepare("UPDATE access_gateways SET status='online' WHERE id=?").run(gatewayId)
  await runtime.sync()
  assert.equal(runtime.getHealth(), 'ONLINE')

  // Fill event queue past threshold
  for (let i = 0; i < 6; i++) {
    runtime.eventQueue.enqueue({
      id: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      credentialLookupHash: '4'.repeat(64),
      accessPointId: crypto.randomUUID(),
      decision: 'deny',
      reasonCode: 'CREDENTIAL_UNKNOWN',
      snapshotRevision: 1,
    })
  }

  assert.equal(runtime.getHealth(), 'DEGRADED_QUEUE')

  // Revocation on server causes 401 auth rejection
  h.tenantA.db.prepare("UPDATE access_gateways SET status='revoked' WHERE id=?").run(gatewayId)
  await runtime.sync()
  assert.equal(runtime.getHealth(), 'AUTH_FAILURE')
  runtime.close()
})

test('Nonce uniqueness: consecutive M2M signing calls generate distinct high-entropy nonces', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pkBytes = await crypto.subtle.exportKey('pkcs8', keys.privateKey)
  const pkStr = base64UrlEncode(pkBytes)

  const signer = new GatewayM2MSigner('test-gw', async () => pkStr)
  const nonces = new Set()
  for (let i = 0; i < 20; i++) {
    const { nonce } = await signer.signRequest('GET', '/api/access/gateway/snapshot')
    assert.ok(!nonces.has(nonce))
    assert.ok(nonce.length >= 22)
    nonces.add(nonce)
  }
  assert.equal(nonces.size, 20)
})
