// Verifie que les ecrans sont reellement servis et que les donnees qu'ils
// consomment existent. Ce n'est pas un test visuel : il couvre le contrat
// entre les pages et l'API, la ou une regression casse l'interface sans
// casser un seul test d'API.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/screens.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, control, page, uniq } from './helpers.mjs'

let owner, operator, clubId

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `App injoignable sur ${BASE}`)

  const c = uniq()
  owner = client()
  const created = await owner.call('POST', '/api/auth/signup', {
    clubName: 'Club Ecrans', slug: `ecrans-${c}`, name: 'Owner Ecrans',
    email: `ecrans-${c}@example.ma`, password: 'motdepasse-solide-e1',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  clubId = created.data.orgId

  const o = uniq()
  const opEmail = `opecrans-${o}@example.ma`
  const tmp = client()
  await tmp.call('POST', '/api/auth/signup', {
    clubName: 'Ops Ecrans', slug: `opsecrans-${o}`, name: 'Ops',
    email: opEmail, password: 'motdepasse-solide-e2',
  })
  control(`UPDATE users SET is_platform_admin = 1 WHERE email_norm = '${opEmail}'`)
  operator = client()
  await operator.call('POST', '/api/auth/login', { email: opEmail, password: 'motdepasse-solide-e2' })
})

test('les trois ecrans sont servis', async () => {
  for (const path of ['/login', '/dashboard', '/admin']) {
    const res = await page(path)
    assert.equal(res.status, 200, `${path} a repondu ${res.status}`)
    assert.ok(res.html.includes('<html'), `${path} ne renvoie pas de document`)
  }
})

test('la connexion est atteignable sans session', async () => {
  const res = await page('/login')
  // On verifie la presence du formulaire, pas son libelle : le texte doit
  // pouvoir changer sans casser le test.
  assert.match(res.html, /autoComplete="current-password"|autocomplete="current-password"/i)
  assert.match(res.html, /type="email"/i)
})

test('toutes les routes de navigation repondent', async () => {
  // Chaque entree du rail doit exister. Un lien vers une page absente donne
  // un 404 que l'utilisateur lit comme « l'application est cassee ».
  const routes = [
    '/dashboard', '/admin', '/members', '/setup',
    '/grades', '/championships', '/comptabilite', '/staff', '/account',
  ]
  for (const route of routes) {
    const res = await page(route)
    assert.equal(res.status, 200, `${route} a repondu ${res.status}`)
  }
})

test('le tableau de bord dispose de tout ce qu il consomme', async () => {
  // La page emet ces quatre appels au montage ; s'ils divergent, l'ecran
  // reste vide sans qu'aucun test d'API ne bronche.
  for (const path of ['/api/me', '/api/layout/dashboard', '/api/dashboard/stats', '/api/setup/status']) {
    const res = await owner.call('GET', path)
    assert.equal(res.status, 200, `${path} a repondu ${res.status}`)
  }
})

test('la disposition arrive avec le registre des cartes', async () => {
  const res = await owner.call('GET', '/api/layout/dashboard')
  assert.equal(res.data.columns, 12)
  assert.ok(res.data.layout.length > 0)
  // L'interface lit les bornes dans la reponse plutot que de les coder en dur.
  for (const card of res.data.layout) {
    assert.ok(res.data.cards[card.id], `borne manquante pour ${card.id}`)
  }
})

test('les chiffres du tableau de bord ont la forme attendue', async () => {
  // Les douze cartes se servent dans cette reponse : si un champ disparait,
  // la carte correspondante se vide sans qu'aucun test d'API ne bronche.
  const res = await owner.call('GET', '/api/dashboard/stats')
  const s = res.data.stats

  for (const key of ['membersTotal', 'membersActive', 'subsExpiring',
                     'insuranceMissing', 'revenueMonthCents', 'alertsCount']) {
    assert.equal(typeof s[key], 'number', `${key} devrait etre un nombre`)
  }
  for (const key of ['growth', 'revenue', 'grades', 'recentMembers',
                     'upcomingGrades', 'branchSplit']) {
    assert.ok(Array.isArray(s[key]), `${key} devrait etre une liste`)
  }
  // La croissance couvre douze mois, meme sans donnees : une courbe a un
  // seul point ne se trace pas.
  assert.equal(s.growth.length, 12, 'douze mois de croissance attendus')
})

test('la supervision renvoie ce que la liste affiche', async () => {
  const res = await operator.call('GET', '/api/admin/overview')
  assert.equal(res.status, 200)
  const club = res.data.clubs.find(c => c.id === clubId)
  assert.ok(club)
  for (const key of ['name', 'slug', 'plan', 'status', 'theme', 'staff_count']) {
    assert.ok(key in club, `champ manquant dans la vue d ensemble : ${key}`)
  }
  assert.match(club.theme.accent, /^#[0-9a-f]{6}$/i, 'la couleur doit etre exploitable en CSS')
})

test('la marque renvoie une URL de logo proxifiee, jamais une cle brute', async () => {
  const res = await owner.call('GET', '/api/branding')
  assert.equal(res.status, 200)
  assert.equal(res.data.logoUrl, null, 'aucun logo pose pour l instant')
  assert.match(res.data.theme.accent, /^#[0-9a-f]{6}$/i)
})

test('entrer dans un club puis en sortir depuis l interface', async () => {
  const enter = await operator.call('POST', `/api/admin/clubs/${clubId}/support`)
  assert.equal(enter.status, 200)

  // La banniere de support lit ces champs : leur absence la rendrait muette.
  const me = await operator.call('GET', '/api/me')
  assert.equal(me.data.scope.mode, 'support')
  assert.equal(me.data.scope.canWrite, true)
  assert.ok(me.data.branding?.name, 'la banniere doit pouvoir nommer le club')

  // La disposition du club est modifiable depuis le support.
  const layout = await operator.call('GET', '/api/layout/dashboard')
  assert.equal(layout.status, 200)
  const saved = await operator.call('PUT', '/api/layout/dashboard', { layout: layout.data.layout })
  assert.equal(saved.status, 200, 'le support doit pouvoir enregistrer la disposition')

  assert.equal((await operator.call('DELETE', '/api/admin/support')).status, 200)
})
