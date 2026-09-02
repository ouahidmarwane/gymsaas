import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, control, createOperator, uniq, waitReady } from './helpers.mjs'

const operatorPassword = 'motdepasse-solide-batch13'
let operator, clubA, clubB, orgA, orgB, operatorEmail
let eventA, eventB, eventGlobal, eventPrivate, userA, userB, multiUser, targetOperator

before(async () => {
  await waitReady()
  const suffix = uniq()
  clubA = client(); clubB = client()
  const madeA = await clubA.call('POST', '/api/auth/signup', { clubName: 'Batch 13 A', slug: `batch13-a-${suffix}`, name: 'Owner A', email: `batch13-owner-a-${suffix}@example.ma`, password: 'motdepasse-solide-club' })
  const madeB = await clubB.call('POST', '/api/auth/signup', { clubName: 'Batch 13 B', slug: `batch13-b-${suffix}`, name: 'Owner B', email: `batch13-owner-b-${suffix}@example.ma`, password: 'motdepasse-solide-club' })
  orgA = madeA.data.orgId; orgB = madeB.data.orgId
  userA = (await clubA.call('GET', '/api/me')).data.user.id
  userB = (await clubB.call('GET', '/api/me')).data.user.id
  const multi = await clubA.call('POST', '/api/staff', { name: 'Multi Org', email: `batch13-multi-${suffix}@example.ma`, password: 'motdepasse-solide-multi', role: 'staff' })
  multiUser = multi.data.userId
  control(`INSERT INTO memberships (id, user_id, org_id, role) VALUES ('batch13-multi-membership-${suffix}', '${multiUser}', '${orgB}', 'staff')`)
  eventA = 1300000000 + Math.floor(Math.random() * 1000000); eventB = eventA + 1; eventGlobal = eventA + 2; eventPrivate = eventA + 3
  control(`INSERT INTO security_events (id, user_id, org_id, type, detail) VALUES
    (${eventA}, NULL, '${orgA}', 'support_write', 'batch13-a'),
    (${eventB}, NULL, '${orgB}', 'support_write', 'batch13-b'),
    (${eventGlobal}, NULL, NULL, 'support_write', 'batch13-global'),
    (${eventPrivate}, '${userA}', '${orgA}', 'new_ip', 'batch13-private')`)
  operatorEmail = `batch13-ops-${suffix}@example.ma`
  createOperator(operatorEmail, 'Batch 13 Operator', operatorPassword)
  control(`INSERT INTO memberships (id, user_id, org_id, role)
    SELECT 'batch13-operator-membership-${suffix}', id, '${orgB}', 'admin'
      FROM users WHERE email = '${operatorEmail}'`)
  const targetOperatorEmail = `batch13-target-ops-${suffix}@example.ma`
  createOperator(targetOperatorEmail, 'Batch 13 Target Operator', operatorPassword)
  const targetRow = JSON.parse(control(`SELECT id FROM users WHERE email = '${targetOperatorEmail}'`))
  targetOperator = targetRow[0].results[0].id
  control(`INSERT INTO memberships (id, user_id, org_id, role) VALUES
    ('batch13-target-operator-membership-${suffix}', '${targetOperator}', '${orgA}', 'admin')`)
  await waitReady(); operator = client()
  assert.equal((await operator.call('POST', '/api/auth/login', { email: operatorEmail, password: operatorPassword })).status, 200)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: operatorPassword })).status, 200)
})

test('club support messages ignore attacker supplied organization and identity', async () => {
  assert.equal((await clubA.call('POST', '/api/messaging/support', { orgId: orgB, body: 'Message du club A', authorKind: 'support', authorName: 'GymFlow Support' })).status, 201)
  const a = await clubA.call('GET', '/api/messaging/support')
  assert.equal(a.data.messages.at(-1).authorKind, 'club'); assert.equal(a.data.messages.at(-1).authorName, 'Owner A')
  assert.equal((await clubB.call('GET', '/api/messaging/support')).data.thread, null)
})

test('normal platform support messaging remains available outside support mode', async () => {
  assert.equal((await operator.call('POST', '/api/messaging/support', { orgId: orgB, body: 'Message officiel normal', authorKind: 'club', authorName: 'Spoof' })).status, 201)
  const b = await clubB.call('GET', '/api/messaging/support')
  assert.equal(b.data.messages.at(-1).authorKind, 'support'); assert.equal(b.data.messages.at(-1).authorName, 'GymFlow Support')
})

test('security-event handling is organization-bound and global events fail closed in support', async () => {
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventA}/handled`)).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventB}/handled`)).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventPrivate}/handled`)).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/events/1999999999/handled')).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventA}/handled`)).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventB}/handled`)).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventGlobal}/handled`)).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventPrivate}/handled`)).status, 403)
})

test('platform club mutations cannot bypass an active support scope', async () => {
  const branchSentinel = `Batch 13 forbidden branch ${uniq()}`
  const disciplineSentinel = `Batch 13 forbidden discipline ${uniq()}`
  const brandingSentinel = `Batch 13 forbidden branding ${uniq()}`

  assert.equal((await operator.call('POST', '/api/admin/support/read-only')).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/branches`, {
    name: branchSentinel,
  })).status, 403, 'read-only support must not use the unrestricted Durable Object route')
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgB}/disciplines`, {
    name: disciplineSentinel,
  })).status, 403, 'support scoped to club A must not mutate club B')
  assert.equal((await operator.call('PUT', `/api/admin/clubs/${orgB}/branding`, {
    name: brandingSentinel,
  })).status, 403, 'support must not use the unrestricted D1 branding route')

  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgB}/branches`, {
    name: branchSentinel,
  })).status, 403, 'write elevation must remain confined to the active support club routes')

  const branchesA = await clubA.call('GET', '/api/branches')
  assert.ok(!branchesA.data.branches.some(branch => branch.name === branchSentinel))
  const disciplinesB = await clubB.call('GET', '/api/disciplines')
  assert.ok(!disciplinesB.data.disciplines.some(discipline => discipline.name === disciplineSentinel))
  const brandingB = await clubB.call('GET', '/api/branding')
  assert.notEqual(brandingB.data.name, brandingSentinel)
})

test('support messages and inbox reads are bound to live support authority', async () => {
  assert.equal((await operator.call('POST', '/api/admin/support/read-only')).status, 200)
  assert.equal((await operator.call('POST', '/api/messaging/support', { orgId: orgA, body: 'Interdit A' })).status, 403)
  assert.equal((await operator.call('POST', '/api/messaging/support', { orgId: orgB, body: 'Interdit B' })).status, 403)
  assert.equal((await operator.call('GET', `/api/messaging/support?orgId=${orgB}`)).status, 403)
  const threads = await operator.call('GET', '/api/messaging/support/threads')
  assert.equal(threads.status, 200); assert.ok(threads.data.threads.every(thread => thread.orgId === orgA))
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  assert.equal((await operator.call('POST', '/api/messaging/support', { orgId: orgA, body: 'Autorise A' })).status, 201)
  assert.equal((await operator.call('POST', '/api/messaging/support', { orgId: orgB, body: 'Toujours interdit B' })).status, 403)
})

test('expired support message authority fails closed', async () => {
  control(`UPDATE support_write_grants SET expires_at = '2000-01-01T00:00:00Z' WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = '${operatorEmail}'))`)
  await waitReady()
  assert.equal((await operator.call('POST', '/api/messaging/support', { orgId: orgA, body: 'Grant expire' })).status, 403)
  assert.equal((await operator.call('DELETE', '/api/admin/support')).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  control(`UPDATE sessions SET support_expires_at = '2000-01-01T00:00:00Z' WHERE user_id = (SELECT id FROM users WHERE email = '${operatorEmail}') AND support_org_id = '${orgA}'`)
  await waitReady()
  assert.equal((await operator.call('POST', '/api/messaging/support', { orgId: orgA, body: 'Support expire' })).status, 403)
  assert.equal((await operator.call('PUT', '/api/branding', {
    theme: { accent: '#123456', skin: 'sombre' },
  })).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventA}/handled`)).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/branches`, {
    name: `Expired same-club ${uniq()}`,
  })).status, 403)
  assert.equal((await operator.call('PUT', `/api/admin/clubs/${orgB}/branding`, {
    name: `Expired cross-club ${uniq()}`,
  })).status, 403)
  assert.equal((await operator.call('DELETE', '/api/admin/support')).status, 200)
})

test('support-scoped global session revocation allows only an exclusive matching membership', async () => {
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  assert.equal((await operator.call('DELETE', `/api/admin/users/${userA}/sessions`)).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  assert.equal((await operator.call('DELETE', `/api/admin/users/${userB}/sessions`)).status, 403)
  assert.equal((await operator.call('DELETE', `/api/admin/users/${multiUser}/sessions`)).status, 403)
  assert.equal((await operator.call('DELETE', `/api/admin/users/${targetOperator}/sessions`)).status, 403)
  assert.equal((await operator.call('DELETE', `/api/admin/users/${userA}/sessions`)).status, 200)
  assert.equal((await clubA.call('GET', '/api/me')).status, 401)
})

test('explicit exit restores normal global Superadmin security administration', async () => {
  assert.equal((await operator.call('DELETE', '/api/admin/support')).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventGlobal}/handled`)).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/events/${eventPrivate}/handled`)).status, 403)
  assert.equal((await operator.call('DELETE', `/api/admin/users/${userB}/sessions`)).status, 200)
  assert.equal((await clubB.call('GET', '/api/me')).status, 401)
})

test('support mode still cannot access private club messaging', async () => {
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  assert.equal((await operator.call('GET', '/api/messaging/participants')).status, 403)
})
