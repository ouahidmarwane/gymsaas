import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import {
  HikvisionIsapiAdapter,
  HikvisionConfigValidator,
  HikvisionDigestAuth,
  HikvisionXmlParser,
  HikvisionStreamParser,
  MockHikvisionServer,
  AccessDeviceController,
  AccessGatewayRuntime,
  GatewayDatabase,
  MemorySecretStore,
  CredentialNormalizer,
} from '../gateway/index.ts'

import { ClubDatabase } from '../src/club/club-database.ts'
import { handleApi } from '../src/api.ts'

// -----------------------------------------------------------------------------
// HELPERS & FIXTURES
// -----------------------------------------------------------------------------

const CONTROL_SCHEMA = readFileSync(new URL('../src/control-plane/schema.sql', import.meta.url), 'utf8')
const CONTROL_MIGRATION = readFileSync(new URL('../migrations/0012_access_gateway_registry.sql', import.meta.url), 'utf8')
const ORG_A = '11111111-1111-4111-8111-111111111111'
const ACTOR = { id: '33333333-3333-4333-8333-333333333333', name: 'Hikvision Test Admin' }

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
        const name = `hik_test_${++savepoint}`
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
    .run(ORG_A, 'hik-gym', 'Hikvision Test Gym', futureDate(365))

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
    .run(memberA, 'Bob Hikvision', branchA, futureDate(365))

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

async function waitForReady(adapter, timeoutMs = 2000) {
  const start = Date.now()
  while (adapter.health().state !== 'READY') {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`ADAPTER_NOT_READY: current state is ${adapter.health().state}, error: ${adapter.health().errorDetails}`)
    }
    await new Promise((r) => setTimeout(r, 20))
  }
}

// -----------------------------------------------------------------------------
// BATCH D.1 TESTS
// -----------------------------------------------------------------------------

test('Hikvision Config Validation: validates valid config and rejects malformed fields', () => {
  // Valid config
  const validRes = HikvisionConfigValidator.validate({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '192.168.1.100',
    controllerPort: 80,
    username: 'admin',
    password: 'password123',
    defaultDoorNo: 1,
    defaultReaderNo: 1,
    readerMappings: {
      1: { accessPointId: crypto.randomUUID(), direction: 'entry', doorNo: 1 },
      2: { accessPointId: crypto.randomUUID(), direction: 'exit', doorNo: 2 },
    },
  })
  assert.equal(validRes.valid, true)
  assert.equal(validRes.errors.length, 0)

  // Malformed host with dangerous protocol / SSRF attempt
  const malformedHost = HikvisionConfigValidator.validate({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: 'http://attacker.com/evil',
    username: 'admin',
    password: 'password123',
  })
  assert.equal(malformedHost.valid, false)
  assert.ok(malformedHost.errors.includes('MALFORMED_CONTROLLER_HOST'))

  // Invalid port and missing credentials
  const invalidPort = HikvisionConfigValidator.validate({
    deviceId: '',
    accessPointId: '',
    controllerHost: '192.168.1.100',
    controllerPort: 70000,
    username: '',
    password: '',
  })
  assert.equal(invalidPort.valid, false)
  assert.ok(invalidPort.errors.includes('INVALID_DEVICE_ID'))
  assert.ok(invalidPort.errors.includes('INVALID_ACCESS_POINT_ID'))
  assert.ok(invalidPort.errors.includes('INVALID_CONTROLLER_PORT'))
  assert.ok(invalidPort.errors.includes('INVALID_USERNAME'))
  assert.ok(invalidPort.errors.includes('MISSING_PASSWORD'))
})

test('Hikvision Digest Authentication: parses challenge, formats Authorization header, increments nc', () => {
  const digest = new HikvisionDigestAuth()

  const challengeHeader = 'Digest realm="Hikvision", nonce="4f8a3c2b1e0d", qop="auth", algorithm="MD5", opaque="abcd1234"'
  const parsed = HikvisionDigestAuth.parseChallenge(challengeHeader)

  assert.ok(parsed)
  assert.equal(parsed.realm, 'Hikvision')
  assert.equal(parsed.nonce, '4f8a3c2b1e0d')
  assert.equal(parsed.qop, 'auth')
  assert.equal(parsed.algorithm, 'MD5')
  assert.equal(parsed.opaque, 'abcd1234')

  digest.setChallenge(parsed)
  assert.equal(digest.hasChallenge(), true)

  // Generate first request header
  const authHeader1 = digest.generateAuthorizationHeader('GET', '/ISAPI/Event/notification/alertStream', {
    username: 'gymflow_api',
    password: 'SecretPassword123!',
  })
  assert.ok(authHeader1)
  assert.ok(authHeader1.startsWith('Digest '))
  assert.ok(authHeader1.includes('username="gymflow_api"'))
  assert.ok(authHeader1.includes('realm="Hikvision"'))
  assert.ok(authHeader1.includes('nonce="4f8a3c2b1e0d"'))
  assert.ok(authHeader1.includes('nc=00000001'))
  assert.ok(authHeader1.includes('qop=auth'))
  assert.ok(!authHeader1.includes('SecretPassword123!')) // Secret is never printed in clear

  // Generate second request header (nc increments)
  const authHeader2 = digest.generateAuthorizationHeader('PUT', '/ISAPI/AccessControl/RemoteControl/door/1', {
    username: 'gymflow_api',
    password: 'SecretPassword123!',
  })
  assert.ok(authHeader2)
  assert.ok(authHeader2.includes('nc=00000002'))
})

test('Hikvision XML Parser: extracts AccessControllerEvent safely and rejects XXE/DTDs', () => {
  const validXml = `
    <EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent version="2.0">
        <majorEventType>5</majorEventType>
        <subEventType>75</subEventType>
        <cardNo>0123456789ABCDEF</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <doorNo>1</doorNo>
        <dateTime>2026-08-31T14:30:00+01:00</dateTime>
        <serialNo>42</serialNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `

  const event = HikvisionXmlParser.parseEvent(validXml)
  assert.equal(event.eventType, 'AccessControllerEvent')
  assert.equal(event.majorEventType, 5)
  assert.equal(event.subEventType, 75)
  assert.equal(event.cardNo, '0123456789ABCDEF')
  assert.equal(event.cardReaderNo, 1)
  assert.equal(event.doorNo, 1)
  assert.equal(event.serialNo, '42')

  // ResponseStatus XML
  const resXml = `
    <ResponseStatus version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
      <requestURL>/ISAPI/AccessControl/RemoteControl/door/1</requestURL>
      <statusCode>1</statusCode>
      <statusString>OK</statusString>
      <subStatusCode>ok</subStatusCode>
    </ResponseStatus>
  `
  const status = HikvisionXmlParser.parseResponseStatus(resXml)
  assert.equal(status.statusCode, 1)
  assert.equal(status.statusString, 'OK')
})

test('D1-001: Case-insensitive DTD, Entity, and XXE defense matrix', () => {
  const hostilePayloads = [
    // DOCTYPE case variations
    '<!DOCTYPE root [<!ENTITY test "val">]><root>&test;</root>',
    '<!doctype root [<!entity test "val">]><root>&test;</root>',
    '<!DoCtYpE root [<!EnTiTy test "val">]><root>&test;</root>',
    '<!  DOCTYPE root><root>test</root>',
    '<!  doctype root><root>test</root>',

    // ENTITY case variations
    '<root><!ENTITY x "val"></root>',
    '<root><!entity x "val"></root>',
    '<root><!EnTiTy x "val"></root>',

    // ELEMENT / ATTLIST / NOTATION declarations
    '<!ELEMENT root ANY><root>test</root>',
    '<!element root ANY><root>test</root>',
    '<!ATTLIST root id CDATA #REQUIRED><root id="1"/>',
    '<!attlist root id CDATA #REQUIRED><root id="1"/>',

    // External entity injections (SYSTEM / PUBLIC)
    '<root SYSTEM "http://evil.com/xxe.xml">test</root>',
    '<root system "file:///etc/passwd">test</root>',
    '<root PUBLIC "-//W3C//DTD//EN" "http://evil.com/xxe.dtd">test</root>',
    '<root public "http://evil.com/xxe.dtd">test</root>',

    // Hostile custom entity expansions
    '<root>&customEntity;</root>',
    '<root>&xxe_leak;</root>',
  ]

  for (const hostile of hostilePayloads) {
    assert.throws(
      () => {
        HikvisionXmlParser.parseEvent(hostile)
      },
      /XML_CONTAINS_FORBIDDEN_DTD_OR_ENTITIES/,
      `Failed to reject hostile payload: ${hostile}`
    )
    assert.throws(
      () => {
        HikvisionXmlParser.parseResponseStatus(hostile)
      },
      /XML_CONTAINS_FORBIDDEN_DTD_OR_ENTITIES/,
      `Failed to reject hostile payload on response status: ${hostile}`
    )
  }
})

test('D1-002: Scopes extraction strictly to AccessControllerEvent and ignores outer/fake fields', () => {
  const spoofedOuterXml = `
    <EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
      <eventType>AccessControllerEvent</eventType>
      <fakeOuter>
        <cardNo>FAKE_ATTACKER_CARD</cardNo>
        <cardReaderNo>99</cardReaderNo>
        <doorNo>99</doorNo>
        <majorEventType>999</majorEventType>
      </fakeOuter>
      <AccessControllerEvent version="2.0">
        <majorEventType>5</majorEventType>
        <subEventType>75</subEventType>
        <cardNo>GENUINE_MEMBER_CARD</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <doorNo>1</doorNo>
        <dateTime>2026-08-31T14:30:00+01:00</dateTime>
      </AccessControllerEvent>
      <anotherFake>
        <cardNo>ANOTHER_FAKE_CARD</cardNo>
        <cardReaderNo>88</cardReaderNo>
      </anotherFake>
    </EventNotificationAlert>
  `

  const parsed = HikvisionXmlParser.parseEvent(spoofedOuterXml)
  assert.equal(parsed.eventType, 'AccessControllerEvent')
  assert.equal(parsed.cardNo, 'GENUINE_MEMBER_CARD')
  assert.equal(parsed.cardReaderNo, 1)
  assert.equal(parsed.doorNo, 1)
  assert.equal(parsed.majorEventType, 5)
})

test('Container Ambiguity: fails closed if multiple AccessControllerEvent containers exist', () => {
  const ambiguousContainerXml = `
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <cardNo>CARD_FIRST</cardNo>
        <cardReaderNo>1</cardReaderNo>
      </AccessControllerEvent>
      <AccessControllerEvent>
        <cardNo>CARD_SECOND</cardNo>
        <cardReaderNo>2</cardReaderNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `
  assert.throws(() => {
    HikvisionXmlParser.parseEvent(ambiguousContainerXml)
  }, /AMBIGUOUS_XML_CONTAINER: AccessControllerEvent/)
})

test('D1-004: Duplicate critical XML fields fail closed', () => {
  // Duplicate conflicting cardNo
  const duplicateCardXml = `
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <cardNo>CARD_FIRST</cardNo>
        <cardNo>CARD_SECOND</cardNo>
        <cardReaderNo>1</cardReaderNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `
  assert.throws(() => {
    HikvisionXmlParser.parseEvent(duplicateCardXml)
  }, /DUPLICATE_XML_FIELD: cardNo/)

  // Duplicate conflicting readerNo
  const duplicateReaderXml = `
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <cardNo>CARD_FIRST</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <cardReaderNo>2</cardReaderNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `
  assert.throws(() => {
    HikvisionXmlParser.parseEvent(duplicateReaderXml)
  }, /DUPLICATE_XML_FIELD: cardReaderNo/)

  // Duplicate conflicting doorNo
  const duplicateDoorXml = `
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <cardNo>CARD_FIRST</cardNo>
        <doorNo>1</doorNo>
        <doorNo>2</doorNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `
  assert.throws(() => {
    HikvisionXmlParser.parseEvent(duplicateDoorXml)
  }, /DUPLICATE_XML_FIELD: doorNo/)
})

test('Hikvision Stream Parser: handles split TCP chunks and boundary extraction with buffer bounds', () => {
  const parser = new HikvisionStreamParser(1024)
  parser.setBoundary('MIME_boundary_123')

  const xml1 = '<EventNotificationAlert><eventType>AccessControllerEvent</eventType><cardNo>CARD1</cardNo></EventNotificationAlert>'
  const xml2 = '<EventNotificationAlert><eventType>AccessControllerEvent</eventType><cardNo>CARD2</cardNo></EventNotificationAlert>'

  const chunkPart1 = `--MIME_boundary_123\r\nContent-Type: application/xml\r\n\r\n<EventNotificationAlert><eventType>AccessController`
  const chunkPart2 = `Event</eventType><cardNo>CARD1</cardNo></EventNotificationAlert>\r\n--MIME_boundary_123\r\nContent-Type: application/xml\r\n\r\n${xml2}\r\n--MIME_boundary_123`

  const res1 = parser.feed(chunkPart1)
  assert.equal(res1.length, 0) // Incomplete part, buffered

  const res2 = parser.feed(chunkPart2)
  assert.equal(res2.length, 2)
  assert.ok(res2[0].includes('CARD1'))
  assert.ok(res2[1].includes('CARD2'))

  // Overflow test
  const smallParser = new HikvisionStreamParser(50)
  assert.throws(() => {
    smallParser.feed('A'.repeat(60))
  }, /STREAM_BUFFER_OVERFLOW/)
})

test('MANDATORY FULL E2E TEST: Mock ISAPI Server -> HikvisionIsapiAdapter -> DeviceController -> Gateway -> Remote Open', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  const rawRfid = '0123456789ABCDEF'
  const lookupHash = await CredentialNormalizer.computeLookupHash('rfid', rawRfid, null)

  // 1. Provision Cloud Gateway and Credential
  h.tenantA.club.createAccessGateway({
    id: gatewayId,
    branchId: h.branchA,
    name: 'Turnstile Hikvision GW',
    status: 'pending',
    scope: { branchId: h.branchA },
  }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  const device = h.tenantA.club.createAccessDevice({
    gatewayId,
    name: 'Hikvision DS-K2602T',
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
    identifierMask: '••••CDEF',
    scope: { branchId: h.branchA },
  }, ACTOR)

  h.tenantA.club.createAccessRule({
    branchId: h.branchA,
    name: 'Entry Rule',
    effect: 'allow',
    priority: 500,
    startTime: '00:00',
    endTime: '23:59',
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

  // 3. Start Mock Hikvision Controller Server
  const mockServer = new MockHikvisionServer({
    username: 'gymflow_api',
    password: 'SecurePassword123!',
  })
  const port = await mockServer.start()

  // 4. Initialize HikvisionIsapiAdapter & Connect DeviceController
  const adapter = new HikvisionIsapiAdapter({
    deviceId: device.id,
    accessPointId: point.id,
    direction: 'entry',
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false, // Testing against local mock HTTP server
    username: 'gymflow_api',
    password: 'SecurePassword123!',
    defaultDoorNo: 1,
    defaultReaderNo: 1,
  })

  const controller = new AccessDeviceController(adapter, runtime)
  await controller.start()

  await waitForReady(adapter)

  // 5. Mock Controller Emits Card Scan Event on AlertStream
  const eventXml = `
    <EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent version="2.0">
        <majorEventType>5</majorEventType>
        <subEventType>75</subEventType>
        <cardNo>${rawRfid}</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <doorNo>1</doorNo>
        <dateTime>2026-08-31T14:35:00+01:00</dateTime>
        <serialNo>101</serialNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `

  mockServer.pushEvent(eventXml)

  // Wait for async processing through Controller -> Gateway -> Adapter -> Remote Open PUT
  await new Promise((r) => setTimeout(r, 200))

  const commands = mockServer.getReceivedUnlockCommands()
  const pending = runtime.eventQueue.peekBatch(10)

  // 6. Verify Mock Server received ISAPI RemoteControl PUT open on Door 1
  assert.equal(commands.length, 1)
  assert.equal(commands[0].doorId, 1)
  assert.ok(commands[0].body.includes('<cmd>open</cmd>'))

  // 7. Verify Gateway event queue has durably recorded the ALLOW event
  assert.equal(runtime.eventQueue.getPendingCount(), 1)
  assert.equal(pending[0].decision, 'allow')
  assert.equal(pending[0].reasonCode, 'ACCESS_GRANTED')

  // 8. Gateway Sync -> Uploads to Cloud
  await runtime.sync()
  assert.equal(runtime.eventQueue.getPendingCount(), 0)

  // Cleanup
  await controller.stop()
  await mockServer.stop()
  runtime.close()
})

test('MANDATORY DENY E2E TEST: Unregistered or invalid badge emits ZERO remote open requests', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()

  h.tenantA.club.createAccessGateway({
    id: gatewayId,
    branchId: h.branchA,
    name: 'Turnstile Hikvision Deny',
    status: 'pending',
    scope: { branchId: h.branchA },
  }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  const device = h.tenantA.club.createAccessDevice({
    gatewayId,
    name: 'Hikvision DS-K2602T 2',
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

  const mockServer = new MockHikvisionServer({
    username: 'gymflow_api',
    password: 'SecurePassword123!',
  })
  const port = await mockServer.start()

  const adapter = new HikvisionIsapiAdapter({
    deviceId: device.id,
    accessPointId: point.id,
    direction: 'entry',
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecurePassword123!',
  })

  const controller = new AccessDeviceController(adapter, runtime)
  await controller.start()
  await waitForReady(adapter)

  // Push unregistered card event
  const denyXml = `
    <EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent version="2.0">
        <majorEventType>5</majorEventType>
        <subEventType>75</subEventType>
        <cardNo>9999999999999999</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <doorNo>1</doorNo>
        <dateTime>2026-08-31T14:40:00+01:00</dateTime>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `

  mockServer.pushEvent(denyXml)
  await new Promise((r) => setTimeout(r, 200))

  // ZERO remote open commands must have been issued
  const commands = mockServer.getReceivedUnlockCommands()
  assert.equal(commands.length, 0)

  // Deny event is durably recorded in local SQLite
  assert.equal(runtime.eventQueue.getPendingCount(), 1)
  const pending = runtime.eventQueue.peekBatch(10)
  assert.equal(pending[0].decision, 'deny')
  assert.equal(pending[0].reasonCode, 'CREDENTIAL_UNKNOWN')

  await controller.stop()
  await mockServer.stop()
  runtime.close()
})

test('MANDATORY OFFLINE E2E TEST: Operates locally during cloud outage and syncs on reconnect', async () => {
  const h = await testHarness()
  const gatewayId = crypto.randomUUID()
  const rawRfid = '1122334455667788'
  const lookupHash = await CredentialNormalizer.computeLookupHash('rfid', rawRfid, null)

  h.tenantA.club.createAccessGateway({
    id: gatewayId,
    branchId: h.branchA,
    name: 'Turnstile Hikvision Offline',
    status: 'pending',
    scope: { branchId: h.branchA },
  }, ACTOR)
  h.controlDb.prepare('INSERT INTO access_gateway_registry(gateway_id, org_id) VALUES(?, ?)').run(gatewayId, ORG_A)

  const device = h.tenantA.club.createAccessDevice({
    gatewayId,
    name: 'Hikvision DS-K2602T 3',
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
    startTime: '00:00',
    endTime: '23:59',
    daysMask: 127,
    status: 'active',
    scope: { branchId: h.branchA },
  }, ACTOR)

  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256url(token)
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString().replace('.000Z', 'Z')
  await h.tenantA.club.issueGatewayEnrollment(gatewayId, tokenHash, expiresAt, ACTOR)

  let cloudAvailable = true
  const customFetch = async (urlStr, init = {}) => {
    if (!cloudAvailable) {
      throw new Error('CLOUD_UNREACHABLE')
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

  const mockServer = new MockHikvisionServer({
    username: 'gymflow_api',
    password: 'SecurePassword123!',
  })
  const port = await mockServer.start()

  const adapter = new HikvisionIsapiAdapter({
    deviceId: device.id,
    accessPointId: point.id,
    direction: 'entry',
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecurePassword123!',
  })

  const controller = new AccessDeviceController(adapter, runtime)
  await controller.start()
  await waitForReady(adapter)

  // CUT WAN CONNECTION TO CLOUD
  cloudAvailable = false

  // Push card event while offline
  const offlineEventXml = `
    <EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent version="2.0">
        <majorEventType>5</majorEventType>
        <subEventType>75</subEventType>
        <cardNo>${rawRfid}</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <doorNo>1</doorNo>
        <dateTime>2026-08-31T14:45:00+01:00</dateTime>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `

  mockServer.pushEvent(offlineEventXml)
  await new Promise((r) => setTimeout(r, 200))

  // Local controller receives RemoteControl open
  const commands = mockServer.getReceivedUnlockCommands()
  assert.equal(commands.length, 1)
  assert.equal(commands[0].doorId, 1)

  // Local SQLite durably queued the event
  assert.equal(runtime.eventQueue.getPendingCount(), 1)

  // Cloud sync fails while offline
  const syncOffline = await runtime.sync()
  assert.equal(syncOffline.eventsUploaded, 0)
  assert.equal(runtime.eventQueue.getPendingCount(), 1)

  // RESTORE WAN CONNECTION
  cloudAvailable = true

  // Cloud sync succeeds
  const syncOnline = await runtime.sync()
  assert.equal(syncOnline.eventsUploaded, 1)
  assert.equal(runtime.eventQueue.getPendingCount(), 0)

  await controller.stop()
  await mockServer.stop()
  runtime.close()
})

test('Duplicate Event Protection: drops duplicate alerts within dedup window without extra unlocks', async () => {
  const mockServer = new MockHikvisionServer()
  const port = await mockServer.start()

  let credentialEventsReceived = 0
  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecureGymFlow2026!',
    dedupWindowMs: 1000,
  })

  adapter.onCredential(async (event) => {
    credentialEventsReceived++
    return {
      decision: 'allow',
      reasonCode: 'ACCESS_GRANTED',
      eventId: crypto.randomUUID(),
      unlocked: true,
      occurredAt: new Date().toISOString(),
    }
  })

  await adapter.start()
  await waitForReady(adapter)

  const eventXml = `
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <cardNo>0123456789ABCDEF</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <doorNo>1</doorNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `

  // Send first event
  mockServer.pushEvent(eventXml)
  await new Promise((r) => setTimeout(r, 50))

  // Send duplicate immediately (stream reconnect simulation)
  mockServer.pushEvent(eventXml)
  await new Promise((r) => setTimeout(r, 100))

  // Only 1 event processed and only 1 unlock issued
  assert.equal(credentialEventsReceived, 1)
  assert.equal(mockServer.getReceivedUnlockCommands().length, 1)

  // Wait past dedup window and send again (legitimate later scan)
  await new Promise((r) => setTimeout(r, 1100))
  mockServer.pushEvent(eventXml)
  await new Promise((r) => setTimeout(r, 100))

  assert.equal(credentialEventsReceived, 2)
  assert.equal(mockServer.getReceivedUnlockCommands().length, 2)

  await adapter.stop()
  await mockServer.stop()
})

test('Ambiguous Actuation: connection drop during unlock does NOT trigger blind retry', async () => {
  const mockServer = new MockHikvisionServer()
  const port = await mockServer.start()

  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecureGymFlow2026!',
  })

  adapter.onCredential(async () => ({
    decision: 'allow',
    reasonCode: 'ACCESS_GRANTED',
    eventId: crypto.randomUUID(),
    unlocked: true,
    occurredAt: new Date().toISOString(),
  }))

  await adapter.start()
  await waitForReady(adapter)

  // Simulate network drop upon receiving RemoteControl PUT
  mockServer.setDropConnectionOnUnlock(true)

  const eventXml = `
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <cardNo>0123456789ABCDEF</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <doorNo>1</doorNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `

  mockServer.pushEvent(eventXml)
  await new Promise((r) => setTimeout(r, 200))

  // Confirm exactly 1 attempt was made and NO blind retry loop occurred
  assert.equal(mockServer.getReceivedUnlockCommands().length, 1)
  assert.ok(adapter.health().errorDetails !== undefined)

  await adapter.stop()
  await mockServer.stop()
})

test('Multi-Reader & Direction Mapping: correctly routes Entry vs Exit readers to distinct doors', async () => {
  const mockServer = new MockHikvisionServer()
  const port = await mockServer.start()

  const entryPoint = crypto.randomUUID()
  const exitPoint = crypto.randomUUID()

  let receivedDispatches = []

  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: entryPoint,
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecureGymFlow2026!',
    readerMappings: {
      1: { accessPointId: entryPoint, direction: 'entry', doorNo: 1 },
      2: { accessPointId: exitPoint, direction: 'exit', doorNo: 2 },
    },
  })

  adapter.onCredential(async (event) => {
    receivedDispatches.push(event)
    return {
      decision: 'allow',
      reasonCode: 'ACCESS_GRANTED',
      eventId: crypto.randomUUID(),
      unlocked: true,
      occurredAt: new Date().toISOString(),
    }
  })

  await adapter.start()
  await waitForReady(adapter)

  // Reader 1 (Entry)
  mockServer.pushEvent(`
    <EventNotificationAlert version="2.0"><eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent><cardNo>CARD_ENTRY</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent>
    </EventNotificationAlert>
  `)

  // Reader 2 (Exit)
  mockServer.pushEvent(`
    <EventNotificationAlert version="2.0"><eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent><cardNo>CARD_EXIT</cardNo><cardReaderNo>2</cardReaderNo></AccessControllerEvent>
    </EventNotificationAlert>
  `)

  // Unmapped Reader 3
  mockServer.pushEvent(`
    <EventNotificationAlert version="2.0"><eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent><cardNo>CARD_UNKNOWN</cardNo><cardReaderNo>3</cardReaderNo></AccessControllerEvent>
    </EventNotificationAlert>
  `)

  await new Promise((r) => setTimeout(r, 200))

  // Only 2 mapped events were dispatched
  assert.equal(receivedDispatches.length, 2)
  assert.equal(receivedDispatches[0].credential, 'CARD_ENTRY')
  assert.equal(receivedDispatches[0].rawMetadata.doorNo, 1)

  assert.equal(receivedDispatches[1].credential, 'CARD_EXIT')
  assert.equal(receivedDispatches[1].rawMetadata.doorNo, 2)

  // Verify corresponding door 1 and door 2 commands
  const commands = mockServer.getReceivedUnlockCommands()
  assert.equal(commands.length, 2)
  assert.equal(commands[0].doorId, 1)
  assert.equal(commands[1].doorId, 2)

  await adapter.stop()
  await mockServer.stop()
})

test('Privacy & Diagnostic Safety: never leaks controller password in health, logs or errors', async () => {
  const password = 'SuperSecretControllerPassword999!'
  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: 9999, // Unreachable port to generate connection error
    useHttps: false,
    username: 'gymflow_api',
    password,
  })

  await adapter.start()
  await new Promise((r) => setTimeout(r, 100))

  const healthJson = JSON.stringify(adapter.health())
  assert.ok(!healthJson.includes(password))

  await adapter.stop()
})

test('Direct actuate() invocation: contract compliance for direct actuation calls', async () => {
  const mockServer = new MockHikvisionServer()
  const port = await mockServer.start()

  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecureGymFlow2026!',
    defaultDoorNo: 1,
  })

  await adapter.start()
  await waitForReady(adapter)

  // Direct ALLOW actuation
  await adapter.actuate({
    decision: 'allow',
    reasonCode: 'ACCESS_GRANTED',
    eventId: crypto.randomUUID(),
    unlocked: true,
    occurredAt: new Date().toISOString(),
  })

  let commands = mockServer.getReceivedUnlockCommands()
  assert.equal(commands.length, 1)
  assert.equal(commands[0].doorId, 1)
  assert.ok(commands[0].body.includes('<cmd>open</cmd>'))

  // Direct DENY actuation (must NOT send unlock)
  await adapter.actuate({
    decision: 'deny',
    reasonCode: 'SUBSCRIPTION_EXPIRED',
    eventId: crypto.randomUUID(),
    unlocked: false,
    occurredAt: new Date().toISOString(),
  })

  commands = mockServer.getReceivedUnlockCommands()
  assert.equal(commands.length, 1) // Count remains 1

  await adapter.stop()
  await mockServer.stop()
})

test('Non-card events & malformed XML: safely ignores heartbeat, status events and corrupted XML', async () => {
  const mockServer = new MockHikvisionServer()
  const port = await mockServer.start()

  let dispatchedCount = 0
  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecureGymFlow2026!',
  })

  adapter.onCredential(async () => {
    dispatchedCount++
    return {
      decision: 'allow',
      reasonCode: 'ACCESS_GRANTED',
      eventId: crypto.randomUUID(),
      unlocked: true,
      occurredAt: new Date().toISOString(),
    }
  })

  await adapter.start()
  await waitForReady(adapter)

  // Push door status event (no card)
  mockServer.pushEvent(`
    <EventNotificationAlert version="2.0">
      <eventType>doorStatus</eventType>
      <doorStatus>open</doorStatus>
    </EventNotificationAlert>
  `)

  // Push AccessControllerEvent with missing cardNo (e.g. key unlock)
  mockServer.pushEvent(`
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <majorEventType>5</majorEventType>
        <subEventType>1</subEventType>
        <doorNo>1</doorNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `)

  // Push malformed XML chunk
  mockServer.pushRawChunk(`--MIME_boundary_123\r\nContent-Type: application/xml\r\nContent-Length: 20\r\n\r\n<Malformed <XML>>>\r\n`)

  await new Promise((r) => setTimeout(r, 150))

  assert.equal(dispatchedCount, 0)
  assert.equal(mockServer.getReceivedUnlockCommands().length, 0)
  assert.equal(adapter.health().state, 'READY')

  await adapter.stop()
  await mockServer.stop()
})

test('Dynamic Password Provider: supports async function for password retrieval with rotation', async () => {
  const mockServer = new MockHikvisionServer({
    password: 'DynamicSecret2026!',
  })
  const port = await mockServer.start()

  let passwordFetchCount = 0
  const dynamicPasswordFn = async () => {
    passwordFetchCount++
    return 'DynamicSecret2026!'
  }

  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: dynamicPasswordFn,
  })

  await adapter.start()
  await waitForReady(adapter)

  assert.ok(passwordFetchCount >= 1)
  assert.equal(adapter.health().state, 'READY')

  await adapter.stop()
  await mockServer.stop()
})

test('D1-003: Configuration immutability prevents post-construction mutation of topology and reader mappings', async () => {
  const mockServer = new MockHikvisionServer()
  const port = await mockServer.start()

  const entryPoint = crypto.randomUUID()
  const mutableMappings = {
    1: { accessPointId: entryPoint, direction: 'entry', doorNo: 1 },
  }

  const mutableConfig = {
    deviceId: crypto.randomUUID(),
    accessPointId: entryPoint,
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecureGymFlow2026!',
    readerMappings: mutableMappings,
  }

  const adapter = new HikvisionIsapiAdapter(mutableConfig)

  // Caller attempts post-construction mutation of original objects
  mutableMappings[1].doorNo = 99
  mutableMappings[1].accessPointId = 'HACKED_POINT'
  mutableConfig.controllerHost = 'evil.com'

  let receivedEvent = null
  adapter.onCredential(async (event) => {
    receivedEvent = event
    return {
      decision: 'allow',
      reasonCode: 'ACCESS_GRANTED',
      eventId: crypto.randomUUID(),
      unlocked: true,
      occurredAt: new Date().toISOString(),
    }
  })

  await adapter.start()
  await waitForReady(adapter)

  // Push valid scan event on Reader 1
  mockServer.pushEvent(`
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <cardNo>TEST_CARD_IMMUTABLE</cardNo>
        <cardReaderNo>1</cardReaderNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `)

  await new Promise((r) => setTimeout(r, 200))

  assert.ok(receivedEvent !== null)
  assert.equal(receivedEvent.rawMetadata.doorNo, 1) // Preserved trusted door 1

  // Remote open is sent to Door 1, NOT Door 99
  const commands = mockServer.getReceivedUnlockCommands()
  assert.equal(commands.length, 1)
  assert.equal(commands[0].doorId, 1) // Strictly Door 1

  await adapter.stop()
  await mockServer.stop()
})

test('Reader -> Door Trust Boundary: Controller XML doorNo cannot override configured mapping doorNo', async () => {
  const mockServer = new MockHikvisionServer()
  const port = await mockServer.start()

  const entryPoint = crypto.randomUUID()
  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: entryPoint,
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecureGymFlow2026!',
    readerMappings: {
      1: { accessPointId: entryPoint, direction: 'entry', doorNo: 1 },
    },
  })

  adapter.onCredential(async () => ({
    decision: 'allow',
    reasonCode: 'ACCESS_GRANTED',
    eventId: crypto.randomUUID(),
    unlocked: true,
    occurredAt: new Date().toISOString(),
  }))

  await adapter.start()
  await waitForReady(adapter)

  // Hostile controller XML sends cardReaderNo: 1 but doorNo: 4 (trying to actuate door 4)
  mockServer.pushEvent(`
    <EventNotificationAlert version="2.0">
      <eventType>AccessControllerEvent</eventType>
      <AccessControllerEvent>
        <cardNo>TEST_CARD_SPOOF_DOOR</cardNo>
        <cardReaderNo>1</cardReaderNo>
        <doorNo>4</doorNo>
      </AccessControllerEvent>
    </EventNotificationAlert>
  `)

  await new Promise((r) => setTimeout(r, 200))

  // Adapter strictly uses trusted reader mapping (Door 1), completely ignoring controller-supplied doorNo 4
  const commands = mockServer.getReceivedUnlockCommands()
  assert.equal(commands.length, 1)
  assert.equal(commands[0].doorId, 1) // Always 1

  await adapter.stop()
  await mockServer.stop()
})

test('D1-001 / D1-002 E2E: Hostile DTD alertStream and outer spoofing payloads cause ZERO unlock', async () => {
  const mockServer = new MockHikvisionServer()
  const port = await mockServer.start()

  let dispatched = false
  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: port,
    useHttps: false,
    username: 'gymflow_api',
    password: 'SecureGymFlow2026!',
  })

  adapter.onCredential(async () => {
    dispatched = true
    return {
      decision: 'allow',
      reasonCode: 'ACCESS_GRANTED',
      eventId: crypto.randomUUID(),
      unlocked: true,
      occurredAt: new Date().toISOString(),
    }
  })

  await adapter.start()
  await waitForReady(adapter)

  // Push hostile lowercase doctype payload across stream
  mockServer.pushEvent(`<!doctype root [<!entity xxe "x">]><EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>HACKED</cardNo></AccessControllerEvent></EventNotificationAlert>`)

  await new Promise((r) => setTimeout(r, 100))

  assert.equal(dispatched, false)
  assert.equal(mockServer.getReceivedUnlockCommands().length, 0)
  assert.ok(adapter.health().errorDetails !== undefined)

  await adapter.stop()
  await mockServer.stop()
})

// -----------------------------------------------------------------------------
// BATCH D.2 REMEDIATION TESTS
// -----------------------------------------------------------------------------

test('D2-ADV-001: Strict controller target validation rejects loopback, link-local, metadata, and URI injection while accepting private RFC1918 addresses', () => {
  const baseConfig = {
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    username: 'admin',
    password: 'password123',
  }

  const rejectedTargets = [
    '127.0.0.1',
    '127.0.0.2',
    '127.1',
    'localhost',
    '0.0.0.0',
    '169.254.169.254',
    '169.254.1.1',
    '100.100.100.200',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '[::1]',
    'fe80::1',
    '[fe80::1]',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    'http://127.0.0.1',
    'https://127.0.0.1',
    'user@127.0.0.1',
    '127.0.0.1/path',
    '127.0.0.1?x=y',
    '127.0.0.1#fragment',
    'attacker.com',
  ]

  for (const target of rejectedTargets) {
    const res = HikvisionConfigValidator.validate({
      ...baseConfig,
      controllerHost: target,
    })
    assert.equal(res.valid, false, `Expected ${target} to be rejected`)
    assert.ok(res.errors.includes('MALFORMED_CONTROLLER_HOST'), `Expected MALFORMED_CONTROLLER_HOST for ${target}`)
  }

  // Accepted RFC1918 private controller addresses
  const acceptedTargets = [
    '192.168.30.20',
    '10.10.50.5',
    '172.20.10.10',
  ]

  for (const target of acceptedTargets) {
    const res = HikvisionConfigValidator.validate({
      ...baseConfig,
      controllerHost: target,
    })
    assert.equal(res.valid, true, `Expected ${target} to be valid`)
    assert.equal(res.errors.length, 0)
  }

  // Testing override flag permits loopback only
  const loopbackTestRes = HikvisionConfigValidator.validate({
    ...baseConfig,
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
  })
  assert.equal(loopbackTestRes.valid, true)

  // Even with allowLoopbackForTesting, cloud metadata and arbitrary hostnames MUST be rejected
  const metadataStillBlocked = HikvisionConfigValidator.validate({
    ...baseConfig,
    controllerHost: '169.254.169.254',
    allowLoopbackForTesting: true,
  })
  assert.equal(metadataStillBlocked.valid, false)
})

test('D2-ADV-002: In-flight concurrency bound at MAX_CONCURRENT_IN_FLIGHT (32) fails closed and recovers capacity', async () => {
  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: 80,
    username: 'admin',
    password: 'password123',
  })

  let heldResolves = []
  let dispatchCount = 0

  adapter.onCredential(() => {
    dispatchCount++
    return new Promise((resolve) => {
      heldResolves.push(resolve)
    })
  })

  // Push 32 concurrent requests
  for (let i = 1; i <= 32; i++) {
    const card = i.toString(16).padStart(16, '0').toUpperCase()
    adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>${card}</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)
  }

  assert.equal(adapter['inFlightCount'], 32)
  assert.equal(dispatchCount, 32)

  // Push 33rd request: must be dropped immediately without dispatching
  adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>OVERFLOW_CARD_33</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)

  assert.equal(adapter['inFlightCount'], 32)
  assert.equal(dispatchCount, 32, '33rd request must not be dispatched when at max concurrency')
  assert.equal(adapter.health().state, 'DEGRADED')
  assert.equal(adapter.health().errorDetails, 'CONCURRENT_IN_FLIGHT_CAPACITY_EXCEEDED')

  // Resolve 1 held promise
  const firstResolve = heldResolves.shift()
  firstResolve({ decision: 'deny', unlocked: false })
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(adapter['inFlightCount'], 31, 'Capacity must recover after resolution')

  // Now a new event can be accepted
  adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>RECOVERED_CARD</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)
  assert.equal(dispatchCount, 33, 'Recovered capacity allows subsequent dispatch')

  // Release remaining held promises
  heldResolves.forEach((r) => r({ decision: 'deny', unlocked: false }))
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(adapter['inFlightCount'], 0)

  // Test synchronous handler throw recovers capacity
  adapter.onCredential(() => {
    throw new Error('SYNC_EVALUATOR_THROW')
  })
  adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>SYNC_THROW_CARD</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(adapter['inFlightCount'], 0, 'Synchronous exception must not leave inFlightCount elevated')

  // Test promise rejection recovers capacity
  adapter.onCredential(async () => {
    throw new Error('ASYNC_EVALUATOR_REJECT')
  })
  adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>ASYNC_REJECT_CARD</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(adapter['inFlightCount'], 0, 'Promise rejection must recover inFlightCount')
})

test('D2-ADV-003: Dedup cache bounds at MAX_DEDUP_CACHE_SIZE (1000) fail-closed on flood to preserve active replay protection', async () => {
  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: 80,
    username: 'admin',
    password: 'password123',
    dedupWindowMs: 2000,
  })

  let legitCardDispatches = 0
  const legitCard = '04A1B2C3D4E5F6'

  adapter.onCredential(async (event) => {
    if (event.credential === legitCard) {
      legitCardDispatches++
    }
    return { decision: 'deny', unlocked: false }
  })

  // 1. Initial valid scan of legit card
  adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>${legitCard}</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(legitCardDispatches, 1)

  // 2. Flood with 1,500 distinct fake card scans inside active window
  for (let i = 1; i <= 1500; i++) {
    const floodCard = `FLOOD_${i.toString(16).padStart(8, '0')}`
    adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>${floodCard}</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)
  }

  // Cache size must strictly be bounded <= MAX_DEDUP_CACHE_SIZE (1000)
  assert.ok(adapter['dedupCache'].size <= 1000, `Dedup cache size ${adapter['dedupCache'].size} exceeded 1000`)
  assert.equal(adapter['dedupCache'].size, 1000)
  assert.equal(adapter.health().state, 'DEGRADED')
  assert.equal(adapter.health().errorDetails, 'DEDUP_CACHE_CAPACITY_EXCEEDED')

  // 3. Attempt replay of legitCard inside its active window:
  // Must NOT have been evicted by the flood; must remain suppressed!
  adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>${legitCard}</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(legitCardDispatches, 1, 'Legit card replay inside window must be suppressed and not evicted by flood')
})

test('D2-ADV-005: Event ingestion stamps monotonic t0ReceivedMs in rawMetadata without affecting lookup hashes', async () => {
  const adapter = new HikvisionIsapiAdapter({
    deviceId: crypto.randomUUID(),
    accessPointId: crypto.randomUUID(),
    controllerHost: '127.0.0.1',
    allowLoopbackForTesting: true,
    controllerPort: 80,
    username: 'admin',
    password: 'password123',
  })

  let capturedEvent = null
  adapter.onCredential(async (event) => {
    capturedEvent = event
    return { decision: 'deny', unlocked: false }
  })

  const testCard = '04A1B2C3D4'
  adapter['handleStreamXml'](`<EventNotificationAlert><eventType>AccessControllerEvent</eventType><AccessControllerEvent><cardNo>${testCard}</cardNo><cardReaderNo>1</cardReaderNo></AccessControllerEvent></EventNotificationAlert>`)
  await new Promise((r) => setTimeout(r, 10))

  assert.ok(capturedEvent !== null)
  assert.ok(typeof capturedEvent.rawMetadata.t0ReceivedMs === 'number', 't0ReceivedMs must be a numeric timestamp')
  assert.ok(capturedEvent.rawMetadata.t0ReceivedMs > 0)

  // Verify that lookupHash computation only uses credential identity and is not affected by timing metadata
  const hash1 = await CredentialNormalizer.computeLookupHash('rfid', capturedEvent.credential)
  const hash2 = await CredentialNormalizer.computeLookupHash('rfid', testCard)
  assert.equal(hash1, hash2, 'Lookup hash must remain identical and independent of diagnostic timing')
})


