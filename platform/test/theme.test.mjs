// Etancheite de l'habillage.
//
// Trois frontieres a tenir, et elles ne se valent pas :
//
//   1. Entre clubs — deux clients ne partagent pas leur identite visuelle.
//   2. Entre un club et la plateforme — l'exploitant qui sort d'un club ne
//      doit pas garder ses couleurs. C'est la frontiere que le mode support
//      existe pour rendre evidente ; la brouiller la rend inutile.
//   3. Dans le temps — visiter le club A puis le club B ne laisse rien de A.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/theme.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, createOperator, uniq, waitReady } from './helpers.mjs'

let clubA, clubB, idA, idB, ops

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)

  const made = []
  for (const ref of ['A', 'B']) {
    const s = uniq()
    const c = client()
    const res = await c.call('POST', '/api/auth/signup', {
      clubName: `Club Theme ${ref}`, slug: `theme-${ref.toLowerCase()}-${s}`, name: `Owner ${ref}`,
      email: `theme-${ref.toLowerCase()}-${s}@example.ma`, password: 'motdepasse-solide-t1',
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    made.push({ c, id: res.data.orgId })
  }
  clubA = made[0].c; idA = made[0].id
  clubB = made[1].c; idB = made[1].id

  const o = uniq()
  const email = `optheme-${o}@example.ma`
  createOperator(email, 'Ops Theme', 'motdepasse-solide-t2')
  await waitReady()
  ops = client()
  assert.equal((await ops.call('POST', '/api/auth/login', {
    email, password: 'motdepasse-solide-t2',
  })).status, 200)
})

test('changer l habillage d un club ne touche pas le voisin', async () => {
  const a = await clubA.call('PUT', '/api/branding', { theme: { accent: '#16a34a', skin: 'sport' } })
  assert.equal(a.status, 200, JSON.stringify(a.data))

  const b = await clubB.call('GET', '/api/branding')
  assert.equal(b.data.theme.skin, 'sombre', 'le club B doit garder son habillage')
  assert.notEqual(b.data.theme.accent, '#16a34a', 'la couleur du club A ne doit pas fuir')

  // Et l'inverse : B se met en tatami sans deranger A.
  await clubB.call('PUT', '/api/branding', { theme: { accent: '#b91c1c', skin: 'tatami' } })
  assert.equal((await clubA.call('GET', '/api/branding')).data.theme.skin, 'sport')
  assert.equal((await clubB.call('GET', '/api/branding')).data.theme.skin, 'tatami')
})

test('l exploitant sans club n herite d aucun habillage', async () => {
  // C'est ce que /api/me expose qui pilote la coquille. Sans club, il ne doit
  // rien y avoir a appliquer — la plateforme reprend son identite plutot que
  // de rester aux couleurs du dernier client visite.
  const me = await ops.call('GET', '/api/me')
  assert.equal(me.status, 200)
  assert.equal(me.data.org, null, 'l exploitant ne possede aucun club')
  assert.equal(me.data.branding, null, 'aucune marque de club a appliquer')
})

test('entrer dans un club donne son habillage, en sortir le retire', async () => {
  assert.equal((await ops.call('POST', `/api/admin/clubs/${idA}/support`)).status, 200)
  const inA = await ops.call('GET', '/api/me')
  assert.equal(inA.data.branding.theme.skin, 'sport', 'le support prend l habillage du club visite')

  assert.equal((await ops.call('DELETE', '/api/admin/support')).status, 200)
  const out = await ops.call('GET', '/api/me')
  assert.equal(out.data.branding, null, 'sortir du support rend la plateforme a elle-meme')
})

test('passer d un club a l autre ne laisse rien du precedent', async () => {
  await ops.call('POST', `/api/admin/clubs/${idA}/support`)
  assert.equal((await ops.call('GET', '/api/me')).data.branding.theme.skin, 'sport')
  await ops.call('DELETE', '/api/admin/support')

  await ops.call('POST', `/api/admin/clubs/${idB}/support`)
  const inB = await ops.call('GET', '/api/me')
  assert.equal(inB.data.branding.theme.skin, 'tatami', 'le club B garde le sien')
  assert.equal(inB.data.branding.theme.accent, '#b91c1c')
  await ops.call('DELETE', '/api/admin/support')
})

test('l habillage pose depuis le support appartient au club visite', async () => {
  await ops.call('POST', `/api/admin/clubs/${idB}/support`)
  const saved = await ops.call('PUT', '/api/branding', { theme: { accent: '#c2410c', skin: 'chaleureux' } })
  assert.equal(saved.status, 200)
  await ops.call('DELETE', '/api/admin/support')

  // Le club B l'a recu.
  assert.equal((await clubB.call('GET', '/api/branding')).data.theme.skin, 'chaleureux')
  // Le club A n'a pas bouge.
  assert.equal((await clubA.call('GET', '/api/branding')).data.theme.skin, 'sport')
  // La plateforme non plus.
  assert.equal((await ops.call('GET', '/api/me')).data.branding, null)
})

test('la vue d ensemble rend a chaque club sa propre couleur', async () => {
  // L'ecran Clubs peint une pastille par club : s'il lisait une couleur
  // partagee, trente clubs se ressembleraient.
  const res = await ops.call('GET', '/api/admin/overview')
  assert.equal(res.status, 200)
  const a = res.data.clubs.find(c => c.id === idA)
  const b = res.data.clubs.find(c => c.id === idB)
  assert.equal(a.theme.accent, '#16a34a')
  assert.equal(b.theme.accent, '#c2410c')
  assert.notEqual(a.theme.accent, b.theme.accent)
})
