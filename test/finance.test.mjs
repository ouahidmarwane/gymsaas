// Comptabilite previsionnelle : tarifs du club et estimations par salle.
//
// La page multiplie des effectifs par des tarifs. Les deux viennent du
// serveur, donc deux choses doivent tenir : les effectifs se reconcilient
// (la somme des salles vaut le global, la somme des mois vaut l'annee), et
// les tarifs d'un club restent invisibles aux autres.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/finance.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, uniq } from './helpers.mjs'

let clubA, clubB, branchA1, branchA2
const YEAR = new Date().getFullYear()

/** Une date de ce mois-ci, jamais dans le futur. */
const day = n => `${YEAR}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)

  const s = uniq()
  clubA = client()
  const created = await clubA.call('POST', '/api/auth/signup', {
    clubName: 'Club Compta', slug: `compta-${s}`, name: 'Owner Compta',
    email: `compta-${s}@example.ma`, password: 'motdepasse-solide-c1',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))

  branchA1 = (await clubA.call('POST', '/api/branches', { name: 'Salle Nord' })).data.id
  branchA2 = (await clubA.call('POST', '/api/branches', { name: 'Salle Sud' })).data.id

  // Trois membres au nord dont deux assures, deux au sud dont un assure.
  const members = [
    { name: 'A Un', phone: '0600100001', branchId: branchA1, insured: true },
    { name: 'A Deux', phone: '0600100002', branchId: branchA1, insured: true },
    { name: 'A Trois', phone: '0600100003', branchId: branchA1, insured: false },
    { name: 'B Un', phone: '0600100004', branchId: branchA2, insured: true },
    { name: 'B Deux', phone: '0600100005', branchId: branchA2, insured: false },
  ]
  for (const [i, m] of members.entries()) {
    const res = await clubA.call('POST', '/api/members', {
      name: m.name, phone: m.phone, branchId: m.branchId,
      joinDate: day(i + 1), isInsured: m.insured,
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
  }

  const t = uniq()
  clubB = client()
  await clubB.call('POST', '/api/auth/signup', {
    clubName: 'Club Voisin', slug: `voisin-${t}`, name: 'Owner Voisin',
    email: `voisin-${t}@example.ma`, password: 'motdepasse-solide-c2',
  })
})

test('un club neuf recoit des tarifs par defaut exploitables', async () => {
  const res = await clubA.call('GET', '/api/finance')
  assert.equal(res.status, 200, JSON.stringify(res.data))
  // La page multiplie ces valeurs : un null afficherait « NaN DH ».
  for (const key of ['monthlyCents', 'insuranceCents', 'registrationCents']) {
    assert.equal(typeof res.data.prices[key], 'number', `${key} devrait etre un nombre`)
    assert.ok(res.data.prices[key] >= 0)
  }
})

test('les effectifs se reconcilient entre le global et les salles', async () => {
  const all = await clubA.call('GET', '/api/finance')
  assert.equal(all.data.scope.total, 5)
  assert.equal(all.data.scope.insured, 3)

  let total = 0, insured = 0
  for (const b of all.data.branches) {
    const one = await clubA.call('GET', `/api/finance?branchId=${encodeURIComponent(b.id)}`)
    total += one.data.scope.total
    insured += one.data.scope.insured
  }
  // Si une salle etait comptee deux fois, ou un membre sans salle oublie, le
  // total affiche ne correspondrait a aucune somme de ses parties.
  assert.equal(total, all.data.scope.total, 'la somme des salles doit valoir le global')
  assert.equal(insured, all.data.scope.insured)
})

test('la somme des mois vaut l annee', async () => {
  const year = await clubA.call('GET', `/api/finance?year=${YEAR}`)
  let sum = 0
  for (let m = 0; m < 12; m++) {
    const one = await clubA.call('GET', `/api/finance?year=${YEAR}&month=${m}`)
    sum += one.data.scope.registrations
  }
  assert.equal(sum, year.data.scope.registrations)
  assert.equal(year.data.byMonth.length, 12, 'douze mois attendus, meme vides')
})

test('le filtre par salle porte aussi sur le graphique', async () => {
  const nord = await clubA.call('GET', `/api/finance?branchId=${branchA1}&year=${YEAR}`)
  const counted = nord.data.byMonth.reduce(
    (sum, b) => sum + Object.values(b.counts).reduce((a, c) => a + c, 0), 0,
  )
  // Trois inscriptions au nord : si le filtre ne s'appliquait qu'aux
  // totaux, les barres continueraient d'afficher les cinq membres.
  assert.equal(counted, 3)
})

test('les annees proposees couvrent les donnees, pas une fenetre arbitraire', async () => {
  const res = await clubA.call('GET', '/api/finance')
  assert.ok(res.data.years.includes(YEAR))
  assert.ok(res.data.years.every(Number.isFinite))
})

test('la periode porte sur l effectif, pas seulement sur les inscriptions', async () => {
  // C'etait le vrai defaut : seul le KPI « inscriptions » repondait au
  // filtre, les trois autres restaient figes sur l'effectif du jour. Un
  // gerant qui choisit janvier voyait donc trois chiffres inchanges et
  // concluait, a raison, que le filtre ne marchait pas.
  const janvier = await clubA.call('GET', `/api/finance?year=${YEAR}&month=0`)
  const annee = await clubA.call('GET', `/api/finance?year=${YEAR}`)

  assert.ok(janvier.data.scope.total <= annee.data.scope.total,
    'l effectif de janvier ne peut pas depasser celui de l annee')

  // Le membre pose en janvier par le test precedent est le seul present a
  // cette date : les cinq autres ont adhere ce mois-ci.
  assert.ok(janvier.data.scope.total < annee.data.scope.total,
    'choisir un mois passe doit reduire l effectif retenu')
})

test('un mois choisi sans annee reste un mois', async () => {
  // Avec « toutes les annees », le mois etait silencieusement ignore et la
  // page renvoyait le total general.
  const sansAnnee = await clubA.call('GET', '/api/finance?month=0')
  const tout = await clubA.call('GET', '/api/finance')
  assert.ok(sansAnnee.data.scope.registrations < tout.data.scope.registrations,
    'le mois doit filtrer meme quand l annee est laissee libre')
  assert.equal(sansAnnee.data.month, 0, 'le mois retenu revient au client')
})

test('le mois revient au client pour la mise en avant du graphique', async () => {
  assert.equal((await clubA.call('GET', '/api/finance')).data.month, null)
  assert.equal((await clubA.call(`GET`, `/api/finance?year=${YEAR}&month=7`)).data.month, 7)
})

test('les tarifs se modifient et se relisent', async () => {
  const saved = await clubA.call('PUT', '/api/finance/prices', {
    monthlyCents: 12_500, insuranceCents: 6_000, registrationCents: 20_000,
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))

  const read = await clubA.call('GET', '/api/finance')
  assert.equal(read.data.prices.monthlyCents, 12_500)
  assert.equal(read.data.prices.registrationCents, 20_000)
})

test('un tarif absurde est refuse', async () => {
  for (const body of [
    { monthlyCents: -1, insuranceCents: 0, registrationCents: 0 },
    { monthlyCents: 'gratuit', insuranceCents: 0, registrationCents: 0 },
    { monthlyCents: 1e12, insuranceCents: 0, registrationCents: 0 },
    { insuranceCents: 0, registrationCents: 0 },
  ]) {
    const res = await clubA.call('PUT', '/api/finance/prices', body)
    assert.equal(res.status, 400, `accepte a tort : ${JSON.stringify(body)}`)
  }
})

test('les tarifs d un club ne fuient pas chez le voisin', async () => {
  // Le club A vient de passer a 12 500 ; B doit rester sur ses valeurs.
  const b = await clubB.call('GET', '/api/finance')
  assert.equal(b.status, 200)
  assert.notEqual(b.data.prices.monthlyCents, 12_500)
  assert.equal(b.data.scope.total, 0, 'le voisin n a aucun membre')
  assert.deepEqual(b.data.branches, [])
})

test('sans session, la comptabilite est fermee', async () => {
  const anon = client()
  assert.equal((await anon.call('GET', '/api/finance')).status, 401)
  assert.equal((await anon.call('PUT', '/api/finance/prices', {
    monthlyCents: 1, insuranceCents: 1, registrationCents: 1,
  })).status, 401)
})

test('une date d adhesion impossible est refusee', async () => {
  // Le format seul laisserait passer le 31 fevrier, et SQLite stockerait la
  // chaine telle quelle : strftime en tirerait un mois nul et le membre
  // disparaitrait du graphique sans erreur visible.
  for (const joinDate of ['2026-02-31', '2026-13-01', 'hier', '26-01-01']) {
    const res = await clubA.call('POST', '/api/members', {
      name: 'Date Douteuse', phone: '0600199999', joinDate,
    })
    assert.equal(res.status, 400, `accepte a tort : ${joinDate}`)
  }
})

test('la date d adhesion fournie est celle qui compte', async () => {
  const january = `${YEAR}-01-15`
  const created = await clubA.call('POST', '/api/members', {
    name: 'Ancien Membre', phone: '0600200001', branchId: branchA1, joinDate: january,
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))

  const res = await clubA.call('GET', `/api/finance?year=${YEAR}&month=0`)
  assert.ok(res.data.scope.registrations >= 1,
    'un membre inscrit en janvier doit compter en janvier, pas au jour de la saisie')
})
