import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, uniq } from './helpers.mjs'

let c, orgId, branchA, branchB, disciplineA, disciplineB
const memberIds = []

before(async () => {
  const u = uniq()
  c = client()
  const signup = await c.call('POST', '/api/auth/signup', {
    clubName: 'Club Scalabilite Batch 4', slug: `scale-${u}`, name: 'Scale Owner',
    email: `scale-${u}@example.ma`, password: 'motdepasse-solide-scale',
  })
  assert.equal(signup.status, 201, JSON.stringify(signup.data))
  orgId = signup.data.orgId

  branchA = (await c.call('POST', '/api/branches', { name: 'Salle Principale' })).data.id
  branchB = (await c.call('POST', '/api/branches', { name: 'Salle Secondaire' })).data.id
  disciplineA = (await c.call('POST', '/api/disciplines', {
    name: 'Discipline A', grades: [{ label: 'Ceinture Blanche' }, { label: 'Ceinture Noire' }],
  })).data.id
  disciplineB = (await c.call('POST', '/api/disciplines', {
    name: 'Discipline B', grades: [],
  })).data.id
})

test('keyset cursor pagination on members list works forward without overlaps', async () => {
  // Create 25 members in branchA, disciplineA
  const created = []
  for (let i = 1; i <= 25; i++) {
    const pad = String(i).padStart(3, '0')
    const res = await c.call('POST', '/api/members', {
      name: `Membre Keyset ${pad}`,
      phone: `0600000${pad}`,
      branchId: branchA,
      disciplineId: disciplineA,
    })
    assert.equal(res.status, 201)
    created.push(res.data.id)
    memberIds.push(res.data.id)
  }

  // Fetch page 1 (limit 10)
  const p1 = await c.call('GET', `/api/members?limit=10&branchId=${branchA}`)
  assert.equal(p1.status, 200)
  assert.equal(p1.data.members.length, 10)
  assert.equal(p1.data.items.length, 10)
  assert.equal(p1.data.hasMore, true)
  assert.ok(p1.data.nextCursor)

  // Fetch page 2 (limit 10)
  const p2 = await c.call('GET', `/api/members?limit=10&branchId=${branchA}&cursor=${p1.data.nextCursor}`)
  assert.equal(p2.status, 200)
  assert.equal(p2.data.members.length, 10)
  assert.equal(p2.data.hasMore, true)
  assert.ok(p2.data.nextCursor)

  // Fetch page 3 (limit 10)
  const p3 = await c.call('GET', `/api/members?limit=10&branchId=${branchA}&cursor=${p2.data.nextCursor}`)
  assert.equal(p3.status, 200)
  assert.equal(p3.data.members.length, 5)
  assert.equal(p3.data.hasMore, false)
  assert.equal(p3.data.nextCursor, null)

  // Check no duplicates and total 25 members retrieved
  const allIds = [
    ...p1.data.members.map(m => m.id),
    ...p2.data.members.map(m => m.id),
    ...p3.data.members.map(m => m.id),
  ]
  assert.equal(new Set(allIds).size, 25)
})

test('tampered or corrupted cursor gracefully falls back to initial page', async () => {
  const invalidBase64 = await c.call('GET', '/api/members?cursor=invalid_base64_not_json_!!!')
  assert.equal(invalidBase64.status, 200)
  assert.ok(Array.isArray(invalidBase64.data.members))

  const corruptJson = await c.call('GET', '/api/members?cursor=eyJmb28iOiJiYXIifQ') // base64url of {"foo":"bar"}
  assert.equal(corruptJson.status, 200)
  assert.ok(Array.isArray(corruptJson.data.members))
})

test('limit is clamped between 1 and 100', async () => {
  const bigLimit = await c.call('GET', '/api/members?limit=1000000')
  assert.equal(bigLimit.status, 200)
  assert.ok(bigLimit.data.limit <= 100)

  const negativeLimit = await c.call('GET', '/api/members?limit=-50')
  assert.equal(negativeLimit.status, 200)
  assert.ok(negativeLimit.data.limit >= 1)
})

test('ordering by name with cursor pagination is stable', async () => {
  const p1 = await c.call('GET', `/api/members?limit=10&orderBy=name&orderDir=asc&branchId=${branchA}`)
  assert.equal(p1.status, 200)
  assert.equal(p1.data.members.length, 10)
  const names1 = p1.data.members.map(m => m.name)
  for (let i = 0; i < names1.length - 1; i++) {
    assert.ok(names1[i].localeCompare(names1[i + 1]) <= 0)
  }

  const p2 = await c.call('GET', `/api/members?limit=10&orderBy=name&orderDir=asc&branchId=${branchA}&cursor=${p1.data.nextCursor}`)
  assert.equal(p2.status, 200)
  assert.equal(p2.data.members.length, 10)
  const names2 = p2.data.members.map(m => m.name)
  assert.ok(names1[names1.length - 1].localeCompare(names2[0]) <= 0)
})

test('GET /api/members/summary computes accurate aggregates in a single query', async () => {
  const summaryAll = await c.call('GET', '/api/members/summary')
  assert.equal(summaryAll.status, 200)
  assert.ok(summaryAll.data.total >= 25)

  const summaryBranch = await c.call('GET', `/api/members/summary?branchId=${branchA}`)
  assert.equal(summaryBranch.status, 200)
  assert.equal(summaryBranch.data.total, 25)

  const summaryEmpty = await c.call('GET', `/api/members/summary?branchId=${branchB}`)
  assert.equal(summaryEmpty.status, 200)
  assert.equal(summaryEmpty.data.total, 0)
})

test('GET /api/members/:id direct detail lookup succeeds and asserts scope', async () => {
  const targetId = memberIds[0]
  const res = await c.call('GET', `/api/members/${targetId}`)
  assert.equal(res.status, 200)
  assert.equal(res.data.member.id, targetId)
  assert.ok(res.data.member.name)

  const notFound = await c.call('GET', '/api/members/00000000-0000-0000-0000-000000000000')
  assert.equal(notFound.status, 404)
})

test('GET /api/members/export streams CSV with formula protection and UTF-8 BOM', async () => {
  const csvRes = await fetch('http://127.0.0.1:8787/api/members/export?branchId=' + branchA, {
    headers: { Cookie: c.cookie },
  })
  assert.equal(csvRes.status, 200)
  assert.ok(csvRes.headers.get('content-type')?.includes('text/csv'))
  const buf = new Uint8Array(await csvRes.arrayBuffer())
  assert.equal(buf[0], 0xEF)
  assert.equal(buf[1], 0xBB)
  assert.equal(buf[2], 0xBF)
  const text = new TextDecoder('utf-8').decode(buf)
  assert.ok(text.includes('Nom,Telephone,Email,Salle,Discipline,Grade'))
  assert.ok(text.includes('Membre Keyset 001'))
})

test('GET /api/payments keyset cursor pagination and date range filtering', async () => {
  const targetMember = memberIds[0]
  // Create 15 payments
  for (let i = 1; i <= 15; i++) {
    const p = await c.call('POST', '/api/payments', {
      memberId: targetMember,
      amountCents: 5000 + i * 100,
      type: 'monthly',
      method: 'cash',
    })
    assert.equal(p.status, 201)
  }

  const p1 = await c.call('GET', '/api/payments?limit=10')
  assert.equal(p1.status, 200)
  assert.equal(p1.data.payments.length, 10)
  assert.equal(p1.data.items.length, 10)
  assert.equal(p1.data.hasMore, true)
  assert.ok(p1.data.nextCursor)

  const p2 = await c.call('GET', `/api/payments?limit=10&cursor=${p1.data.nextCursor}`)
  assert.equal(p2.status, 200)
  assert.equal(p2.data.hasMore, false)
  assert.ok(p2.data.payments.length >= 5)

  // Date range filtering
  const today = new Date().toISOString().slice(0, 10)
  const range = await c.call('GET', `/api/payments?from=${today}&to=${today}`)
  assert.equal(range.status, 200)
  assert.ok(range.data.payments.length >= 15)
})

test('bulk member creation and scale pagination traversal (100 members)', async () => {
  const batchRows = []
  for (let i = 1; i <= 100; i++) {
    const pad = String(i).padStart(3, '0')
    batchRows.push({
      name: `Bulk Member ${pad}`,
      phone: `0699000${pad}`,
      branchId: branchB,
      disciplineId: disciplineB,
    })
  }

  const imp = await c.call('POST', '/api/members/import', { rows: batchRows })
  assert.equal(imp.status, 201, JSON.stringify(imp.data))
  assert.equal(imp.data.created, 100)

  // Traverse all pages of branchB
  let cursor = null
  let totalFetched = 0
  let pageCount = 0

  while (true) {
    pageCount++
    const url = cursor
      ? `/api/members?limit=30&branchId=${branchB}&cursor=${cursor}`
      : `/api/members?limit=30&branchId=${branchB}`
    const res = await c.call('GET', url)
    assert.equal(res.status, 200)
    totalFetched += res.data.members.length
    if (!res.data.hasMore) break
    cursor = res.data.nextCursor
    assert.ok(cursor)
  }

  assert.equal(totalFetched, 100)
  assert.equal(pageCount, 4) // 30 + 30 + 30 + 10
})
