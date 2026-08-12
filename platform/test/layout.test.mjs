// Mode modification : disposition des ecrans.
//
// Les cartes se deplacent sur une grille de 12 colonnes. La disposition
// envoyee par le client n'est jamais stockee telle quelle : elle est
// reconstruite a partir du catalogue de l'ecran vise.
//
// Lire sa disposition est le droit du club — c'est ce qui dessine ses
// ecrans. L'ECRIRE appartient a la plateforme : les tests passent donc par
// un exploitant entre en mode support, et verifient qu'un proprietaire de
// club est refuse.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/layout.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, createOperator, uniq, waitReady } from './helpers.mjs'

// ownerA/ownerB lisent ; writerA/writerB ecrivent depuis le support.
let ownerA, ownerB, writerA, writerB

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)

  const clubs = []
  for (const [label, ref] of [['a', 'A'], ['b', 'B']]) {
    const s = uniq()
    const c = client()
    const res = await c.call('POST', '/api/auth/signup', {
      clubName: `Club Layout ${ref}`, slug: `layout-${label}-${s}`, name: `Owner ${ref}`,
      email: `layout-${label}-${s}@example.ma`, password: 'motdepasse-solide-l1',
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    clubs.push({ session: c, orgId: res.data.orgId })
  }
  ownerA = clubs[0].session
  ownerB = clubs[1].session

  // Un seul compte exploitant, deux sessions : la portee support vit sur la
  // ligne de session, pas sur l'utilisateur. Deux clubs peuvent donc etre
  // visites en parallele sans que l'un chasse l'autre.
  const o = uniq()
  const email = `oplayout-${o}@example.ma`
  createOperator(email, 'Ops Layout', 'motdepasse-solide-op')
  await waitReady()

  const writers = []
  for (const club of clubs) {
    const w = client()
    const login = await w.call('POST', '/api/auth/login', { email, password: 'motdepasse-solide-op' })
    assert.equal(login.status, 200, JSON.stringify(login.data))
    const enter = await w.call('POST', `/api/admin/clubs/${club.orgId}/support`)
    assert.equal(enter.status, 200, JSON.stringify(enter.data))
    writers.push(w)
  }
  writerA = writers[0]
  writerB = writers[1]
})

test('un club recoit une disposition par defaut', async () => {
  const res = await ownerA.call('GET', '/api/layout/dashboard')
  assert.equal(res.status, 200)
  assert.equal(res.data.columns, 12)
  assert.equal(res.data.page, 'dashboard')
  assert.ok(res.data.layout.length > 0)
  assert.ok(res.data.layout.some(c => c.id === 'members_total' && c.visible))
  // Le registre accompagne la disposition : l'interface connait les bornes
  // de redimensionnement sans les coder en dur.
  assert.ok(res.data.cards.growth_chart.maxW >= res.data.cards.growth_chart.minW)
})

test('un proprietaire de club ne peut pas modifier la disposition', async () => {
  // Le bouton n'est propose qu'a la plateforme. Une route laissee ouverte
  // derriere un bouton cache ne serait pas une regle, juste un decor.
  const put = await ownerA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'members_total', x: 0, y: 0, w: 3, h: 1, visible: true }],
  })
  assert.equal(put.status, 403, JSON.stringify(put.data))

  const del = await ownerA.call('DELETE', '/api/layout/dashboard')
  assert.equal(del.status, 403, JSON.stringify(del.data))

  // Mais il continue de lire la sienne, sinon ses ecrans ne s'afficheraient plus.
  assert.equal((await ownerA.call('GET', '/api/layout/dashboard')).status, 200)
})

test('une disposition personnalisee est conservee', async () => {
  const layout = [
    { id: 'revenue_month', x: 0, y: 0, w: 4, h: 1, visible: true },
    { id: 'members_total', x: 4, y: 0, w: 4, h: 1, visible: true },
    { id: 'growth_chart',  x: 0, y: 1, w: 12, h: 3, visible: true },
  ]
  const saved = await writerA.call('PUT', '/api/layout/dashboard', { layout })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))

  // Relue par le CLUB : ce que la plateforme pose doit etre ce que le club voit.
  const read = await ownerA.call('GET', '/api/layout/dashboard')
  const revenue = read.data.layout.find(c => c.id === 'revenue_month')
  assert.deepEqual([revenue.x, revenue.y, revenue.w], [0, 0, 4])

  // Les cartes non citees restent disponibles mais masquees, elles ne
  // disparaissent pas du registre.
  const alerts = read.data.layout.find(c => c.id === 'alerts_unread')
  assert.equal(alerts.visible, false)
})

test('une carte inconnue est refusee', async () => {
  const res = await writerA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'admin_secrets', x: 0, y: 0, w: 4, h: 1, visible: true }],
  })
  assert.equal(res.status, 400, JSON.stringify(res.data))
})

test('les dimensions hors bornes sont ramenees dans la grille', async () => {
  await writerA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'members_total', x: 99, y: -5, w: 999, h: 999, visible: true }],
  })
  const read = await ownerA.call('GET', '/api/layout/dashboard')
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
  const res = await writerA.call('PUT', '/api/layout/dashboard', {
    layout: [
      { id: 'members_total', x: 0, y: 0, w: 3, h: 1, visible: true },
      { id: 'members_total', x: 3, y: 0, w: 3, h: 1, visible: true },
    ],
  })
  assert.equal(res.status, 400)
})

test('une coordonnee non numerique est refusee', async () => {
  const res = await writerA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'members_total', x: 'abc', y: 0, w: 3, h: 1, visible: true }],
  })
  assert.equal(res.status, 400)
})

test('la disposition du club A n affecte pas celle du club B', async () => {
  const b = await ownerB.call('GET', '/api/layout/dashboard')
  const revenue = b.data.layout.find(c => c.id === 'revenue_month')
  // Le club B garde la disposition par defaut : revenue_month n'est pas en
  // haut a gauche comme chez A.
  assert.notDeepEqual([revenue.x, revenue.y], [0, 0])
  assert.ok(b.data.layout.find(c => c.id === 'members_total').visible)
})

test('reinitialiser rend la disposition par defaut', async () => {
  const res = await writerA.call('DELETE', '/api/layout/dashboard')
  assert.equal(res.status, 200)
  const read = await ownerA.call('GET', '/api/layout/dashboard')
  const members = read.data.layout.find(c => c.id === 'members_total')
  assert.deepEqual([members.x, members.y, members.w], [0, 0, 3])
})

test('chaque ecran a sa propre disposition, independante', async () => {
  // Le mode modification n'appartient pas au tableau de bord : deplacer une
  // carte sur un ecran ne doit rien changer aux autres.
  const dash = await ownerA.call('GET', '/api/layout/dashboard')
  const compta = await ownerA.call('GET', '/api/layout/comptabilite')
  assert.equal(dash.status, 200)
  assert.equal(compta.status, 200)
  assert.equal(compta.data.page, 'comptabilite')

  // Les catalogues different : une carte n'est proposee que la ou elle a un sens.
  assert.ok(Object.keys(dash.data.cards).length > Object.keys(compta.data.cards).length)
  assert.ok(!compta.data.cards.upcoming_grades, 'les passages de grade n ont rien a faire en comptabilite')

  const before = JSON.stringify(compta.data.layout)
  await writerA.call('PUT', '/api/layout/dashboard', {
    layout: [{ id: 'members_total', x: 9, y: 4, w: 3, h: 1, visible: true }],
  })
  const after = await ownerA.call('GET', '/api/layout/comptabilite')
  assert.equal(JSON.stringify(after.data.layout), before, 'la comptabilite ne doit pas bouger')
})

test('une carte valide ailleurs est refusee sur le mauvais ecran', async () => {
  const res = await writerA.call('PUT', '/api/layout/comptabilite', {
    layout: [{ id: 'upcoming_grades', x: 0, y: 0, w: 4, h: 2, visible: true }],
  })
  assert.equal(res.status, 400, JSON.stringify(res.data))
})

test('un ecran inconnu est refuse', async () => {
  assert.equal((await ownerA.call('GET', '/api/layout/inexistant')).status, 404)
})

test('le catalogue annonce un libelle et un groupe pour chaque carte', async () => {
  // La palette lit ces champs : sans eux elle afficherait des identifiants.
  const res = await ownerA.call('GET', '/api/layout/dashboard')
  for (const [id, spec] of Object.entries(res.data.cards)) {
    assert.ok(spec.label, `libelle manquant pour ${id}`)
    assert.ok(spec.group, `groupe manquant pour ${id}`)
  }
})

test('la comptabilite du club B reste intacte apres les ecritures sur A', async () => {
  // writerB partage le compte exploitant de writerA : si la portee support
  // vivait sur l'utilisateur et non sur la session, les ecritures faites sur
  // A auraient atterri chez B.
  const res = await writerB.call('GET', '/api/layout/dashboard')
  assert.equal(res.status, 200)
  const members = res.data.layout.find(c => c.id === 'members_total')
  assert.deepEqual([members.x, members.y], [0, 0], 'B doit avoir sa disposition par defaut')
})
