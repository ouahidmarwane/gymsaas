// Mode modification : disposition du tableau de bord.
//
// Les cartes se deplacent sur une grille de 12 colonnes. La disposition
// envoyee par le client n'est jamais stockee telle quelle : elle est
// reconstruite a partir du registre des cartes. Ces tests verifient que rien
// d'arbitraire ne passe, et que la disposition d'un club n'affecte pas
// celle d'un autre.
//
//   npx wrangler dev --port 8787     (dans un autre terminal)
//   node --test test/layout.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, uniq } from './helpers.mjs'

let clubA, clubB

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)
  for (const [label, ref] of [['a', 'A'], ['b', 'B']]) {
    const s = uniq()
    const c = client()
    const res = await c.call('POST', '/api/auth/signup', {
      clubName: `Club Layout ${ref}`, slug: `layout-${label}-${s}`, name: `Owner ${ref}`,
      email: `layout-${label}-${s}@example.ma`, password: 'motdepasse-solide-l1',
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    if (label === 'a') clubA = c; else clubB = c
  }
})

test('un club recoit une disposition par defaut', async () => {
  const res = await clubA.call('GET', '/api/layout/dashboard')
  assert.equal(res.status, 200)
  assert.equal(res.data.columns, 12)
  assert.equal(res.data.page, 'dashboard')
  assert.ok(res.data.layout.length > 0)
  assert.ok(res.data.layout.some(c => c.id === 'members_total' && c.visible))
  // Le registre accompagne la disposition : l'interface connait les bornes
  // de redimensionnement sans les coder en dur.
  assert.ok(res.data.cards.growth_chart.maxW >= res.data.cards.growth_chart.minW)
})

test('une disposition personnalisee est conservee', async () => {
  const layout = [
    { id: 'revenue_month', x: 0, y: 0, w: 4, h: 1, visible: true },
    { id: 'members_total', x: 4, y: 0, w: 4, h: 1, visible: true },
    { id: 'growth_chart',  x: 0, y: 1, w: 12, h: 3, visible: true },
  ]
  const saved = await clubA.call('PUT', '/api/layout/dashboard', { layout })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))

  const read = await clubA.call('GET', '/api/layout/dashboard')
  const revenue = read.data.layout.find(c => c.id === 'revenue_month')
  assert.deepEqual([revenue.x, revenue.y, revenue.w], [0, 0, 4])

  // Les cartes non citees restent disponibles mais masquees, elles ne
  // disparaissent pas du registre.
  const alerts = read.data.layout.find(c => c.id === 'alerts_unread')
  assert.equal(alerts.visible, false)
})

test('une carte inconnue est refusee', async () => {
  const res = await clubA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'admin_secrets', x: 0, y: 0, w: 4, h: 1, visible: true }],
  })
  assert.equal(res.status, 400, JSON.stringify(res.data))
})

test('les dimensions hors bornes sont ramenees dans la grille', async () => {
  await clubA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'members_total', x: 99, y: -5, w: 999, h: 999, visible: true }],
  })
  const read = await clubA.call('GET', '/api/layout/dashboard')
  const card = read.data.layout.find(c => c.id === 'members_total')
  const spec = read.data.cards.members_total
  // On compare aux bornes annoncees par le catalogue, pas a une valeur
  // recopiee : le test ne doit pas casser quand une carte gagne en largeur.
  assert.ok(card.w <= spec.maxW, `largeur bornee a ${spec.maxW}, recu ${card.w}`)
  assert.ok(card.h <= spec.maxH, `hauteur bornee a ${spec.maxH}, recu ${card.h}`)
  assert.ok(card.x >= 0 && card.x + card.w <= 12, 'la carte reste dans la grille')
  assert.ok(card.y >= 0, 'ordonnee positive')
})

test('une carte en double est refusee', async () => {
  const res = await clubA.call('PUT', '/api/layout/dashboard', {
    layout: [
      { id: 'members_total', x: 0, y: 0, w: 3, h: 1, visible: true },
      { id: 'members_total', x: 3, y: 0, w: 3, h: 1, visible: true },
    ],
  })
  assert.equal(res.status, 400)
})

test('une coordonnee non numerique est refusee', async () => {
  const res = await clubA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'members_total', x: 'abc', y: 0, w: 3, h: 1, visible: true }],
  })
  assert.equal(res.status, 400)
})

test('la disposition du club A n affecte pas celle du club B', async () => {
  const b = await clubB.call('GET', '/api/layout/dashboard')
  const revenue = b.data.layout.find(c => c.id === 'revenue_month')
  // Le club B garde la disposition par defaut : revenue_month n'est pas en
  // haut a gauche comme chez A.
  assert.notDeepEqual([revenue.x, revenue.y], [0, 0])
  assert.ok(b.data.layout.find(c => c.id === 'members_total').visible)
})

test('reinitialiser rend la disposition par defaut', async () => {
  const res = await clubA.call('DELETE', '/api/layout/dashboard')
  assert.equal(res.status, 200)
  const read = await clubA.call('GET', '/api/layout/dashboard')
  const members = read.data.layout.find(c => c.id === 'members_total')
  assert.deepEqual([members.x, members.y, members.w], [0, 0, 3])
})

test('chaque ecran a sa propre disposition, independante', async () => {
  // Le mode modification n'appartient pas au tableau de bord : deplacer une
  // carte sur un ecran ne doit rien changer aux autres.
  const dash = await clubA.call('GET', '/api/layout/dashboard')
  const compta = await clubA.call('GET', '/api/layout/comptabilite')
  assert.equal(dash.status, 200)
  assert.equal(compta.status, 200)
  assert.equal(compta.data.page, 'comptabilite')

  // Les catalogues different : une carte n'est proposee que la ou elle a un sens.
  assert.ok(Object.keys(dash.data.cards).length > Object.keys(compta.data.cards).length)
  assert.ok(!compta.data.cards.upcoming_grades, 'les passages de grade n ont rien a faire en comptabilite')

  const before = JSON.stringify(compta.data.layout)
  await clubA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'members_total', x: 9, y: 4, w: 3, h: 1, visible: true }],
  })
  const after = await clubA.call('GET', '/api/layout/comptabilite')
  assert.equal(JSON.stringify(after.data.layout), before, 'la comptabilite ne doit pas bouger')
})

test('une carte valide ailleurs est refusee sur le mauvais ecran', async () => {
  const res = await clubA.call('PUT', '/api/layout/comptabilite', {
    layout: [{ id: 'upcoming_grades', x: 0, y: 0, w: 4, h: 2, visible: true }],
  })
  assert.equal(res.status, 400, JSON.stringify(res.data))
})

test('un ecran inconnu est refuse', async () => {
  assert.equal((await clubA.call('GET', '/api/layout/inexistant')).status, 404)
})

test('le catalogue annonce un libelle et un groupe pour chaque carte', async () => {
  // La palette lit ces champs : sans eux elle afficherait des identifiants.
  const res = await clubA.call('GET', '/api/layout/dashboard')
  for (const [id, spec] of Object.entries(res.data.cards)) {
    assert.ok(spec.label, `libelle manquant pour ${id}`)
    assert.ok(spec.group, `groupe manquant pour ${id}`)
  }
})
