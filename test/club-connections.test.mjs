import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, uniq, waitReady } from './helpers.mjs'

let owner, admin, staff, outsider
let ownerEmail, adminEmail, staffEmail, outsiderEmail

before(async () => {
  await waitReady()
  const suffix = uniq()
  ownerEmail = `connections-owner-${suffix}@example.ma`
  adminEmail = `connections-admin-${suffix}@example.ma`
  staffEmail = `connections-staff-${suffix}@example.ma`
  outsiderEmail = `connections-outside-${suffix}@example.ma`

  owner = client()
  const signup = await owner.call('POST', '/api/auth/signup', {
    clubName: `Club Connexions ${suffix}`,
    slug: `club-connections-${suffix}`,
    name: 'Owner Connexions',
    email: ownerEmail,
    password: 'motdepasse-solide-owner',
  }, { 'CF-Connecting-IP': '203.0.113.10', 'User-Agent': 'GymFlow-Test-Owner' })
  assert.equal(signup.status, 201, JSON.stringify(signup.data))

  assert.equal((await owner.call('POST', '/api/staff', {
    name: 'Admin Connexions', email: adminEmail,
    password: 'motdepasse-solide-admin', role: 'admin',
  })).status, 201)
  assert.equal((await owner.call('POST', '/api/staff', {
    name: 'Reception Connexions', email: staffEmail,
    password: 'motdepasse-solide-staff', role: 'staff',
  })).status, 201)

  admin = client()
  assert.equal((await admin.call('POST', '/api/auth/login', {
    email: adminEmail, password: 'motdepasse-solide-admin',
  }, { 'CF-Connecting-IP': '203.0.113.20', 'User-Agent': 'Mozilla/5.0 Chrome/140 Windows' })).status, 200)

  staff = client()
  assert.equal((await staff.call('POST', '/api/auth/login', {
    email: staffEmail, password: 'motdepasse-solide-staff',
  }, { 'CF-Connecting-IP': '203.0.113.30', 'User-Agent': 'Mozilla/5.0 Mobile Safari/18' })).status, 200)

  outsider = client()
  assert.equal((await outsider.call('POST', '/api/auth/signup', {
    clubName: `Club Exterieur ${suffix}`,
    slug: `club-outside-${suffix}`,
    name: 'Owner Exterieur',
    email: outsiderEmail,
    password: 'motdepasse-solide-outside',
  }, { 'CF-Connecting-IP': '198.51.100.40' })).status, 201)
})

test('le proprietaire et l administrateur voient uniquement les connexions de leur club', async () => {
  for (const responsible of [owner, admin]) {
    const response = await responsible.call('GET', '/api/club/connections')
    assert.equal(response.status, 200, JSON.stringify(response.data))
    const emails = response.data.connections.map(row => row.email)
    assert.ok(emails.includes(ownerEmail))
    assert.ok(emails.includes(adminEmail))
    assert.ok(emails.includes(staffEmail))
    assert.equal(emails.includes(outsiderEmail), false, 'une connexion d un autre club ne doit jamais apparaitre')
  }
})

test('l adresse IP, l appareil, les dates et la session courante sont exposes sans jeton brut', async () => {
  const response = await admin.call('GET', '/api/club/connections')
  const own = response.data.connections.find(row => row.email === adminEmail)
  assert.ok(own)
  assert.equal(own.ip, '203.0.113.20')
  assert.match(own.user_agent, /Chrome/)
  assert.ok(Date.parse(own.connected_at) > 0)
  assert.ok(Date.parse(own.last_seen_at) >= Date.parse(own.connected_at))
  assert.equal(own.session_active, 1)
  assert.equal(own.is_current, 1)
  assert.equal('token' in own, false)
})

test('la reception et la lecture seule ne peuvent pas ouvrir la supervision', async () => {
  assert.equal((await staff.call('GET', '/api/club/connections')).status, 403)
})

test('une connexion terminee reste dans l historique du club', async () => {
  assert.equal((await staff.call('POST', '/api/auth/logout')).status, 200)
  const response = await admin.call('GET', '/api/club/connections')
  const ended = response.data.connections.find(row => row.email === staffEmail)
  assert.ok(ended)
  assert.equal(ended.session_active, 0)
  assert.ok(ended.disconnected_at)
})

test('un autre proprietaire ne voit que son propre club', async () => {
  const response = await outsider.call('GET', '/api/club/connections')
  assert.equal(response.status, 200)
  const emails = response.data.connections.map(row => row.email)
  assert.ok(emails.includes(outsiderEmail))
  assert.equal(emails.includes(ownerEmail), false)
})
