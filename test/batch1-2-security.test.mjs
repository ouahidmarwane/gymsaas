import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, control, createOperator, uniq, waitReady } from './helpers.mjs'

const operatorPassword = 'motdepasse-solide-batch12'
let operator, noStepUp, orgA, orgB, operatorEmail, invoiceA

before(async () => {
  await waitReady()
  const suffix = uniq()
  const clubA = client(); const clubB = client()
  orgA = (await clubA.call('POST', '/api/auth/signup', { clubName: 'Batch 12 A', slug: `batch12-a-${suffix}`, name: 'Club A', email: `batch12-a-${suffix}@example.ma`, password: 'motdepasse-solide-club' })).data.orgId
  orgB = (await clubB.call('POST', '/api/auth/signup', { clubName: 'Batch 12 B', slug: `batch12-b-${suffix}`, name: 'Club B', email: `batch12-b-${suffix}@example.ma`, password: 'motdepasse-solide-club' })).data.orgId
  operatorEmail = `batch12-ops-${suffix}@example.ma`
  createOperator(operatorEmail, 'Batch 12 Operator', operatorPassword)
  await waitReady()
  operator = client(); noStepUp = client()
  for (const session of [operator, noStepUp]) assert.equal((await session.call('POST', '/api/auth/login', { email: operatorEmail, password: operatorPassword })).status, 200)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: operatorPassword })).status, 200)
  for (const orgId of [orgA, orgB]) assert.equal((await operator.call('PUT', `/api/admin/billing/${orgId}`, { priceCents: 12000, cycleMonths: 1 })).status, 200)
  invoiceA = (await operator.call('POST', `/api/admin/billing/${orgA}/invoices`, {})).data.id
  await operator.call('POST', `/api/admin/billing/${orgB}/invoices`, {})
  control(`INSERT INTO org_invoice_proofs (invoice_id, org_id, reference) VALUES ('${invoiceA}', '${orgA}', 'batch12')`)
})

test('support read-only blocks billing with and without step-up', async () => {
  assert.equal((await noStepUp.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  assert.equal((await noStepUp.call('PUT', `/api/admin/billing/${orgA}`, { priceCents: 13000, cycleMonths: 1 })).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  assert.equal((await operator.call('PUT', `/api/admin/billing/${orgA}`, { priceCents: 13000, cycleMonths: 1 })).status, 403)
})

test('support write is bound to its organization across billing routes', async () => {
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  assert.equal((await operator.call('PUT', `/api/admin/billing/${orgA}`, { priceCents: 13000, cycleMonths: 1 })).status, 200)
  assert.equal((await operator.call('PUT', `/api/admin/billing/${orgB}`, { priceCents: 1, cycleMonths: 1 })).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/billing/${orgB}/invoices`, {})).status, 403)
})

test('read-only support blocks every invoice mutation family', async () => {
  assert.equal((await operator.call('POST', '/api/admin/support/read-only')).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/proofs/${invoiceA}/accept`, {})).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/invoices/${invoiceA}/paid`, {})).status, 403)
  assert.equal((await operator.call('DELETE', `/api/admin/invoices/${invoiceA}/paid`)).status, 403)
  assert.equal((await operator.call('DELETE', `/api/admin/invoices/${invoiceA}`)).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/invoices/${invoiceA}/reminder`, {})).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/billing/${orgA}/renew`, {})).status, 403)
})

test('expired grants and expired support context fail closed', async () => {
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  control(`UPDATE support_write_grants SET expires_at = '2000-01-01T00:00:00Z' WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = '${operatorEmail}') AND support_org_id = '${orgA}')`)
  assert.equal((await operator.call('PUT', `/api/admin/billing/${orgA}`, { priceCents: 14000, cycleMonths: 1 })).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  control(`UPDATE sessions SET support_expires_at = '2000-01-01T00:00:00Z' WHERE user_id = (SELECT id FROM users WHERE email = '${operatorEmail}') AND support_org_id = '${orgA}'`)
  assert.equal((await operator.call('PUT', `/api/admin/billing/${orgA}`, { priceCents: 14000, cycleMonths: 1 })).status, 403)
})

test('switching support invalidates old authority and explicit exit restores normal mode', async () => {
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgB}/support`)).status, 200)
  assert.equal((await operator.call('PUT', `/api/admin/billing/${orgA}`, { priceCents: 1, cycleMonths: 1 })).status, 403)
  assert.equal((await operator.call('DELETE', '/api/admin/support')).status, 200)
  assert.equal((await operator.call('PUT', `/api/admin/billing/${orgB}`, { priceCents: 15000, cycleMonths: 1 })).status, 200)
})

test('messaging discovery and new conversations obey membership intersection scope', async () => {
  const suffix = uniq(); const owner = client()
  const signup = await owner.call('POST', '/api/auth/signup', { clubName: 'Batch 12 Messages', slug: `batch12-msg-${suffix}`, name: 'Owner Null', email: `batch12-msg-owner-${suffix}@example.ma`, password: 'motdepasse-solide-owner' })
  const orgId = signup.data.orgId
  const branchA = (await owner.call('POST', '/api/branches', { name: 'A' })).data.id
  const branchB = (await owner.call('POST', '/api/branches', { name: 'B' })).data.id
  const disciplineX = (await owner.call('POST', '/api/disciplines', { name: 'X' })).data.id
  const disciplineY = (await owner.call('POST', '/api/disciplines', { name: 'Y' })).data.id
  const ownerId = (await owner.call('GET', '/api/me')).data.user.id
  const people = { actorBoth: { id: ownerId, session: owner } }
  const allowed = await owner.call('POST', '/api/staff', { name: 'Allowed AX', email: `batch12-allowed-${suffix}@example.ma`, password: 'motdepasse-solide-staff', role: 'staff' })
  people.allowed = { id: allowed.data.userId }
  for (const [key, name] of Object.entries({ wrongBranch: 'Hidden BX', wrongDiscipline: 'Hidden AY', nullTarget: 'Hidden Null' })) {
    const id = `batch12-${key}-${suffix}`; const email = `${id}@example.ma`
    control(`INSERT INTO users (id, email, email_norm, name, password_hash) SELECT '${id}', '${email}', '${email}', '${name}', password_hash FROM users WHERE id = '${people.allowed.id}'; INSERT INTO memberships (id, user_id, org_id, role) VALUES ('membership-${id}', '${id}', '${orgId}', 'staff')`)
    people[key] = { id }
  }
  const setScope = (key, branch, discipline) => control(`UPDATE memberships SET branch_id = ${branch ? `'${branch}'` : 'NULL'}, discipline_id = ${discipline ? `'${discipline}'` : 'NULL'} WHERE org_id = '${orgId}' AND user_id = '${people[key].id}'`)
  setScope('actorBoth', branchA, disciplineX)
  setScope('allowed', branchA, disciplineX); setScope('wrongBranch', branchB, disciplineX); setScope('wrongDiscipline', branchA, disciplineY)
  await waitReady()
  const both = await people.actorBoth.session.call('GET', '/api/messaging/participants'); const bothIds = both.data.people.map(person => person.id)
  assert.ok(bothIds.includes(people.allowed.id)); assert.ok(!bothIds.includes(people.wrongBranch.id)); assert.ok(!bothIds.includes(people.wrongDiscipline.id)); assert.ok(!bothIds.includes(people.nullTarget.id))
  setScope('actorBoth', branchA, null)
  await waitReady()
  const branchIds = (await people.actorBoth.session.call('GET', '/api/messaging/participants')).data.people.map(p => p.id)
  assert.ok(branchIds.includes(people.allowed.id)); assert.ok(branchIds.includes(people.wrongDiscipline.id)); assert.ok(!branchIds.includes(people.wrongBranch.id))
  setScope('actorBoth', null, disciplineX)
  await waitReady()
  const disciplineIds = (await people.actorBoth.session.call('GET', '/api/messaging/participants')).data.people.map(p => p.id)
  assert.ok(disciplineIds.includes(people.allowed.id)); assert.ok(disciplineIds.includes(people.wrongBranch.id)); assert.ok(!disciplineIds.includes(people.wrongDiscipline.id))
  setScope('actorBoth', branchA, disciplineX)
  await waitReady()
  assert.deepEqual((await people.actorBoth.session.call('GET', '/api/messaging/participants?q=Hidden')).data.people, [])
  assert.equal((await people.actorBoth.session.call('POST', '/api/messaging/dm', { userId: people.wrongBranch.id })).status, 400)
  const dm = await people.actorBoth.session.call('POST', '/api/messaging/dm', { userId: people.allowed.id }); assert.equal(dm.status, 201)
  setScope('allowed', branchB, disciplineX)
  await waitReady()
  assert.equal((await people.actorBoth.session.call('GET', `/api/messaging/conversations/${dm.data.id}/messages`)).status, 200)
  setScope('actorBoth', null, null)
  await waitReady()
  const unrestrictedIds = (await owner.call('GET', '/api/messaging/participants')).data.people.map(person => person.id)
  assert.ok(unrestrictedIds.includes(people.wrongBranch.id)); assert.ok(unrestrictedIds.includes(people.wrongDiscipline.id)); assert.ok(unrestrictedIds.includes(people.nullTarget.id))
})

test('support mode remains denied private club messaging', async () => {
  assert.equal((await noStepUp.call('GET', '/api/messaging/participants')).status, 403)
})
