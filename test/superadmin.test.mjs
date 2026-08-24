// Verifie l'autre moitie de l'exigence : le superadmin voit tous les clubs,
// et son acces a la base d'un club laisse une trace.
//
// Le statut superadmin ne s'obtient par aucune route : il se pose a la main
// dans la base centrale. C'est deliberé — aucune escalade de privilege n'est
// possible depuis l'application, quel que soit le bug.
//
//   npx wrangler dev --port 8787     (dans un autre terminal)
//   node --test test/superadmin.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, control, createOperator, uniq, waitReady } from './helpers.mjs'

let operator, clubOwner, clubId, opEmail

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)

  // Un club ordinaire, avec une donnee reconnaissable.
  const s = uniq()
  clubOwner = client()
  const created = await clubOwner.call('POST', '/api/auth/signup', {
    clubName: 'Club Observe', slug: `observe-${s}`, name: 'Owner Observe',
    email: `owner-${s}@example.ma`, password: 'motdepasse-solide-7',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  clubId = created.data.orgId
  await clubOwner.call('POST', '/api/members', { name: 'Membre Observe', phone: '0600000009' })

  // Un compte separe, promu exploitant de la plateforme hors application.
  const o = uniq()
  opEmail = `operateur-${o}@example.ma`
  operator = client()
  const op = await operator.call('POST', '/api/auth/signup', {
    clubName: 'Plateforme', slug: `plateforme-${o}`, name: 'Operateur',
    email: opEmail, password: 'motdepasse-solide-8',
  })
  assert.equal(op.status, 201, JSON.stringify(op.data))

  control(`UPDATE users SET is_platform_admin = 1 WHERE email_norm = '${opEmail}'`)
  await waitReady()

  // Nouvelle session : le statut est relu a chaque requete, mais on repart
  // proprement pour ne rien devoir a un cache.
  operator = client()
  const relogin = await operator.call('POST', '/api/auth/login', {
    email: opEmail, password: 'motdepasse-solide-8',
  })
  assert.equal(relogin.status, 200, JSON.stringify(relogin.data))
})

test('le superadmin voit tous les clubs', async () => {
  const res = await operator.call('GET', '/api/admin/clubs')
  assert.equal(res.status, 200, JSON.stringify(res.data))
  assert.ok(res.data.clubs.length >= 2, 'au moins deux clubs attendus')
  assert.ok(res.data.clubs.some(c => c.id === clubId), 'le club observe doit apparaitre')
})

test("le superadmin lit les stats d'un club dont il n'est pas membre", async () => {
  const res = await operator.call('GET', `/api/admin/clubs/${clubId}/stats`)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  assert.equal(res.data.orgId, clubId)
  assert.equal(res.data.stats.memberCount, 1)
})

test("l'ouverture de la base d'un club est tracee", async () => {
  const out = control(
    `SELECT COUNT(*) AS n FROM platform_audit
      WHERE action = 'read_club_stats' AND org_id = '${clubId}'`,
  )
  // On cherche un compteur non nul dans la sortie JSON de wrangler.
  assert.match(out, /"n":\s*[1-9]/, `aucune trace d'audit trouvee : ${out}`)
})

test('un exploitant sans club n en possede aucun et n en voit aucun ecran', async () => {
  // Un exploitant supervise la plateforme ; il ne gere pas de club. Lui en
  // attribuer un lui afficherait des ecrans vides et brouillerait la
  // distinction entre superviser et posseder.
  const o = uniq()
  const email = `pur-${o}@example.ma`
  createOperator(email, 'Exploitant Pur', 'motdepasse-solide-pur')
  await waitReady()

  const pure = client()
  const login = await pure.call('POST', '/api/auth/login', { email, password: 'motdepasse-solide-pur' })
  assert.equal(login.status, 200, JSON.stringify(login.data))
  assert.equal(login.data.orgId, null, 'un exploitant ne doit etre rattache a aucun club')

  const me = await pure.call('GET', '/api/me')
  assert.equal(me.data.isPlatformAdmin, true)
  assert.equal(me.data.org, null, 'aucune organisation')
  assert.equal(me.data.branding, null, 'aucune marque de club a afficher')

  // Il supervise bien la plateforme.
  assert.equal((await pure.call('GET', '/api/admin/clubs')).status, 200)

  // Mais les ecrans d'un club lui sont fermes : ils n'ont rien a ouvrir.
  for (const path of ['/api/members', '/api/branches', '/api/disciplines', '/api/dashboard/stats']) {
    const res = await pure.call('GET', path)
    assert.equal(res.status, 403, `${path} devrait etre refuse, recu ${res.status}`)
  }

  // Et il n'apparait pas comme un club dans sa propre liste.
  const overview = await pure.call('GET', '/api/admin/overview')
  assert.equal(
    overview.data.clubs.some(c => c.name === 'Exploitant Pur' || c.slug?.startsWith('pur-')),
    false,
    'un exploitant ne doit pas figurer parmi les clubs',
  )
})

test('le superadmin conserve son propre club, sans confusion de portee', async () => {
  const me = await operator.call('GET', '/api/me')
  assert.equal(me.status, 200)
  assert.equal(me.data.isPlatformAdmin, true)
  // Ses propres membres restent les siens : etre superadmin n'elargit pas
  // silencieusement la portee des routes ordinaires.
  const mine = await operator.call('GET', '/api/members')
  assert.equal(mine.status, 200)
  assert.equal(mine.data.members.length, 0)
})
