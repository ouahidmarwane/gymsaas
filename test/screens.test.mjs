// Verifie que les ecrans sont reellement servis et que les donnees qu'ils
// consomment existent. Ce n'est pas un test visuel : il couvre le contrat
// entre les pages et l'API, la ou une regression casse l'interface sans
// casser un seul test d'API.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/screens.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BASE, client, control, page, uniq, waitReady } from './helpers.mjs'

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
  await waitReady()
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
    '/grades', '/comptabilite', '/staff', '/account', '/messagerie',
  ]
  for (const route of routes) {
    const res = await page(route)
    assert.equal(res.status, 200, `${route} a repondu ${res.status}`)
  }
})

test('l ecran de bienvenue est monte, et ne s affiche pas sans connexion', async () => {
  // Il vit dans la coquille racine, donc son code part sur toutes les pages.
  // Mais il ne rend RIEN tant qu'une connexion ne vient pas de reussir : le
  // marquage ne doit donc apparaitre dans aucun HTML servi.
  for (const route of ['/login', '/dashboard']) {
    const res = await page(route)
    assert.equal(res.status, 200)
    assert.ok(!res.html.includes('welcome-splash'),
      `${route} sert le splash alors que personne ne vient de se connecter`)
  }
})

test('le fond du splash suit le theme, il n est jamais ecrit en dur', async () => {
  // Le critere de recette : sur les cinq habillages, il doit se confondre
  // avec le fond de l'application. Une couleur figee ferait un flash a
  // chaque connexion sur un habillage clair.
  const css = await fetch(`${BASE}/login`).then(r => r.text())
  assert.ok(!/\.welcome-splash\s*\{[^}]*background(-color)?:\s*#/.test(css),
    'le splash porte une couleur de fond ecrite en dur')
})

test('un bouton desactive se voit, et son survol ne l anime pas', () => {
  // Le defaut se presente toujours comme « le bouton est casse ». « Ajouter »
  // une salle reste inerte tant que le champ est vide — c'est correct — mais
  // sans etat desactive il gardait sa couleur pleine, et :hover l'eclaircit
  // meme desactive : le bouton avait l'air vivant et ne repondait pas.
  //
  // Ces trois classes portent presque tous les boutons de l'application, donc
  // l'oubli valait partout a la fois.
  const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  for (const cls of ['btn-dark', 'btn-gold', 'btn-ghost']) {
    assert.match(css, new RegExp(`\\.${cls}:disabled`), `${cls} n a pas d etat desactive`)
    // Chaque :hover doit s'exclure lui-meme sur un bouton desactive.
    for (const m of css.matchAll(new RegExp(`\\.${cls}:hover([^{,]*)`, 'g'))) {
      assert.ok(m[1].includes(':not(:disabled)'),
        `un survol de .${cls} s applique encore a un bouton desactive`)
    }
  }
})

test('les gouttes du splash ne deforment jamais le mot', () => {
  // La regression a corriger, et elle etait visible a l'oeil : une lentille
  // promenait sur le mot une COPIE du texte deformee par un bruit fractal.
  // Les lettres vues au travers devenaient tremblees et l'ensemble se lisait
  // comme une ecriture d'enfant. Le mot doit rester net et aligne ; le verre
  // ne floute que son arriere-plan.
  const tsx = readFileSync(fileURLToPath(new URL('../components/WelcomeSplash.tsx', import.meta.url)), 'utf8')
  assert.ok(!tsx.includes('feDisplacementMap'),
    'aucun deplacement de pixels ne doit toucher le trace')
  assert.equal((tsx.match(/d=\{WORD\}/g) ?? []).length, 1,
    'une seule copie du mot : une seconde signifie une lentille posee dessus')
})

test('la pluie monte en decelerant et retombe en accelerant', () => {
  const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const block = name => {
    const m = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
    assert.ok(m, `@keyframes ${name} introuvable`)
    return m[1]
  }

  // Deux courbes DIFFERENTES, ecrites dans les images-cles. Une seule courbe
  // pour toute l'animation ne peut pas dire « decelere en montant » puis
  // « accelere en tombant » : le mouvement redevient un va-et-vient
  // mecanique, ce qui est exactement ce qu'on ne veut pas.
  const curves = [...block('welcomeDropArc').matchAll(/animation-timing-function:\s*([^;]+);/g)]
    .map(m => m[1].trim())
  assert.equal(curves.length, 2, 'la montee et la chute doivent porter chacune sa courbe')
  assert.notEqual(curves[0], curves[1], 'monter et tomber ne se font pas de la meme facon')

  // La pluie se mesure en fractions de la largeur du mot : en pixels fixes,
  // elle giclerait hors de l'ecran sur un telephone.
  assert.match(block('welcomeDropArc'), /var\(--stage-w\)/,
    'la trajectoire doit suivre la taille du mot')

  // Les trois couches d'une meme goutte partagent duree et retard. Si elles
  // divergent, la peau s'efface pendant que la bulle est encore en l'air.
  const drop = css.match(/\.welcome-drop\s*\{([\s\S]*?)\n\}/)
  assert.ok(drop, '.welcome-drop introuvable')
  for (const frag of ['welcomeDropArc', 'welcomeDropGlass']) {
    assert.match(drop[1], new RegExp(`${frag}\\s+var\\(--dur\\)\\s+linear\\s+var\\(--lag\\)`),
      `${frag} n est pas cale sur la cadence de la goutte`)
  }
  const skin = css.match(/\.welcome-drop::after\s*\{([\s\S]*?)\n\}/)
  assert.match(skin[1], /welcomeDropFade\s+var\(--dur\)\s+linear\s+var\(--lag\)/,
    'la peau doit se fondre sur la meme cadence que la bulle')
})

test('l ecran des championnats a bien disparu', async () => {
  // Retire du produit : la clientele fait surtout de la musculation et
  // l'ecran restait vide. Ce test tient la porte fermee — une route morte
  // qui reviendrait par un copier-coller se verrait ici.
  assert.equal((await page('/championships')).status, 404)
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

test('un club neuf demarre sur l habillage d origine', async () => {
  const res = await owner.call('GET', '/api/branding')
  assert.equal(res.data.theme.skin, 'sombre',
    'sans choix, un club doit ressembler a l application, pas a une variante')
})

test('les cinq habillages sont acceptes et relus', async () => {
  for (const skin of ['clair', 'chaleureux', 'sport', 'tatami', 'sombre']) {
    const saved = await owner.call('PUT', '/api/branding', { theme: { accent: '#2f6bff', skin } })
    assert.equal(saved.status, 200, `${skin} refuse : ${JSON.stringify(saved.data)}`)
    assert.equal(saved.data.theme.skin, skin)
    assert.equal((await owner.call('GET', '/api/branding')).data.theme.skin, skin)
  }
})

test('un habillage inconnu est refuse', async () => {
  // La valeur finit en attribut du document. Une chaine libre s'y
  // retrouverait telle quelle dans le HTML.
  for (const skin of ['neon', '', 'sombre"><script>', 42]) {
    const res = await owner.call('PUT', '/api/branding', { theme: { accent: '#2f6bff', skin } })
    assert.equal(res.status, 400, `accepte a tort : ${JSON.stringify(skin)}`)
  }
  // Et l'habillage precedent n'a pas bouge.
  assert.equal((await owner.call('GET', '/api/branding')).data.theme.skin, 'sombre')
})

test('entrer dans un club puis en sortir depuis l interface', async () => {
  const enter = await operator.call('POST', `/api/admin/clubs/${clubId}/support`)
  assert.equal(enter.status, 200)

  // La banniere de support lit ces champs : leur absence la rendrait muette.
  const me = await operator.call('GET', '/api/me')
  assert.equal(me.data.scope.mode, 'support')
  assert.equal(me.data.scope.canWrite, false)
  assert.ok(me.data.branding?.name, 'la banniere doit pouvoir nommer le club')

  // La disposition du club est modifiable depuis le support.
  const layout = await operator.call('GET', '/api/layout/dashboard')
  assert.equal(layout.status, 200)
  assert.equal((await operator.call('PUT', '/api/layout/dashboard', { layout: layout.data.layout })).status, 403)
  assert.equal((await operator.call('POST', '/api/admin/step-up', { password: 'motdepasse-solide-e2' })).status, 200)
  assert.equal((await operator.call('POST', '/api/admin/support/write')).status, 200)
  const saved = await operator.call('PUT', '/api/layout/dashboard', { layout: layout.data.layout })
  assert.equal(saved.status, 200, 'le support doit pouvoir enregistrer la disposition')

  assert.equal((await operator.call('DELETE', '/api/admin/support')).status, 200)
})
