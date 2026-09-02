import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { handleApi } from '../src/api.ts'
import { MIGRATIONS } from '../src/club/schema.ts'
import { AccessStore, credentialDigest, maskCredential, normalizeCredential } from '../src/club/access.ts'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const BRANCH = '44444444-4444-4444-8444-444444444444'
const DISCIPLINE = '55555555-5555-4555-8555-555555555555'
const RESOURCE = '66666666-6666-4666-8666-666666666666'
const SESSION = 'access-router-session-token'

function session(overrides = {}) {
  const future = new Date(Date.now() + 3_600_000).toISOString()
  const recent = new Date(Date.now() - 1_000).toISOString()
  return {
    user_id: USER, org_id: ORG_A, expires_at: future, last_seen_at: recent,
    support_org_id: null, support_expires_at: null, support_write: 0,
    support_write_expires_at: null, name: 'Admin Route', email: 'route@example.test',
    is_platform_admin: 0, user_status: 'active', role: 'admin', branch_id: BRANCH,
    discipline_id: DISCIPLINE, membership_status: 'active', org_status: 'active',
    timezone: 'Africa/Casablanca', ...overrides,
  }
}

function entitlement(overrides = {}) {
  return {
    id: ORG_A, status: 'active', plan: 'pro', trial_ends_at: null,
    max_members: null, max_branches: null, max_staff: null,
    expires_at: '2099-12-31T00:00:00Z', price_cents: 1000, ...overrides,
  }
}

function clubDouble(overrides = {}) {
  const calls = []
  const club = {
    calls,
    accessRateLimit: async (...args) => (calls.push(['rate', ...args]), { allowed: true, retryAfter: 1 }),
    accessOptions: async (kind, options) => (calls.push(['options', kind, options]), { items: [], nextCursor: null }),
    listAccess: async (kind, options) => (calls.push(['list', kind, options]), { items: [], nextCursor: null }),
    createAccessGateway: async (input, actor) => (calls.push(['createGateway', input, actor]), { id: RESOURCE }),
    createAccessDevice: async (input, actor) => (calls.push(['createDevice', input, actor]), { id: RESOURCE }),
    createAccessPoint: async (input, actor) => (calls.push(['createPoint', input, actor]), { id: RESOURCE }),
    createAccessCredential: async (input, actor) => (calls.push(['createCredential', input, actor]), { id: RESOURCE, type: input.type, maskedIdentifier: input.identifierMask, status: 'active' }),
    createAccessRule: async (input, actor) => (calls.push(['createRule', input, actor]), { id: RESOURCE }),
    patchAccess: async (...args) => { calls.push(['patch', ...args]) },
    disableAccess: async (...args) => { calls.push(['disable', ...args]) },
    evaluateAccess: async input => (calls.push(['evaluate', input]), { decision: 'deny', reason: 'CREDENTIAL_UNKNOWN', accessPointId: input.accessPointId }),
    ...overrides,
  }
  return club
}

function environment({ principal = session(), billing = entitlement(), club = clubDouble(), clubs = null } = {}) {
  const selected = []
  const audits = []
  const control = {
    prepare(sql) {
      let bound = []
      return {
        bind(...values) { bound = values; return this },
        async first() {
          if (sql.includes('FROM sessions s')) return principal
          if (sql.includes('FROM organizations o') && sql.includes('LEFT JOIN org_billing')) return billing
          return null
        },
        async run() { if(sql.includes('INSERT INTO platform_audit'))audits.push({sql,bound});return { success: true, meta: { changes: 1 }, bound } },
        async all() { return { results: [] } },
      }
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())) },
  }
  return {
    club, selected, audits,
    env: {
      CONTROL: control,
      CLUB: {
        idFromName(orgId) { selected.push(orgId); return `do:${orgId}` },
        get(id) { return clubs?.[id] ?? club },
      },
      ENTITLEMENT_MODE: 'enforce',
    },
  }
}

function realAccessFixture() {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
  for(const migration of MIGRATIONS){db.exec('BEGIN IMMEDIATE');try{for(const statement of migration.statements)db.exec(statement);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}
  const sql={exec(query,...params){const statement=db.prepare(query);const rows=statement.columns().length?statement.all(...params):(statement.run(...params),[]);return{toArray:()=>rows,one:()=>{if(!rows[0])throw new Error('no row');return rows[0]},raw:()=>rows.map(Object.values)}}}
  const storage={transactionSync(callback){db.exec('BEGIN IMMEDIATE');try{const value=callback();db.exec('COMMIT');return value}catch(error){db.exec('ROLLBACK');throw error}}}
  const store=new AccessStore(sql,storage),branch=crypto.randomUUID(),discipline=crypto.randomUUID(),member=crypto.randomUUID(),actor={id:USER,name:'Admin Route'}
  db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branch,'Centre')
  db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(discipline,'Fitness')
  db.prepare("INSERT INTO members(id,name,phone,branch_id,discipline_id,status) VALUES(?,?,?,?,?,'active')").run(member,'Sara Route','0600000099',branch,discipline)
  const scope={branchId:branch,disciplineId:null}
  const gateway=store.createGateway({branchId:branch,name:'Gateway',status:'online',scope},actor).id
  const device=store.createDevice({gatewayId:gateway,name:'Portique',adapterType:'generic',deviceType:'turnstile',status:'online',metadata:{},scope},actor).id
  const point=store.createPoint({deviceId:device,name:'Entrée',direction:'entry',status:'active',scope},actor).id
  const raw='A3:F8:82:91'
  return {db,store,branch,discipline,member,gateway,device,point,raw,actor}
}

async function seedRealCredential(fixture) {
  const lookupHash=await credentialDigest('rfid',null,fixture.raw)
  fixture.store.createCredential({memberId:fixture.member,type:'rfid',lookupHash,identifierMask:maskCredential(normalizeCredential('rfid',fixture.raw)),scope:{branchId:fixture.branch}},fixture.actor)
  fixture.store.createRule({branchId:fixture.branch,name:'Membres',effect:'allow',priority:10,daysMask:127,status:'active',scope:{branchId:fixture.branch}},fixture.actor)
}

function realClub(fixture) {
  return {
    accessRateLimit:async(...args)=>fixture.store.rateLimit(...args),
    accessOptions:async(...args)=>fixture.store.options(...args),
    listAccess:async(...args)=>fixture.store.list(...args),
    createAccessGateway:async(...args)=>fixture.store.createGateway(...args),
    createAccessDevice:async(...args)=>fixture.store.createDevice(...args),
    createAccessPoint:async(...args)=>fixture.store.createPoint(...args),
    createAccessCredential:async(...args)=>fixture.store.createCredential(...args),
    createAccessRule:async(...args)=>fixture.store.createRule(...args),
    patchAccess:async(...args)=>fixture.store.patch(...args),
    disableAccess:async(...args)=>fixture.store.disable(...args),
    evaluateAccess:async(...args)=>{try{return fixture.store.evaluate(...args)}catch(error){fixture.lastError=error;throw error}},
  }
}

function request(path, { method = 'GET', body, origin = true, cookie = true, headers = {} } = {}) {
  const url = `https://gymflow.test${path}`
  const nextHeaders = new Headers(headers)
  if (cookie) nextHeaders.set('Cookie', `__Host-gf_session=${SESSION}`)
  if (origin === true) nextHeaders.set('Origin', 'https://gymflow.test')
  else if (typeof origin === 'string') nextHeaders.set('Origin', origin)
  if (body !== undefined && !nextHeaders.has('Content-Type')) nextHeaders.set('Content-Type', 'application/json')
  return new Request(url, { method, headers: nextHeaders, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
}

async function call(env, path, init) {
  const response = await handleApi(request(path, init), env)
  const data = await response.json()
  return { response, data }
}

test('production router requires authentication and staff authorization', async () => {
  let setup = environment({ principal: null })
  assert.equal((await call(setup.env, '/api/access/gateways')).response.status, 401)

  setup = environment({ principal: session({ role: 'viewer' }) })
  const denied = await call(setup.env, '/api/access/gateways')
  assert.equal(denied.response.status, 403)
  assert.equal(setup.club.calls.some(entry => entry[0] === 'list'), false)

  setup = environment({ principal: session({ role: 'staff' }) })
  const staffWrite = await call(setup.env, '/api/access/gateways', { method: 'POST', body: { branchId: BRANCH, name: 'A' } })
  assert.equal(staffWrite.response.status, 403)
  assert.equal(setup.club.calls.some(entry => entry[0] === 'createGateway'), false)
})

test('credential collection reaches production route with branch and discipline scope', async () => {
  const setup = environment()
  const result = await call(setup.env, '/api/access/credentials?limit=25')
  assert.equal(result.response.status, 200, JSON.stringify(result.data))
  const list = setup.club.calls.find(entry => entry[0] === 'list')
  assert.equal(list[1], 'credentials')
  assert.deepEqual(list[2].scope, { branchId: BRANCH, disciplineId: DISCIPLINE })
  assert.equal(list[2].limit, 25)
  assert.deepEqual(setup.selected, [ORG_A])
  assert.ok(!setup.selected.includes(ORG_B), 'the client cannot select a different tenant Durable Object')
})

test('production router enforces Origin, entitlement, support state, and rate limits', async () => {
  let setup = environment()
  assert.equal((await call(setup.env, '/api/access/gateways', { method: 'POST', origin: false, body: { branchId: BRANCH, name: 'A' } })).response.status, 403)
  assert.equal((await call(setup.env, '/api/access/gateways', { method: 'POST', origin: 'https://evil.test', body: { branchId: BRANCH, name: 'A' } })).response.status, 403)

  setup = environment({ billing: entitlement({ expires_at: '2000-01-01T00:00:00Z' }) })
  const expired = await call(setup.env, '/api/access/gateways', { method: 'POST', body: { branchId: BRANCH, name: 'A' } })
  assert.equal(expired.response.status, 403)
  assert.equal(expired.data.code, 'ENTITLEMENT_READ_ONLY')

  const future = new Date(Date.now() + 3_600_000).toISOString()
  setup = environment({ principal: session({ is_platform_admin: 1, role: null, membership_status: null, org_id: null, org_status: null, support_org_id: ORG_A, support_expires_at: future, support_write: 0 }) })
  assert.equal((await call(setup.env, '/api/access/gateways', { method: 'POST', body: { branchId: BRANCH, name: 'A' } })).response.status, 403)

  setup = environment({ principal: session({ is_platform_admin: 1, role: null, membership_status: null, org_id: null, org_status: null, support_org_id: ORG_A, support_expires_at: '2000-01-01T00:00:00Z' }) })
  assert.equal((await call(setup.env, '/api/access/gateways')).response.status, 403)

  setup = environment({ club: clubDouble({ accessRateLimit: async () => ({ allowed: false, retryAfter: 37 }) }) })
  const throttled = await call(setup.env, '/api/access/gateways')
  assert.equal(throttled.response.status, 429)
  assert.equal(throttled.response.headers.get('Retry-After'), '37')
})

test('production router rejects malformed methods, cursors, identifiers, fields, and bodies', async () => {
  const setup = environment()
  assert.equal((await call(setup.env, '/api/access/events', { method: 'POST', body: {} })).response.status, 405)
  assert.equal((await call(setup.env, '/api/access/events?limit=101')).response.status, 400)
  assert.equal((await call(setup.env, '/api/access/events?cursor=not-a-bound-cursor')).data.code, 'INVALID_CURSOR')
  assert.equal((await call(setup.env, '/api/access/gateways/not-a-uuid', { method: 'PATCH', body: { status: 'disabled' } })).data.code, 'INVALID_ID')
  assert.equal((await call(setup.env, '/api/access/gateways', { method: 'POST', body: { branchId: BRANCH, name: 'A', secret: 'never' } })).data.code, 'UNKNOWN_FIELD')
  assert.equal((await call(setup.env, '/api/access/gateways', { method: 'POST', body: { branchId: BRANCH, name: 'A' }, headers: { 'Content-Length': '9000' } })).response.status, 413)
  assert.equal((await call(setup.env, '/api/access/gateways', { method: 'POST', body: { branchId: BRANCH, name: 'x'.repeat(9000) } })).response.status, 413)
  assert.equal(setup.club.calls.some(entry => entry[0] === 'createGateway'), false)
})

test('rule validity is canonical UTC on create and patch', async () => {
  const setup = environment()
  const base = { branchId: BRANCH, name: 'Jour', effect: 'allow', validUntil: '2026-09-01T10:00:00Z' }
  for (const validFrom of ['2026-09-01T08:00:00-02:00', '2026-09-01', '2026-02-30T08:00:00Z']) {
    const result = await call(setup.env, '/api/access/rules', { method: 'POST', body: { ...base, validFrom } })
    assert.equal(result.data.code, 'INVALID_RULE', validFrom)
  }
  assert.equal((await call(setup.env, `/api/access/rules/${RESOURCE}`, { method: 'PATCH', body: { validFrom: '2026-09-01T08:00:00-02:00', validUntil: '2026-09-01T12:00:00Z' } })).data.code, 'INVALID_RULE')
  assert.equal(setup.club.calls.some(entry => entry[0] === 'createRule' || entry[0] === 'patch'), false)
})

test('whitespace-only Access optionals normalize to null or bounded 4xx before storage', async () => {
  const setup=environment()
  const gateway=await call(setup.env,'/api/access/gateways',{method:'POST',body:{branchId:BRANCH,name:'Gateway',version:'   '}})
  assert.equal(gateway.response.status,201);assert.equal(setup.club.calls.find(entry=>entry[0]==='createGateway')[1].version,null)
  const device=await call(setup.env,'/api/access/devices',{method:'POST',body:{gatewayId:RESOURCE,name:'Porte',adapterType:'generic',deviceType:'door',externalDeviceId:' \t ',metadata:{}}})
  assert.equal(device.response.status,201);assert.equal(setup.club.calls.find(entry=>entry[0]==='createDevice')[1].externalDeviceId,null)
  const credential=await call(setup.env,'/api/access/credentials',{method:'POST',body:{memberId:USER,type:'rfid',identifier:'A3F88291',provider:'   '}})
  assert.equal(credential.response.status,201);assert.equal(setup.club.calls.find(entry=>entry[0]==='createCredential')[1].provider,null)
  const external=await call(setup.env,'/api/access/credentials',{method:'POST',body:{memberId:USER,type:'external',provider:' ',externalCredentialId:'REF-1000'}})
  assert.equal(external.response.status,400);assert.equal(external.data.code,'INVALID_CREDENTIAL')
  const rule=await call(setup.env,'/api/access/rules',{method:'POST',body:{branchId:BRANCH,name:'Toujours',effect:'allow',startTime:' ',endTime:'\t',validFrom:' ',validUntil:' '}})
  assert.equal(rule.response.status,201)
  const ruleInput=setup.club.calls.find(entry=>entry[0]==='createRule')[1]
  assert.equal(ruleInput.startTime,null);assert.equal(ruleInput.endTime,null);assert.equal(ruleInput.validFrom,null);assert.equal(ruleInput.validUntil,null)
  const halfRule=await call(setup.env,'/api/access/rules',{method:'POST',body:{branchId:BRANCH,name:'Invalide',effect:'allow',startTime:' ',endTime:'10:00'}})
  assert.equal(halfRule.response.status,400);assert.equal(halfRule.data.code,'INVALID_RULE')
  const evaluation=await call(setup.env,'/api/access/evaluate',{method:'POST',body:{credentialType:'rfid',identifier:'A3F88291',accessPointId:RESOURCE,externalEventId:'   '}})
  assert.equal(evaluation.response.status,200);assert.equal(setup.club.calls.find(entry=>entry[0]==='evaluate')[1].externalEventId,null)
  const gatewayPatch=await call(setup.env,`/api/access/gateways/${RESOURCE}`,{method:'PATCH',body:{version:' '}})
  const devicePatch=await call(setup.env,`/api/access/devices/${RESOURCE}`,{method:'PATCH',body:{externalDeviceId:' '}})
  const rulePatch=await call(setup.env,`/api/access/rules/${RESOURCE}`,{method:'PATCH',body:{startTime:' ',endTime:' ',validFrom:' ',validUntil:' '}})
  assert.equal(gatewayPatch.response.status,200);assert.equal(devicePatch.response.status,200);assert.equal(rulePatch.response.status,200)
  const patches=setup.club.calls.filter(entry=>entry[0]==='patch').map(entry=>entry[3])
  assert.equal(patches[0].version,null);assert.equal(patches[1].externalDeviceId,null)
  assert.deepEqual(patches[2],{startTime:null,endTime:null,validFrom:null,validUntil:null})
})

test('biometric and external credentials accept external references only and never forward raw material', async () => {
  const setup = environment()
  const forbidden = await call(setup.env, '/api/access/credentials', { method: 'POST', body: { memberId: USER, type: 'fingerprint', provider: 'controller', identifier: 'template-shaped-material', externalCredentialId: 'FP-100' } })
  assert.equal(forbidden.data.code, 'INVALID_CREDENTIAL')
  assert.ok(!JSON.stringify(forbidden.data).includes('template-shaped-material'))

  const created = await call(setup.env, '/api/access/credentials', { method: 'POST', body: { memberId: USER, type: 'fingerprint', provider: 'controller', externalCredentialId: 'FP-100' } })
  assert.equal(created.response.status, 201, JSON.stringify(created.data))
  const callEntry = setup.club.calls.find(entry => entry[0] === 'createCredential')
  assert.match(callEntry[1].lookupHash, /^[0-9a-f]{64}$/)
  assert.equal(callEntry[1].identifierMask, '••••-100')
  assert.equal('identifier' in callEntry[1], false)
  assert.ok(!JSON.stringify(created.data).includes('FP-100'))
})

test('production CRUD dispatches every topology collection and resource mutation', async () => {
  const setup = environment()
  const creates = [
    ['gateways', { branchId: BRANCH, name: 'Passerelle', status: 'pending' }, 'createGateway'],
    ['devices', { gatewayId: RESOURCE, name: 'Portique', adapterType: 'generic', deviceType: 'turnstile', status: 'pending', metadata: {} }, 'createDevice'],
    ['points', { deviceId: RESOURCE, name: 'Entree', direction: 'entry', status: 'active' }, 'createPoint'],
    ['credentials', { memberId: USER, type: 'rfid', identifier: 'A3F88291' }, 'createCredential'],
    ['rules', { branchId: BRANCH, name: 'Membres', effect: 'allow', priority: 5, daysMask: 127, status: 'active' }, 'createRule'],
  ]
  for (const [kind, body, callName] of creates) {
    const created = await call(setup.env, `/api/access/${kind}`, { method: 'POST', body })
    assert.equal(created.response.status, 201, `${kind}: ${JSON.stringify(created.data)}`)
    assert.ok(setup.club.calls.some(entry => entry[0] === callName), callName)
  }
  for (const kind of ['gateways', 'devices', 'points', 'credentials', 'rules']) {
    const patch = kind === 'credentials' ? { status: 'lost' } : { status: 'disabled' }
    assert.equal((await call(setup.env, `/api/access/${kind}/${RESOURCE}`, { method: 'PATCH', body: patch })).response.status, 200, kind)
    assert.equal((await call(setup.env, `/api/access/${kind}/${RESOURCE}`, { method: 'DELETE' })).response.status, 200, kind)
  }
})

test('production CRUD maps cross-scope entity misses uniformly', async () => {
  const setup = environment({ club: clubDouble({ patchAccess: async () => { throw new Error('NOT_FOUND') } }) })
  const hidden = await call(setup.env, `/api/access/devices/${RESOURCE}`, { method: 'PATCH', body: { status: 'disabled' } })
  assert.equal(hidden.response.status, 404)
  assert.equal(hidden.data.code, 'ACCESS_NOT_FOUND')
})

test('malformed credentials return bounded 400 errors for enrollment and evaluation without raw logging', async () => {
  const setup=environment(),raw='RAW-CREDENTIAL-MUST-NOT-BE-LOGGED'
  const cases=[
    ['rfid',{identifier:''}],['rfid',{identifier:'ZZZZ'}],['rfid',{identifier:'A'.repeat(129)}],
    ['nfc',{identifier:''}],['nfc',{identifier:'ABC'}],['nfc',{identifier:'Z'.repeat(8)}],['nfc',{identifier:'A'.repeat(129)}],
    ['qr',{identifier:''}],['qr',{identifier:'short'}],['qr',{identifier:'Q'.repeat(513)}],
    ['fingerprint',{provider:'controller',externalCredentialId:''}],['fingerprint',{provider:'controller',externalCredentialId:'F'.repeat(161)}],
    ['face',{provider:'controller',externalCredentialId:''}],['face',{provider:'controller',externalCredentialId:'F'.repeat(161)}],
    ['external',{provider:'controller',externalCredentialId:''}],['external',{provider:'controller',externalCredentialId:'E'.repeat(161)}],
  ]
  const logged=[],original=console.error;console.error=(...args)=>logged.push(args)
  try{
    for(const [type,reference] of cases){
      const enrollment=await call(setup.env,'/api/access/credentials',{method:'POST',body:{memberId:USER,type,...reference}})
      assert.equal(enrollment.response.status,400,type);assert.equal(enrollment.data.code,'INVALID_CREDENTIAL',type)
      const evaluation=await call(setup.env,'/api/access/evaluate',{method:'POST',body:{credentialType:type,accessPointId:RESOURCE,...reference}})
      assert.equal(evaluation.response.status,400,type);assert.equal(evaluation.data.code,'INVALID_CREDENTIAL',type)
    }
    const explicit=await call(setup.env,'/api/access/evaluate',{method:'POST',body:{credentialType:'qr',identifier:raw.slice(0,7),accessPointId:RESOURCE}})
    assert.equal(explicit.data.code,'INVALID_CREDENTIAL')
  }finally{console.error=original}
  assert.equal(logged.length,0);assert.ok(!JSON.stringify(logged).includes(raw))
})

test('support evaluations write safe D1 audit entries for success and replay', async () => {
  const future=new Date(Date.now()+3_600_000).toISOString(),club=clubDouble({evaluateAccess:async input=>({eventId:RESOURCE,decision:'allow',reason:'ACCESS_GRANTED',accessPointId:input.accessPointId,replayed:false})})
  const principal=session({is_platform_admin:1,role:null,membership_status:null,org_id:null,org_status:null,branch_id:null,discipline_id:null,support_org_id:ORG_A,support_expires_at:future,support_write:1,support_write_expires_at:future})
  const setup=environment({principal,club})
  let result=await call(setup.env,'/api/access/evaluate',{method:'POST',body:{credentialType:'rfid',identifier:'A3F88291',accessPointId:RESOURCE,externalEventId:'support-event'}})
  assert.equal(result.response.status,200);assert.equal(setup.audits.length,1)
  assert.equal(setup.audits[0].bound[1],'support_access_evaluated');assert.equal(setup.audits[0].bound[2],ORG_A)
  let detail=JSON.parse(setup.audits[0].bound[3]);assert.equal(detail.decision,'allow');assert.equal(detail.replayed,false);assert.ok(!JSON.stringify(detail).includes('A3F88291'))
  club.evaluateAccess=async input=>({eventId:RESOURCE,decision:'allow',reason:'ACCESS_GRANTED',accessPointId:input.accessPointId,replayed:true})
  result=await call(setup.env,'/api/access/evaluate',{method:'POST',body:{credentialType:'rfid',identifier:'A3F88291',accessPointId:RESOURCE,externalEventId:'support-event'}})
  assert.equal(result.response.status,200);assert.equal(setup.audits.length,2);detail=JSON.parse(setup.audits[1].bound[3]);assert.equal(detail.replayed,true)
})

test('options route binds kind, search, scope, cursor, and bounded continuation', async () => {
  const observed=[],firstCursor={val:'Gateway 049',id:RESOURCE},club=clubDouble({accessOptions:async(kind,options)=>(observed.push({kind,options}),{items:[{id:RESOURCE,name:'Gateway 050'}],nextCursor:options.cursor?null:firstCursor})}),setup=environment({club})
  const first=await call(setup.env,'/api/access/options?kind=gateways&q=Gateway&limit=50')
  assert.equal(first.response.status,200);assert.equal(first.data.hasMore,true);assert.ok(first.data.nextCursor)
  assert.equal(observed[0].kind,'gateways');assert.equal(observed[0].options.search,'Gateway');assert.deepEqual(observed[0].options.scope,{branchId:BRANCH,disciplineId:DISCIPLINE})
  const second=await call(setup.env,`/api/access/options?kind=gateways&q=Gateway&limit=50&cursor=${first.data.nextCursor}`)
  assert.equal(second.response.status,200);assert.equal(second.data.hasMore,false)
  assert.deepEqual(observed[1].options.cursor,firstCursor)
  assert.equal((await call(setup.env,'/api/access/options?kind=members&limit=101')).data.code,'INVALID_PAGE')
  assert.equal((await call(setup.env,'/api/access/options?kind=unknown')).response.status,400)
  await call(setup.env,'/api/access/options?kind=gateways&q=%20%20%20')
  assert.equal(observed.at(-1).options.search,null)
})

test('production router plus real SQLite hides cross-scope replay and validates rule relations', async () => {
  const fixture=realAccessFixture();await seedRealCredential(fixture);const club=realClub(fixture)
  let setup=environment({club,principal:session({branch_id:fixture.branch,discipline_id:fixture.discipline})})
  const body={credentialType:'rfid',identifier:fixture.raw,accessPointId:fixture.point,externalEventId:'route-replay'}
  const granted=await call(setup.env,'/api/access/evaluate',{method:'POST',body});assert.equal(granted.data.reason,'ACCESS_GRANTED',fixture.lastError?.stack)
  setup=environment({club,principal:session({branch_id:crypto.randomUUID(),discipline_id:fixture.discipline})})
  let hidden=await call(setup.env,'/api/access/evaluate',{method:'POST',body});assert.equal(hidden.response.status,200);assert.equal(hidden.data.reason,'WRONG_BRANCH');assert.equal(hidden.data.replayed,false);assert.equal('memberId' in hidden.data,false)
  setup=environment({club,principal:session({branch_id:fixture.branch,discipline_id:crypto.randomUUID()})})
  hidden=await call(setup.env,'/api/access/evaluate',{method:'POST',body});assert.equal(hidden.response.status,200);assert.equal(hidden.data.reason,'WRONG_DISCIPLINE');assert.equal(hidden.data.replayed,false);assert.equal('memberId' in hidden.data,false)

  const otherDiscipline=crypto.randomUUID(),otherMember=crypto.randomUUID();fixture.db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(otherDiscipline,'Boxe');fixture.db.prepare("INSERT INTO members(id,name,phone,branch_id,discipline_id,status) VALUES(?,?,?,?,?,'active')").run(otherMember,'Autre','0600000011',fixture.branch,otherDiscipline)
  setup=environment({club,principal:session({branch_id:fixture.branch,discipline_id:fixture.discipline})})
  const invalidMember=await call(setup.env,'/api/access/rules',{method:'POST',body:{branchId:fixture.branch,disciplineId:fixture.discipline,memberId:otherMember,name:'Hors portée',effect:'allow'}})
  assert.equal(invalidMember.response.status,404);assert.equal(invalidMember.data.code,'ACCESS_NOT_FOUND')
  const invalidPoint=await call(setup.env,'/api/access/rules',{method:'POST',body:{branchId:fixture.branch,disciplineId:fixture.discipline,accessPointId:crypto.randomUUID(),name:'Point absent',effect:'allow'}})
  assert.equal(invalidPoint.response.status,404);assert.equal(invalidPoint.data.code,'ACCESS_NOT_FOUND')
})

test('production tenant-derived routing cannot read another real SQLite club', async () => {
  const clubA=realAccessFixture(),clubB=realAccessFixture();await seedRealCredential(clubA);await seedRealCredential(clubB)
  const setup=environment({principal:session({org_id:ORG_A,branch_id:clubA.branch,discipline_id:clubA.discipline}),club:realClub(clubA),clubs:{[`do:${ORG_A}`]:realClub(clubA),[`do:${ORG_B}`]:realClub(clubB)}})
  const result=await call(setup.env,'/api/access/evaluate',{method:'POST',body:{credentialType:'rfid',identifier:clubB.raw,accessPointId:clubB.point}})
  assert.equal(result.response.status,200);assert.equal(result.data.reason,'ACCESS_POINT_UNKNOWN');assert.deepEqual(setup.selected,[ORG_A])
})

test('production summary endpoint returns scoped statistics and aggregates', async () => {
  const observed = [], club = clubDouble({
    accessSummary: async (scope, date) => {
      observed.push({ scope, date })
      return {
        today: { totalAttempts: 10, allowedCount: 8, deniedCount: 2, uniqueMembers: 7, deltaAttemptsPct: 5, deltaAllowedPct: 10, deltaDeniedPct: -20, deltaMembersPct: 12 },
        securityBreakdown: { deniedTotal: 2, subscriptionExpired: 1, memberInactive: 1, credentialUnknown: 0, credentialLostOrRevoked: 0, infrastructureDenied: 0 },
        hourly: [{ hour: '09', count: 4 }, { hour: '10', count: 6 }],
        topPoints: [{ name: 'Entrée Principale', count: 8 }],
        infrastructure: { gatewaysTotal: 2, gatewaysOnline: 2, gatewaysOffline: 0, devicesTotal: 3, devicesActive: 3 },
      }
    }
  })
  const setup = environment({ club })
  const result = await call(setup.env, '/api/access/summary?date=2026-09-02')
  assert.equal(result.response.status, 200)
  assert.equal(result.data.today.totalAttempts, 10)
  assert.equal(result.data.today.allowedCount, 8)
  assert.equal(result.data.infrastructure.gatewaysOnline, 2)
  assert.deepEqual(observed[0], { scope: { branchId: BRANCH, disciplineId: DISCIPLINE }, date: '2026-09-02' })
})

test('production member summary endpoint authorizes staff, validates id and returns scoped aggregate', async () => {
  const memberId = '77777777-7777-4777-8777-777777777777'
  const observed = []
  const club = clubDouble({
    accessMemberSummary: async (targetId, scope) => {
      observed.push({ targetId, scope })
      return {
        memberId: targetId,
        visitsLast30Days: 14,
        averageVisitsPerWeek: 3.3,
        lastEntryAt: '2026-09-02T10:00:00.000Z',
        windowStart: '2026-08-03T10:00:00.000Z',
        windowEnd: '2026-09-02T10:00:00.000Z',
      }
    }
  })
  const setup = environment({ club })

  // Valid staff call
  const result = await call(setup.env, `/api/access/members/${memberId}/summary`)
  assert.equal(result.response.status, 200)
  assert.equal(result.data.visitsLast30Days, 14)
  assert.equal(result.data.averageVisitsPerWeek, 3.3)
  assert.deepEqual(observed[0], {
    targetId: memberId,
    scope: { branchId: BRANCH, disciplineId: DISCIPLINE },
  })

  // Invalid UUID format rejected with 400
  const badId = await call(setup.env, '/api/access/members/not-a-valid-uuid/summary')
  assert.equal(badId.response.status, 400)

  // Viewer role rejected with 403
  const viewerEnv = environment({ club, principal: session({ role: 'viewer' }) })
  const forbidden = await call(viewerEnv.env, `/api/access/members/${memberId}/summary`)
  assert.equal(forbidden.response.status, 403)
})

test('production summary endpoint validates calendar dates strictly', async () => {
  const club = clubDouble({
    accessSummary: async () => ({ today: {}, hourly: [], topPoints: [], infrastructure: {} })
  })
  const setup = environment({ club })

  // Valid dates accepted
  const valid1 = await call(setup.env, '/api/access/summary?date=2026-09-02')
  assert.equal(valid1.response.status, 200)
  const validLeap = await call(setup.env, '/api/access/summary?date=2024-02-29')
  assert.equal(validLeap.response.status, 200)

  // Non-leap Feb 29 rejected
  const badLeap = await call(setup.env, '/api/access/summary?date=2026-02-29')
  assert.equal(badLeap.response.status, 400)

  // Invalid month 13 rejected
  const badMonth = await call(setup.env, '/api/access/summary?date=2026-13-01')
  assert.equal(badMonth.response.status, 400)

  // Invalid day 31 of Feb rejected
  const badDay = await call(setup.env, '/api/access/summary?date=2026-02-31')
  assert.equal(badDay.response.status, 400)

  // Non-date string rejected
  const badStr = await call(setup.env, '/api/access/summary?date=not-a-date')
  assert.equal(badStr.response.status, 400)
})


