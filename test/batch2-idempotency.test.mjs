import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, control, controlFile, createOperator, uniq, waitReady } from './helpers.mjs'

let club, otherClub, viewer, staff, ops, ops2, orgId, otherOrgId, memberId, otherMemberId, invoiceId
const password = 'motdepasse-solide-batch2'
const key = label => `batch2-${label}-${crypto.randomUUID()}`
const idem = value => ({ 'Idempotency-Key': value })

function rows(sql) {
  return JSON.parse(control(sql))[0].results
}

before(async () => {
  await waitReady()
  const suffix = uniq()
  club = client()
  const made = await club.call('POST', '/api/auth/signup', {
    clubName: 'Batch 2 Finance', slug: `batch2-finance-${suffix}`,
    name: 'Owner Batch 2', email: `batch2-owner-${suffix}@example.ma`, password,
  })
  assert.equal(made.status, 201, JSON.stringify(made.data))
  orgId = made.data.orgId
  memberId = (await club.call('POST', '/api/members', {
    name: 'Membre Idempotent', phone: '0600990001',
  })).data.id

  otherClub = client()
  const other = await otherClub.call('POST', '/api/auth/signup', {
    clubName: 'Batch 2 Other', slug: `batch2-other-${suffix}`,
    name: 'Other Owner', email: `batch2-other-${suffix}@example.ma`, password,
  })
  otherOrgId = other.data.orgId
  const otherMember = await otherClub.call('POST', '/api/members', {
    name: 'Other Member', phone: '0600990002',
  })
  assert.equal(otherMember.status, 201, JSON.stringify(otherMember.data))
  otherMemberId = otherMember.data.id

  const viewerEmail = `batch2-viewer-${suffix}@example.ma`
  assert.equal((await club.call('POST', '/api/staff', {
    name: 'Viewer Batch 2', email: viewerEmail, password, role: 'viewer',
  })).status, 201)
  viewer = client()
  assert.equal((await viewer.call('POST', '/api/auth/login', { email: viewerEmail, password })).status, 200)
  const staffEmail = `batch2-staff-${suffix}@example.ma`
  assert.equal((await club.call('POST', '/api/staff', {
    name: 'Staff Batch 2', email: staffEmail, password, role: 'staff',
  })).status, 201)
  staff = client()
  assert.equal((await staff.call('POST', '/api/auth/login', { email: staffEmail, password })).status, 200)

  const operatorEmail = `batch2-ops-${suffix}@example.ma`
  createOperator(operatorEmail, 'Ops Batch 2', password)
  await waitReady()
  ops = client()
  assert.equal((await ops.call('POST', '/api/auth/login', { email: operatorEmail, password })).status, 200)
  assert.equal((await ops.call('POST', '/api/admin/step-up', { password })).status, 200)
  const operator2Email = `batch2-ops2-${suffix}@example.ma`
  createOperator(operator2Email, 'Ops 2 Batch 2', password)
  await waitReady()
  ops2 = client()
  assert.equal((await ops2.call('POST', '/api/auth/login', { email: operator2Email, password })).status, 200)
  assert.equal((await ops2.call('POST', '/api/admin/step-up', { password })).status, 200)
  assert.equal((await ops.call('PUT', `/api/admin/billing/${orgId}`, {
    priceCents: 12_000, cycleMonths: 1,
  })).status, 200)
})

test('identical payment and lost-response retry produce one mutation', async () => {
  const requestKey = key('payment')
  const body = { memberId, amountCents: 7_500, type: 'monthly', method: 'cash' }
  const first = await club.call('POST', '/api/payments', body, idem(requestKey))
  const retry = await club.call('POST', '/api/payments', body, idem(requestKey))
  assert.equal(first.status, 201)
  assert.deepEqual(retry, first)

  const list = await club.call('GET', '/api/payments')
  assert.equal(list.data.payments.filter(p => p.id === first.data.id).length, 1)

  const altered = await club.call('POST', '/api/payments', {
    ...body, amountCents: 7_501,
  }, idem(requestKey))
  assert.equal(altered.status, 409)

  const separate = await club.call('POST', '/api/payments', body, idem(key('payment-second')))
  assert.equal(separate.status, 201)
  assert.notEqual(separate.data.id, first.data.id)
})

test('same-key concurrent payments collapse, while actor and organization scopes stay distinct', async () => {
  const concurrentKey = key('payment-concurrent')
  const body = { memberId, amountCents: 3_300, type: 'other', method: 'cash' }
  const [a, b] = await Promise.all([
    club.call('POST', '/api/payments', body, idem(concurrentKey)),
    club.call('POST', '/api/payments', body, idem(concurrentKey)),
  ])
  assert.equal(a.status, 201); assert.deepEqual(b, a)
  const after = await club.call('GET', '/api/payments')
  assert.equal(after.data.payments.filter(p => p.id === a.data.id).length, 1)

  const shared = key('cross-scope')
  const sameOrgOwner = await club.call('POST', '/api/payments', body, idem(shared))
  const sameOrgStaff = await staff.call('POST', '/api/payments', body, idem(shared))
  const otherOrg = await otherClub.call('POST', '/api/payments', {
    memberId: otherMemberId, amountCents: 3_300, type: 'other', method: 'cash',
  }, idem(shared))
  assert.equal(sameOrgOwner.status, 201)
  assert.equal(sameOrgStaff.status, 201)
  assert.equal(otherOrg.status, 201)
  assert.equal(new Set([sameOrgOwner.data.id, sameOrgStaff.data.id, otherOrg.data.id]).size, 3)
})

test('renewal and insurance retries advance each expiry once', async () => {
  const renewalKey = key('renew')
  const firstRenew = await club.call('POST', `/api/members/${memberId}/renew`, {
    amountCents: 10_000,
  }, idem(renewalKey))
  const retryRenew = await club.call('POST', `/api/members/${memberId}/renew`, {
    amountCents: 10_000,
  }, idem(renewalKey))
  assert.equal(firstRenew.status, 200)
  assert.deepEqual(retryRenew, firstRenew)

  const nextRenew = await club.call('POST', `/api/members/${memberId}/renew`, {
    amountCents: 10_000,
  }, idem(key('renew-next')))
  assert.notEqual(nextRenew.data.subExpiry, firstRenew.data.subExpiry)

  const insuranceKey = key('insurance')
  const firstInsurance = await club.call('POST', `/api/members/${memberId}/insurance`, {
    months: 12, charge: true,
  }, idem(insuranceKey))
  const retryInsurance = await club.call('POST', `/api/members/${memberId}/insurance`, {
    months: 12, charge: true,
  }, idem(insuranceKey))
  assert.equal(firstInsurance.status, 200)
  assert.deepEqual(retryInsurance, firstInsurance)

  const nextInsurance = await club.call('POST', `/api/members/${memberId}/insurance`, {
    months: 12, charge: true,
  }, idem(key('insurance-next')))
  assert.notEqual(nextInsurance.data.insExpiry, firstInsurance.data.insExpiry)
})

test('same-key concurrent renewal advances expiry and ledger once', async () => {
  const before = await club.call('GET', '/api/payments')
  const beforeCount = before.data.payments.filter(p => p.member_id === memberId && p.type === 'monthly').length
  const requestKey = key('renew-concurrent')
  const [a, b] = await Promise.all([
    club.call('POST', `/api/members/${memberId}/renew`, { amountCents: 8_000 }, idem(requestKey)),
    club.call('POST', `/api/members/${memberId}/renew`, { amountCents: 8_000 }, idem(requestKey)),
  ])
  assert.equal(a.status, 200); assert.deepEqual(b, a)
  const after = await club.call('GET', '/api/payments')
  assert.equal(after.data.payments.filter(p => p.member_id === memberId && p.type === 'monthly').length,
    beforeCount + 1)
})

test('payment reversal returns its original result on replay without weakening uniqueness', async () => {
  const payment = await club.call('POST', '/api/payments', {
    memberId, amountCents: 6_200, type: 'other', method: 'cash',
  }, idem(key('reverse-source')))
  const requestKey = key('reverse')
  const intent = { kind: 'erreur', reason: 'Saisie dupliquee' }
  const first = await club.call('POST', `/api/payments/${payment.data.id}/reverse`, intent, idem(requestKey))
  const retry = await club.call('POST', `/api/payments/${payment.data.id}/reverse`, intent, idem(requestKey))
  assert.equal(first.status, 201); assert.deepEqual(retry, first)
  assert.equal((await club.call('POST', `/api/payments/${payment.data.id}/reverse`, {
    ...intent, reason: 'Intention modifiee',
  }, idem(requestKey))).status, 409)
  assert.equal((await club.call('POST', `/api/payments/${payment.data.id}/reverse`, intent,
    idem(key('reverse-other')))).status, 409)
  const list = await club.call('GET', '/api/payments')
  assert.equal(list.data.payments.filter(p => p.reverses_id === payment.data.id).length, 1)
})

test('an unauthorized actor cannot reuse another actor key or result', async () => {
  const sharedKey = key('actor-scope')
  const body = { memberId, amountCents: 4_000, type: 'other' }
  const accepted = await club.call('POST', '/api/payments', body, idem(sharedKey))
  assert.equal(accepted.status, 201)
  const refused = await viewer.call('POST', '/api/payments', body, idem(sharedKey))
  assert.equal(refused.status, 403)
  assert.notDeepEqual(refused.data, accepted.data)
})

test('manual invoice retry is stable and period uniqueness is enforced', async () => {
  const requestKey = key('invoice')
  const body = {
    periodStart: '2031-01-01', periodEnd: '2031-02-01',
    amountCents: 12_000, dueDate: '2031-01-01',
  }
  const first = await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, body, idem(requestKey))
  const retry = await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, body, idem(requestKey))
  assert.equal(first.status, 201, JSON.stringify(first.data))
  assert.deepEqual(retry, first)
  invoiceId = first.data.id

  assert.equal((await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, body,
    idem(key('same-period')))).status, 409)
  assert.equal(rows(`SELECT COUNT(*) AS n FROM org_invoices WHERE org_id = '${orgId}' AND period_start = '2031-01-01' AND period_end = '2031-02-01'`)[0].n, 1)
  await waitReady()

  const overlap = { ...body, periodStart: '2031-03-01', periodEnd: '2031-04-01' }
  const raced = await Promise.all([
    ops.call('POST', `/api/admin/billing/${orgId}/invoices`, overlap, idem(key('overlap-a'))),
    ops.call('POST', `/api/admin/billing/${orgId}/invoices`, overlap, idem(key('overlap-b'))),
  ])
  assert.deepEqual(raced.map(r => r.status).sort(), [201, 409])
})

test('manual invoice hashes effective defaults and rejects genuinely different intent', async () => {
  const requestKey = key('invoice-defaults')
  const omitted = { periodStart: '2031-05-01', periodEnd: '2031-06-01' }
  const first = await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, omitted, idem(requestKey))
  assert.equal(first.status, 201)
  const row = rows(`SELECT amount_cents, due_date, note FROM org_invoices WHERE id = '${first.data.id}'`)[0]
  await waitReady()
  const explicitEquivalent = {
    ...omitted, amountCents: row.amount_cents, dueDate: row.due_date, note: row.note,
  }
  assert.deepEqual(
    await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, explicitEquivalent, idem(requestKey)),
    first,
  )
  assert.equal((await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, {
    ...explicitEquivalent, amountCents: row.amount_cents + 1,
  }, idem(requestKey))).status, 409)
})

async function createRaceInvoice(start, end, label) {
  const made = await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, {
    periodStart: start, periodEnd: end, amountCents: 12_000, dueDate: start,
  }, idem(key(`race-invoice-${label}`)))
  control(`INSERT INTO org_invoice_proofs (invoice_id, org_id, reference) VALUES ('${made.data.id}', '${orgId}', '${label}')`)
  await waitReady()
  return made.data.id
}

async function raceProofAcceptAndPaid(invoice, reverseOrder) {
  const acceptKey = key('accept-paid-race')
  const paidKey = key('paid-accept-race')
  const accept = () => ops.call('POST', `/api/admin/proofs/${invoice}/accept`, {}, idem(acceptKey))
  const paid = () => ops2.call('POST', `/api/admin/invoices/${invoice}/paid`, {
    method: 'cash', paidAt: '2032-01-15',
  }, idem(paidKey))
  const results = reverseOrder ? await Promise.all([paid(), accept()]) : await Promise.all([accept(), paid()])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  const winnerWasPaid = (reverseOrder ? results[0] : results[1]).status === 200
  const replay = winnerWasPaid ? await paid() : await accept()
  assert.equal(replay.status, 200)
}

test('proof ACCEPT and manual PAID races have one winner and atomically update coverage', async () => {
  const first = await createRaceInvoice('2032-01-01', '2032-02-01', 'accept-first')
  await raceProofAcceptAndPaid(first, false)
  let state = rows(`SELECT i.paid_at, i.method, b.expires_at FROM org_invoices i JOIN org_billing b ON b.org_id = i.org_id WHERE i.id = '${first}'`)[0]
  assert.equal(state.expires_at, '2032-02-01')
  assert.ok(state.paid_at)
  await waitReady()

  const second = await createRaceInvoice('2032-02-02', '2032-03-02', 'paid-first')
  await raceProofAcceptAndPaid(second, true)
  state = rows(`SELECT i.paid_at, i.method, b.expires_at FROM org_invoices i JOIN org_billing b ON b.org_id = i.org_id WHERE i.id = '${second}'`)[0]
  assert.equal(state.expires_at, '2032-03-02')
  assert.ok(state.paid_at)
  await waitReady()
})

test('one-step paid SaaS renewal commits invoice, receipt, and coverage together', async () => {
  assert.equal((await ops.call('PUT', `/api/admin/billing/${otherOrgId}`, {
    priceCents: 9_000, cycleMonths: 1, expiresAt: '2030-01-01',
  })).status, 200)
  const requestKey = key('saas-renew-paid')
  const body = { markPaid: true, method: 'virement' }
  const first = await ops.call('POST', `/api/admin/billing/${otherOrgId}/renew`, body, idem(requestKey))
  const retry = await ops.call('POST', `/api/admin/billing/${otherOrgId}/renew`, body, idem(requestKey))
  assert.equal(first.status, 201); assert.deepEqual(retry, first)
  const state = rows(`SELECT i.paid_at, b.expires_at FROM org_invoices i JOIN org_billing b ON b.org_id = i.org_id WHERE i.id = '${first.data.id}'`)[0]
  assert.ok(state.paid_at)
  assert.equal(state.expires_at, first.data.periodEnd)
  await waitReady()
})

test('historical datetime periods collapse to one deterministic logical claim without deleting invoices', async () => {
  const oldId = `historical-old-${uniq()}`
  const newerId = `historical-new-${uniq()}`
  control(`INSERT INTO org_invoices (id, org_id, period_start, period_end, amount_cents, due_date, created_at) VALUES
    ('${oldId}', '${otherOrgId}', '2033-01-01T00:00:00Z', '2033-02-01T00:00:00Z', 9000, '2033-01-01', '2033-01-01T00:00:00Z'),
    ('${newerId}', '${otherOrgId}', '2033-01-01', '2033-02-01', 9500, '2033-01-01', '2033-01-02T00:00:00Z')`)
  controlFile('migrations/0003_batch2_1_financial_completion.sql')
  await waitReady()
  const invoices = rows(`SELECT COUNT(*) AS n FROM org_invoices WHERE id IN ('${oldId}','${newerId}')`)[0].n
  const claims = rows(`SELECT invoice_id, period_start, period_end FROM org_invoice_period_claims
    WHERE org_id = '${otherOrgId}' AND period_start = '2033-01-01' AND period_end = '2033-02-01'`)
  assert.equal(invoices, 2)
  assert.equal(claims.length, 1)
  assert.equal(claims[0].invoice_id, oldId)
  await waitReady()
  assert.equal((await ops.call('POST', `/api/admin/billing/${otherOrgId}/invoices`, {
    periodStart: '2033-01-01', periodEnd: '2033-02-01', amountCents: 9_000,
  }, idem(key('historical-collision')))).status, 409)
})

test('concurrent proof review has one winner and stale decision is rejected', async () => {
  control(`INSERT INTO org_invoice_proofs (invoice_id, org_id, reference) VALUES ('${invoiceId}', '${orgId}', 'batch2-proof')`)
  await waitReady()
  const [accept, reject] = await Promise.all([
    ops.call('POST', `/api/admin/proofs/${invoiceId}/accept`, {}, idem(key('proof-accept'))),
    ops.call('POST', `/api/admin/proofs/${invoiceId}/reject`, { reason: 'Concurrent' }, idem(key('proof-reject'))),
  ])
  assert.deepEqual([accept.status, reject.status].sort(), [200, 409])
  const proof = rows(`SELECT status FROM org_invoice_proofs WHERE invoice_id = '${invoiceId}'`)[0]
  assert.ok(['accepted', 'rejected'].includes(proof.status))
})

test('paid and unpaid transitions are conditional and idempotent', async () => {
  const current = rows(`SELECT paid_at FROM org_invoices WHERE id = '${invoiceId}'`)[0]
  await waitReady()
  if (current.paid_at) {
    assert.equal((await ops.call('DELETE', `/api/admin/invoices/${invoiceId}/paid`, undefined,
      idem(key('prepare-unpaid')))).status, 200)
  }
  const paidKey = key('paid')
  const first = await ops.call('POST', `/api/admin/invoices/${invoiceId}/paid`, {
    method: 'virement', paidAt: '2031-01-10',
  }, idem(paidKey))
  const retry = await ops.call('POST', `/api/admin/invoices/${invoiceId}/paid`, {
    method: 'virement', paidAt: '2031-01-10',
  }, idem(paidKey))
  assert.equal(first.status, 200)
  assert.deepEqual(retry, first)
  assert.equal((await ops.call('POST', `/api/admin/invoices/${invoiceId}/paid`, {
    method: 'cash', paidAt: '2031-01-11',
  }, idem(key('stale-paid')))).status, 409)

  const unpaidKey = key('unpaid')
  const unpaid = await ops.call('DELETE', `/api/admin/invoices/${invoiceId}/paid`, undefined, idem(unpaidKey))
  const unpaidRetry = await ops.call('DELETE', `/api/admin/invoices/${invoiceId}/paid`, undefined, idem(unpaidKey))
  assert.equal(unpaid.status, 200)
  assert.deepEqual(unpaidRetry, unpaid)
})

test('overlapping invoice cron runs issue one coverage-period invoice', async () => {
  const suffix = uniq()
  const cronClub = client()
  const made = await cronClub.call('POST', '/api/auth/signup', {
    clubName: 'Batch 2 Cron', slug: `batch2-cron-${suffix}`, name: 'Cron Owner',
    email: `batch2-cron-${suffix}@example.ma`, password,
  })
  const cronOrg = made.data.orgId
  const today = new Date().toISOString().slice(0, 10)
  assert.equal((await ops.call('PUT', `/api/admin/billing/${cronOrg}`, {
    priceCents: 9_000, cycleMonths: 1, startedAt: today, expiresAt: today,
  })).status, 200)
  // Miniflare's local scheduled-control endpoint crashes its own harness when
  // invoked concurrently. The production overlap invariant lives below that
  // adapter in the atomic period claim; replay the cron twice here, while the
  // concurrent claim race is exercised by the invoice tests above.
  await fetch(`${BASE}/cdn-cgi/local/scheduled`)
  await fetch(`${BASE}/cdn-cgi/local/scheduled`)
  const count = rows(`SELECT COUNT(*) AS n FROM org_invoices WHERE org_id = '${cronOrg}'`)[0].n
  assert.equal(count, 1)
})
