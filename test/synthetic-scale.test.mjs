import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, uniq } from './helpers.mjs'

let c, orgId, branchA, branchB, disciplineA, disciplineB

before(async () => {
  const u = uniq()
  c = client()
  const signup = await c.call('POST', '/api/auth/signup', {
    clubName: 'Club Synthetic Scale 1K', slug: `syn-${u}`, name: 'Synthetic Owner',
    email: `syn-${u}@example.ma`, password: 'motdepasse-solide-scale',
  })
  assert.equal(signup.status, 201, JSON.stringify(signup.data))
  orgId = signup.data.orgId

  branchA = (await c.call('POST', '/api/branches', { name: 'Salle Principale' })).data.id
  branchB = (await c.call('POST', '/api/branches', { name: 'Salle Secondaire' })).data.id
  disciplineA = (await c.call('POST', '/api/disciplines', { name: 'Judo' })).data.id
  disciplineB = (await c.call('POST', '/api/disciplines', { name: 'Boxe' })).data.id
})

test('synthetic scale: 1,000 members import, cursor walkthrough, search and summary aggregation', async () => {
  const BATCH_SIZE = 200
  const TOTAL_MEMBERS = 1000

  // Insert 1,000 members in 5 chunks of 200
  for (let b = 0; b < TOTAL_MEMBERS / BATCH_SIZE; b++) {
    const rows = []
    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = b * BATCH_SIZE + i + 1
      const pad = String(idx).padStart(4, '0')
      rows.push({
        name: `Athlete Synthetique ${pad}`,
        phone: `0655${pad}00`,
        email: `athlete.${pad}@club.example`,
        branchId: idx % 2 === 0 ? branchA : branchB,
        disciplineId: idx % 3 === 0 ? disciplineA : disciplineB,
        subExpiry: idx % 4 === 0 ? '2027-12-31' : idx % 4 === 1 ? '2026-08-30' : '2025-01-01',
        isInsured: idx % 2 === 0,
        insExpiry: idx % 2 === 0 ? '2027-12-31' : null,
      })
    }
    const imp = await c.call('POST', '/api/members/import', { rows })
    assert.equal(imp.status, 201, JSON.stringify(imp.data))
    assert.equal(imp.data.created, BATCH_SIZE)
  }

  // 1. Verify single-pass summary on 1,000 members
  const startSummary = performance.now()
  const summary = await c.call('GET', '/api/members/summary')
  const summaryTime = performance.now() - startSummary
  assert.equal(summary.status, 200)
  assert.equal(summary.data.total, 1000)
  assert.ok(summaryTime < 200, `Summary aggregation took ${summaryTime.toFixed(1)}ms (< 200ms)`)

  // 2. Full keyset cursor walkthrough of 1,000 members
  const startWalkthrough = performance.now()
  let cursor = null
  let totalRetrieved = 0
  let pages = 0

  while (true) {
    pages++
    const url = cursor ? `/api/members?limit=100&cursor=${cursor}` : '/api/members?limit=100'
    const res = await c.call('GET', url)
    assert.equal(res.status, 200)
    totalRetrieved += res.data.members.length
    if (!res.data.hasMore) break
    cursor = res.data.nextCursor
    assert.ok(cursor)
  }

  const walkTime = performance.now() - startWalkthrough
  assert.equal(totalRetrieved, 1000)
  assert.equal(pages, 10)
  assert.ok(walkTime < 1000, `Walkthrough of 10 pages (1,000 members) took ${walkTime.toFixed(1)}ms (< 1000ms)`)

  // 3. Search indexing test
  const startSearch = performance.now()
  const searchRes = await c.call('GET', '/api/members?q=Athlete%20Synthetique%200550')
  const searchTime = performance.now() - startSearch
  assert.equal(searchRes.status, 200)
  assert.equal(searchRes.data.members.length, 1)
  assert.equal(searchRes.data.members[0].name, 'Athlete Synthetique 0550')
  assert.ok(searchTime < 100, `Search query took ${searchTime.toFixed(1)}ms (< 100ms)`)

  // 4. Scoped branch query
  const branchSummary = await c.call('GET', `/api/members/summary?branchId=${branchA}`)
  assert.equal(branchSummary.status, 200)
  assert.equal(branchSummary.data.total, 500)
})
