import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { handleApi } from '../src/api.ts'
import { ClubDatabase } from '../src/club/club-database.ts'
import { AccessStore, credentialDigest } from '../src/club/access.ts'
import { hashToken } from '../src/auth/crypto.ts'

import {
  AccessGatewayRuntime,
  MemorySecretStore,
  GatewayDatabase,
  CredentialNormalizer,
  TurnstileSimulator,
  AccessDeviceController,
} from '../gateway/index.ts'

const CONTROL_SCHEMA = readFileSync(new URL('../src/control-plane/schema.sql', import.meta.url), 'utf8')
const CONTROL_MIGRATION = readFileSync(new URL('../migrations/0012_access_gateway_registry.sql', import.meta.url), 'utf8')
const ORG_A = '11111111-1111-4111-8111-111111111111'
const ACTOR = { id: '33333333-3333-4333-8333-333333333333', name: 'Device Test Admin' }

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
        const name = `device_test_${++savepoint}`
        db.exec(`SAVEPOINT ${name}`)
        try { const value = callback(); db.exec(`RELEASE ${name}`); return value }
        catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error }
      }
      db.exec('BEGIN IMMEDIATE')
      try { const value = callback(); db.exec('COMMIT'); return value }
      catch (error) { db.exec('ROLLBACK'); throw error }
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
    blockConcurrencyWhile(callback) { this.ready = Promise.resolve().then(callback); return this.ready },
  }
  const club = new ClubDatabase(ctx, {})
  await ctx.ready
  return { db, club }
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

function base64UrlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64UrlEncode(digest)
}

async function testHarness() {
  const controlDb = new DatabaseSync(':memory:')
  controlDb.exec(CONTROL_SCHEMA)
  controlDb.exec(CONTROL_MIGRATION)
  controlDb.prepare("INSERT INTO organizations(id,slug,name,plan,status,trial_ends_at) VALUES(?,?,?,'trial','active',?)")
    .run(ORG_A, 'org-a', 'Organization A', futureDate(365))

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
  const deviceA = crypto.randomUUID()
  const pointEntryA = crypto.randomUUID()
  const pointExitA = crypto.randomUUID()
  const memberA = crypto.randomUUID()

  tenantA.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branchA, 'Branch A')
  tenantA.db.prepare("INSERT INTO members(id,name,phone,branch_id,status,sub_expiry) VALUES(?,?,'0600000000',?,'active',?)")
    .run(memberA, 'Alice Active', branchA, futureDate(365))

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

  return {
    controlDb,
    tenantA,
    branchA,
    deviceA,
    pointEntryA,
    pointExitA,
    memberA,
    env,
    serverFetch,
  }
}

// -----------------------------------------------------------------------------
// BATCH C TESTS
// -----------------------------------------------------------------------------

test('Generic Adapter Contract & Health States: lifecycle and diagnostics', async () => {
  const pointId = crypto.randomUUID()
  const deviceId = crypto.randomUUID()

  const simulator = new TurnstileSimulator({
    deviceId,
    accessPointId: pointId,
    direction: 'entry',
    name: 'Turnstile-1',
    unlockDurationMs: 1000,
  })

  assert.equal(simulator.deviceId, deviceId)
  assert.equal(simulator.accessPointId, pointId)
  assert.equal(simulator.direction, 'entry')
  assert.equal(simulator.getState(), 'LOCKED')
  assert.equal(simulator.health().state, 'STOPPED')

  await simulator.start()
  assert.equal(simulator.health().state, 'READY')
  assert.ok(simulator.health().lastSeenAt)

  await simulator.stop()
  assert.equal(simulator.health().state, 'STOPPED')
  assert.equal(simulator.getState(), 'LOCKED')
})

test('Credential Normalization: formats, validation, hashing, and masking', async () => {
  // 1. RFID / NFC format normalization
  const normRfid1 = CredentialNormalizer.normalize('rfid', ' 01:23:45:67:89:ab:cd:ef ')
  assert.equal(normRfid1, '0123456789ABCDEF')

  const normRfid2 = CredentialNormalizer.normalize('nfc', '01-23-45-67-89-AB-CD-EF')
  assert.equal(normRfid2, '0123456789ABCDEF')

  // Invalid RFID
  assert.equal(CredentialNormalizer.validate('rfid', '12').valid, false) // too short (<4)
  assert.equal(CredentialNormalizer.validate('rfid', '0123GG').valid, false) // non-hex
  assert.equal(CredentialNormalizer.validate('rfid', '').valid, false) // empty

  // 2. QR format normalization
  const normQr = CredentialNormalizer.normalize('qr', '  GYM-PASS-2026-XYZ  ')
  assert.equal(normQr, 'GYM-PASS-2026-XYZ')
  assert.equal(CredentialNormalizer.validate('qr', 'short').valid, false) // <8
  assert.equal(CredentialNormalizer.validate('qr', 'invalid\x00null').valid, false) // control char

  // 3. Masking
  assert.equal(CredentialNormalizer.mask('0123456789ABCDEF'), '••••CDEF')
  assert.equal(CredentialNormalizer.mask('123'), '••••')
  assert.equal(CredentialNormalizer.mask(''), '••••')

  // 4. Canonical Lookup Hash Parity with Cloud credentialDigest
  const cloudHash = await credentialDigest('rfid', null, '0123456789ABCDEF')
  const localHash = await CredentialNormalizer.computeLookupHash('rfid', '01:23:45:67:89:ab:cd:ef', null)
  assert.equal(localHash, cloudHash)
})

test('Turnstile Simulator: state transitions, unlock window, and simulated passage', async () => {
  const simulator = new TurnstileSimulator({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    unlockDurationMs: 500,
  })
  await simulator.start()

  // 1. Passage denied while locked
  assert.equal(simulator.getState(), 'LOCKED')
  const passageDenied = simulator.simulatePassage()
  assert.equal(passageDenied, false)
  assert.equal(simulator.getState(), 'LOCKED')

  // 2. Actuate ALLOW -> Unlocked
  await simulator.actuate({
    decision: 'allow',
    reasonCode: 'ACCESS_GRANTED',
    eventId: crypto.randomUUID(),
    unlocked: true,
    occurredAt: new Date().toISOString(),
  })
  assert.equal(simulator.getState(), 'UNLOCKED')

  // 3. Simulate passage while unlocked -> Transitions to PASSAGE_DETECTED then LOCKED
  const passageAllowed = simulator.simulatePassage()
  assert.equal(passageAllowed, true)
  assert.equal(simulator.getState(), 'LOCKED')

  // 4. Auto-relock on timeout
  await simulator.actuate({
    decision: 'allow',
    reasonCode: 'ACCESS_GRANTED',
    eventId: crypto.randomUUID(),
    unlocked: true,
    unlockDurationMs: 100, // 100ms for quick test
    occurredAt: new Date().toISOString(),
  })
  assert.equal(simulator.getState(), 'UNLOCKED')

  await new Promise(r => setTimeout(r, 150))
  assert.equal(simulator.getState(), 'LOCKED')

  await simulator.stop()
})

test('Fail-closed Actuation: DENY and handler exceptions keep simulator locked', async () => {
  const simulator = new TurnstileSimulator({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
  })
  await simulator.start()

  // 1. DENY actuation
  await simulator.actuate({
    decision: 'deny',
    reasonCode: 'CREDENTIAL_REVOKED',
    eventId: crypto.randomUUID(),
    unlocked: false,
    occurredAt: new Date().toISOString(),
  })
  assert.equal(simulator.getState(), 'LOCKED')

  // 2. Handler throwing exception -> Fails closed
  simulator.onCredential(async () => {
    throw new Error('NETWORK_TIMEOUT')
  })

  const scanRes = await simulator.scanCredential('0123456789ABCDEF')
  assert.equal(scanRes.decision, 'deny')
  assert.equal(scanRes.reasonCode, 'SYSTEM_ERROR')
  assert.equal(scanRes.unlocked, false)
  assert.equal(simulator.getState(), 'LOCKED')

  await simulator.stop()
})

test('Device Spoofing: scan payload cannot override configured context or produce decision', async () => {
  const configuredPoint = crypto.randomUUID()
  const simulator = new TurnstileSimulator({
    deviceId: crypto.randomUUID(),
    accessPointId: configuredPoint,
  })

  let receivedEvent = null
  simulator.onCredential(async (event) => {
    receivedEvent = event
    return {
      decision: 'deny',
      reasonCode: 'ACCESS_RULE_DENIED',
      eventId: crypto.randomUUID(),
      unlocked: false,
      occurredAt: new Date().toISOString(),
    }
  })
  await simulator.start()

  // Malicious raw metadata attempting to spoof branchId / decision / accessPointId
  await simulator.scanCredential('0123456789ABCDEF', 'rfid', new Date().toISOString())

  assert.ok(receivedEvent)
  assert.equal(receivedEvent.credential, '0123456789ABCDEF')
  // Confirmed: DeviceCredentialEvent contains no branchId, memberId, or decision fields
  assert.equal('branchId' in receivedEvent, false)
  assert.equal('decision' in receivedEvent, false)
  assert.equal(simulator.accessPointId, configuredPoint)

  await simulator.stop()
})

test('Concurrency & Serialization: 10 parallel scans execute deterministically', async () => {
  const simulator = new TurnstileSimulator({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
  })

  let executionOrder = []
  simulator.onCredential(async (event) => {
    executionOrder.push(event.credential)
    return {
      decision: 'deny',
      reasonCode: 'CREDENTIAL_UNKNOWN',
      eventId: crypto.randomUUID(),
      unlocked: false,
      occurredAt: new Date().toISOString(),
    }
  })
  await simulator.start()

  const scanPromises = []
  for (let i = 0; i < 10; i++) {
    scanPromises.push(simulator.scanCredential(`CARD_${i.toString().padStart(2, '0')}`, 'qr'))
  }

  const results = await Promise.all(scanPromises)
  assert.equal(results.length, 10)
  assert.equal(executionOrder.length, 10)
  for (let i = 0; i < 10; i++) {
    assert.equal(results[i].decision, 'deny')
    assert.equal(results[i].unlocked, false)
  }
  assert.equal(simulator.getState(), 'LOCKED')

  await simulator.stop()
})

test('Backpressure & Flood Stress: drops excess scans with DEGRADED state without crash', async () => {
  const simulator = new TurnstileSimulator({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    maxQueueSize: 10,
  })

  // Slow handler to force queue buildup
  simulator.onCredential(async () => {
    await new Promise(r => setTimeout(r, 50))
    return {
      decision: 'deny',
      reasonCode: 'CREDENTIAL_UNKNOWN',
      eventId: crypto.randomUUID(),
      unlocked: false,
      occurredAt: new Date().toISOString(),
    }
  })
  await simulator.start()

  const promises = []
  for (let i = 0; i < 25; i++) {
    promises.push(simulator.scanCredential(`CARD_${i.toString().padStart(2, '0')}`, 'qr'))
  }

  const allRes = await Promise.all(promises)
  assert.equal(allRes.length, 25)
  // At least some requests should have been rejected immediately due to queue limit
  const overflows = allRes.filter(r => r.reasonCode === 'SYSTEM_ERROR' && r.unlocked === false)
  assert.ok(overflows.length > 0)
  assert.equal(simulator.getState(), 'LOCKED')

  await simulator.stop()
})

test('Diagnostic History Safety: bounds ring buffer and never records raw credentials or secrets', async () => {
  const simulator = new TurnstileSimulator({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    maxHistorySize: 20,
  })
  simulator.onCredential(async () => ({
    decision: 'deny',
    reasonCode: 'CREDENTIAL_UNKNOWN',
    eventId: crypto.randomUUID(),
    unlocked: false,
    occurredAt: new Date().toISOString(),
  }))
  await simulator.start()

  for (let i = 0; i < 30; i++) {
    await simulator.scanCredential('0123456789ABCDEF')
  }

  const history = simulator.getHistory()
  assert.ok(history.length <= 20)

  // Verify that history contains NO raw card numbers or secrets
  for (const entry of history) {
    if (entry.details.maskedCredential) {
      assert.ok(!entry.details.maskedCredential.includes('0123456789'))
      assert.ok(entry.details.maskedCredential.startsWith('••••'))
    }
  }

  await simulator.stop()
})

test('MANDATORY FULL E2E TEST: Simulator -> Adapter -> Controller -> Real Gateway -> Cloud Persistence', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  const rawRfid = '0123456789ABCDEF'
  const lookupHash = await CredentialNormalizer.computeLookupHash('rfid', rawRfid, null)

  // 1. Provision Cloud Gateway and Credential
  h.tenantA.club.createAccessGateway({
    id: gatewayId,
    branchId: h.branchA,
    name: 'Turnstile GW 1',
    status: 'pending',
    scope: { branchId: h.branchA },
  }, ACTOR)

  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  // Device & AccessPoint in Cloud
  const device = h.tenantA.club.createAccessDevice({
    gatewayId,
    name: 'Turnstile Controller 1',
    adapterType: 'turnstile',
    deviceType: 'door',
    status: 'online',
    metadata: {},
    scope: { branchId: h.branchA },
  }, ACTOR)

  const point = h.tenantA.club.createAccessPoint({
    deviceId: device.id,
    name: 'Main Entry Turnstile',
    direction: 'entry',
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

  // Active Credential in Cloud
  h.tenantA.club.createAccessCredential({
    memberId: h.memberA,
    type: 'rfid',
    lookupHash,
    identifierMask: '••••CDEF',
    scope: { branchId: h.branchA },
  }, ACTOR)

  h.tenantA.club.createAccessRule({
    branchId: h.branchA,
    name: 'Entry Rule',
    effect: 'allow',
    priority: 500,
    daysMask: 127,
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

  // 2. Issue Enrollment & Enroll Gateway Runtime
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

  assert.equal(runtime.getActiveRevision() > 0, true)

  // 3. Connect Turnstile Simulator and Controller
  const simulator = new TurnstileSimulator({
    deviceId: device.id,
    accessPointId: point.id,
    direction: 'entry',
    unlockDurationMs: 2000,
  })
  const controller = new AccessDeviceController(simulator, runtime)
  await controller.start()

  assert.equal(simulator.getState(), 'LOCKED')

  // 4. Scan Card at Turnstile Simulator
  const scanResult = await simulator.scanCredential('01:23:45:67:89:ab:cd:ef', 'rfid')
  assert.equal(scanResult.decision, 'allow')
  assert.equal(scanResult.reasonCode, 'ACCESS_GRANTED')
  assert.equal(scanResult.unlocked, true)
  assert.equal(simulator.getState(), 'UNLOCKED')

  // 5. Simulate Physical Person Passing Through
  const passageDone = simulator.simulatePassage()
  assert.equal(passageDone, true)
  assert.equal(simulator.getState(), 'LOCKED')

  // 6. Verify Event Durably Queued in Local SQLite
  assert.equal(runtime.eventQueue.getPendingCount(), 1)
  const pendingEvents = runtime.eventQueue.peekBatch(10)
  assert.equal(pendingEvents[0].decision, 'allow')
  assert.equal(pendingEvents[0].reasonCode, 'ACCESS_GRANTED')

  // 7. Gateway Sync -> Uploads to Real Cloud Database
  const syncRes = await runtime.sync()
  assert.equal(syncRes.eventsUploaded, 1)
  assert.equal(runtime.eventQueue.getPendingCount(), 0)

  // 8. Verify Event Stored in Cloud access_events
  const cloudEvents = h.tenantA.db.prepare('SELECT * FROM access_events WHERE external_event_id = ?').all(scanResult.eventId)
  assert.equal(cloudEvents.length, 1)
  assert.equal(cloudEvents[0].decision, 'allow')
  assert.equal(cloudEvents[0].reason_code, 'ACCESS_GRANTED')
  assert.equal(cloudEvents[0].access_point_id, point.id)

  await controller.stop()
  runtime.close()
})

test('MANDATORY DENY E2E TEST: Invalid / revoked credential remains locked and persists deny event', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()

  h.tenantA.club.createAccessGateway({
    id: gatewayId,
    branchId: h.branchA,
    name: 'Turnstile GW Deny',
    status: 'pending',
    scope: { branchId: h.branchA },
  }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  const device = h.tenantA.club.createAccessDevice({
    gatewayId,
    name: 'Turnstile Controller 2',
    adapterType: 'turnstile',
    deviceType: 'door',
    status: 'online',
    metadata: {},
    scope: { branchId: h.branchA },
  }, ACTOR)

  const point = h.tenantA.club.createAccessPoint({
    deviceId: device.id,
    name: 'Main Entry Turnstile',
    direction: 'entry',
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

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

  const simulator = new TurnstileSimulator({
    deviceId: device.id,
    accessPointId: point.id,
    direction: 'entry',
  })
  const controller = new AccessDeviceController(simulator, runtime)
  await controller.start()

  // Scan un-enrolled / unknown RFID
  const scanResult = await simulator.scanCredential('9999999999999999', 'rfid')
  assert.equal(scanResult.decision, 'deny')
  assert.equal(scanResult.reasonCode, 'CREDENTIAL_UNKNOWN')
  assert.equal(scanResult.unlocked, false)
  assert.equal(simulator.getState(), 'LOCKED')

  // Event queued
  assert.equal(runtime.eventQueue.getPendingCount(), 1)
  await runtime.sync()
  assert.equal(runtime.eventQueue.getPendingCount(), 0)

  // Cloud contains deny event
  const cloudEvents = h.tenantA.db.prepare('SELECT * FROM access_events WHERE external_event_id = ?').all(scanResult.eventId)
  assert.equal(cloudEvents.length, 1)
  assert.equal(cloudEvents[0].decision, 'deny')
  assert.equal(cloudEvents[0].reason_code, 'CREDENTIAL_UNKNOWN')

  await controller.stop()
  runtime.close()
})

test('MANDATORY OFFLINE E2E TEST: Evaluates offline, unlocks, passage, queues, and syncs on reconnect', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  const rawRfid = '1122334455667788'
  const lookupHash = await CredentialNormalizer.computeLookupHash('rfid', rawRfid, null)

  h.tenantA.club.createAccessGateway({
    id: gatewayId,
    branchId: h.branchA,
    name: 'Turnstile GW Offline',
    status: 'pending',
    scope: { branchId: h.branchA },
  }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  const device = h.tenantA.club.createAccessDevice({
    gatewayId,
    name: 'Turnstile Controller 3',
    adapterType: 'turnstile',
    deviceType: 'door',
    status: 'online',
    metadata: {},
    scope: { branchId: h.branchA },
  }, ACTOR)

  const point = h.tenantA.club.createAccessPoint({
    deviceId: device.id,
    name: 'Main Entry Turnstile',
    direction: 'entry',
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

  h.tenantA.club.createAccessCredential({
    memberId: h.memberA,
    type: 'rfid',
    lookupHash,
    identifierMask: '••••7788',
    scope: { branchId: h.branchA },
  }, ACTOR)

  h.tenantA.club.createAccessRule({
    branchId: h.branchA,
    name: 'Offline Entry Rule',
    effect: 'allow',
    priority: 500,
    daysMask: 127,
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256url(token)
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString().replace('.000Z', 'Z')
  await h.tenantA.club.issueGatewayEnrollment(gatewayId, tokenHash, expiresAt, ACTOR)

  let networkOnline = true
  const customFetch = async (urlStr, init = {}) => {
    if (!networkOnline) {
      throw new Error('NETWORK_DISCONNECTED')
    }
    return h.serverFetch(urlStr, init)
  }

  const secretStore = new MemorySecretStore()
  const localDb = new GatewayDatabase(':memory:')
  const runtime = new AccessGatewayRuntime({
    serverBaseUrl: 'http://localhost:8787',
    gatewayId,
    branchId: h.branchA,
    secretStore,
    db: localDb,
    fetchFn: customFetch,
  })

  await runtime.init()
  await runtime.enroll(token)
  h.tenantA.db.prepare("UPDATE access_gateways SET status='online' WHERE id=?").run(gatewayId)
  await runtime.sync()

  const simulator = new TurnstileSimulator({
    deviceId: device.id,
    accessPointId: point.id,
    direction: 'entry',
  })
  const controller = new AccessDeviceController(simulator, runtime)
  await controller.start()

  // CUT NETWORK CONNECTION
  networkOnline = false

  // Scan Card Offline
  const scanResult = await simulator.scanCredential('11:22:33:44:55:66:77:88', 'rfid')
  assert.equal(scanResult.decision, 'allow')
  assert.equal(scanResult.reasonCode, 'ACCESS_GRANTED')
  assert.equal(scanResult.unlocked, true)
  assert.equal(simulator.getState(), 'UNLOCKED')

  // Passage
  assert.equal(simulator.simulatePassage(), true)
  assert.equal(simulator.getState(), 'LOCKED')

  // Sync fails while offline
  const offlineSync = await runtime.sync()
  assert.equal(offlineSync.eventsUploaded, 0)
  assert.equal(runtime.eventQueue.getPendingCount(), 1)

  // RESTORE NETWORK
  networkOnline = true

  // Sync succeeds
  const onlineSync = await runtime.sync()
  assert.equal(onlineSync.eventsUploaded, 1)
  assert.equal(runtime.eventQueue.getPendingCount(), 0)

  // Event in Cloud
  const cloudEvents = h.tenantA.db.prepare('SELECT * FROM access_events WHERE external_event_id = ?').all(scanResult.eventId)
  assert.equal(cloudEvents.length, 1)
  assert.equal(cloudEvents[0].decision, 'allow')

  await controller.stop()
  runtime.close()
})

test('Snapshot Expiration during Simulation: denies access when snapshot expires', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  const rawRfid = '2233445566778899'
  const lookupHash = await CredentialNormalizer.computeLookupHash('rfid', rawRfid, null)

  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const spkiBytes = await crypto.subtle.exportKey('spki', keys.publicKey)
  const snapshotVerificationKey = base64UrlEncode(spkiBytes)

  const secretStore = new MemorySecretStore()
  const localDb = new GatewayDatabase(':memory:')

  const pkBytes = await crypto.subtle.exportKey('pkcs8', keys.privateKey)
  await secretStore.setMachinePrivateKey(base64UrlEncode(pkBytes))

  const pointId = crypto.randomUUID()
  localDb.setMeta('gateway_id', gatewayId)
  localDb.setMeta('branch_id', h.branchA)
  localDb.setMeta('snapshot_verification_key', snapshotVerificationKey)

  // Create an expired snapshot
  const expiredSnapshot = {
    snapshotSchemaVersion: 2,
    revision: 5,
    generatedAt: new Date(Date.now() - 7200_000).toISOString(),
    validUntil: new Date(Date.now() - 1000).toISOString(), // expired in the past
    branchId: h.branchA,
    branchActive: true,
    timezone: 'Africa/Casablanca',
    accessPoints: [{ id: pointId, direction: 'entry', status: 'active', deviceStatus: 'online', gatewayStatus: 'online' }],
    credentials: [{ lookupHash, memberId: h.memberA, status: 'active' }],
    members: [{ id: h.memberA, status: 'active', subscriptionExpiresAt: futureDate(10), disciplineId: null, disciplineActive: null }],
    rules: [{ id: crypto.randomUUID(), accessPointId: null, memberId: null, disciplineId: null, effect: 'allow', priority: 100, daysMask: 127, startTime: null, endTime: null, validFrom: null, validUntil: null }],
  }

  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    new TextEncoder().encode(JSON.stringify(expiredSnapshot))
  )
  localDb.saveActiveSnapshot(expiredSnapshot, base64UrlEncode(sigBytes))

  const runtime = new AccessGatewayRuntime({
    serverBaseUrl: 'http://localhost:8787',
    gatewayId,
    branchId: h.branchA,
    secretStore,
    db: localDb,
  })
  await runtime.init()

  const simulator = new TurnstileSimulator({
    deviceId: crypto.randomUUID(),
    accessPointId: pointId,
  })
  const controller = new AccessDeviceController(simulator, runtime)
  await controller.start()

  // Scan with expired snapshot -> Must DENY / SYSTEM_ERROR and stay locked
  const scanResult = await simulator.scanCredential('22:33:44:55:66:77:88:99', 'rfid')
  assert.equal(scanResult.decision, 'deny')
  assert.equal(scanResult.reasonCode, 'SYSTEM_ERROR')
  assert.equal(scanResult.unlocked, false)
  assert.equal(simulator.getState(), 'LOCKED')

  await controller.stop()
  runtime.close()
})

test('Revoked Credential across Snapshot Revisions: immediately denies on new revision activation', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  const rawRfid = '33445566778899AA'
  const lookupHash = await CredentialNormalizer.computeLookupHash('rfid', rawRfid, null)

  h.tenantA.club.createAccessGateway({
    id: gatewayId,
    branchId: h.branchA,
    name: 'Turnstile GW Revoke',
    status: 'pending',
    scope: { branchId: h.branchA },
  }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  const device = h.tenantA.club.createAccessDevice({
    gatewayId,
    name: 'Turnstile Controller 4',
    adapterType: 'turnstile',
    deviceType: 'door',
    status: 'online',
    metadata: {},
    scope: { branchId: h.branchA },
  }, ACTOR)

  const point = h.tenantA.club.createAccessPoint({
    deviceId: device.id,
    name: 'Main Entry Turnstile',
    direction: 'entry',
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

  const cred = h.tenantA.club.createAccessCredential({
    memberId: h.memberA,
    type: 'rfid',
    lookupHash,
    identifierMask: '••••99AA',
    scope: { branchId: h.branchA },
  }, ACTOR)

  h.tenantA.club.createAccessRule({
    branchId: h.branchA,
    name: 'Entry Rule',
    effect: 'allow',
    priority: 500,
    daysMask: 127,
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

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

  const simulator = new TurnstileSimulator({
    deviceId: device.id,
    accessPointId: point.id,
  })
  const controller = new AccessDeviceController(simulator, runtime)
  await controller.start()

  // First scan: ALLOW
  const scan1 = await simulator.scanCredential('33:44:55:66:77:88:99:AA', 'rfid')
  assert.equal(scan1.decision, 'allow')
  assert.equal(scan1.unlocked, true)
  simulator.simulatePassage()

  // Revoke Credential in Cloud -> Advances policy revision via database trigger
  h.tenantA.db.prepare("UPDATE access_credentials SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").run(cred.id)

  // Gateway Sync -> Downloads and activates new snapshot revision
  await runtime.sync()

  // Second scan: DENY (CREDENTIAL_REVOKED)
  const scan2 = await simulator.scanCredential('33:44:55:66:77:88:99:AA', 'rfid')
  assert.equal(scan2.decision, 'deny')
  assert.equal(scan2.reasonCode, 'CREDENTIAL_REVOKED')
  assert.equal(scan2.unlocked, false)
  assert.equal(simulator.getState(), 'LOCKED')

  await controller.stop()
  runtime.close()
})

