import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, createOperator, uniq, waitReady } from './helpers.mjs'

let operator, secondSession, clubUser, orgA, orgB
const originalPassword = 'motdepasse-solide-batch11'
const newPassword = 'motdepasse-solide-batch11-new'

before(async () => {
  await waitReady()
  const a = uniq()
  clubUser = client()
  orgA = (await clubUser.call('POST', '/api/auth/signup', {
    clubName: 'Batch 11 A', slug: `batch11-a-${a}`, name: 'Club A',
    email: `batch11-a-${a}@example.ma`, password: 'motdepasse-solide-club',
  })).data.orgId
  const other = client()
  orgB = (await other.call('POST', '/api/auth/signup', {
    clubName: 'Batch 11 B', slug: `batch11-b-${a}`, name: 'Club B',
    email: `batch11-b-${a}@example.ma`, password: 'motdepasse-solide-club',
  })).data.orgId
  const email = `batch11-ops-${a}@example.ma`
  createOperator(email, 'Batch 11 Operator', originalPassword)
  await waitReady()
  operator = client()
  secondSession = client()
  assert.equal((await operator.call('POST', '/api/auth/login', { email, password: originalPassword })).status, 200)
  assert.equal((await secondSession.call('POST', '/api/auth/login', { email, password: originalPassword })).status, 200)
})

test('le step-up est propre a la session et interdit aux comptes club', async () => {
  assert.equal((await secondSession.call('PUT', '/api/admin/bank-details', { bankName: 'x' })).status, 403)
  assert.equal((await clubUser.call('POST', '/api/admin/step-up', { password: 'motdepasse-solide-club' })).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: 'incorrect' })).status, 401)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: originalPassword })).status, 200)
  assert.equal((await secondSession.call('PUT', '/api/admin/bank-details', { bankName: 'x' })).status, 403)
})

test('les routes plateforme ne contournent pas le support en lecture seule', async () => {
  const enter = await operator.call('POST', `/api/admin/clubs/${orgA}/support`)
  assert.equal(enter.status, 200)
  assert.equal(enter.data.canWrite, false)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/branches`, { name: 'Interdite' })).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/disciplines`, { name: 'Interdite' })).status, 403)
  assert.equal((await operator.call('PUT', `/api/admin/clubs/${orgA}/branding`, { name: 'Interdite' })).status, 403)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgB}/branches`, { name: 'Mauvais club' })).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgA}/branches`, { name: 'Autorisee' })).status, 201)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgB}/branches`, { name: 'Toujours interdite' })).status, 403)
})

test('changer de club support invalide le grant d ecriture precedent', async () => {
  const switched = await operator.call('POST', `/api/admin/clubs/${orgB}/support`)
  assert.equal(switched.status, 200)
  assert.equal(switched.data.canWrite, false)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgB}/branches`, { name: 'Ancien grant' })).status, 403)
  assert.equal((await operator.call('GET', '/api/messaging/participants')).status, 403)
})

test('le changement de mot de passe coupe step-up et support-write', async () => {
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  assert.equal((await operator.call('POST', '/api/account/password', {
    currentPassword: originalPassword, newPassword,
  })).status, 200)
  assert.equal((await operator.call('POST', `/api/admin/clubs/${orgB}/branches`, { name: 'Grant obsolete' })).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: originalPassword })).status, 401)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: newPassword })).status, 200)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
})

test('les echecs repetes de step-up sont limites par compte', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await operator.call('POST', '/api/admin/step-up', { password: `faux-${i}` })).status, 401)
  }
  const limited = await operator.call('POST', '/api/admin/step-up', { password: newPassword })
  assert.equal(limited.status, 429, JSON.stringify(limited.data))
})
