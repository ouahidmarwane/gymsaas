import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, LATEST_VERSION } from '../src/club/schema.ts'
import { AccessStore, credentialDigest, maskCredential, normalizeCredential } from '../src/club/access.ts'
import { accessNavigationRole, canManageAccessUi, canViewAccessUi } from '../src/access-ui.ts'

function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const migration of MIGRATIONS) {
    db.exec('BEGIN IMMEDIATE')
    try { for (const statement of migration.statements) db.exec(statement); db.exec('COMMIT') }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  const sql = { exec(query, ...params) {
    const statement = db.prepare(query)
    const rows = statement.columns().length ? statement.all(...params) : (statement.run(...params), [])
    return { toArray:()=>rows, one:()=>{if(!rows[0])throw new Error('no row');return rows[0]}, raw:()=>rows.map(Object.values) }
  }}
  const storage = { transactionSync(callback) { db.exec('BEGIN IMMEDIATE'); try { const result=callback();db.exec('COMMIT');return result } catch(error){db.exec('ROLLBACK');throw error} } }
  return { db, store:new AccessStore(sql,storage) }
}

function fixture() {
  const value=database(); const {db}=value
  const branch=crypto.randomUUID(), discipline=crypto.randomUUID(), member=crypto.randomUUID()
  db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branch,'Centre')
  db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(discipline,'Fitness')
  db.prepare("INSERT INTO members(id,name,phone,branch_id,discipline_id,status) VALUES(?,?,?,?,?,'active')").run(member,'Sara Test','0600000000',branch,discipline)
  return {...value,branch,discipline,member,actor:{id:crypto.randomUUID(),name:'Admin Test'},scope:{branchId:branch,disciplineId:null}}
}

async function topology(f) {
  const gateway=f.store.createGateway({branchId:f.branch,name:'Gateway',status:'online',scope:f.scope},f.actor).id
  const device=f.store.createDevice({gatewayId:gateway,name:'Tourniquet',adapterType:'generic',deviceType:'turnstile',status:'online',metadata:{},scope:f.scope},f.actor).id
  const point=f.store.createPoint({deviceId:device,name:'Entrée',direction:'entry',status:'active',scope:f.scope},f.actor).id
  const raw='A3:F8:82:91'; const digest=await credentialDigest('rfid',null,raw)
  const credential=f.store.createCredential({memberId:f.member,type:'rfid',lookupHash:digest,identifierMask:maskCredential(normalizeCredential('rfid',raw)),scope:f.scope},f.actor).id
  f.store.createRule({branchId:f.branch,name:'Membres actifs',effect:'allow',priority:10,daysMask:127,status:'active',scope:f.scope},f.actor)
  return {gateway,device,point,credential,digest}
}

test('Access migrations install every table, critical index, and immutability trigger',()=>{
  const {db}=database(); assert.equal(LATEST_VERSION,17)
  const names=db.prepare("SELECT name,type FROM sqlite_master WHERE name LIKE '%access%'").all()
  for(const expected of ['access_gateways','access_devices','access_points','access_credentials','access_rules','access_events','access_rate_limits','access_policy_state','idx_access_credentials_lookup','idx_access_events_time','idx_access_events_branch_time','access_events_no_update','access_events_no_delete']) assert.ok(names.some(row=>row.name===expected),expected)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('real Access migrations upgrade from every prior schema version',()=>{
  for(let start=0;start<LATEST_VERSION;start++){
    const db=new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _schema_version(version INTEGER PRIMARY KEY)')
    for(const migration of MIGRATIONS.filter(item=>item.version<=start)){
      db.exec('BEGIN IMMEDIATE');try{for(const statement of migration.statements)db.exec(statement);db.prepare('INSERT INTO _schema_version VALUES(?)').run(migration.version);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
    }
    for(const migration of MIGRATIONS.filter(item=>item.version>start)){
      if(migration.foreignKeysOff)db.exec('PRAGMA foreign_keys=OFF')
      db.exec('BEGIN IMMEDIATE');try{for(const statement of migration.statements)db.exec(statement);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.prepare('INSERT INTO _schema_version VALUES(?)').run(migration.version);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}finally{if(migration.foreignKeysOff)db.exec('PRAGMA foreign_keys=ON')}
    }
    assert.equal(db.prepare('SELECT MAX(version) v FROM _schema_version').get().v,LATEST_VERSION,`v${start}`)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='access_events'").get().n,1,`v${start}`)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],`v${start}`)
    db.close()
  }
})

test('v15 table rebuild preserves an existing gateway topology',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _schema_version(version INTEGER PRIMARY KEY)')
  for(const migration of MIGRATIONS.filter(item=>item.version<=14)){db.exec('BEGIN');for(const statement of migration.statements)db.exec(statement);db.prepare('INSERT INTO _schema_version VALUES(?)').run(migration.version);db.exec('COMMIT')}
  const branch=crypto.randomUUID(),gateway=crypto.randomUUID(),device=crypto.randomUUID()
  db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branch,'Existante')
  db.prepare("INSERT INTO access_gateways(id,branch_id,name,status) VALUES(?,?,?,'pending')").run(gateway,branch,'Gateway existant')
  db.prepare("INSERT INTO access_devices(id,gateway_id,branch_id,name,adapter_type,device_type,status) VALUES(?,?,?,?,?,?,'pending')").run(device,gateway,branch,'Controleur','generic','door')
  const migration=MIGRATIONS.find(item=>item.version===15);assert.equal(migration.foreignKeysOff,true)
  db.exec('PRAGMA foreign_keys=OFF; BEGIN');for(const statement of migration.statements)db.exec(statement);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.exec('COMMIT; PRAGMA foreign_keys=ON')
  assert.equal(db.prepare('SELECT id FROM access_gateways').get().id,gateway);assert.equal(db.prepare('SELECT gateway_id FROM access_devices').get().gateway_id,gateway)
})

test('gateway nonce registration accepts first use and rejects replay per gateway',()=>{
  const f=fixture(),nonce='fresh-client-generated-nonce',expiresAt=new Date(Date.now()+90_000).toISOString().replace('.000Z','Z')
  const first=f.store.registerGatewayNonce({gatewayId:crypto.randomUUID(),nonce,expiresAt});assert.equal(first.consumed,true)
  const gateway=crypto.randomUUID();assert.equal(f.store.registerGatewayNonce({gatewayId:gateway,nonce,expiresAt}).consumed,true)
  assert.equal(f.store.registerGatewayNonce({gatewayId:gateway,nonce,expiresAt}).consumed,false)
})

test('actual v13 migration fault rolls back its schema and version atomically',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _schema_version(version INTEGER PRIMARY KEY)')
  for(const migration of MIGRATIONS.filter(item=>item.version<=12)){db.exec('BEGIN IMMEDIATE');for(const statement of migration.statements)db.exec(statement);db.prepare('INSERT INTO _schema_version VALUES(?)').run(migration.version);db.exec('COMMIT')}
  const migration=MIGRATIONS.find(item=>item.version===13)
  db.exec('BEGIN IMMEDIATE')
  assert.throws(()=>{for(const statement of migration.statements)db.exec(statement);db.exec('INVALID SQL');db.prepare('INSERT INTO _schema_version VALUES(13)').run()})
  db.exec('ROLLBACK')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='access_events'").get().n,0)
  assert.equal(db.prepare('SELECT MAX(version) v FROM _schema_version').get().v,12)
})

test('credential canonicalization is stable and storage-safe',async()=>{
  assert.equal(normalizeCredential('rfid','a3:f8-82 91'),'A3F88291')
  assert.equal(await credentialDigest('rfid',null,'a3:f8-82 91'),await credentialDigest('rfid',null,'A3F88291'))
  assert.match(await credentialDigest('qr',null,'CaseSensitive42'),/^[0-9a-f]{64}$/)
  assert.equal(maskCredential('A3F88291'),'••••8291')
})

test('CRUD derives topology branch, writes safe audit, and rejects cross-branch parents',async()=>{
  const f=fixture();const t=await topology(f)
  assert.equal(f.db.prepare('SELECT branch_id FROM access_devices WHERE id=?').get(t.device).branch_id,f.branch)
  assert.ok(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'access.%'").get().n>=5)
  assert.ok(!JSON.stringify(f.db.prepare("SELECT * FROM audit_logs WHERE action LIKE 'access.%'").all()).includes('A3F88291'))
  const other=crypto.randomUUID();f.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(other,'Autre')
  assert.throws(()=>f.store.createDevice({gatewayId:t.gateway,name:'Vol',adapterType:'generic',deviceType:'door',status:'online',metadata:{},scope:{branchId:other}},f.actor),/NOT_FOUND/)
})

test('domain boundary normalizes every optional Access string before SQLite',async()=>{
  const f=fixture()
  const gateway=f.store.createGateway({branchId:f.branch,name:'Gateway',status:'online',version:'   ',scope:f.scope},f.actor).id
  const device=f.store.createDevice({gatewayId:gateway,name:'Porte',adapterType:'generic',deviceType:'door',status:'online',externalDeviceId:' \t ',metadata:{},scope:f.scope},f.actor).id
  const point=f.store.createPoint({deviceId:device,name:'Entrée',direction:'entry',status:'active',scope:f.scope},f.actor).id
  const digest=await credentialDigest('rfid',null,'A3F88291')
  f.store.createCredential({memberId:f.member,type:'rfid',lookupHash:digest,identifierMask:'••••8291',provider:'   ',scope:f.scope},f.actor)
  const rule=f.store.createRule({branchId:f.branch,name:'Sans fenêtre',effect:'allow',priority:0,daysMask:127,startTime:' ',endTime:'\t',validFrom:' ',validUntil:' ',status:'active',scope:f.scope},f.actor).id
  const event=f.store.evaluate({lookupHash:digest,accessPointId:point,externalEventId:'   ',requestHash:'  ',scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5})
  assert.equal(f.db.prepare('SELECT version FROM access_gateways WHERE id=?').get(gateway).version,null)
  assert.equal(f.db.prepare('SELECT external_device_id FROM access_devices WHERE id=?').get(device).external_device_id,null)
  assert.equal(f.db.prepare('SELECT provider FROM access_credentials WHERE lookup_hash=?').get(digest).provider,null)
  const storedRule=f.db.prepare('SELECT start_time,end_time,valid_from,valid_until FROM access_rules WHERE id=?').get(rule)
  assert.equal(storedRule.start_time,null);assert.equal(storedRule.end_time,null);assert.equal(storedRule.valid_from,null);assert.equal(storedRule.valid_until,null)
  assert.equal(f.db.prepare('SELECT external_event_id FROM access_events WHERE id=?').get(event.eventId).external_event_id,null)
  f.store.patch('gateways',gateway,{version:'  '},f.scope,f.actor)
  f.store.patch('devices',device,{externalDeviceId:'  '},f.scope,f.actor)
  f.store.patch('rules',rule,{startTime:' ',endTime:' ',validFrom:' ',validUntil:' '},f.scope,f.actor)
  assert.throws(()=>f.store.createRule({branchId:f.branch,name:'Demi-fenêtre',effect:'allow',priority:0,daysMask:127,startTime:' ',endTime:'10:00',status:'active',scope:f.scope},f.actor),/INVALID_RULE/)
  assert.throws(()=>f.store.createCredential({memberId:f.member,type:'external',lookupHash:'b'.repeat(64),identifierMask:'••••REF1',provider:' ',scope:f.scope},f.actor),/INVALID_CREDENTIAL/)
})

test('authoritative engine allows only a matching rule and appends an immutable event',async()=>{
  const f=fixture(),t=await topology(f)
  const result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5})
  assert.equal(result.decision,'allow');assert.equal(result.reason,'ACCESS_GRANTED');assert.equal(result.memberId,f.member)
  assert.throws(()=>f.db.prepare("UPDATE access_events SET decision='deny'").run(),/ACCESS_EVENT_IMMUTABLE/)
})

test('engine denies unknown credential without leaking or persisting it',async()=>{
  const f=fixture(),t=await topology(f);const secret='RAW-SECRET-NEVER-STORED'
  const result=f.store.evaluate({lookupHash:await credentialDigest('qr',null,secret),accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5})
  assert.equal(result.decision,'deny');assert.equal(result.reason,'CREDENTIAL_UNKNOWN');assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM access_events').all()).includes(secret))
})

test('raw credentials are absent from list, event, result, and audit projections',async()=>{
  const f=fixture(),raw='A3:F8:82:91',t=await topology(f)
  const result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5})
  const projections={result,credentials:f.store.list('credentials',{limit:10,scope:f.scope}).items,events:f.store.list('events',{limit:10,scope:f.scope}).items,audits:f.db.prepare("SELECT action,entity,entity_id,entity_name,detail,actor_id,actor_name FROM audit_logs WHERE action LIKE 'access.%'").all()}
  assert.ok(!JSON.stringify(projections).includes(raw));assert.ok(!JSON.stringify(projections).includes(normalizeCredential('rfid',raw)))
  assert.equal('lookup_hash' in projections.credentials[0],false);assert.equal('request_hash' in projections.events[0],false)
})

test('revoked credential and disabled parent states fail closed',async()=>{
  const f=fixture(),t=await topology(f);f.store.disable('credentials',t.credential,f.scope,f.actor)
  let result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5});assert.equal(result.reason,'CREDENTIAL_REVOKED')
  f.db.prepare("UPDATE access_gateways SET status='disabled' WHERE id=?").run(t.gateway)
  result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:01:00Z',localDate:'2026-08-29',localTime:'12:01',localWeekday:5});assert.equal(result.reason,'GATEWAY_DISABLED')
})

test('lost and disabled credentials map to stable deny reasons',async()=>{
  for (const [status,reason] of [['lost','CREDENTIAL_LOST'],['disabled','CREDENTIAL_DISABLED']]) {
    const f=fixture(),t=await topology(f);f.store.patch('credentials',t.credential,{status},f.scope,f.actor)
    const result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5})
    assert.equal(result.decision,'deny');assert.equal(result.reason,reason)
  }
})

test('inactive and expired members fail closed while null expiry follows current membership semantics',async()=>{
  let f=fixture(),t=await topology(f)
  f.db.prepare("UPDATE members SET status='inactive' WHERE id=?").run(f.member)
  let result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5});assert.equal(result.reason,'MEMBER_INACTIVE')
  f=fixture();t=await topology(f);f.db.prepare("UPDATE members SET sub_expiry='2026-08-28' WHERE id=?").run(f.member)
  result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5});assert.equal(result.reason,'SUBSCRIPTION_EXPIRED')
})

test('rule windows deny outside hours and explicit deny overrides allow',async()=>{
  const f=fixture(),t=await topology(f)
  f.db.prepare("UPDATE access_rules SET start_time='08:00',end_time='10:00'").run()
  let result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5});assert.equal(result.reason,'OUTSIDE_ALLOWED_HOURS')
  f.db.prepare('UPDATE access_rules SET start_time=NULL,end_time=NULL').run()
  f.store.createRule({branchId:f.branch,name:'Blocage',effect:'deny',priority:100,daysMask:127,status:'active',scope:f.scope},f.actor)
  result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:01:00Z',localDate:'2026-08-29',localTime:'12:01',localWeekday:5});assert.equal(result.reason,'ACCESS_RULE_DENIED')
})

test('branch and discipline scope cannot be bypassed with valid tenant IDs',async()=>{
  const f=fixture(),t=await topology(f)
  let result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:{branchId:crypto.randomUUID()},occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5});assert.equal(result.reason,'WRONG_BRANCH')
  result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:{branchId:f.branch,disciplineId:crypto.randomUUID()},occurredAt:'2026-08-29T12:01:00Z',localDate:'2026-08-29',localTime:'12:01',localWeekday:5});assert.equal(result.reason,'WRONG_DISCIPLINE')
})

test('credential lists use member branch and discipline scope columns',async()=>{
  const f=fixture();await topology(f)
  const visible=f.store.list('credentials',{limit:20,scope:{branchId:f.branch,disciplineId:f.discipline}})
  assert.equal(visible.items.length,1)
  assert.equal(f.store.list('credentials',{limit:20,scope:{branchId:f.branch,disciplineId:crypto.randomUUID()}}).items.length,0)
})

test('inactive branches and disciplines fail closed and advance policy revision',async()=>{
  let f=fixture(),t=await topology(f),before=f.db.prepare('SELECT revision FROM access_policy_state WHERE id=1').get().revision
  f.db.prepare('UPDATE branches SET is_active=0 WHERE id=?').run(f.branch)
  assert.equal(f.db.prepare('SELECT revision FROM access_policy_state WHERE id=1').get().revision,before+1)
  let result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5})
  assert.equal(result.decision,'deny');assert.equal(result.reason,'WRONG_BRANCH')
  f=fixture();t=await topology(f);before=f.db.prepare('SELECT revision FROM access_policy_state WHERE id=1').get().revision
  f.db.prepare('UPDATE disciplines SET is_active=0 WHERE id=?').run(f.discipline)
  assert.equal(f.db.prepare('SELECT revision FROM access_policy_state WHERE id=1').get().revision,before+1)
  result=f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5})
  assert.equal(result.decision,'deny');assert.equal(result.reason,'WRONG_DISCIPLINE')
})

test('duplicate credential enrollment is database-enforced under serialized writes',async()=>{
  const f=fixture(),t=await topology(f)
  assert.throws(()=>f.store.createCredential({memberId:f.member,type:'rfid',lookupHash:t.digest,identifierMask:'••••8291',scope:f.scope},f.actor),/UNIQUE constraint failed/)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM access_credentials').get().n,1)
})

test('external event retry replays once and payload mismatch conflicts',async()=>{
  const f=fixture(),t=await topology(f);const input={lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5,externalEventId:'event-1001',requestHash:'a'.repeat(64)}
  const first=f.store.evaluate(input), replay=f.store.evaluate({...input,occurredAt:'2026-08-29T12:01:00Z'})
  assert.equal(replay.replayed,true);assert.equal(replay.eventId,first.eventId);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM access_events').get().n,1)
  assert.throws(()=>f.store.evaluate({...input,requestHash:'b'.repeat(64)}),/IDEMPOTENCY_CONFLICT/)
})

test('idempotent replay authorizes branch and discipline before returning or conflicting',async()=>{
  const f=fixture(),t=await topology(f)
  const input={lookupHash:t.digest,accessPointId:t.point,scope:{branchId:f.branch,disciplineId:f.discipline},occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5,externalEventId:'scoped-event',requestHash:'a'.repeat(64)}
  const first=f.store.evaluate(input);assert.equal(first.decision,'allow')
  const otherBranch=f.store.evaluate({...input,scope:{branchId:crypto.randomUUID(),disciplineId:f.discipline},requestHash:'b'.repeat(64),occurredAt:'2026-08-29T12:01:00Z'})
  assert.equal(otherBranch.reason,'WRONG_BRANCH');assert.equal(otherBranch.replayed,false);assert.equal('memberId' in otherBranch,false)
  const otherDiscipline=f.store.evaluate({...input,scope:{branchId:f.branch,disciplineId:crypto.randomUUID()},requestHash:'c'.repeat(64),occurredAt:'2026-08-29T12:02:00Z'})
  assert.equal(otherDiscipline.reason,'WRONG_DISCIPLINE');assert.equal(otherDiscipline.replayed,false);assert.equal('memberId' in otherDiscipline,false)
  const foreignBranch=crypto.randomUUID(),foreignMember=crypto.randomUUID(),foreignRaw='B4:E9:93:02',foreignDigest=await credentialDigest('rfid',null,foreignRaw)
  f.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(foreignBranch,'Étrangère')
  f.db.prepare("INSERT INTO members(id,name,phone,branch_id,discipline_id,status) VALUES(?,?,?,?,?,'active')").run(foreignMember,'Membre étranger','0600000012',foreignBranch,f.discipline)
  f.store.createCredential({memberId:foreignMember,type:'rfid',lookupHash:foreignDigest,identifierMask:maskCredential(normalizeCredential('rfid',foreignRaw)),scope:{branchId:foreignBranch}},f.actor)
  const foreignCredential=f.store.evaluate({...input,lookupHash:foreignDigest,requestHash:'d'.repeat(64),occurredAt:'2026-08-29T12:03:00Z'})
  assert.equal(foreignCredential.reason,'WRONG_BRANCH');assert.equal(foreignCredential.replayed,false);assert.equal('memberId' in foreignCredential,false)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM access_events WHERE external_event_id='scoped-event'").get().n,1)
})

test('rule relationships are fully validated inside branch and discipline scope',async()=>{
  const f=fixture(),t=await topology(f)
  const otherDiscipline=crypto.randomUUID(),otherMember=crypto.randomUUID(),otherBranch=crypto.randomUUID()
  f.db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(otherDiscipline,'Boxe')
  f.db.prepare("INSERT INTO members(id,name,phone,branch_id,discipline_id,status) VALUES(?,?,?,?,?,'active')").run(otherMember,'Hors discipline','0600000001',f.branch,otherDiscipline)
  f.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(otherBranch,'Annexe')
  assert.throws(()=>f.store.createRule({branchId:f.branch,memberId:otherMember,disciplineId:f.discipline,name:'Interdit',effect:'allow',priority:0,daysMask:127,status:'active',scope:{branchId:f.branch,disciplineId:f.discipline}},f.actor),/NOT_FOUND/)
  assert.throws(()=>f.store.createRule({branchId:otherBranch,accessPointId:t.point,name:'Mauvais point',effect:'allow',priority:0,daysMask:127,status:'active',scope:{}},f.actor),/NOT_FOUND/)
  assert.throws(()=>f.store.createRule({branchId:f.branch,accessPointId:crypto.randomUUID(),name:'Point absent',effect:'allow',priority:0,daysMask:127,status:'active',scope:f.scope},f.actor),/NOT_FOUND/)
})

test('device, point, no-rule, and day-mask states deny deterministically',async()=>{
  let f=fixture(),t=await topology(f)
  f.db.prepare("UPDATE access_devices SET status='disabled' WHERE id=?").run(t.device)
  assert.equal(f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5}).reason,'DEVICE_DISABLED')
  f=fixture();t=await topology(f);f.db.prepare("UPDATE access_points SET status='disabled' WHERE id=?").run(t.point)
  assert.equal(f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5}).reason,'ACCESS_POINT_DISABLED')
  f=fixture();t=await topology(f);f.db.prepare('DELETE FROM access_rules').run()
  assert.equal(f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5}).reason,'ACCESS_RULE_DENIED')
  f=fixture();t=await topology(f);f.db.prepare('UPDATE access_rules SET days_mask=1').run()
  assert.equal(f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5}).reason,'OUTSIDE_ALLOWED_HOURS')
})

test('all Access resources patch and soft-delete with safe parameterized payloads',async()=>{
  const f=fixture(),t=await topology(f),attack=`<img src=x onerror=alert(1)>' OR 1=1 --`
  f.store.patch('gateways',t.gateway,{name:attack},f.scope,f.actor)
  f.store.patch('devices',t.device,{name:attack,metadata:{locationNote:attack}},f.scope,f.actor)
  f.store.patch('points',t.point,{name:attack},f.scope,f.actor)
  f.store.patch('credentials',t.credential,{status:'lost'},f.scope,f.actor)
  const rule=f.db.prepare('SELECT id FROM access_rules LIMIT 1').get().id
  f.store.patch('rules',rule,{name:attack},f.scope,f.actor)
  assert.equal(f.db.prepare('SELECT name FROM access_gateways WHERE id=?').get(t.gateway).name,attack)
  assert.equal(JSON.parse(f.db.prepare('SELECT metadata_json FROM access_devices WHERE id=?').get(t.device).metadata_json).locationNote,attack)
  for(const [kind,id] of [['gateways',t.gateway],['devices',t.device],['points',t.point],['rules',rule]])f.store.disable(kind,id,f.scope,f.actor)
  f.store.disable('credentials',t.credential,f.scope,f.actor)
  assert.equal(f.db.prepare('SELECT status FROM access_gateways WHERE id=?').get(t.gateway).status,'disabled')
  assert.equal(f.db.prepare('SELECT status FROM access_devices WHERE id=?').get(t.device).status,'disabled')
  assert.equal(f.db.prepare('SELECT status FROM access_points WHERE id=?').get(t.point).status,'disabled')
  assert.equal(f.db.prepare('SELECT status FROM access_rules WHERE id=?').get(rule).status,'disabled')
  assert.equal(f.db.prepare('SELECT status FROM access_credentials WHERE id=?').get(t.credential).status,'revoked')
})

test('every scoped option kind supports bounded continuation without overlap',()=>{
  const f=fixture()
  const gateway=crypto.randomUUID(),device=crypto.randomUUID()
  f.db.prepare('INSERT INTO access_gateways(id,branch_id,name,status) VALUES(?,?,?,?)').run(gateway,f.branch,'Gateway root','online')
  f.db.prepare('INSERT INTO access_devices(id,gateway_id,branch_id,name,adapter_type,device_type,status) VALUES(?,?,?,?,?,?,?)').run(device,gateway,f.branch,'Device root','generic','door','online')
  for(let index=0;index<6;index++){
    const branch=crypto.randomUUID(),discipline=crypto.randomUUID(),member=crypto.randomUUID(),nextGateway=crypto.randomUUID(),nextDevice=crypto.randomUUID()
    f.db.prepare('INSERT INTO branches(id,name) VALUES(?,?)').run(branch,`Branch ${index}`)
    f.db.prepare('INSERT INTO disciplines(id,name) VALUES(?,?)').run(discipline,`Discipline ${index}`)
    f.db.prepare("INSERT INTO members(id,name,phone,branch_id,status) VALUES(?,?,?,?,'active')").run(member,`Member ${index}`,`06000000${index}`,f.branch)
    f.db.prepare('INSERT INTO access_gateways(id,branch_id,name,status) VALUES(?,?,?,?)').run(nextGateway,f.branch,`Gateway ${index}`,'online')
    f.db.prepare('INSERT INTO access_devices(id,gateway_id,branch_id,name,adapter_type,device_type,status) VALUES(?,?,?,?,?,?,?)').run(nextDevice,gateway,f.branch,`Device ${index}`,'generic','door','online')
    f.db.prepare('INSERT INTO access_points(id,device_id,branch_id,name,direction,status) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),device,f.branch,`Point ${index}`,'entry','active')
  }
  for(const [kind,scope,search] of [['branches',{},'Branch'],['disciplines',{},'Discipline'],['members',f.scope,'Member'],['gateways',f.scope,'Gateway'],['devices',f.scope,'Device'],['points',f.scope,'Point']]){
    const first=f.store.options(kind,{limit:2,scope,search}),second=f.store.options(kind,{limit:2,scope,search,cursor:first.nextCursor})
    assert.equal(first.items.length,2,kind);assert.ok(first.nextCursor,kind);assert.equal(second.items.length,2,kind)
    assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,4,kind)
  }
  assert.equal(f.store.options('members',{limit:10,scope:{branchId:f.branch,disciplineId:crypto.randomUUID()},search:'Sara'}).items.length,0)
})

test('every administrative Access collection continues by keyset without overlap',async()=>{
  const f=fixture(),t=await topology(f)
  for(let index=0;index<5;index++){
    f.db.prepare('INSERT INTO access_gateways(id,branch_id,name,status) VALUES(?,?,?,?)').run(crypto.randomUUID(),f.branch,`More gateway ${index}`,'online')
    f.db.prepare('INSERT INTO access_devices(id,gateway_id,branch_id,name,adapter_type,device_type,status) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),t.gateway,f.branch,`More device ${index}`,'generic','door','online')
    f.db.prepare('INSERT INTO access_points(id,device_id,branch_id,name,direction,status) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),t.device,f.branch,`More point ${index}`,'entry','active')
    f.db.prepare('INSERT INTO access_credentials(id,member_id,type,lookup_hash,identifier_mask,status) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),f.member,'external',index.toString(16).padStart(64,'0'),`••••REF${index}`,'active')
    f.db.prepare('INSERT INTO access_rules(id,branch_id,name,effect,priority,days_mask,status) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),f.branch,`More rule ${index}`,'allow',index,127,'active')
  }
  for(const kind of ['gateways','devices','points','credentials','rules']){
    const first=f.store.list(kind,{limit:2,scope:f.scope}),second=f.store.list(kind,{limit:2,scope:f.scope,cursor:first.nextCursor})
    assert.equal(first.items.length,2,kind);assert.ok(first.nextCursor,kind);assert.equal(second.items.length,2,kind)
    assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,4,kind)
  }
})

test('500-rule branch cap includes disabled rules and rejects the next mutation',()=>{
  const f=fixture(),insert=f.db.prepare('INSERT INTO access_rules(id,branch_id,name,effect,priority,days_mask,status) VALUES(?,?,?,?,?,?,?)')
  for(let index=0;index<500;index++)insert.run(crypto.randomUUID(),f.branch,`Rule ${index}`,'allow',index%1001,127,index%2?'active':'disabled')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM access_rules WHERE branch_id=?').get(f.branch).n,500)
  assert.throws(()=>f.store.createRule({branchId:f.branch,name:'Overflow',effect:'allow',priority:0,daysMask:127,status:'active',scope:f.scope},f.actor),/RULE_LIMIT/)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM access_rules WHERE branch_id=?').get(f.branch).n,500)
})

test('serialized idempotency and status races preserve one event and fail closed',async()=>{
  const f=fixture(),t=await topology(f),input={lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt:'2026-08-29T12:00:00Z',localDate:'2026-08-29',localTime:'12:00',localWeekday:5,externalEventId:'race-event',requestHash:'d'.repeat(64)}
  const results=await Promise.all(Array.from({length:8},()=>Promise.resolve().then(()=>f.store.evaluate(input))))
  assert.equal(results.filter(result=>result.replayed===false).length,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM access_events WHERE external_event_id='race-event'").get().n,1)
  f.store.disable('credentials',t.credential,f.scope,f.actor)
  const denied=f.store.evaluate({...input,externalEventId:'after-revoke',requestHash:'e'.repeat(64),occurredAt:'2026-08-29T12:01:00Z'})
  assert.equal(denied.reason,'CREDENTIAL_REVOKED')
  const second=fixture(),topology2=await topology(second)
  second.store.disable('devices',topology2.device,second.scope,second.actor)
  const deviceResults=await Promise.all(Array.from({length:4},(_,index)=>Promise.resolve().then(()=>second.store.evaluate({lookupHash:topology2.digest,accessPointId:topology2.point,scope:second.scope,occurredAt:`2026-08-29T12:1${index}:00Z`,localDate:'2026-08-29',localTime:`12:1${index}`,localWeekday:5}))))
  assert.ok(deviceResults.every(result=>result.reason==='DEVICE_DISABLED'))
})

test('large event history enforces practical max pages with keyset continuation',async()=>{
  const f=fixture(),t=await topology(f)
  for(let i=0;i<240;i++){
    const occurredAt=new Date(Date.UTC(2026,7,29,0,0,i)).toISOString().replace('.000Z','Z')
    f.store.evaluate({lookupHash:t.digest,accessPointId:t.point,scope:f.scope,occurredAt,localDate:'2026-08-29',localTime:'12:00',localWeekday:5})
  }
  const first=f.store.list('events',{limit:100,scope:f.scope});assert.equal(first.items.length,100);assert.ok(first.nextCursor)
  const second=f.store.list('events',{limit:100,scope:f.scope,cursor:first.nextCursor});assert.equal(second.items.length,100);assert.ok(second.nextCursor)
  const third=f.store.list('events',{limit:100,scope:f.scope,cursor:second.nextCursor});assert.equal(third.items.length,40);assert.equal(third.nextCursor,null)
  assert.equal(new Set([...first.items,...second.items,...third.items].map(row=>row.id)).size,240)
})

test('DO-backed rate limit is bounded and separates trusted actors',()=>{
  const f=fixture();assert.equal(f.store.rateLimit('actor-a','access-read',2).allowed,true);assert.equal(f.store.rateLimit('actor-a','access-read',2).allowed,true);assert.equal(f.store.rateLimit('actor-a','access-read',2).allowed,false);assert.equal(f.store.rateLimit('actor-b','access-read',2).allowed,true);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM access_rate_limits').get().n,2)
})

test('critical query plans use credential and every event-filter keyset index',async()=>{
  const f=fixture(),t=await topology(f)
  const credential=f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM access_credentials WHERE lookup_hash=?').all('a'.repeat(64)).map(row=>row.detail).join(' ')
  const events=f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM access_events WHERE (occurred_at < ? OR (occurred_at=? AND id<?)) ORDER BY occurred_at DESC,id DESC LIMIT 50').all('z','z','z').map(row=>row.detail).join(' ')
  const branchEvents=f.db.prepare(`EXPLAIN QUERY PLAN
    SELECT e.id,e.occurred_at,e.member_id,e.credential_id,e.gateway_id,e.device_id,
           e.access_point_id,e.branch_id,e.discipline_id,e.direction,e.decision,
           e.reason_code,e.source,e.created_at,m.name AS member_name,
           c.type AS credential_type,c.identifier_mask
      FROM access_events e
      LEFT JOIN members m ON m.id=e.member_id
      LEFT JOIN access_credentials c ON c.id=e.credential_id
     WHERE e.branch_id=?
       AND (e.occurred_at < ? OR (e.occurred_at=? AND e.id<?))
     ORDER BY e.occurred_at DESC,e.id DESC LIMIT 50`).all(f.branch,'z','z','z').map(row=>row.detail).join(' ')
  const memberEvents=f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM access_events WHERE member_id=? AND (occurred_at<? OR (occurred_at=? AND id<?)) ORDER BY occurred_at DESC,id DESC LIMIT 50').all(f.member,'z','z','z').map(row=>row.detail).join(' ')
  const pointEvents=f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM access_events WHERE access_point_id=? AND (occurred_at<? OR (occurred_at=? AND id<?)) ORDER BY occurred_at DESC,id DESC LIMIT 50').all(t.point,'z','z','z').map(row=>row.detail).join(' ')
  assert.match(credential,/idx_access_credentials_lookup/);assert.match(events,/idx_access_events_time/);assert.match(branchEvents,/idx_access_events_branch_time/);assert.doesNotMatch(branchEvents,/TEMP B-TREE/)
  assert.match(memberEvents,/idx_access_events_member_time/);assert.doesNotMatch(memberEvents,/TEMP B-TREE/)
  assert.match(pointEvents,/idx_access_events_point_time/);assert.doesNotMatch(pointEvents,/TEMP B-TREE/)
})

test('AccessStore SQL contains no OFFSET pagination',async()=>{
  const source=await readFile(new URL('../src/club/access.ts',import.meta.url),'utf8')
  assert.doesNotMatch(source,/\bOFFSET\b/i)
})

test('Access UI policy gates roles, support writes, navigation, and member panels',()=>{
  for(const role of ['owner','admin'])assert.equal(canManageAccessUi({mode:'club'},role),true,role)
  for(const role of ['staff','viewer',null])assert.equal(canManageAccessUi({mode:'club'},role),false,String(role))
  for(const role of ['owner','admin','staff'])assert.equal(canViewAccessUi({mode:'club'},role),true,role)
  assert.equal(canViewAccessUi({mode:'club'},'viewer'),false)
  assert.equal(canViewAccessUi({mode:'support',canWrite:false},null),true)
  assert.equal(canManageAccessUi({mode:'support',canWrite:false},null),false)
  assert.equal(canManageAccessUi({mode:'support',canWrite:true},null),true)
  assert.equal(accessNavigationRole({mode:'support'},null),'admin')
})

test('Access UI uses scoped relationship options, member panel, and continuation actions',async()=>{
  const [apiSource,pageSource,shellSource,membersSource,detailSource,panelSource]=await Promise.all([readFile(new URL('../src/api.ts',import.meta.url),'utf8'),readFile(new URL('../app/access/page.tsx',import.meta.url),'utf8'),readFile(new URL('../components/Shell.tsx',import.meta.url),'utf8'),readFile(new URL('../app/members/page.tsx',import.meta.url),'utf8'),readFile(new URL('../components/MemberDetail.tsx',import.meta.url),'utf8'),readFile(new URL('../components/MemberAccessPanel.tsx',import.meta.url),'utf8')])
  for(const invariant of ['accessOrigin(request)','assertEntitledWrite','accessRateLimit','readAccessJson','credentialDigest','atLeast(principal','accessCredentialReference','accessUtcInstant']) assert.ok(apiSource.includes(invariant),invariant)
  for(const invariant of ['/api/access/options?','kind="devices"','api.patch','<SelectField','Plus de choix','Charger la suite','Charger les équipements suivants','role="alert"']) assert.ok(pageSource.includes(invariant),invariant)
  assert.ok(shellSource.includes('accessNavigationRole'));assert.ok(membersSource.includes('canViewAccessUi'))
  assert.ok(detailSource.includes('showAccess && <MemberAccessPanel'));assert.ok(panelSource.includes('/api/access/credentials?memberId='));assert.ok(panelSource.includes('/api/access/events?memberId='))
  assert.ok(!pageSource.includes('dangerouslySetInnerHTML'));assert.ok(!apiSource.includes('fetch(body.'))
})

test('UI1-MED-001: memberSummary server-side 30-day visit aggregation correctly handles counts and directions', async () => {
  const f = fixture(), t = await topology(f)
  const nowIso = '2026-09-02T12:00:00.000Z'

  // 0 entries
  let res = f.store.memberSummary(f.member, f.scope, nowIso)
  assert.equal(res.visitsLast30Days, 0)
  assert.equal(res.averageVisitsPerWeek, 0)

  // Insert helper
  const insertEvent = (decision, direction, occurredAt, memberId = f.member) => {
    f.db.prepare(`INSERT INTO access_events(
      id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), f.branch, memberId, t.credential, t.point, t.point, decision, direction,
      decision === 'allow' ? 'ACCESS_GRANTED' : 'MEMBER_INACTIVE', 'cloud', occurredAt
    )
  }

  // 1 entry
  insertEvent('allow', 'entry', '2026-09-01T10:00:00.000Z')
  res = f.store.memberSummary(f.member, f.scope, nowIso)
  assert.equal(res.visitsLast30Days, 1)
  assert.equal(res.averageVisitsPerWeek, 0.2)

  // Insert 9 more -> 10 entries total (within 30 days)
  for (let i = 1; i <= 9; i++) {
    insertEvent('allow', 'entry', `2026-08-${10 + i}T09:00:00.000Z`)
  }
  res = f.store.memberSummary(f.member, f.scope, nowIso)
  assert.equal(res.visitsLast30Days, 10)

  // Insert 1 more -> 11 entries total (exceeds previous limit=10)
  insertEvent('allow', 'entry', '2026-08-20T14:00:00.000Z')
  res = f.store.memberSummary(f.member, f.scope, nowIso)
  assert.equal(res.visitsLast30Days, 11)

  // Insert 19 more -> 30 entries total
  for (let i = 1; i <= 19; i++) {
    const day = 21 + Math.floor(i / 2)
    const hour = i % 2 === 0 ? '11' : '16'
    insertEvent('allow', 'entry', `2026-08-${day}T${hour}:00:00.000Z`)
  }
  res = f.store.memberSummary(f.member, f.scope, nowIso)
  assert.equal(res.visitsLast30Days, 30)
  assert.equal(res.averageVisitsPerWeek, 7)

  // Non-visit events:
  // 30 EXIT ALLOW events -> must NOT increment visit count (total remains 30, not 60)
  for (let i = 1; i <= 30; i++) {
    insertEvent('allow', 'exit', `2026-08-${11 + (i % 18)}T18:00:00.000Z`)
  }
  // 30 DENY ENTRY events -> must NOT increment visit count
  for (let i = 1; i <= 30; i++) {
    insertEvent('deny', 'entry', `2026-08-${11 + (i % 18)}T08:00:00.000Z`)
  }
  // 10 ALLOW ENTRY events from 35 days ago (outside 30-day window) -> must NOT increment visit count
  for (let i = 0; i < 10; i++) {
    insertEvent('allow', 'entry', '2026-07-25T10:00:00.000Z')
  }
  // Future event -> must NOT increment visit count
  insertEvent('allow', 'entry', '2026-09-05T10:00:00.000Z')

  // Other member event -> must NOT affect this member
  const otherMemberId = crypto.randomUUID()
  f.db.prepare('INSERT INTO members(id,branch_id,name,phone,status) VALUES(?,?,?,?,?)').run(otherMemberId, f.branch, 'Other Member', '0600000001', 'active')
  insertEvent('allow', 'entry', '2026-08-25T10:00:00.000Z', otherMemberId)

  // Count remains strictly 30!
  res = f.store.memberSummary(f.member, f.scope, nowIso)
  assert.equal(res.visitsLast30Days, 30)
  assert.equal(res.averageVisitsPerWeek, 7)

  // Scope & Isolation: query from different branch fails closed
  assert.throws(() => {
    f.store.memberSummary(f.member, { branchId: crypto.randomUUID() }, nowIso)
  }, /NOT_FOUND/)
})

test('UI1-MED-002: timezone-aware summary around day boundaries and hourly local buckets', async () => {
  const f = fixture(), t = await topology(f)

  // Event at Casablanca local 00:30 on 2026-09-02 (UTC+1)
  // In UTC, this is 2026-09-01T23:30:00.000Z
  f.db.prepare(`INSERT INTO access_events(
    id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', '2026-09-01T23:30:00.000Z'
  )

  // Querying Casablanca for 2026-09-02:
  const casaSummary = f.store.summary(f.scope, '2026-09-02', 'Africa/Casablanca')
  assert.equal(casaSummary.today.totalAttempts, 1)
  assert.equal(casaSummary.today.allowedCount, 1)
  assert.equal(casaSummary.today.uniqueMembers, 1)
  // Local hour 00 bucket has 1
  const casaHour00 = casaSummary.hourly.find(h => h.hour === '00')
  assert.ok(casaHour00)
  assert.equal(casaHour00.count, 1)

  // Querying UTC for 2026-09-02:
  const utcSummary = f.store.summary(f.scope, '2026-09-02', 'UTC')
  // In UTC, 2026-09-01T23:30 is yesterday, not today
  assert.equal(utcSummary.today.totalAttempts, 0)
  assert.equal(utcSummary.today.allowedCount, 0)

  // Querying UTC for 2026-09-01:
  const utcYesterday = f.store.summary(f.scope, '2026-09-01', 'UTC')
  assert.equal(utcYesterday.today.totalAttempts, 1)
  const utcHour23 = utcYesterday.hourly.find(h => h.hour === '23')
  assert.ok(utcHour23)
  assert.equal(utcHour23.count, 1)
})

test('UI1-MED-002: Europe/Paris DST spring-forward (23h) and fall-back (25h) handling', async () => {
  const f = fixture(), t = await topology(f)

  // Spring forward: 2026-03-29 (23 hours: 02:00 -> 03:00)
  // Event at 01:30 local (00:30 UTC)
  f.db.prepare(`INSERT INTO access_events(
    id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', '2026-03-29T00:30:00.000Z'
  )
  // Event at 03:30 local (01:30 UTC)
  f.db.prepare(`INSERT INTO access_events(
    id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', '2026-03-29T01:30:00.000Z'
  )

  const springSummary = f.store.summary(f.scope, '2026-03-29', 'Europe/Paris')
  assert.equal(springSummary.today.totalAttempts, 2)
  assert.equal(springSummary.hourly.find(h => h.hour === '01')?.count, 1)
  assert.equal(springSummary.hourly.find(h => h.hour === '03')?.count, 1)

  // Fall back: 2026-10-25 (25 hours: 03:00 -> 02:00 repeated)
  // Event 1 at 02:15 first pass (00:15 UTC)
  f.db.prepare(`INSERT INTO access_events(
    id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', '2026-10-25T00:15:00.000Z'
  )
  // Event 2 at 02:45 second pass (01:45 UTC)
  f.db.prepare(`INSERT INTO access_events(
    id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', '2026-10-25T01:45:00.000Z'
  )

  const fallSummary = f.store.summary(f.scope, '2026-10-25', 'Europe/Paris')
  assert.equal(fallSummary.today.totalAttempts, 2)
  // Repeated local hour 02 aggregates both occurrences cleanly into the single local bucket
  assert.equal(fallSummary.hourly.find(h => h.hour === '02')?.count, 2)
})

test('UI1-MED-002: America/New_York DST fall-back handling', async () => {
  const f = fixture(), t = await topology(f)

  // New York Fall-back: 2026-11-01 (02:00 repeated)
  // Event at 01:30 local (05:30 UTC)
  f.db.prepare(`INSERT INTO access_events(
    id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', '2026-11-01T05:30:00.000Z'
  )

  const nySummary = f.store.summary(f.scope, '2026-11-01', 'America/New_York')
  assert.equal(nySummary.today.totalAttempts, 1)
  assert.equal(nySummary.hourly.find(h => h.hour === '01')?.count, 1)
})

test('UI1-MED-002: Africa/Casablanca Ramadan timezone transition handling', async () => {
  const f = fixture(), t = await topology(f)

  // In 2026, Morocco transitions around Feb/March. Test 2026-03-01 where Morocco is GMT (UTC+0)
  // Local 00:30 is 2026-03-01T00:30:00.000Z
  f.db.prepare(`INSERT INTO access_events(
    id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', '2026-03-01T00:30:00.000Z'
  )

  const casaMarch = f.store.summary(f.scope, '2026-03-01', 'Africa/Casablanca')
  assert.equal(casaMarch.today.totalAttempts, 1)
  assert.equal(casaMarch.hourly.find(h => h.hour === '00')?.count, 1)
})

test('UI1-MED-002: yesterday deltas calculated against local previous calendar day', async () => {
  const f = fixture(), t = await topology(f)

  // Insert 2 events yesterday local (2026-09-01 local in Casablanca)
  for (let i = 0; i < 2; i++) {
    f.db.prepare(`INSERT INTO access_events(
      id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', `2026-09-01T1${i}:00:00.000Z`
    )
  }

  // Insert 4 events today local (2026-09-02 local in Casablanca)
  for (let i = 0; i < 4; i++) {
    f.db.prepare(`INSERT INTO access_events(
      id, branch_id, member_id, credential_id, access_point_id, requested_access_point_id, decision, direction, reason_code, source, occurred_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), f.branch, f.member, t.credential, t.point, t.point, 'allow', 'entry', 'ACCESS_GRANTED', 'cloud', `2026-09-02T1${i}:00:00.000Z`
    )
  }

  const res = f.store.summary(f.scope, '2026-09-02', 'Africa/Casablanca')
  assert.equal(res.today.totalAttempts, 4)
  // Delta: (4 - 2) / 2 * 100 = 100%
  assert.equal(res.today.deltaAttemptsPct, 100)
})

