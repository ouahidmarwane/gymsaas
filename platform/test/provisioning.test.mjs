// Repond a la question : peut-on ajouter un club en production, avec ses
// sports et ses salles, sans rien affecter des clubs existants ?
//
// Le test etablit un club X complet, en releve l'etat exact, provisionne un
// club Y depuis le tableau de bord plateforme avec une configuration
// totalement differente, puis verifie que X est identique octet pour octet.
//
//   npx wrangler dev --port 8787     (dans un autre terminal)
//   node --test test/provisioning.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, control, uniq } from './helpers.mjs'

// Deux clubs volontairement dissemblables : rien dans le schema ne privilegie
// un sport ni un nombre de salles.
const KARATE_BELTS = [
  { label: 'Blanche', color: '#e5e7eb' }, { label: 'Jaune', color: '#facc15' },
  { label: 'Orange', color: '#fb923c' },  { label: 'Verte', color: '#22c55e' },
  { label: 'Bleue', color: '#3b82f6' },   { label: 'Marron', color: '#92400e' },
  { label: 'Noire', color: '#111111' },
]
const JUDO_KYU = [
  { label: '6e kyu' }, { label: '5e kyu' }, { label: '4e kyu' },
  { label: '3e kyu' }, { label: '2e kyu' }, { label: '1er kyu' }, { label: '1er dan' },
]

let operator, clubX, xId, yId, xSnapshot

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)

  // Club X : deux salles, deux sports, un membre.
  const x = uniq()
  clubX = client()
  const created = await clubX.call('POST', '/api/auth/signup', {
    clubName: 'Club X', slug: `club-x-${x}`, name: 'Owner X',
    email: `ownerx-${x}@example.ma`, password: 'motdepasse-solide-x',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  xId = created.data.orgId

  await clubX.call('POST', '/api/branches', { name: 'Salle Centre' })
  await clubX.call('POST', '/api/branches', { name: 'Salle Nord' })
  await clubX.call('POST', '/api/disciplines', { name: 'Karate', grades: KARATE_BELTS })
  await clubX.call('POST', '/api/disciplines', { name: 'Aerobic', hasGrading: false })
  await clubX.call('POST', '/api/members', { name: 'Membre X', phone: '0611111111' })

  // Un exploitant de plateforme.
  const o = uniq()
  const opEmail = `op-${o}@example.ma`
  const op = client()
  await op.call('POST', '/api/auth/signup', {
    clubName: 'Plateforme Ops', slug: `ops-${o}`, name: 'Ops',
    email: opEmail, password: 'motdepasse-solide-op',
  })
  control(`UPDATE users SET is_platform_admin = 1 WHERE email_norm = '${opEmail}'`)
  operator = client()
  await operator.call('POST', '/api/auth/login', { email: opEmail, password: 'motdepasse-solide-op' })
})

test('un club neuf ne presuppose aucun sport ni aucune salle', async () => {
  const s = uniq()
  const fresh = client()
  await fresh.call('POST', '/api/auth/signup', {
    clubName: 'Club Vierge', slug: `vierge-${s}`, name: 'Vierge',
    email: `vierge-${s}@example.ma`, password: 'motdepasse-solide-v',
  })

  assert.deepEqual((await fresh.call('GET', '/api/branches')).data.branches, [])
  assert.deepEqual((await fresh.call('GET', '/api/disciplines')).data.disciplines, [])
  assert.equal((await fresh.call('GET', '/api/setup/status')).data.configured, false)
})

test('club X est configure comme il le souhaite', async () => {
  const branches = (await clubX.call('GET', '/api/branches')).data.branches
  assert.deepEqual(branches.map(b => b.name).sort(), ['Salle Centre', 'Salle Nord'])

  const disciplines = (await clubX.call('GET', '/api/disciplines')).data.disciplines
  const karate = disciplines.find(d => d.name === 'Karate')
  assert.equal(karate.grades.length, 7)
  assert.equal(karate.grades[0].label, 'Blanche')
  assert.equal(disciplines.find(d => d.name === 'Aerobic').grades.length, 0)

  // Empreinte de reference, relevee AVANT la creation du club Y.
  xSnapshot = JSON.stringify({
    branches: branches.map(b => [b.id, b.name]),
    disciplines: disciplines.map(d => [d.id, d.name, d.grades.map(g => g.label)]),
    members: (await clubX.call('GET', '/api/members')).data.members.map(m => [m.id, m.name]),
  })
})

test('la plateforme provisionne le club Y en production', async () => {
  const y = uniq()
  const res = await operator.call('POST', '/api/admin/clubs', {
    clubName: 'Club Y', slug: `club-y-${y}`,
    ownerName: 'Owner Y', ownerEmail: `ownery-${y}@example.ma`,
    ownerPassword: 'motdepasse-solide-y', plan: 'club',
  })
  assert.equal(res.status, 201, JSON.stringify(res.data))
  yId = res.data.orgId
  assert.equal(res.data.configured, false)
  assert.notEqual(yId, xId)
})

test('la plateforme equipe le club Y de ses propres sports et salles', async () => {
  await operator.call('POST', `/api/admin/clubs/${yId}/branches`, { name: 'Dojo Unique' })
  await operator.call('POST', `/api/admin/clubs/${yId}/disciplines`, { name: 'Judo', grades: JUDO_KYU })
  await operator.call('POST', `/api/admin/clubs/${yId}/disciplines`, { name: 'Boxe', hasGrading: false })

  const branches = (await operator.call('GET', `/api/admin/clubs/${yId}/branches`)).data.branches
  assert.deepEqual(branches.map(b => b.name), ['Dojo Unique'])

  const disciplines = (await operator.call('GET', `/api/admin/clubs/${yId}/disciplines`)).data.disciplines
  assert.deepEqual(disciplines.map(d => d.name).sort(), ['Boxe', 'Judo'])
  assert.equal(disciplines.find(d => d.name === 'Judo').grades.length, 7)
  assert.equal(disciplines.find(d => d.name === 'Judo').grades[6].label, '1er dan')
  assert.equal(disciplines.find(d => d.name === 'Boxe').grades.length, 0)
})

test('le club X est rigoureusement inchange', async () => {
  const branches = (await clubX.call('GET', '/api/branches')).data.branches
  const disciplines = (await clubX.call('GET', '/api/disciplines')).data.disciplines
  const after = JSON.stringify({
    branches: branches.map(b => [b.id, b.name]),
    disciplines: disciplines.map(d => [d.id, d.name, d.grades.map(g => g.label)]),
    members: (await clubX.call('GET', '/api/members')).data.members.map(m => [m.id, m.name]),
  })

  assert.equal(after, xSnapshot, 'la creation du club Y a modifie le club X')

  // Et rien du club Y n'a filtre.
  assert.equal(disciplines.some(d => d.name === 'Judo' || d.name === 'Boxe'), false)
  assert.equal(branches.some(b => b.name === 'Dojo Unique'), false)
})

test('les deux clubs coexistent avec des echelles de grades differentes', async () => {
  const xKarate = (await operator.call('GET', `/api/admin/clubs/${xId}/disciplines`))
    .data.disciplines.find(d => d.name === 'Karate')
  const yJudo = (await operator.call('GET', `/api/admin/clubs/${yId}/disciplines`))
    .data.disciplines.find(d => d.name === 'Judo')

  assert.equal(xKarate.grades[0].label, 'Blanche')
  assert.equal(yJudo.grades[0].label, '6e kyu')
  // Meme rang, libelles differents : l'echelle appartient au club, pas au
  // schema de la plateforme.
  assert.equal(xKarate.grades[0].rank, yJudo.grades[0].rank)
})

test("un club ne peut pas configurer un autre club", async () => {
  const res = await clubX.call('POST', `/api/admin/clubs/${yId}/branches`, { name: 'Intrusion' })
  assert.equal(res.status, 403)

  const still = (await operator.call('GET', `/api/admin/clubs/${yId}/branches`)).data.branches
  assert.deepEqual(still.map(b => b.name), ['Dojo Unique'])
})
