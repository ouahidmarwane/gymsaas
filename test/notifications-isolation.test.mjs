import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, control, createOperator, uniq, waitReady } from './helpers.mjs'

const password = 'motdepasse-solide-notifs'
let ownerA, staffA, ownerB, operator
let orgA, orgB, ownerAId, staffAId, ownerBId
let ownerAEmail, staffAEmail, ownerBEmail
let ownerNewIpEvent, ownerBurstEvent, staffEvent, clubBEvent, anonymousBurstEvent, sharedEvent

const securityItems = data => data.items.filter(item => item.kind === 'security')
const eventIds = data => securityItems(data).map(item => item.id)

before(async () => {
  await waitReady()

  const suffix = uniq()
  ownerAEmail = `notif-owner-a-${suffix}@example.ma`
  staffAEmail = `notif-staff-a-${suffix}@example.ma`
  ownerBEmail = `notif-owner-b-${suffix}@example.ma`

  ownerA = client()
  const madeA = await ownerA.call('POST', '/api/auth/signup', {
    clubName: `Notif Club A ${suffix}`,
    slug: `notif-a-${suffix}`,
    name: 'Notif Owner A',
    email: ownerAEmail,
    password,
  })
  assert.equal(madeA.status, 201, JSON.stringify(madeA.data))
  orgA = madeA.data.orgId
  ownerAId = (await ownerA.call('GET', '/api/me')).data.user.id

  const madeStaff = await ownerA.call('POST', '/api/staff', {
    name: 'Notif Staff A',
    email: staffAEmail,
    password,
    role: 'staff',
  })
  assert.equal(madeStaff.status, 201, JSON.stringify(madeStaff.data))
  staffAId = madeStaff.data.userId
  staffA = client()
  assert.equal((await staffA.call('POST', '/api/auth/login', { email: staffAEmail, password })).status, 200)

  ownerB = client()
  const madeB = await ownerB.call('POST', '/api/auth/signup', {
    clubName: `Notif Club B ${suffix}`,
    slug: `notif-b-${suffix}`,
    name: 'Notif Owner B',
    email: ownerBEmail,
    password,
  })
  assert.equal(madeB.status, 201, JSON.stringify(madeB.data))
  orgB = madeB.data.orgId
  ownerBId = (await ownerB.call('GET', '/api/me')).data.user.id

  const base = 1500000000 + Math.floor(Math.random() * 1000000)
  ownerNewIpEvent = base
  ownerBurstEvent = base + 1
  staffEvent = base + 2
  clubBEvent = base + 3
  anonymousBurstEvent = base + 4
  sharedEvent = base + 5

  control(`INSERT INTO security_events (id, user_id, org_id, type, detail, ip) VALUES
    (${ownerNewIpEvent}, '${ownerAId}', '${orgA}', 'new_ip', 'owner-new-ip', '203.0.113.10'),
    (${ownerBurstEvent}, '${ownerAId}', NULL, 'failed_burst', '${ownerAEmail}', '203.0.113.11'),
    (${staffEvent}, '${staffAId}', '${orgA}', 'new_ip', 'staff-new-ip', '203.0.113.12'),
    (${clubBEvent}, '${ownerBId}', '${orgB}', 'new_ip', 'club-b-new-ip', '203.0.113.13'),
    (${anonymousBurstEvent}, NULL, NULL, 'failed_burst', 'unknown-${suffix}@example.ma', '203.0.113.14'),
    (${sharedEvent}, NULL, '${orgA}', 'support_write', 'shared-support-event', '203.0.113.15')`)

  const operatorEmail = `notif-ops-${suffix}@example.ma`
  createOperator(operatorEmail, 'Notif Operator', password)
  await waitReady()
  operator = client()
  assert.equal((await operator.call('POST', '/api/auth/login', { email: operatorEmail, password })).status, 200)
})

test('un compte ne voit que ses propres notifications de securite dans le meme club', async () => {
  const ownerFeed = await ownerA.call('GET', '/api/notifications')
  assert.equal(ownerFeed.status, 200, JSON.stringify(ownerFeed.data))
  assert.deepEqual(eventIds(ownerFeed.data).sort(), [`sec-${ownerBurstEvent}`, `sec-${ownerNewIpEvent}`].sort())
  assert.equal(securityItems(ownerFeed.data).some(item => item.title.includes('Notif Staff A')), false)

  const staffFeed = await staffA.call('GET', '/api/notifications')
  assert.equal(staffFeed.status, 200, JSON.stringify(staffFeed.data))
  assert.deepEqual(eventIds(staffFeed.data), [`sec-${staffEvent}`])
})

test('les notifications privees ne franchissent ni club ni utilisateur nul', async () => {
  const clubBFeed = await ownerB.call('GET', '/api/notifications')
  assert.equal(clubBFeed.status, 200, JSON.stringify(clubBFeed.data))
  assert.deepEqual(eventIds(clubBFeed.data), [`sec-${clubBEvent}`])

  const allSecurityIds = [
    ...eventIds((await ownerA.call('GET', '/api/notifications')).data),
    ...eventIds((await staffA.call('GET', '/api/notifications')).data),
    ...eventIds(clubBFeed.data),
  ]
  assert.equal(allSecurityIds.includes(`sec-${anonymousBurstEvent}`), false)
})

test('le mode support ne transforme pas les evenements prives du club en notifications', async () => {
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/support`)).status, 200)
  const feed = await operator.call('GET', '/api/notifications')
  assert.equal(feed.status, 200, JSON.stringify(feed.data))
  assert.equal(securityItems(feed.data).length, 0)
})

test('la supervision Superadmin masque et ne traite pas les evenements prives', async () => {
  assert.equal((await operator.call('DELETE', '/api/admin/support')).status, 200)

  const supervision = await operator.call('GET', '/api/admin/supervision')
  assert.equal(supervision.status, 200, JSON.stringify(supervision.data))
  assert.equal(supervision.data.events.some(event => event.id === ownerNewIpEvent), false)
  assert.equal(supervision.data.events.some(event => event.id === ownerBurstEvent), false)
  assert.ok(supervision.data.events.some(event => event.id === sharedEvent), 'les alertes partagees restent visibles')

  assert.equal((await operator.call('POST', `/api/admin/events/${ownerNewIpEvent}/handled`)).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/events/${ownerBurstEvent}/handled`)).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/events/${sharedEvent}/handled`)).status, 200)
})

