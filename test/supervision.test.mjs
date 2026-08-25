// Supervision : qui est connecte, ou, et ce qui cloche.
//
// L'interet de la page est de mettre les sessions de la plateforme et celles
// des clubs cote a cote : une connexion suspecte sur un club se repere par
// comparaison, pas en ouvrant trente ecrans.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/supervision.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, createOperator, uniq, waitReady } from './helpers.mjs'

let operator, clubOwner, clubEmail, clubId, ownerName

before(async () => {
  await waitReady()

  const c = uniq()
  clubEmail = `sup-club-${c}@example.ma`
  ownerName = `Proprio ${c}`
  clubOwner = client()
  const created = await clubOwner.call('POST', '/api/auth/signup', {
    clubName: `Club Supervise ${c}`, slug: `supervise-${c}`,
    name: ownerName, email: clubEmail, password: 'motdepasse-solide-sup',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  clubId = created.data.orgId
  const branch = await clubOwner.call('POST', '/api/branches', {
    name: 'Salle cartographiée', lat: 33.5731, lng: -7.5898, label: 'Casablanca',
  })
  assert.equal(branch.status, 201, JSON.stringify(branch.data))

  const o = uniq()
  const opEmail = `sup-ops-${o}@example.ma`
  createOperator(opEmail, 'Ops Supervision', 'motdepasse-solide-ops')
  await waitReady()

  operator = client()
  const login = await operator.call('POST', '/api/auth/login', {
    email: opEmail, password: 'motdepasse-solide-ops',
  })
  assert.equal(login.status, 200, JSON.stringify(login.data))
  assert.equal((await operator.call('POST', '/api/admin/step-up', {
    password: 'motdepasse-solide-ops',
  })).status, 200)
})

test('la supervision est reservee a la plateforme', async () => {
  const res = await clubOwner.call('GET', '/api/admin/supervision')
  assert.equal(res.status, 403)
})

test('les sessions plateforme et club apparaissent sur le meme ecran', async () => {
  const res = await operator.call('GET', '/api/admin/supervision')
  assert.equal(res.status, 200, JSON.stringify(res.data))

  const sessions = res.data.sessions
  assert.ok(sessions.some(s => s.is_platform_admin === 1), 'la session de l exploitant doit figurer')

  const club = sessions.find(s => s.user_name === ownerName)
  assert.ok(club, 'la session du club doit figurer')
  assert.equal(club.is_platform_admin, 0)
  // Le nom du club permet de reperer d'ou vient la connexion.
  assert.match(club.org_name, /Club Supervise/)
})

test('la branche placée par le club apparaît sur la carte Superadmin', async () => {
  const res = await operator.call('GET', '/api/admin/supervision')
  assert.equal(res.status, 200, JSON.stringify(res.data))
  const branch = res.data.clubs.find(item => item.org_id === clubId && item.branch_name === 'Salle cartographiée')
  assert.ok(branch, 'la branche localisée doit figurer dans la supervision')
  assert.equal(branch.lat, 33.5731)
  assert.equal(branch.lng, -7.5898)
  assert.equal(branch.label, 'Casablanca')
})

test('une rafale d echecs leve une alerte nommant le compte vise', async () => {
  const attacker = client()
  for (let i = 0; i < 6; i++) {
    await attacker.call('POST', '/api/auth/login', { email: clubEmail, password: 'mauvais-mot-de-passe' })
  }

  const res = await operator.call('GET', '/api/admin/supervision')
  const burst = res.data.events.find(e => e.type === 'failed_burst' && e.detail === clubEmail)
  assert.ok(burst, `aucune alerte de rafale pour ${clubEmail}`)

  const grouped = res.data.failedAttempts.find(a => a.identifier === clubEmail)
  assert.ok(grouped, 'les echecs groupes doivent apparaitre')
  assert.ok(grouped.failures >= 5, `attendu >= 5 echecs, recu ${grouped.failures}`)
})

test('une alerte peut etre marquee comme traitee', async () => {
  const before = await operator.call('GET', '/api/admin/supervision')
  const open = before.data.events.find(e => !e.handled_at)
  assert.ok(open, 'au moins une alerte ouverte attendue')

  assert.equal((await operator.call('POST', `/api/admin/events/${open.id}/handled`)).status, 200)

  const after = await operator.call('GET', '/api/admin/supervision')
  const same = after.data.events.find(e => e.id === open.id)
  assert.ok(same.handled_at, 'l alerte doit etre marquee traitee')
})

test('la plateforme peut couper les sessions d un compte', async () => {
  const sessions = (await operator.call('GET', '/api/admin/supervision')).data.sessions
  const target = sessions.find(s => s.user_name === ownerName)
  assert.ok(target)

  assert.equal((await operator.call('DELETE', `/api/admin/users/${target.user_id}/sessions`)).status, 200)

  // La session du club est reellement invalidee, pas seulement masquee.
  assert.equal((await clubOwner.call('GET', '/api/me')).status, 401)

  const after = (await operator.call('GET', '/api/admin/supervision')).data.sessions
  assert.equal(after.some(s => s.user_name === ownerName), false)
})

test('un club ne peut pas couper les sessions d un autre compte', async () => {
  const fresh = client()
  const c = uniq()
  await fresh.call('POST', '/api/auth/signup', {
    clubName: `Club Curieux ${c}`, slug: `curieux-${c}`,
    name: 'Curieux', email: `curieux-${c}@example.ma`, password: 'motdepasse-solide-cur',
  })
  const me = await fresh.call('GET', '/api/me')
  const res = await fresh.call('DELETE', `/api/admin/users/${me.data.user.id}/sessions`)
  assert.equal(res.status, 403)
})
