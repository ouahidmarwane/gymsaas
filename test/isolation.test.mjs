// Prouve que deux clubs ne peuvent pas se voir.
//
// C'est LE test qui justifie l'architecture : un Durable Object par club.
// Il doit rester vert à chaque évolution du routeur — une régression ici
// n'est pas un bug d'affichage, c'est une fuite de données entre clients.
//
//   npx wrangler dev --port 8787     (dans un autre terminal)
//   node --test test/isolation.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, uniq } from './helpers.mjs'

let clubA, clubB, aId, bId

before(async () => {
  const health = await client().call('GET', '/api/health')
  assert.equal(health.status, 200, `Worker injoignable sur ${BASE}`)

  clubA = client()
  clubB = client()

  const sa = uniq(), sb = uniq()
  const ra = await clubA.call('POST', '/api/auth/signup', {
    clubName: 'Club Alpha', slug: `alpha-${sa}`, name: 'Amine Alpha',
    email: `amine-${sa}@example.ma`, password: 'motdepasse-solide-1',
  })
  assert.equal(ra.status, 201, JSON.stringify(ra.data))
  aId = ra.data.orgId

  const rb = await clubB.call('POST', '/api/auth/signup', {
    clubName: 'Club Bravo', slug: `bravo-${sb}`, name: 'Bilal Bravo',
    email: `bilal-${sb}@example.ma`, password: 'motdepasse-solide-2',
  })
  assert.equal(rb.status, 201, JSON.stringify(rb.data))
  bId = rb.data.orgId

  assert.notEqual(aId, bId)
})

test('chaque club ne voit que ses propres membres', async () => {
  const a = await clubA.call('POST', '/api/members', { name: 'Alice Alaoui', phone: '0600000001' })
  assert.equal(a.status, 201, JSON.stringify(a.data))

  const b = await clubB.call('POST', '/api/members', { name: 'Brahim Bennani', phone: '0600000002' })
  assert.equal(b.status, 201, JSON.stringify(b.data))

  const listA = await clubA.call('GET', '/api/members')
  const namesA = listA.data.members.map(m => m.name)
  assert.deepEqual(namesA, ['Alice Alaoui'])

  const listB = await clubB.call('GET', '/api/members')
  const namesB = listB.data.members.map(m => m.name)
  assert.deepEqual(namesB, ['Brahim Bennani'])
})

test("la recherche ne franchit pas la frontière du club", async () => {
  const res = await clubA.call('GET', '/api/members?q=Brahim')
  assert.equal(res.status, 200)
  assert.equal(res.data.members.length, 0)
})

test("l'identifiant de club fourni par le client est ignoré", async () => {
  // Le club vient de la session ; aucun paramètre ne doit pouvoir le changer.
  const res = await clubA.call('GET', `/api/members?orgId=${bId}&org=${bId}`)
  assert.equal(res.status, 200)
  assert.deepEqual(res.data.members.map(m => m.name), ['Alice Alaoui'])
})

test('sans session, aucun accès', async () => {
  const anon = client()
  assert.equal((await anon.call('GET', '/api/members')).status, 401)
  assert.equal((await anon.call('GET', '/api/me')).status, 401)
  assert.equal((await anon.call('GET', '/api/admin/clubs')).status, 401)
})

test('la base centrale est invisible depuis un club', async () => {
  const res = await clubA.call('GET', '/api/admin/clubs')
  assert.equal(res.status, 403)
})

test('un propriétaire de club ne peut pas lire les stats d’un autre club', async () => {
  const res = await clubA.call('GET', `/api/admin/clubs/${bId}/stats`)
  assert.equal(res.status, 403)
})

test('la déconnexion invalide la session côté serveur', async () => {
  const tmp = client()
  const s = uniq()
  await tmp.call('POST', '/api/auth/signup', {
    clubName: 'Club Temp', slug: `temp-${s}`, name: 'Temp User',
    email: `temp-${s}@example.ma`, password: 'motdepasse-solide-3',
  })
  assert.equal((await tmp.call('GET', '/api/me')).status, 200)

  const stolen = tmp.cookie
  await tmp.call('POST', '/api/auth/logout')

  // Rejouer le cookie après déconnexion ne doit rien donner : la session est
  // supprimée en base, pas seulement effacée du navigateur.
  const replay = await fetch(BASE + '/api/me', { headers: { Cookie: stolen } })
  assert.equal(replay.status, 401)
})

test('un e-mail déjà pris est refusé', async () => {
  const s = uniq()
  const email = `dup-${s}@example.ma`
  const first = await client().call('POST', '/api/auth/signup', {
    clubName: 'Un', slug: `un-${s}`, name: 'Un', email, password: 'motdepasse-solide-4',
  })
  assert.equal(first.status, 201)

  const second = await client().call('POST', '/api/auth/signup', {
    clubName: 'Deux', slug: `deux-${s}`, name: 'Deux', email, password: 'motdepasse-solide-5',
  })
  assert.equal(second.status, 409)
})

test('un mot de passe faible est refusé', async () => {
  const s = uniq()
  const res = await client().call('POST', '/api/auth/signup', {
    clubName: 'Faible', slug: `faible-${s}`, name: 'Faible',
    email: `faible-${s}@example.ma`, password: 'court',
  })
  assert.equal(res.status, 400)
})

test('les tentatives de connexion sont limitées', async () => {
  const s = uniq()
  const email = `brute-${s}@example.ma`
  await client().call('POST', '/api/auth/signup', {
    clubName: 'Brute', slug: `brute-${s}`, name: 'Brute', email, password: 'motdepasse-solide-6',
  })

  // Deux plafonds distincts : un bas par adresse IP, un plus haut par compte.
  // Compter serre sur le compte offrait un deni de service — vingt requetes
  // suffisaient a verrouiller un proprietaire depuis n'importe ou. En local
  // CF-Connecting-IP est absent, donc c'est le plafond par compte qui joue.
  let throttled = false
  for (let i = 0; i < 25; i++) {
    const res = await client().call('POST', '/api/auth/login', { email, password: 'mauvais-mot-de-passe' })
    if (res.status === 429) { throttled = true; break }
    assert.equal(res.status, 401)
  }
  assert.ok(throttled, 'aucune limitation apres 25 echecs')
})

test('une connexion reussie efface les echecs precedents', async () => {
  const s = uniq()
  const email = `reset-${s}@example.ma`
  const password = 'motdepasse-solide-reset'
  const created = await client().call('POST', '/api/auth/signup', {
    clubName: 'Reset', slug: `reset-${s}`, name: 'Reset', email, password,
  })
  assert.equal(created.status, 201, `inscription refusee : ${JSON.stringify(created.data)}`)

  // Quelques echecs, puis une reussite : l'ardoise doit repartir a zero,
  // sinon de vieux echecs continueraient a compter contre un utilisateur
  // legitime jusqu'a le bloquer sans raison.
  for (let i = 0; i < 5; i++) {
    await client().call('POST', '/api/auth/login', { email, password: 'faux' })
  }
  assert.equal((await client().call('POST', '/api/auth/login', { email, password })).status, 200)

  for (let i = 0; i < 5; i++) {
    const res = await client().call('POST', '/api/auth/login', { email, password: 'faux' })
    assert.equal(res.status, 401, `bloque trop tot apres remise a zero (tentative ${i + 1})`)
  }
})
