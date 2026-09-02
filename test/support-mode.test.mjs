// Mode support : entrer dans le tableau de bord d'un club a distance, en
// securite.
//
// Les garanties verifiees ici sont celles qui distinguent un outil de support
// d'une porte derobee : lecture seule par defaut, ecriture explicite et
// tracee, sortie propre, expiration, et impossibilite pour un club d'y
// acceder.
//
//   npx wrangler dev --port 8787     (dans un autre terminal)
//   node --test test/support-mode.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, control, uniq, waitReady } from './helpers.mjs'

let operator, owner, clubId, memberName

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)

  const c = uniq()
  memberName = `Membre ${c}`
  owner = client()
  const created = await owner.call('POST', '/api/auth/signup', {
    clubName: 'Club Support', slug: `support-${c}`, name: 'Owner Support',
    email: `owner-${c}@example.ma`, password: 'motdepasse-solide-s1',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  clubId = created.data.orgId
  await owner.call('POST', '/api/branches', { name: 'Salle Unique' })
  await owner.call('POST', '/api/members', { name: memberName, phone: '0655555555' })

  const o = uniq()
  const opEmail = `sup-${o}@example.ma`
  const tmp = client()
  await tmp.call('POST', '/api/auth/signup', {
    clubName: 'Ops Support', slug: `ops-sup-${o}`, name: 'Ops Support',
    email: opEmail, password: 'motdepasse-solide-s2',
  })
  control(`UPDATE users SET is_platform_admin = 1 WHERE email_norm = '${opEmail}'`)
  operator = client()
  await operator.call('POST', '/api/auth/login', { email: opEmail, password: 'motdepasse-solide-s2' })
})

test('la vue d ensemble liste les clubs avec leur marque', async () => {
  const res = await operator.call('GET', '/api/admin/overview')
  assert.equal(res.status, 200, JSON.stringify(res.data))
  const club = res.data.clubs.find(c => c.id === clubId)
  assert.ok(club, 'le club doit apparaitre dans la vue d ensemble')
  assert.equal(club.theme.accent, '#2f6bff', 'un theme par defaut est renvoye')
  assert.ok(res.data.serverTime)
})

test('avant d entrer, la plateforme ne voit pas les membres du club', async () => {
  const res = await operator.call('GET', '/api/members')
  assert.equal(res.status, 200)
  // Ses propres membres, pas ceux du club observe.
  assert.equal(res.data.members.some(m => m.name === memberName), false)
})

test('entrer dans un club commence toujours en lecture seule', async () => {
  const enter = await operator.call('POST', `/api/admin/clubs/${clubId}/support`)
  assert.equal(enter.status, 200, JSON.stringify(enter.data))
  assert.equal(enter.data.mode, 'support')
  assert.equal(enter.data.canWrite, false)

  // Les memes routes servent desormais le club visite.
  const members = await operator.call('GET', '/api/members')
  assert.equal(members.status, 200)
  assert.deepEqual(members.data.members.map(m => m.name), [memberName])

  const branches = await operator.call('GET', '/api/branches')
  assert.deepEqual(branches.data.branches.map(b => b.name), ['Salle Unique'])
})

test('le support ne peut ecrire qu apres reauthentification explicite', async () => {
  const refused = await operator.call('POST', '/api/branches', { name: 'Salle Refusee' })
  assert.equal(refused.status, 403)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: 'incorrect' })).status, 401)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: 'motdepasse-solide-s2' })).status, 200)
  const elevated = await operator.call('POST', '/api/admin/support/write')
  assert.equal(elevated.status, 200)
  const writeTtl = Date.parse(elevated.data.expiresAt) - Date.now()
  assert.ok(writeTtl > 0 && writeTtl <= 5 * 60_000,
    `support write elevation must retain its five-minute TTL, got ${writeTtl}ms`)
  const branch = await operator.call('POST', '/api/branches', { name: 'Salle Ajoutee Par Support' })
  assert.equal(branch.status, 201, JSON.stringify(branch.data))

  // Le club voit la nouvelle salle : le support a bien agi sur SA base.
  const seen = await owner.call('GET', '/api/branches')
  assert.ok(seen.data.branches.some(b => b.name === 'Salle Ajoutee Par Support'))
})

test('/api/me signale clairement le mode support', async () => {
  const me = await operator.call('GET', '/api/me')
  assert.equal(me.data.scope.mode, 'support')
  assert.equal(me.data.scope.orgId, clubId)
  assert.equal(me.data.scope.canWrite, true)
  // L'identite ne change pas : on n'usurpe pas le proprietaire.
  assert.notEqual(me.data.user.id, undefined)
  assert.equal(me.data.isPlatformAdmin, true)
})

test('le mode support ne peut pas publier dans le canal annonces', async () => {
  const publish = await operator.call('POST', '/api/messaging/announcements', {
    title: 'Interdit depuis support', content: 'Cette annonce ne doit pas exister', status: 'published',
  })
  assert.equal(publish.status, 403)
})

test('le droit d ecriture expire sans fermer la session de support', async () => {
  control("UPDATE support_write_grants SET expires_at = '2000-01-01T00:00:00Z'")
  await waitReady()
  const me = await operator.call('GET', '/api/me')
  assert.equal(me.status, 200)
  assert.equal(me.data.scope.mode, 'support')
  assert.equal(me.data.scope.canWrite, false)
  assert.equal((await operator.call('POST', '/api/branches', { name: 'Salle Apres Expiration' })).status, 403)
  // Le grant de reauthentification est encore court et valide ; seule
  // l autorisation d ecriture support a expire ici.
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
})

test('le step-up expire et doit etre renouvele pour une operation privilegiee', async () => {
  assert.equal((await operator.call('POST', '/api/admin/support/read-only')).status, 200)
  control("UPDATE privileged_grants SET expires_at = '2000-01-01T00:00:00Z'")
  await waitReady()
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: 'motdepasse-solide-s2' })).status, 200)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
})

test('l observation en lecture seule reste possible et bloque les ecritures', async () => {
  assert.equal((await operator.call('POST', '/api/admin/support/read-only')).status, 200)
  assert.equal((await operator.call('GET', '/api/me')).data.scope.canWrite, false)

  const refused = await operator.call('POST', '/api/branches', { name: 'Salle Fantome' })
  assert.equal(refused.status, 403, JSON.stringify(refused.data))

  const check = await owner.call('GET', '/api/branches')
  assert.equal(check.data.branches.some(b => b.name === 'Salle Fantome'), false)

  // Retour en ecriture pour la suite du scenario.
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
})

test('le support modifie la marque du club', async () => {
  const res = await operator.call('PUT', '/api/branding', {
    name: 'Club Support Renomme',
    theme: { accent: '#b3242b', mode: 'dark' },
  })
  assert.equal(res.status, 200, JSON.stringify(res.data))
  assert.equal(res.data.name, 'Club Support Renomme')
  assert.equal(res.data.theme.accent, '#b3242b')

  // Le club voit sa nouvelle marque.
  const asOwner = await owner.call('GET', '/api/branding')
  assert.equal(asOwner.data.name, 'Club Support Renomme')
  assert.equal(asOwner.data.theme.mode, 'dark')
})

test('une couleur non hexadecimale est rejetee', async () => {
  const res = await operator.call('PUT', '/api/branding', {
    theme: { accent: 'red; background:url(//evil)', mode: 'dark' },
  })
  assert.equal(res.status, 400, JSON.stringify(res.data))
})

test('le club voit la trace de l intervention', async () => {
  const log = await owner.call('GET', '/api/support-log')
  assert.equal(log.status, 200)
  const actions = log.data.entries.map(e => e.action)
  assert.ok(actions.includes('support_enter'), 'l entree doit etre tracee')
  assert.ok(actions.includes('support_write_enabled'), 'l escalade doit etre tracee')
  assert.ok(actions.includes('support_write_branding'), 'la modification doit etre tracee')
})

test('sortir du mode support rend sa portee normale', async () => {
  const out = await operator.call('DELETE', '/api/admin/support')
  assert.equal(out.status, 200)
  assert.equal(out.data.mode, 'member')

  const me = await operator.call('GET', '/api/me')
  assert.equal(me.data.scope.mode, 'member')

  const members = await operator.call('GET', '/api/members')
  assert.equal(members.data.members.some(m => m.name === memberName), false)
})

test('un club ne peut pas entrer dans un autre club', async () => {
  const res = await owner.call('POST', `/api/admin/clubs/${clubId}/support`)
  assert.equal(res.status, 403)
})

test('perdre le statut plateforme coupe le mode support immediatement', async () => {
  const o = uniq()
  const email = `revoke-${o}@example.ma`
  const tmp = client()
  await tmp.call('POST', '/api/auth/signup', {
    clubName: 'Ops Revoke', slug: `ops-rev-${o}`, name: 'Ops Revoke',
    email, password: 'motdepasse-solide-s3',
  })
  control(`UPDATE users SET is_platform_admin = 1 WHERE email_norm = '${email}'`)

  const op = client()
  await op.call('POST', '/api/auth/login', { email, password: 'motdepasse-solide-s3' })
  assert.equal((await op.call('POST', `/api/admin/clubs/${clubId}/support`)).status, 200)
  assert.equal((await op.call('GET', '/api/me')).data.scope.mode, 'support')

  // Retrait du statut : la portee de support tombe sans nettoyer la session.
  control(`UPDATE users SET is_platform_admin = 0 WHERE email_norm = '${email}'`)

  const me = await op.call('GET', '/api/me')
  assert.equal(me.data.scope.mode, 'member', 'le mode support doit cesser')
  assert.equal((await op.call('GET', `/api/admin/clubs/${clubId}/stats`)).status, 403)
})
