import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { handleApi } from '../src/api.ts'
import { ClubDatabase } from '../src/club/club-database.ts'
import { AccessStore, credentialDigest, maskCredential, normalizeCredential } from '../src/club/access.ts'
import { MIGRATIONS, LATEST_VERSION } from '../src/club/schema.ts'
import { hashToken } from '../src/auth/crypto.ts'

const CONTROL_SCHEMA = readFileSync(new URL('../src/control-plane/schema.sql', import.meta.url), 'utf8')
const CONTROL_MIGRATION = readFileSync(new URL('../migrations/0012_access_gateway_registry.sql', import.meta.url), 'utf8')
const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const ACTOR = { id: '33333333-3333-4333-8333-333333333333', name: 'Gateway Test Admin' }

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
        const name = `gateway_test_${++savepoint}`
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
  return { db, club, storage }
}

function d1(db) {
  return {
    prepare(query) {
      let params = []
      return {
        bind(...values) { params = values; return this },
        async first(column) {
          const row = db.prepare(query).get(...params) ?? null
          return column && row ? row[column] : row
        },
        async all() { return { results: db.prepare(query).all(...params) } },
        async run() {
          const result = db.prepare(query).run(...params)
          return { success: true, meta: { changes: Number(result.changes) } }
        },
      }
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())) },
  }
}

function futureDate(days = 30) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

async function harness() {
  const controlDb = new DatabaseSync(':memory:')
  controlDb.exec(CONTROL_SCHEMA)
  const insertOrg = controlDb.prepare('INSERT INTO organizations(id,slug,name,plan,status,trial_ends_at) VALUES(?,?,?,\'trial\',\'active\',?)')
  insertOrg.run(ORG_A, 'org-a', 'Organization A', futureDate())
  insertOrg.run(ORG_B, 'org-b', 'Organization B', futureDate())
  const tenantA = await realClub()
  const tenantB = await realClub()
  const tenants = new Map([[ORG_A, tenantA], [ORG_B, tenantB]])
  const selected = []
  const env = {
    CONTROL: d1(controlDb),
    CLUB: {
      idFromName(orgId) { selected.push(['idFromName', orgId]); return orgId },
      get(orgId) { selected.push(['get', orgId]); return tenants.get(orgId)?.club },
    },
    ENTITLEMENT_MODE: 'enforce',
  }
  const branchA = crypto.randomUUID(), branchA2 = crypto.randomUUID(), branchB = crypto.randomUUID()
  tenantA.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branchA, 'A Main')
  tenantA.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branchA2, 'A Other')
  tenantB.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branchB, 'B Main')
  return { controlDb, tenantA, tenantB, tenants, selected, env, branchA, branchA2, branchB }
}

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function b64bytes(value) {
  return Uint8Array.from(Buffer.from(value, 'base64url'))
}

async function sha256url(value) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

function registry(f, gatewayId, orgId) {
  f.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id,org_id) VALUES(?,?)').run(gatewayId, orgId)
}

function gatewayRecord(f, orgId, branchId, { register = true, status = 'pending' } = {}) {
  const id = crypto.randomUUID()
  const tenant = f.tenants.get(orgId)
  tenant.club.createAccessGateway({ id, branchId, name: `Gateway ${id.slice(0, 6)}`, status, scope: { branchId } }, ACTOR)
  if (register) registry(f, id, orgId)
  return id
}

function plainRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const next = new Headers(headers)
  if (body !== undefined) next.set('Content-Type', 'application/json')
  return new Request(`https://gymflow.test${path}`, {
    method, headers: next,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function responseData(response) {
  if (response.status === 304) return null
  return response.json()
}

async function api(f, path, init) {
  const response = await handleApi(plainRequest(path, init), f.env)
  return { response, data: await responseData(response) }
}

async function enroll(f, orgId, branchId, options = {}) {
  const tenant = f.tenants.get(orgId)
  const gatewayId = gatewayRecord(f, orgId, branchId, { register: options.register !== false })
  const token = options.token ?? b64url(crypto.getRandomValues(new Uint8Array(32)))
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString().replace('.000Z', 'Z')
  await tenant.club.issueGatewayEnrollment(gatewayId, await sha256url(token), expiresAt, ACTOR)
  const result = await api(f, '/api/access/gateways/enroll', { method: 'POST', body: { gatewayId, token } })
  if (options.expectSuccess !== false) assert.equal(result.response.status, 200, JSON.stringify(result.data))
  if (result.response.status !== 200) return { gatewayId, token, result }
  const privateKey = await crypto.subtle.importKey('pkcs8', b64bytes(result.data.machinePrivateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  return { gatewayId, token, privateKey, snapshotVerificationKey: result.data.snapshotVerificationKey, result }
}

async function signedRequest({ gatewayId, privateKey, path, method = 'POST', body, timestamp, nonce, signedPath, signedMethod, signedBody, headers = {} }) {
  const requestBody = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const canonicalBody = signedBody === undefined ? requestBody : typeof signedBody === 'string' ? signedBody : JSON.stringify(signedBody)
  const seconds = timestamp ?? Math.floor(Date.now() / 1000)
  const requestNonce = nonce ?? b64url(crypto.getRandomValues(new Uint8Array(24)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBody))
  const bodyHash = Buffer.from(digest).toString('hex')
  const canonicalPath = signedPath ?? new URL(`https://gymflow.test${path}`).pathname
  const canonical = `${signedMethod ?? method}\n${canonicalPath}\n${seconds}\n${requestNonce}\n${bodyHash}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(canonical))
  const next = new Headers({
    'Gateway-Id': gatewayId,
    'Gateway-Signature': b64url(signature),
    'Gateway-Timestamp': String(seconds),
    'Gateway-Nonce': requestNonce,
    ...headers,
  })
  if (requestBody) next.set('Content-Type', 'application/json')
  return new Request(`https://gymflow.test${path}`, { method, headers: next, body: requestBody || undefined })
}

async function signedCall(f, identity, path, options = {}) {
  const request = await signedRequest({ ...identity, path, ...options })
  const response = await handleApi(request, f.env)
  return { request, response, data: await responseData(response) }
}

function heartbeatBody(overrides = {}) {
  return { version: '1.2.3', queueDepth: 0, snapshotRevision: 0, health: { ok: true }, ...overrides }
}

async function topology(f, tenant, branchId, suffix = '') {
  const discipline = crypto.randomUUID(), member = crypto.randomUUID()
  tenant.db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(discipline, `Fitness${suffix}`)
  tenant.db.prepare("INSERT INTO members(id,name,phone,branch_id,discipline_id,status) VALUES(?,?,?,?,?,'active')").run(member, `Member${suffix}`, `0600${suffix.padStart(6, '0')}`, branchId, discipline)
  const gateway = tenant.db.prepare('SELECT id FROM access_gateways WHERE branch_id=? LIMIT 1').get(branchId)?.id
  if (!gateway) throw new Error('gateway required before topology')
  const device = tenant.club.createAccessDevice({ gatewayId: gateway, name: `Device${suffix}`, adapterType: 'generic', deviceType: 'door', status: 'online', metadata: {}, scope: { branchId } }, ACTOR).id
  const point = tenant.club.createAccessPoint({ deviceId: device, name: `Point${suffix}`, direction: 'entry', status: 'active', scope: { branchId } }, ACTOR).id
  const raw = Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString('hex').toUpperCase()
  const lookupHash = await credentialDigest('rfid', null, raw)
  tenant.club.createAccessCredential({ memberId: member, type: 'rfid', lookupHash, identifierMask: maskCredential(normalizeCredential('rfid', raw)), scope: { branchId } }, ACTOR)
  const rule = tenant.club.createAccessRule({ branchId, name: `Allow${suffix}`, effect: 'allow', priority: 10, daysMask: 127, status: 'active', scope: { branchId } }, ACTOR).id
  return { discipline, member, gateway, device, point, lookupHash, rule }
}

function eventBody(topo, overrides = {}) {
  return { events: [{
    id: crypto.randomUUID(), occurredAt: new Date().toISOString(), credentialLookupHash: topo.lookupHash,
    accessPointId: topo.point, decision: 'allow', reasonCode: 'ACCESS_GRANTED', snapshotRevision: 0,
    ...overrides,
  }] }
}

test('harness loads real production router, Durable Object, AccessStore, crypto, and migration symbols', async () => {
  assert.equal(typeof handleApi, 'function')
  assert.equal(ClubDatabase.name, 'ClubDatabase')
  assert.equal(typeof ClubDatabase.prototype.handleGatewayM2M, 'function')
  assert.equal(typeof AccessStore.prototype.registerGatewayNonce, 'function')
  assert.equal(typeof hashToken, 'function')
  assert.equal(LATEST_VERSION, 17)
  assert.match(readFileSync(new URL('../src/club/club-database.ts', import.meta.url), 'utf8'), /export type GatewayAuthContext = Readonly/)
  const f = await harness()
  assert.equal(f.tenantA.club instanceof ClubDatabase, true)
  assert.equal(f.tenantA.db.prepare('SELECT MAX(version) version FROM _schema_version').get().version, LATEST_VERSION)
})

test('CONTROL registry routes only known well-formed IDs to the correct tenant and partial states fail closed', async () => {
  const f = await harness()
  const a = await enroll(f, ORG_A, f.branchA)
  const valid = await signedCall(f, a, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  assert.equal(valid.response.status, 200)
  assert.deepEqual(f.selected.slice(-2), [['idFromName', ORG_A], ['get', ORG_A]])

  f.selected.length = 0
  const malformed = await api(f, '/api/access/gateway/heartbeat', { method: 'POST', body: heartbeatBody(), headers: { 'Gateway-Id': 'not-a-uuid' } })
  assert.equal(malformed.response.status, 401)
  assert.deepEqual(f.selected, [])

  const unknownId = crypto.randomUUID()
  const unknown = await api(f, '/api/access/gateway/heartbeat', { method: 'POST', body: heartbeatBody(), headers: { 'Gateway-Id': unknownId } })
  assert.equal(unknown.response.status, 401)
  assert.equal(unknown.data.code, 'GATEWAY_UNAUTHORIZED')
  assert.deepEqual(f.selected, [])

  const registryOnly = crypto.randomUUID(); registry(f, registryOnly, ORG_A)
  const fakeKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const absentTenant = await signedCall(f, { gatewayId: registryOnly, privateKey: fakeKeys.privateKey }, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  assert.equal(absentTenant.response.status, 401)

  const tenantOnly = gatewayRecord(f, ORG_A, f.branchA, { register: false })
  const missingRegistry = await api(f, '/api/access/gateway/heartbeat', { method: 'POST', body: heartbeatBody(), headers: { 'Gateway-Id': tenantOnly } })
  assert.equal(missingRegistry.response.status, 401)
})

test('valid ECDSA requests authenticate and execute heartbeat, snapshot, and event upload', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const topo = await topology(f, f.tenantA, f.branchA)
  const heartbeat = await signedCall(f, identity, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  assert.equal(heartbeat.response.status, 200)
  const snapshot = await signedCall(f, identity, '/api/access/gateway/snapshot', { method: 'GET' })
  assert.equal(snapshot.response.status, 200)
  const events = await signedCall(f, identity, '/api/access/gateway/events', { body: eventBody(topo) })
  assert.equal(events.response.status, 200)
  assert.equal(events.data.accepted, 1)
})

test('signature adversarial matrix denies body, method, path, key, ID, encoding, and missing headers', async () => {
  const f = await harness(), a = await enroll(f, ORG_A, f.branchA), b = await enroll(f, ORG_B, f.branchB)
  const original = heartbeatBody()
  assert.equal((await signedCall(f, a, '/api/access/gateway/heartbeat', { body: original })).response.status, 200)
  assert.equal((await signedCall(f, a, '/api/access/gateway/heartbeat', { body: heartbeatBody({ queueDepth: 9 }), signedBody: original })).response.status, 401)
  assert.equal((await signedCall(f, a, '/api/access/gateway/heartbeat', { method: 'PUT', signedMethod: 'POST', body: original })).response.status, 405)
  assert.equal((await signedCall(f, a, '/api/access/gateway/heartbeat', { signedPath: '/api/access/gateway/events', body: original })).response.status, 401)
  assert.equal((await signedCall(f, { gatewayId: a.gatewayId, privateKey: b.privateKey }, '/api/access/gateway/heartbeat', { body: original })).response.status, 401)
  assert.equal((await signedCall(f, { gatewayId: b.gatewayId, privateKey: a.privateKey }, '/api/access/gateway/heartbeat', { body: original })).response.status, 401)

  const base = await signedRequest({ ...a, path: '/api/access/gateway/heartbeat', body: original })
  for (const [header, value] of [
    ['Gateway-Signature', '%%%'], ['Gateway-Signature', null], ['Gateway-Timestamp', null],
    ['Gateway-Nonce', null], ['Gateway-Id', null],
  ]) {
    const headers = new Headers(base.headers)
    value === null ? headers.delete(header) : headers.set(header, value)
    const response = await handleApi(new Request(base.url, { method: base.method, headers, body: await base.clone().text() }), f.env)
    assert.equal(response.status, 401, header)
  }
})

test('timestamp window accepts current and +/-89 seconds and denies clearly outside +/-90 seconds', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const now = Math.floor(Date.now() / 1000)
  for (const offset of [0, 89, -89]) {
    const result = await signedCall(f, identity, '/api/access/gateway/heartbeat', { body: heartbeatBody(), timestamp: now + offset })
    assert.equal(result.response.status, 200, `offset ${offset}`)
  }
  for (const offset of [120, -120]) {
    const result = await signedCall(f, identity, '/api/access/gateway/heartbeat', { body: heartbeatBody(), timestamp: now + offset })
    assert.equal(result.response.status, 401, `offset ${offset}`)
  }
})

test('nonce first use persists, exact sequential replay is denied', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const request = await signedRequest({ ...identity, path: '/api/access/gateway/heartbeat', body: heartbeatBody() })
  const nonce = request.headers.get('Gateway-Nonce')
  const first = await handleApi(request.clone(), f.env)
  const second = await handleApi(request.clone(), f.env)
  assert.equal(first.status, 200)
  assert.equal(second.status, 401)
  assert.equal((await second.json()).code, 'GATEWAY_REPLAY')
  const stored = f.tenantA.db.prepare('SELECT expires_at FROM gateway_nonces WHERE gateway_id=? AND nonce=?').get(identity.gatewayId, nonce)
  assert.ok(stored)
  assert.ok(Date.parse(stored.expires_at) > Date.now())
})

test('concurrent identical signed requests allow exactly one and reject seven as replay', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const request = await signedRequest({ ...identity, path: '/api/access/gateway/heartbeat', body: heartbeatBody() })
  const responses = await Promise.all(Array.from({ length: 8 }, () => handleApi(request.clone(), f.env)))
  assert.equal(responses.filter(response => response.status === 200).length, 1)
  assert.equal(responses.filter(response => response.status === 401).length, 7)
  const codes = await Promise.all(responses.filter(response => response.status === 401).map(response => response.json()))
  assert.ok(codes.every(value => value.code === 'GATEWAY_REPLAY'))
})

test('the same nonce is independently accepted once for two Gateways', async () => {
  const f = await harness(), a = await enroll(f, ORG_A, f.branchA), b = await enroll(f, ORG_B, f.branchB)
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(24)))
  const ra = await signedCall(f, a, '/api/access/gateway/heartbeat', { body: heartbeatBody(), nonce })
  const rb = await signedCall(f, b, '/api/access/gateway/heartbeat', { body: heartbeatBody(), nonce })
  assert.equal(ra.response.status, 200)
  assert.equal(rb.response.status, 200)
})

test('status matrix permits provisioned/online and denies pending/offline/revoked/disabled on all M2M routes', async () => {
  for (const status of ['provisioned', 'online', 'pending', 'offline', 'revoked', 'disabled']) {
    const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
    const topo = await topology(f, f.tenantA, f.branchA, status)
    const results = []
    for (const [path, options] of [
      ['/api/access/gateway/heartbeat', { body: heartbeatBody() }],
      ['/api/access/gateway/snapshot', { method: 'GET' }],
      ['/api/access/gateway/events', { body: eventBody(topo) }],
    ]) {
      f.tenantA.db.prepare('UPDATE access_gateways SET status=? WHERE id=?').run(status, identity.gatewayId)
      results.push(await signedCall(f, identity, path, options))
    }
    const expected = ['provisioned', 'online'].includes(status) ? 200 : 401
    assert.ok(results.every(result => result.response.status === expected), status)
  }
})

test('entitlement enforcement denies suspended tenants before DO dispatch while observe mode preserves operation', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  f.controlDb.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(ORG_A)
  f.selected.length = 0
  const denied = await signedCall(f, identity, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  assert.equal(denied.response.status, 403)
  assert.equal(denied.data.code, 'ENTITLEMENT_READ_ONLY')
  assert.deepEqual(f.selected, [])
  f.env.ENTITLEMENT_MODE = 'observe'
  const observed = await signedCall(f, identity, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  assert.equal(observed.response.status, 200)
})

test('per-Gateway heartbeat rate limit isolates Gateway B after Gateway A exhausts 60 requests', async () => {
  const f = await harness(), a = await enroll(f, ORG_A, f.branchA), b = await enroll(f, ORG_B, f.branchB)
  for (let index = 0; index < 60; index++) {
    const response = await signedCall(f, a, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
    assert.equal(response.response.status, 200, `A request ${index + 1}`)
  }
  const limited = await signedCall(f, a, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  assert.equal(limited.response.status, 429)
  assert.equal(limited.data.code, 'RATE_LIMITED')
  assert.equal((await signedCall(f, b, '/api/access/gateway/heartbeat', { body: heartbeatBody() })).response.status, 200)
  assert.equal(f.tenantA.db.prepare("SELECT request_count FROM access_rate_limits WHERE actor_id=? AND bucket='gateway-heartbeat'").get(a.gatewayId).request_count, 60)
})

test('snapshot, event, authentication, and enrollment rate buckets enforce configured per-Gateway ceilings', async () => {
  const snapshots = await harness(), snapshotA = await enroll(snapshots, ORG_A, snapshots.branchA), snapshotB = await enroll(snapshots, ORG_B, snapshots.branchB)
  for (let index = 0; index < 6; index++) assert.equal((await signedCall(snapshots, snapshotA, '/api/access/gateway/snapshot', { method: 'GET' })).response.status, 200)
  assert.equal((await signedCall(snapshots, snapshotA, '/api/access/gateway/snapshot', { method: 'GET' })).response.status, 429)
  assert.equal((await signedCall(snapshots, snapshotB, '/api/access/gateway/snapshot', { method: 'GET' })).response.status, 200)

  const events = await harness(), eventA = await enroll(events, ORG_A, events.branchA), eventB = await enroll(events, ORG_B, events.branchB)
  const topoA = await topology(events, events.tenantA, events.branchA, 'rateA')
  const topoB = await topology(events, events.tenantB, events.branchB, 'rateB')
  for (let index = 0; index < 10; index++) assert.equal((await signedCall(events, eventA, '/api/access/gateway/events', { body: eventBody(topoA) })).response.status, 200)
  assert.equal((await signedCall(events, eventA, '/api/access/gateway/events', { body: eventBody(topoA) })).response.status, 429)
  assert.equal((await signedCall(events, eventB, '/api/access/gateway/events', { body: eventBody(topoB) })).response.status, 200)

  const authentication = await harness(), auth = await enroll(authentication, ORG_A, authentication.branchA)
  for (let index = 0; index < 301; index++) await signedCall(authentication, auth, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  assert.equal(authentication.tenantA.db.prepare("SELECT request_count FROM access_rate_limits WHERE actor_id=? AND bucket='gateway-auth'").get(auth.gatewayId).request_count, 300)

  const enrollment = await harness(), enrollmentId = gatewayRecord(enrollment, ORG_A, enrollment.branchA)
  const validToken = b64url(crypto.getRandomValues(new Uint8Array(32)))
  await enrollment.tenantA.club.issueGatewayEnrollment(enrollmentId, await sha256url(validToken), new Date(Date.now() + 60_000).toISOString(), ACTOR)
  for (let index = 0; index < 6; index++) {
    const wrong = b64url(crypto.getRandomValues(new Uint8Array(32)))
    assert.equal((await api(enrollment, '/api/access/gateways/enroll', { method: 'POST', body: { gatewayId: enrollmentId, token: wrong } })).response.status, 401)
  }
  assert.equal(enrollment.tenantA.db.prepare("SELECT request_count FROM access_rate_limits WHERE actor_id=? AND bucket='gateway-enrollment'").get(enrollmentId).request_count, 5)
})

test('authenticated enrollment and M2M operations write machine-attributed audit records immune to body spoofing', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const topo = await topology(f, f.tenantA, f.branchA)
  await signedCall(f, identity, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  const snapshot = await signedCall(f, identity, '/api/access/gateway/snapshot', { method: 'GET' })
  await signedCall(f, identity, `/api/access/gateway/snapshot?if_revision=${snapshot.data.snapshot.revision}`, { method: 'GET' })
  await signedCall(f, identity, '/api/access/gateway/events', { body: eventBody(topo) })
  const rows = f.tenantA.db.prepare('SELECT action,actor_id FROM audit_logs WHERE entity_id=? ORDER BY id').all(identity.gatewayId)
  for (const action of ['access.gateway.enrolled', 'access.gateway.heartbeat', 'access.gateway.snapshot.generated', 'access.gateway.snapshot.not_modified', 'access.gateway.events.uploaded']) {
    assert.ok(rows.some(row => row.action === action && row.actor_id === `gateway:${identity.gatewayId}`), action)
  }
  const spoofed = await signedCall(f, identity, '/api/access/gateway/heartbeat', { body: { ...heartbeatBody(), actorId: 'admin' } })
  assert.equal(spoofed.response.status, 400)
})

test('enrollment is single-use, rejects invalid and expired tokens, and discloses only intended key material', async () => {
  const f = await harness()
  const identity = await enroll(f, ORG_A, f.branchA)
  assert.match(identity.result.data.machinePrivateKey, /^[A-Za-z0-9_-]+$/)
  assert.match(identity.result.data.snapshotVerificationKey, /^[A-Za-z0-9_-]+$/)
  assert.equal('snapshotPrivateKey' in identity.result.data, false)
  assert.equal('snapshotSigningPrivateKey' in identity.result.data, false)
  const replay = await api(f, '/api/access/gateways/enroll', { method: 'POST', body: { gatewayId: identity.gatewayId, token: identity.token } })
  assert.equal(replay.response.status, 401)
  const stored = f.tenantA.db.prepare('SELECT machine_public_key,enrollment_token_hash FROM access_gateways WHERE id=?').get(identity.gatewayId)
  assert.match(stored.machine_public_key, /^[A-Za-z0-9_-]+$/)
  assert.equal(stored.enrollment_token_hash, null)
  const serialized = JSON.stringify(stored)
  assert.equal(serialized.includes(identity.result.data.machinePrivateKey), false)

  const invalidId = gatewayRecord(f, ORG_A, f.branchA)
  const validToken = b64url(crypto.getRandomValues(new Uint8Array(32)))
  await f.tenantA.club.issueGatewayEnrollment(invalidId, await sha256url(validToken), new Date(Date.now() + 60_000).toISOString(), ACTOR)
  assert.equal((await api(f, '/api/access/gateways/enroll', { method: 'POST', body: { gatewayId: invalidId, token: b64url(crypto.getRandomValues(new Uint8Array(32))) } })).response.status, 401)

  const expired = await enroll(f, ORG_A, f.branchA, { expiresAt: new Date(Date.now() - 60_000).toISOString(), expectSuccess: false })
  assert.equal(expired.result.response.status, 401)
})

test('concurrent use of one enrollment token succeeds exactly once', async () => {
  const f = await harness(), gatewayId = gatewayRecord(f, ORG_A, f.branchA)
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)))
  await f.tenantA.club.issueGatewayEnrollment(gatewayId, await sha256url(token), new Date(Date.now() + 60_000).toISOString(), ACTOR)
  const requests = Array.from({ length: 4 }, () => plainRequest('/api/access/gateways/enroll', { method: 'POST', body: { gatewayId, token } }))
  const responses = await Promise.all(requests.map(request => handleApi(request, f.env)))
  assert.equal(responses.filter(response => response.status === 200).length, 1)
  assert.equal(responses.filter(response => response.status === 401).length, 3)
})

test('snapshot signature verifies, tampering and wrong tenant key fail, and branch isolation/TTL/schema hold', async () => {
  const f = await harness(), a = await enroll(f, ORG_A, f.branchA), b = await enroll(f, ORG_B, f.branchB)
  const own = await topology(f, f.tenantA, f.branchA, 'own')
  const otherGateway = gatewayRecord(f, ORG_A, f.branchA2, { register: false, status: 'online' })
  const other = await topology(f, f.tenantA, f.branchA2, 'other')
  assert.equal(other.gateway, otherGateway)
  const result = await signedCall(f, a, '/api/access/gateway/snapshot', { method: 'GET' })
  assert.equal(result.response.status, 200)
  const snapshotBytes = new TextEncoder().encode(JSON.stringify(result.data.snapshot))
  const keyA = await crypto.subtle.importKey('spki', b64bytes(a.snapshotVerificationKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const keyB = await crypto.subtle.importKey('spki', b64bytes(b.snapshotVerificationKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keyA, b64bytes(result.data.signature), snapshotBytes), true)
  const tampered = { ...result.data.snapshot, revision: result.data.snapshot.revision + 1 }
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keyA, b64bytes(result.data.signature), new TextEncoder().encode(JSON.stringify(tampered))), false)
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keyB, b64bytes(result.data.signature), snapshotBytes), false)
  assert.equal(result.data.snapshot.branchId, f.branchA)
  assert.ok(result.data.snapshot.accessPoints.some(point => point.id === own.point))
  assert.ok(!result.data.snapshot.accessPoints.some(point => point.id === other.point))
  assert.equal(result.data.snapshot.snapshotSchemaVersion, 2)
  assert.equal('schemaVersion' in result.data.snapshot, false)
  assert.ok(Number.isInteger(result.data.snapshot.revision))
  const ttl = Date.parse(result.data.snapshot.validUntil) - Date.parse(result.data.snapshot.generatedAt)
  assert.equal(ttl, 4 * 60 * 60_000)
  const keyRow = f.tenantA.db.prepare('SELECT snapshot_public_key,snapshot_private_key FROM access_policy_state WHERE id=1').get()
  assert.equal(keyRow.snapshot_public_key, a.snapshotVerificationKey)
  assert.ok(keyRow.snapshot_private_key)
  assert.equal(JSON.stringify(result.data).includes(keyRow.snapshot_private_key), false)
})

test('snapshot 304 preserves revision and legitimate policy mutation advances signed revision', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const first = await signedCall(f, identity, '/api/access/gateway/snapshot', { method: 'GET' })
  const r1 = first.data.snapshot.revision
  const unchanged = await signedCall(f, identity, `/api/access/gateway/snapshot?if_revision=${r1}`, { method: 'GET' })
  assert.equal(unchanged.response.status, 304)
  assert.equal(f.tenantA.db.prepare('SELECT revision FROM access_policy_state WHERE id=1').get().revision, r1)
  f.tenantA.club.createAccessRule({ branchId: f.branchA, name: 'Revision advance', effect: 'deny', priority: 999, daysMask: 127, status: 'active', scope: { branchId: f.branchA } }, ACTOR)
  const second = await signedCall(f, identity, '/api/access/gateway/snapshot', { method: 'GET' })
  assert.ok(second.data.snapshot.revision > r1)
  assert.notEqual(second.data.signature, first.data.signature)
})

test('event upload persists batches, is idempotent per Gateway, and invalid batches are atomic', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA), topo = await topology(f, f.tenantA, f.branchA)
  const one = eventBody(topo), two = eventBody(topo)
  const batch = { events: [one.events[0], two.events[0]] }
  const accepted = await signedCall(f, identity, '/api/access/gateway/events', { body: batch })
  assert.equal(accepted.response.status, 200)
  assert.equal(accepted.data.accepted, 2)
  assert.equal(f.tenantA.db.prepare("SELECT COUNT(*) count FROM access_events WHERE gateway_id=? AND source='gateway'").get(identity.gatewayId).count, 2)
  const replay = await signedCall(f, identity, '/api/access/gateway/events', { body: batch })
  assert.equal(replay.response.status, 200)
  assert.equal(replay.data.accepted, 0)
  assert.deepEqual(new Set(replay.data.duplicates), new Set([one.events[0].id, two.events[0].id]))
  const secondGateway = await enroll(f, ORG_A, f.branchA)
  const otherGatewayFirstUse = await signedCall(f, secondGateway, '/api/access/gateway/events', { body: { events: [one.events[0]] } })
  assert.equal(otherGatewayFirstUse.response.status, 200)
  assert.equal(otherGatewayFirstUse.data.accepted, 1)

  const before = f.tenantA.db.prepare('SELECT COUNT(*) count FROM access_events').get().count
  const malformed = { events: [eventBody(topo).events[0], { ...eventBody(topo).events[0], credentialLookupHash: 'bad' }] }
  assert.equal((await signedCall(f, identity, '/api/access/gateway/events', { body: malformed })).response.status, 400)
  assert.equal(f.tenantA.db.prepare('SELECT COUNT(*) count FROM access_events').get().count, before)
  const invalidPoint = eventBody(topo, { accessPointId: crypto.randomUUID() })
  assert.equal((await signedCall(f, identity, '/api/access/gateway/events', { body: invalidPoint })).response.status, 400)
  assert.equal(f.tenantA.db.prepare('SELECT COUNT(*) count FROM access_events').get().count, before)
})

test('event identity fields are rejected and cross-branch/cross-tenant resources fail closed', async () => {
  const f = await harness(), a = await enroll(f, ORG_A, f.branchA), b = await enroll(f, ORG_B, f.branchB)
  const own = await topology(f, f.tenantA, f.branchA, 'a')
  const otherGateway = gatewayRecord(f, ORG_A, f.branchA2, { register: false, status: 'online' })
  const otherBranch = await topology(f, f.tenantA, f.branchA2, 'a2')
  assert.equal(otherBranch.gateway, otherGateway)
  const tenantB = await topology(f, f.tenantB, f.branchB, 'b')
  for (const extra of [{ gatewayId: b.gatewayId }, { branchId: f.branchA2 }, { orgId: ORG_B }]) {
    const spoof = { events: [{ ...eventBody(own).events[0], ...extra }] }
    assert.equal((await signedCall(f, a, '/api/access/gateway/events', { body: spoof })).response.status, 400)
  }
  assert.equal((await signedCall(f, a, '/api/access/gateway/events', { body: eventBody(otherBranch) })).response.status, 400)
  assert.equal((await signedCall(f, a, '/api/access/gateway/events', { body: eventBody(tenantB) })).response.status, 400)
  const wrongId = await signedCall(f, { gatewayId: b.gatewayId, privateKey: a.privateKey }, '/api/access/gateway/heartbeat', { body: heartbeatBody() })
  assert.equal(wrongId.response.status, 401)
})

function applyMigration(db, migration) {
  if (migration.foreignKeysOff) db.exec('PRAGMA foreign_keys=OFF')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const statement of migration.statements) db.exec(statement)
    db.prepare('INSERT INTO _schema_version(version) VALUES(?)').run(migration.version)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    if (migration.foreignKeysOff) db.exec('PRAGMA foreign_keys=ON')
  }
}

function migratedTo(version) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _schema_version(version INTEGER PRIMARY KEY)')
  for (const migration of MIGRATIONS.filter(item => item.version <= version)) applyMigration(db, migration)
  return db
}

function populateV14(db) {
  const branch = crypto.randomUUID(), discipline = crypto.randomUUID(), member = crypto.randomUUID()
  const gateway = crypto.randomUUID(), device = crypto.randomUUID(), point = crypto.randomUUID(), credential = crypto.randomUUID(), rule = crypto.randomUUID(), event = crypto.randomUUID()
  db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branch, 'Existing branch')
  db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(discipline, 'Existing discipline')
  db.prepare("INSERT INTO members(id,name,phone,branch_id,discipline_id,status) VALUES(?,?,?,?,?,'active')").run(member, 'Existing member', '0600000000', branch, discipline)
  db.prepare("INSERT INTO access_gateways(id,branch_id,name,status) VALUES(?,?,?,'online')").run(gateway, branch, 'Existing gateway')
  db.prepare("INSERT INTO access_devices(id,gateway_id,branch_id,name,adapter_type,device_type,status) VALUES(?,?,?,?,?,?,'online')").run(device, gateway, branch, 'Existing device', 'generic', 'door')
  db.prepare("INSERT INTO access_points(id,device_id,branch_id,name,direction,status) VALUES(?,?,?,?,?,'active')").run(point, device, branch, 'Existing point', 'entry')
  db.prepare("INSERT INTO access_credentials(id,member_id,type,lookup_hash,identifier_mask,status) VALUES(?,?,'rfid',?,?,'active')").run(credential, member, 'a'.repeat(64), '****0000')
  db.prepare("INSERT INTO access_rules(id,branch_id,name,effect,status) VALUES(?,?,?,'allow','active')").run(rule, branch, 'Existing rule')
  db.prepare("INSERT INTO access_events(id,occurred_at,member_id,credential_id,gateway_id,device_id,access_point_id,branch_id,requested_access_point_id,direction,decision,reason_code,source) VALUES(?,?,?,?,?,?,?,?,?,'entry','allow','ACCESS_GRANTED','gateway')").run(event, new Date().toISOString(), member, credential, gateway, device, point, branch, point)
  return { branch, gateway, device, point, credential, rule, event }
}

test('populated v14 migrates through v15, v16, and v17 without topology or event loss', () => {
  const db = migratedTo(14), ids = populateV14(db)
  applyMigration(db, MIGRATIONS.find(item => item.version === 15))
  applyMigration(db, MIGRATIONS.find(item => item.version === 16))
  applyMigration(db, MIGRATIONS.find(item => item.version === 17))
  assert.equal(db.prepare('SELECT MAX(version) version FROM _schema_version').get().version, 17)
  for (const [table, id] of [['access_gateways', ids.gateway], ['access_devices', ids.device], ['access_points', ids.point], ['access_credentials', ids.credential], ['access_rules', ids.rule], ['access_events', ids.event]]) {
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE id=?`).get(id).count, 1, table)
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  const policy = db.prepare('SELECT revision,snapshot_public_key,snapshot_private_key FROM access_policy_state WHERE id=1').get()
  assert.ok(Number.isInteger(policy.revision)); assert.equal(policy.snapshot_public_key, null); assert.equal(policy.snapshot_private_key, null)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM pragma_table_info('access_events') WHERE name='snapshot_revision'").get().count, 1)
  assert.equal(db.prepare('SELECT snapshot_revision FROM access_events WHERE id=?').get(ids.event).snapshot_revision, null)
})

test('populated v15 migrates cleanly to current exactly once', () => {
  const db = migratedTo(14), ids = populateV14(db)
  applyMigration(db, MIGRATIONS.find(item => item.version === 15))
  applyMigration(db, MIGRATIONS.find(item => item.version === 16))
  applyMigration(db, MIGRATIONS.find(item => item.version === 17))
  assert.equal(db.prepare('SELECT id FROM access_gateways WHERE id=?').get(ids.gateway).id, ids.gateway)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM pragma_table_info('access_policy_state') WHERE name IN ('snapshot_public_key','snapshot_private_key')").get().count, 2)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM pragma_table_info('access_events') WHERE name='snapshot_revision'").get().count, 1)
  const current = db.prepare('SELECT MAX(version) version FROM _schema_version').get().version
  for (const migration of MIGRATIONS.filter(item => item.version > current)) applyMigration(db, migration)
  assert.equal(db.prepare('SELECT MAX(version) version FROM _schema_version').get().version, 17)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('CONTROL 0012 migration creates routing constraints, index, uniqueness, and organization cascade', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(CONTROL_SCHEMA)
  db.exec('DROP TABLE access_gateway_registry')
  db.exec(CONTROL_MIGRATION)
  const org = crypto.randomUUID(), gateway = crypto.randomUUID()
  db.prepare("INSERT INTO organizations(id,slug,name,plan,status,trial_ends_at) VALUES(?,?,?,'trial','active',?)").run(org, 'migration-org', 'Migration Org', futureDate())
  db.prepare('INSERT INTO access_gateway_registry(gateway_id,org_id) VALUES(?,?)').run(gateway, org)
  assert.throws(() => db.prepare('INSERT INTO access_gateway_registry(gateway_id,org_id) VALUES(?,?)').run(gateway, org), /UNIQUE constraint failed/i)
  assert.throws(() => db.prepare('INSERT INTO access_gateway_registry(gateway_id,org_id) VALUES(?,?)').run(crypto.randomUUID(), crypto.randomUUID()), /FOREIGN KEY constraint failed/i)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='index' AND name='idx_gateway_registry_org'").get().count, 1)
  db.prepare('DELETE FROM organizations WHERE id=?').run(org)
  assert.equal(db.prepare('SELECT COUNT(*) count FROM access_gateway_registry').get().count, 0)
})

test('browser Access routes still require sessions and Gateway headers confer no browser authority', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const headers = { 'Gateway-Id': identity.gatewayId, 'Gateway-Signature': 'x'.repeat(86), 'Gateway-Timestamp': String(Math.floor(Date.now() / 1000)), 'Gateway-Nonce': b64url(crypto.getRandomValues(new Uint8Array(24))) }
  assert.equal((await api(f, '/api/access/gateways', { headers })).response.status, 401)

  const user = crypto.randomUUID(), membership = crypto.randomUUID(), token = b64url(crypto.getRandomValues(new Uint8Array(32)))
  f.controlDb.prepare('INSERT INTO users(id,email,email_norm,name,password_hash) VALUES(?,?,?,?,?)').run(user, 'browser@example.test', 'browser@example.test', 'Browser Admin', 'test-only-hash')
  f.controlDb.prepare("INSERT INTO memberships(id,user_id,org_id,role,branch_id,status) VALUES(?,?,?,'admin',?,'active')").run(membership, user, ORG_A, f.branchA)
  f.controlDb.prepare('INSERT INTO sessions(token_hash,user_id,org_id,expires_at) VALUES(?,?,?,?)').run(await hashToken(token), user, ORG_A, new Date(Date.now() + 3_600_000).toISOString())
  const browser = await api(f, '/api/access/gateways', { headers: { Cookie: `__Host-gf_session=${token}` } })
  assert.equal(browser.response.status, 200)
  assert.ok(Array.isArray(browser.data.items))
})

async function snapshotContractFixture() {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const disciplineA = crypto.randomUUID(), disciplineB = crypto.randomUUID()
  const memberA = crypto.randomUUID(), memberB = crypto.randomUUID()
  f.tenantA.db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(disciplineA, 'Discipline A')
  f.tenantA.db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(disciplineB, 'Discipline B')
  f.tenantA.db.prepare("INSERT INTO members(id,name,phone,email,branch_id,discipline_id,status,sub_expiry,notes) VALUES(?,?,?,?,?,?,'active',?,?)")
    .run(memberA, 'Private Member A', '0600000001', 'a@example.test', f.branchA, disciplineA, futureDate(), 'Private notes A')
  f.tenantA.db.prepare("INSERT INTO members(id,name,phone,email,branch_id,discipline_id,status,sub_expiry,notes) VALUES(?,?,?,?,?,?,'active',?,?)")
    .run(memberB, 'Private Member B', '0600000002', 'b@example.test', f.branchA, disciplineB, futureDate(), 'Private notes B')
  const device = f.tenantA.club.createAccessDevice({ gatewayId: identity.gatewayId, name: 'Contract Device', adapterType: 'generic', deviceType: 'door', status: 'online', metadata: {}, scope: { branchId: f.branchA } }, ACTOR).id
  const point = f.tenantA.club.createAccessPoint({ deviceId: device, name: 'Private Point Name', direction: 'entry', status: 'active', scope: { branchId: f.branchA } }, ACTOR).id
  const rawA = 'A1B2C3D4', rawB = 'B1C2D3E4'
  const hashA = await credentialDigest('rfid', null, rawA), hashB = await credentialDigest('rfid', null, rawB)
  const credentialA = f.tenantA.club.createAccessCredential({ memberId: memberA, type: 'rfid', lookupHash: hashA, identifierMask: maskCredential(rawA), scope: { branchId: f.branchA } }, ACTOR).id
  const credentialB = f.tenantA.club.createAccessCredential({ memberId: memberB, type: 'rfid', lookupHash: hashB, identifierMask: maskCredential(rawB), scope: { branchId: f.branchA } }, ACTOR).id
  const memberRule = f.tenantA.club.createAccessRule({ branchId: f.branchA, memberId: memberA, name: 'Member A deny', effect: 'deny', priority: 900, daysMask: 127, status: 'active', scope: { branchId: f.branchA } }, ACTOR).id
  const disciplineRule = f.tenantA.club.createAccessRule({ branchId: f.branchA, disciplineId: disciplineB, name: 'Discipline B allow', effect: 'allow', priority: 500, daysMask: 127, status: 'active', scope: { branchId: f.branchA } }, ACTOR).id
  const globalRule = f.tenantA.club.createAccessRule({ branchId: f.branchA, name: 'Global allow', effect: 'allow', priority: 100, daysMask: 127, status: 'active', scope: { branchId: f.branchA } }, ACTOR).id
  const result = await signedCall(f, identity, '/api/access/gateway/snapshot', { method: 'GET' })
  assert.equal(result.response.status, 200)
  return { f, identity, result, disciplineA, disciplineB, memberA, memberB, device, point, hashA, hashB, credentialA, credentialB, memberRule, disciplineRule, globalRule }
}

async function verifiesSnapshot(publicKeyValue, snapshot, signature) {
  const key = await crypto.subtle.importKey('spki', b64bytes(publicKeyValue), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64bytes(signature), new TextEncoder().encode(JSON.stringify(snapshot)))
}

test('snapshot contract: explicit credential ownership, discipline relations, selectors, and null semantics are unambiguous', async () => {
  const fixture = await snapshotContractFixture(), snapshot = fixture.result.data.snapshot
  assert.equal(snapshot.snapshotSchemaVersion, 2)
  assert.equal('schemaVersion' in snapshot, false)
  assert.equal(snapshot.timezone, 'Africa/Casablanca')
  const ownership = new Map(snapshot.credentials.map(credential => [credential.lookupHash, credential.memberId]))
  assert.equal(ownership.get(fixture.hashA), fixture.memberA)
  assert.equal(ownership.get(fixture.hashB), fixture.memberB)
  const members = new Map(snapshot.members.map(member => [member.id, member]))
  assert.equal(members.get(fixture.memberA).disciplineId, fixture.disciplineA)
  assert.equal(members.get(fixture.memberB).disciplineId, fixture.disciplineB)
  assert.equal(members.get(fixture.memberA).disciplineActive, true)
  const rules = new Map(snapshot.rules.map(rule => [rule.id, rule]))
  assert.equal(rules.get(fixture.memberRule).memberId, fixture.memberA)
  assert.equal(rules.get(fixture.memberRule).disciplineId, null)
  assert.equal(rules.get(fixture.disciplineRule).memberId, null)
  assert.equal(rules.get(fixture.disciplineRule).disciplineId, fixture.disciplineB)
  assert.equal(rules.get(fixture.globalRule).memberId, null)
  assert.equal(rules.get(fixture.globalRule).disciplineId, null)
  assert.ok(Object.hasOwn(rules.get(fixture.globalRule), 'memberId'))
  assert.ok(Object.hasOwn(rules.get(fixture.globalRule), 'disciplineId'))
  assert.deepEqual(snapshot.rules.map(rule => rule.priority), [...snapshot.rules.map(rule => rule.priority)].sort((a, b) => b - a))
})

test('snapshot contract: every new relationship is signed and individual tampering fails verification', async () => {
  const fixture = await snapshotContractFixture(), { snapshot, signature } = fixture.result.data
  assert.equal(await verifiesSnapshot(fixture.identity.snapshotVerificationKey, snapshot, signature), true)
  const mutations = [
    value => { value.credentials[0].memberId = crypto.randomUUID() },
    value => { value.members[0].disciplineId = crypto.randomUUID() },
    value => { value.rules.find(rule => rule.id === fixture.memberRule).memberId = fixture.memberB },
    value => { value.rules.find(rule => rule.id === fixture.disciplineRule).disciplineId = fixture.disciplineA },
    value => { value.timezone = 'UTC' },
  ]
  for (const mutate of mutations) {
    const tampered = structuredClone(snapshot)
    mutate(tampered)
    assert.equal(await verifiesSnapshot(fixture.identity.snapshotVerificationKey, tampered, signature), false)
  }
})

test('snapshot contract: every authorization relationship mutation advances policy revision', async () => {
  const x = await snapshotContractFixture(), db = x.f.tenantA.db
  const revision = () => db.prepare('SELECT revision FROM access_policy_state WHERE id=1').get().revision
  const advances = statement => { const before = revision(); statement(); assert.ok(revision() > before) }
  const disposableRule = x.f.tenantA.club.createAccessRule({ branchId: x.f.branchA, name: 'Delete me', effect: 'deny', priority: 1, daysMask: 127, status: 'active', scope: { branchId: x.f.branchA } }, ACTOR).id
  const beforeTimezone = revision()
  x.f.controlDb.prepare("UPDATE organizations SET timezone='Europe/Paris' WHERE id=?").run(ORG_A)
  const timezoneSnapshot = await signedCall(x.f, x.identity, '/api/access/gateway/snapshot', { method: 'GET' })
  assert.equal(timezoneSnapshot.data.snapshot.timezone, 'Europe/Paris')
  assert.ok(revision() > beforeTimezone)
  advances(() => db.prepare('UPDATE access_credentials SET member_id=? WHERE id=?').run(x.memberB, x.credentialA))
  advances(() => db.prepare("UPDATE access_credentials SET status='disabled' WHERE id=?").run(x.credentialA))
  advances(() => db.prepare("UPDATE members SET status='inactive' WHERE id=?").run(x.memberB))
  advances(() => db.prepare('UPDATE members SET sub_expiry=? WHERE id=?').run('2000-01-01', x.memberB))
  advances(() => db.prepare('UPDATE members SET discipline_id=? WHERE id=?').run(x.disciplineA, x.memberB))
  advances(() => db.prepare('UPDATE access_rules SET member_id=? WHERE id=?').run(x.memberB, x.globalRule))
  advances(() => db.prepare('UPDATE access_rules SET discipline_id=? WHERE id=?').run(x.disciplineA, x.globalRule))
  advances(() => db.prepare("UPDATE access_rules SET start_time='08:00',end_time='09:00' WHERE id=?").run(x.globalRule))
  advances(() => db.prepare("UPDATE access_points SET status='disabled' WHERE id=?").run(x.point))
  advances(() => db.prepare("UPDATE access_devices SET status='offline' WHERE id=?").run(x.device))
  advances(() => db.prepare("UPDATE access_gateways SET status='offline' WHERE id=?").run(x.identity.gatewayId))
  advances(() => db.prepare('DELETE FROM access_rules WHERE id=?').run(disposableRule))
  advances(() => db.prepare('UPDATE branches SET is_active=0 WHERE id=?').run(x.f.branchA))
  advances(() => db.prepare('UPDATE disciplines SET is_active=0 WHERE id=?').run(x.disciplineA))
})

test('snapshot contract: branch and tenant isolation hold and unnecessary PII is absent', async () => {
  const x = await snapshotContractFixture()
  const otherGateway = gatewayRecord(x.f, ORG_A, x.f.branchA2, { register: false, status: 'online' })
  const otherBranch = await topology(x.f, x.f.tenantA, x.f.branchA2, 'contractOther')
  assert.equal(otherBranch.gateway, otherGateway)
  const tenantBGateway = gatewayRecord(x.f, ORG_B, x.f.branchB, { register: false, status: 'online' })
  const tenantB = await topology(x.f, x.f.tenantB, x.f.branchB, 'contractTenantB')
  assert.equal(tenantB.gateway, tenantBGateway)
  const refreshed = await signedCall(x.f, x.identity, '/api/access/gateway/snapshot', { method: 'GET' })
  const snapshot = refreshed.data.snapshot, serialized = JSON.stringify(snapshot)
  assert.ok(!snapshot.accessPoints.some(point => point.id === otherBranch.point || point.id === tenantB.point))
  assert.ok(!snapshot.credentials.some(credential => credential.lookupHash === otherBranch.lookupHash || credential.lookupHash === tenantB.lookupHash))
  assert.ok(!snapshot.members.some(member => member.id === otherBranch.member || member.id === tenantB.member))
  assert.ok(!snapshot.rules.some(rule => rule.id === otherBranch.rule || rule.id === tenantB.rule))
  for (const forbidden of ['Private Member A', 'a@example.test', '0600000001', 'Private notes A', 'Private Point Name', 'A1B2C3D4', 'identifierMask', 'password', 'session', 'payment']) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
})

test('snapshot contract: realistic set-based fixture reports bounded serialized size', async () => {
  const f = await harness(), identity = await enroll(f, ORG_A, f.branchA)
  const discipline = crypto.randomUUID()
  f.tenantA.db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(discipline, 'Scale discipline')
  for (let index = 0; index < 100; index++) {
    const member = crypto.randomUUID(), lookupHash = index.toString(16).padStart(64, '0')
    f.tenantA.db.prepare("INSERT INTO members(id,name,phone,branch_id,discipline_id,status,sub_expiry) VALUES(?,?,?,?,?,'active',?)").run(member, `Member ${index}`, `06${String(index).padStart(8, '0')}`, f.branchA, discipline, futureDate())
    f.tenantA.club.createAccessCredential({ memberId: member, type: 'rfid', lookupHash, identifierMask: '****0000', scope: { branchId: f.branchA } }, ACTOR)
  }
  for (let index = 0; index < 10; index++) f.tenantA.club.createAccessRule({ branchId: f.branchA, disciplineId: discipline, name: `Rule ${index}`, effect: index % 2 ? 'allow' : 'deny', priority: index, daysMask: 127, status: 'active', scope: { branchId: f.branchA } }, ACTOR)
  const result = await signedCall(f, identity, '/api/access/gateway/snapshot', { method: 'GET' })
  const bytes = Buffer.byteLength(JSON.stringify(result.data.snapshot))
  assert.equal(result.data.snapshot.credentials.length, 100)
  assert.equal(result.data.snapshot.members.length, 100)
  assert.equal(result.data.snapshot.rules.length, 10)
  assert.ok(bytes < 100_000)
  console.log(`SNAPSHOT_SIZE_METRIC credentials=100 members=100 rules=10 bytes=${bytes}`)
})
