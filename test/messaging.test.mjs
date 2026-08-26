import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, createOperator, uniq, waitReady } from './helpers.mjs'

let ownerA, staffA, thirdA, ownerB, operator
let ownerAId, staffAId, thirdAId, staffBId, orgA, orgB
let dmId, groupId
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function attachmentRequest(session, method, path, body, contentType) {
  const response = await fetch(BASE + path, {
    method, headers: { ...(contentType ? { 'Content-Type': contentType } : {}), Cookie: session.cookie ?? '' }, body,
  })
  const type = response.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await response.json().catch(() => null) : Buffer.from(await response.arrayBuffer())
  return { status: response.status, type, data }
}

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)
  const suffix = uniq()
  ownerA = client(); ownerB = client()
  const a = await ownerA.call('POST', '/api/auth/signup', {
    clubName: 'Messages Alpha', slug: `messages-alpha-${suffix}`, name: 'Owner Alpha',
    email: `msg-owner-a-${suffix}@example.ma`, password: 'motdepasse-messaging-a',
  })
  const b = await ownerB.call('POST', '/api/auth/signup', {
    clubName: 'Messages Bravo', slug: `messages-bravo-${suffix}`, name: 'Owner Bravo',
    email: `msg-owner-b-${suffix}@example.ma`, password: 'motdepasse-messaging-b',
  })
  assert.equal(a.status, 201, JSON.stringify(a.data)); assert.equal(b.status, 201, JSON.stringify(b.data))
  orgA = a.data.orgId; orgB = b.data.orgId
  ownerAId = (await ownerA.call('GET', '/api/me')).data.user.id

  const staffEmail = `msg-staff-a-${suffix}@example.ma`
  const thirdEmail = `msg-third-a-${suffix}@example.ma`
  const staffInvite = await ownerA.call('POST', '/api/staff', {
    name: 'Staff Alpha', email: staffEmail, password: 'motdepasse-staff-alpha', role: 'staff',
  })
  const thirdInvite = await ownerA.call('POST', '/api/staff', {
    name: 'Third Alpha', email: thirdEmail, password: 'motdepasse-third-alpha', role: 'staff',
  })
  staffAId = staffInvite.data.userId; thirdAId = thirdInvite.data.userId
  staffA = client(); thirdA = client()
  assert.equal((await staffA.call('POST', '/api/auth/login', { email: staffEmail, password: 'motdepasse-staff-alpha' })).status, 200)
  assert.equal((await thirdA.call('POST', '/api/auth/login', { email: thirdEmail, password: 'motdepasse-third-alpha' })).status, 200)

  const staffBEmail = `msg-staff-b-${suffix}@example.ma`
  const staffBInvite = await ownerB.call('POST', '/api/staff', {
    name: 'Staff Bravo', email: staffBEmail, password: 'motdepasse-staff-bravo', role: 'staff',
  })
  staffBId = staffBInvite.data.userId

  const operatorEmail = `msg-operator-${suffix}@example.ma`
  createOperator(operatorEmail, 'Support Operator', 'motdepasse-support-operator')
  await waitReady()
  operator = client()
  assert.equal((await operator.call('POST', '/api/auth/login', {
    email: operatorEmail, password: 'motdepasse-support-operator',
  })).status, 200)
})

test('participant discovery is same-club and excludes viewers/cross-club users', async () => {
  const result = await ownerA.call('GET', '/api/messaging/participants')
  assert.equal(result.status, 200, JSON.stringify(result.data))
  const ids = result.data.people.map(person => person.id)
  assert.ok(ids.includes(staffAId)); assert.ok(ids.includes(thirdAId))
  assert.ok(!ids.includes(staffBId))
})

test('same-club DM is private and sender identity is server-derived', async () => {
  const opened = await ownerA.call('POST', '/api/messaging/dm', { userId: staffAId })
  assert.equal(opened.status, 201, JSON.stringify(opened.data)); dmId = opened.data.id
  const sent = await ownerA.call('POST', `/api/messaging/conversations/${dmId}/messages`, {
    body: '<img src=x onerror=alert(1)>', authorId: staffAId, mentionIds: [],
  })
  assert.equal(sent.status, 201, JSON.stringify(sent.data))
  const history = await staffA.call('GET', `/api/messaging/conversations/${dmId}/messages`)
  assert.equal(history.status, 200, JSON.stringify(history.data))
  assert.equal(history.data.messages[0].body, '<img src=x onerror=alert(1)>')
  assert.equal(history.data.messages[0].authorId, ownerAId)
  assert.equal((await thirdA.call('GET', `/api/messaging/conversations/${dmId}/messages`)).status, 404)
})

test('attachments use authorized R2 proxy and remain tenant-private', async () => {
  const uploaded = await attachmentRequest(ownerA, 'PUT',
    `/api/messaging/conversations/${dmId}/attachments?name=preuve.png`, PNG, 'image/png')
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data))
  const history = await staffA.call('GET', `/api/messaging/conversations/${dmId}/messages`)
  const attachment = history.data.messages.flatMap(message => message.attachments).find(item => item.id === uploaded.data.attachmentId)
  assert.equal(attachment.fileName, 'preuve.png')
  const download = await attachmentRequest(staffA, 'GET',
    `/api/messaging/conversations/${dmId}/attachments/${attachment.id}`)
  assert.equal(download.status, 200); assert.equal(download.type, 'image/png'); assert.deepEqual(download.data, PNG)
  assert.equal((await attachmentRequest(thirdA, 'GET',
    `/api/messaging/conversations/${dmId}/attachments/${attachment.id}`)).status, 404)
  assert.equal((await attachmentRequest(ownerB, 'GET',
    `/api/messaging/conversations/${dmId}/attachments/${attachment.id}`)).status, 404)
  assert.equal((await attachmentRequest(ownerA, 'PUT',
    `/api/messaging/conversations/${dmId}/attachments?name=danger.html`, Buffer.from('<script>'), 'text/html')).status, 415)
})

test('cross-club DM and cross-club mentions are rejected', async () => {
  assert.equal((await ownerA.call('POST', '/api/messaging/dm', { userId: staffBId })).status, 400)
  const mention = await ownerA.call('POST', `/api/messaging/conversations/${dmId}/messages`, {
    body: '@Staff Bravo impossible', mentionIds: [staffBId],
  })
  assert.ok([400, 403].includes(mention.status), JSON.stringify(mention.data))
})

test('group membership, admin policy, reactions, replies and removal are enforced', async () => {
  const created = await ownerA.call('POST', '/api/messaging/groups', {
    name: 'Direction test', description: 'Groupe privé', memberIds: [staffAId],
  })
  assert.equal(created.status, 201, JSON.stringify(created.data)); groupId = created.data.id
  const first = await staffA.call('POST', `/api/messaging/conversations/${groupId}/messages`, {
    body: 'Message du groupe', mentionIds: [ownerAId],
  })
  assert.equal(first.status, 201, JSON.stringify(first.data))
  const reply = await ownerA.call('POST', `/api/messaging/conversations/${groupId}/messages`, {
    body: 'Réponse', replyToId: first.data.id, mentionIds: [],
  })
  assert.equal(reply.status, 201)
  assert.equal((await staffA.call('POST', `/api/messaging/conversations/${groupId}/messages/${reply.data.id}/reactions`, { emoji: '👍' })).status, 200)
  assert.equal((await staffA.call('POST', `/api/messaging/conversations/${groupId}/messages/${reply.data.id}/reactions`, { emoji: '🔥' })).status, 200)
  const reactedMessages = await staffA.call('GET', `/api/messaging/conversations/${groupId}/messages`)
  const reactedReply = reactedMessages.data.messages.find(item => item.id === reply.data.id)
  assert.deepEqual(reactedReply.reactions, [{ emoji: '🔥', count: 1, reacted: 1 }])
  assert.equal((await staffA.call('POST', `/api/messaging/groups/${groupId}/admins/${staffAId}`)).status, 403)
  assert.equal((await ownerA.call('DELETE', `/api/messaging/groups/${groupId}/members/${staffAId}`)).status, 200)
  assert.equal((await staffA.call('GET', `/api/messaging/conversations/${groupId}/messages`)).status, 404)
  assert.equal((await thirdA.call('GET', `/api/messaging/conversations/${groupId}`)).status, 404)
  assert.equal((await ownerA.call('PATCH', `/api/messaging/conversations/${groupId}`, { name: 'Direction renommée' })).status, 200)
  assert.equal((await ownerA.call('DELETE', `/api/messaging/conversations/${groupId}`)).status, 200)
  assert.equal((await ownerA.call('GET', `/api/messaging/conversations/${groupId}`)).status, 404)
})

test('team channel is tenant-local and history uses bounded cursors', async () => {
  const listA = await ownerA.call('GET', '/api/messaging/conversations')
  const listB = await ownerB.call('GET', '/api/messaging/conversations')
  const teamA = listA.data.conversations.find(item => item.type === 'team')
  const teamB = listB.data.conversations.find(item => item.type === 'team')
  assert.ok(teamA); assert.ok(teamB); assert.notEqual(teamA.id, teamB.id)
  assert.equal((await ownerA.call('POST', `/api/messaging/conversations/${teamA.id}/messages`, {
    body: 'Interne Alpha', mentionIds: [staffAId],
  })).status, 201)
  assert.equal((await ownerB.call('GET', `/api/messaging/conversations/${teamA.id}/messages`)).status, 404)
  const page = await ownerA.call('GET', `/api/messaging/conversations/${teamA.id}/messages?limit=1`)
  assert.equal(page.status, 200); assert.equal(page.data.messages.length, 1)
  assert.equal((await ownerA.call('POST', `/api/messaging/conversations/${teamA.id}/read`)).status, 200)
})

test('support threads are explicit, isolated and support identity cannot be spoofed', async () => {
  assert.equal((await ownerA.call('POST', '/api/messaging/support', {
    body: 'Besoin assistance', orgId: orgB, authorKind: 'support',
  })).status, 201)
  const supportView = await operator.call('GET', `/api/messaging/support?orgId=${orgA}`)
  assert.equal(supportView.status, 200, JSON.stringify(supportView.data))
  assert.equal(supportView.data.messages[0].authorKind, 'club')
  const otherClub = await ownerB.call('GET', `/api/messaging/support?orgId=${orgA}`)
  assert.equal(otherClub.status, 200)
  assert.equal(otherClub.data.thread, null)
  assert.equal((await operator.call('POST', '/api/messaging/support', {
    orgId: orgA, body: 'Réponse officielle', authorName: 'Fake club', authorKind: 'club',
  })).status, 201)
  const clubView = await ownerA.call('GET', '/api/messaging/support')
  assert.equal(clubView.data.messages.at(-1).authorKind, 'support')
  assert.equal(clubView.data.messages.at(-1).authorName, 'GymFlow Support')
})

test('only platform Superadmin can publish announcements', async () => {
  assert.equal((await ownerA.call('POST', '/api/messaging/announcements', {
    title: 'Interdit', content: 'Non',
  })).status, 403)
  const published = await operator.call('POST', '/api/messaging/announcements', {
    title: 'Maintenance GymFlow', content: '<script>alert(1)</script>', status: 'published',
  })
  assert.equal(published.status, 201, JSON.stringify(published.data))
  const list = await ownerA.call('GET', '/api/messaging/announcements')
  const item = list.data.announcements.find(row => row.id === published.data.id)
  assert.equal(item.content, '<script>alert(1)</script>')
  assert.deepEqual(item.reactions, [])
  assert.equal((await ownerA.call('POST', `/api/messaging/announcements/${item.id}/reactions`, { emoji: '👍' })).status, 200)
  const reacted = await ownerA.call('GET', '/api/messaging/announcements')
  const reactedItem = reacted.data.announcements.find(row => row.id === item.id)
  assert.deepEqual(reactedItem.reactions, [{ emoji: '👍', count: 1, reacted: 1 }])
  assert.equal((await ownerA.call('POST', `/api/messaging/announcements/${item.id}/reactions`, { emoji: '🔥' })).status, 200)
  const replaced = await ownerA.call('GET', '/api/messaging/announcements')
  const replacedItem = replaced.data.announcements.find(row => row.id === item.id)
  assert.deepEqual(replacedItem.reactions, [{ emoji: '🔥', count: 1, reacted: 1 }])
  const otherClubView = await ownerB.call('GET', '/api/messaging/announcements')
  const otherClubItem = otherClubView.data.announcements.find(row => row.id === item.id)
  assert.deepEqual(otherClubItem.reactions, [{ emoji: '🔥', count: 1, reacted: 0 }])
  assert.equal((await operator.call('POST', `/api/messaging/announcements/${item.id}/reactions`, { emoji: '👍' })).status, 403)
  assert.equal((await ownerA.call('POST', `/api/messaging/announcements/${item.id}/reactions`, { emoji: '<x>' })).status, 400)
  assert.equal((await ownerA.call('POST', `/api/messaging/announcements/${item.id}/reactions`, { emoji: '🔥' })).status, 200)
  const unreacted = await ownerA.call('GET', '/api/messaging/announcements')
  assert.deepEqual(unreacted.data.announcements.find(row => row.id === item.id).reactions, [])
  assert.equal((await ownerA.call('POST', `/api/messaging/announcements/${item.id}/read`)).status, 200)
  assert.equal((await ownerA.call('PATCH', `/api/messaging/announcements/${item.id}`, { title: 'Piraté' })).status, 403)
})

test('club staff can contact support without gaining announcement publishing rights', async () => {
  assert.equal((await staffA.call('POST', '/api/messaging/support', {
    body: 'Demande envoyee par la reception',
  })).status, 201)
  assert.equal((await staffA.call('POST', '/api/messaging/announcements', {
    title: 'Interdit', content: 'Non', status: 'published',
  })).status, 403)
})

test('message validation rejects empty, oversized, invalid reaction and SQL payload safely', async () => {
  assert.equal((await ownerA.call('POST', `/api/messaging/conversations/${dmId}/messages`, { body: '   ' })).status, 400)
  assert.equal((await ownerA.call('POST', `/api/messaging/conversations/${dmId}/messages`, { body: 'x'.repeat(4001) })).status, 400)
  assert.equal((await ownerA.call('POST', `/api/messaging/conversations/${dmId}/messages`, { body: 'bad\u0000control' })).status, 400)
  const valid = await ownerA.call('POST', `/api/messaging/conversations/${dmId}/messages`, {
    body: "'); DROP TABLE messages; --", mentionIds: [],
  })
  assert.equal(valid.status, 201)
  assert.equal((await ownerA.call('POST', `/api/messaging/conversations/${dmId}/messages/${valid.data.id}/reactions`, { emoji: '<x>' })).status, 400)
  assert.equal((await staffA.call('GET', `/api/messaging/conversations/${dmId}/messages`)).status, 200)
})
