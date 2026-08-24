import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, control, createOperator, uniq, waitReady } from './helpers.mjs'

let ops, ops2, club, otherClub, orgId, orgSlug, otherOrgId, otherOrgSlug
const password = 'motdepasse-solide-batch3'

function rows(sql) {
  return JSON.parse(control(sql))[0].results
}

before(async () => {
  await waitReady()

  const suffix = uniq()
  const operatorEmail = `batch3-ops-${suffix}@example.ma`
  createOperator(operatorEmail, 'Ops Batch 3', password)
  await waitReady()

  ops = client()
  assert.equal((await ops.call('POST', '/api/auth/login', { email: operatorEmail, password })).status, 200)
  assert.equal((await ops.call('POST', '/api/admin/step-up', { password })).status, 200)

  const operator2Email = `batch3-ops2-${suffix}@example.ma`
  createOperator(operator2Email, 'Ops 2 Batch 3', password)
  await waitReady()
  ops2 = client()
  assert.equal((await ops2.call('POST', '/api/auth/login', { email: operator2Email, password })).status, 200)
  assert.equal((await ops2.call('POST', '/api/admin/step-up', { password })).status, 200)

  club = client()
  orgSlug = `batch3-club-${suffix}`
  const made = await club.call('POST', '/api/auth/signup', {
    clubName: 'Club Batch 3', slug: orgSlug,
    name: 'Owner Batch 3', email: `batch3-owner-${suffix}@example.ma`, password,
  })
  assert.equal(made.status, 201)
  orgId = made.data.orgId

  otherClub = client()
  otherOrgSlug = `batch3-other-${suffix}`
  const otherMade = await otherClub.call('POST', '/api/auth/signup', {
    clubName: 'Other Club Batch 3', slug: otherOrgSlug,
    name: 'Other Owner 3', email: `batch3-other-${suffix}@example.ma`, password,
  })
  assert.equal(otherMade.status, 201)
  otherOrgId = otherMade.data.orgId
})

test('H-02: non-admin and non-stepped-up admins cannot trigger organization deletion', async () => {
  const unauthOps = client()
  const res1 = await unauthOps.call('DELETE', `/api/admin/clubs/${orgId}`, { slug: orgSlug })
  assert.ok([401, 403].includes(res1.status))

  const res2 = await club.call('DELETE', `/api/admin/clubs/${orgId}`, { slug: orgSlug })
  assert.equal(res2.status, 403)

  // Incorrect slug fails with 400
  const res3 = await ops.call('DELETE', `/api/admin/clubs/${orgId}`, { slug: 'wrong-slug' })
  assert.equal(res3.status, 400)
  assert.match(res3.data.error, /Pour confirmer, saisissez exactement/)
})

test('H-02: foreign-org support context cannot mutate or delete another club', async () => {
  const suffix = uniq()
  const supportOps = client()
  const opEmail = `batch3-sup-${suffix}@example.ma`
  createOperator(opEmail, 'Ops Support', password)
  await waitReady()
  await supportOps.call('POST', '/api/auth/login', { email: opEmail, password })
  await supportOps.call('POST', `/api/admin/clubs/${orgId}/support`)

  // In support mode for orgId, attempting to delete otherOrgId is rejected
  const deleteOther = await supportOps.call('DELETE', `/api/admin/clubs/${otherOrgId}`, { slug: otherOrgSlug })
  assert.equal(deleteOther.status, 403)
})

test('H-02 & M-04: phased resumable deletion with failure injection at every phase', async () => {
  const suffix = uniq()
  const targetClub = client()
  const targetSlug = `batch3-target-${suffix}`
  const targetEmail = `batch3-target-${suffix}@example.ma`
  const targetMade = await targetClub.call('POST', '/api/auth/signup', {
    clubName: 'Target Deletion Club', slug: targetSlug,
    name: 'Target Owner', email: targetEmail, password,
  })
  assert.equal(targetMade.status, 201)
  const targetOrgId = targetMade.data.orgId

  // Add members and billing info to target club
  const memberRes = await targetClub.call('POST', '/api/members', { name: 'Member Target', phone: '0600000001' })
  assert.equal(memberRes.status, 201)
  const targetMemberId = memberRes.data.id

  await ops.call('PUT', `/api/admin/billing/${targetOrgId}`, { priceCents: 50_000, cycleMonths: 1 })

  // 1. Simulate failure after 'pending'
  const fail1 = await ops.call('DELETE', `/api/admin/clubs/${targetOrgId}`, {
    slug: targetSlug, failAfterPhase: 'pending',
  })
  assert.equal(fail1.status, 500)

  // Status check: job recorded, organization marked deleting
  const status1 = await ops.call('GET', `/api/admin/clubs/${targetOrgId}/deletion-status`)
  assert.equal(status1.status, 200)
  assert.equal(status1.data.job.phase, 'pending')
  assert.equal(status1.data.job.attempts, 1)
  assert.match(status1.data.job.last_error, /SIMULATED_FAILURE_AFTER_pending/)

  // 2. Simulate failure after 'access_revoked'
  const fail2 = await ops.call('DELETE', `/api/admin/clubs/${targetOrgId}`, {
    slug: targetSlug, failAfterPhase: 'access_revoked',
  })
  assert.equal(fail2.status, 500)

  const status2 = await ops.call('GET', `/api/admin/clubs/${targetOrgId}/deletion-status`)
  assert.equal(status2.status, 200)
  assert.equal(status2.data.job.phase, 'access_revoked')
  assert.equal(status2.data.job.attempts, 2)

  // Tenant access must now fail
  const memberFetch = await targetClub.call('GET', `/api/members/${targetMemberId}`)
  assert.equal(memberFetch.status, 401)

  // Support mode entry to deleting club must be blocked
  const supEntry = await ops.call('POST', `/api/admin/clubs/${targetOrgId}/support`)
  assert.equal(supEntry.status, 400)

  // 3. Simulate failure after 'do_destroyed'
  const fail3 = await ops.call('DELETE', `/api/admin/clubs/${targetOrgId}`, {
    slug: targetSlug, failAfterPhase: 'do_destroyed',
  })
  assert.equal(fail3.status, 500)
  const status3 = await ops.call('GET', `/api/admin/clubs/${targetOrgId}/deletion-status`)
  assert.equal(status3.status, 200)
  assert.equal(status3.data.job.phase, 'do_destroyed')

  // 4. Simulate failure after 'r2_cleaned'
  const fail4 = await ops.call('DELETE', `/api/admin/clubs/${targetOrgId}`, {
    slug: targetSlug, failAfterPhase: 'r2_cleaned',
  })
  assert.equal(fail4.status, 500)
  const status4 = await ops.call('GET', `/api/admin/clubs/${targetOrgId}/deletion-status`)
  assert.equal(status4.status, 200)
  assert.equal(status4.data.job.phase, 'r2_cleaned')

  // 5. Simulate failure after 'd1_cleaned'
  const fail5 = await ops.call('DELETE', `/api/admin/clubs/${targetOrgId}`, {
    slug: targetSlug, failAfterPhase: 'd1_cleaned',
  })
  assert.equal(fail5.status, 500)
  const status5 = await ops.call('GET', `/api/admin/clubs/${targetOrgId}/deletion-status`)
  assert.equal(status5.status, 200)
  assert.equal(status5.data.job.phase, 'd1_cleaned')

  // 6. Final resume to complete
  const finish = await ops.call('DELETE', `/api/admin/clubs/${targetOrgId}`, { slug: targetSlug })
  assert.equal(finish.status, 200)
  assert.equal(finish.data.ok, true)
  assert.equal(finish.data.phase, 'completed')

  // Verify job record completed
  const statusFinal = await ops.call('GET', `/api/admin/clubs/${targetOrgId}/deletion-status`)
  assert.equal(statusFinal.status, 200)
  assert.equal(statusFinal.data.job.phase, 'completed')
  assert.ok(statusFinal.data.job.completed_at)

  // Verify idempotent subsequent call
  const replayDel = await ops.call('DELETE', `/api/admin/clubs/${targetOrgId}`, { slug: targetSlug })
  assert.equal(replayDel.status, 200)
  assert.equal(replayDel.data.alreadyCompleted, true)

  // Verify org deleted from D1
  const orgCheck = rows(`SELECT 1 FROM organizations WHERE id = '${targetOrgId}'`)
  assert.equal(orgCheck.length, 0)

  // Verify orphaned user was purged
  const userCheck = rows(`SELECT 1 FROM users WHERE email_norm = '${targetEmail}'`)
  assert.equal(userCheck.length, 0)
})

test('M-04: orphan file reconciliation endpoint', async () => {
  const rec = await ops.call('POST', `/api/admin/clubs/${orgId}/reconcile-files`, { olderThanSeconds: 0 })
  assert.equal(rec.status, 200)
  assert.equal(rec.data.ok, true)
  assert.ok(Array.isArray(rec.data.deletedKeys))
})

test('L-04: privileged mutation audits are recorded for admin actions', async () => {
  // 1. Location set and delete
  const locSet = await ops.call('PUT', `/api/admin/clubs/${orgId}/location`, { lat: 33.5731, lng: -7.5898, label: 'Casablanca' })
  assert.equal(locSet.status, 200)

  const locDel = await ops.call('DELETE', `/api/admin/clubs/${orgId}/location`)
  assert.equal(locDel.status, 200)

  // 2. Bank details update
  const bankSet = await ops.call('PUT', '/api/admin/bank-details', { value: 'RIB: 007 780 0001234567890123 45' })
  assert.equal(bankSet.status, 200)

  // 3. Billing update
  const billSet = await ops.call('PUT', `/api/admin/billing/${orgId}`, { priceCents: 15_000, cycleMonths: 3 })
  assert.equal(billSet.status, 200)

  // 4. Invoice deletion and paid/unpaid audits
  const invRes = await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, {
    periodStart: '2026-09-01', periodEnd: '2026-11-30', amountCents: 15_000,
  })
  assert.equal(invRes.status, 201)
  const invoiceId = invRes.data.id

  const markPaid = await ops.call('POST', `/api/admin/invoices/${invoiceId}/paid`, {
    paidAt: '2026-09-02', method: 'virement',
  })
  assert.equal(markPaid.status, 200)

  const markUnpaid = await ops.call('DELETE', `/api/admin/invoices/${invoiceId}/paid`)
  assert.equal(markUnpaid.status, 200)

  const invDel = await ops.call('DELETE', `/api/admin/invoices/${invoiceId}`)
  assert.equal(invDel.status, 200)

  // Assert audits in D1 after all HTTP mutations
  const auditLocSet = rows(`SELECT 1 FROM platform_audit WHERE action = 'club_location_set' AND org_id = '${orgId}'`)
  assert.ok(auditLocSet.length >= 1)

  const auditLocDel = rows(`SELECT 1 FROM platform_audit WHERE action = 'club_location_delete' AND org_id = '${orgId}'`)
  assert.ok(auditLocDel.length >= 1)

  const auditBank = rows("SELECT 1 FROM platform_audit WHERE action = 'bank_details_update'")
  assert.ok(auditBank.length >= 1)

  const auditBill = rows(`SELECT 1 FROM platform_audit WHERE action = 'billing_update' AND org_id = '${orgId}'`)
  assert.ok(auditBill.length >= 1)

  const auditPaid = rows("SELECT 1 FROM platform_audit WHERE action = 'invoice_paid'")
  assert.ok(auditPaid.length >= 1)

  const auditUnpaid = rows("SELECT 1 FROM platform_audit WHERE action = 'invoice_unpaid'")
  assert.ok(auditUnpaid.length >= 1)

  const auditInvDel = rows(`SELECT 1 FROM platform_audit WHERE action = 'invoice_delete' AND org_id = '${orgId}'`)
  assert.ok(auditInvDel.length >= 1)
})
