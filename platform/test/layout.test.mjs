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

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787'

function client() {
  let cookie = null
  return {
    async call(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const sc = res.headers.get('set-cookie')
      if (sc) { const raw = sc.split(';')[0]; cookie = raw.endsWith('=') ? null : raw }
      let data = null
      try { data = await res.json() } catch { /* vide */ }
      return { status: res.status, data }
    },
  }
}

const uniq = () => Math.random().toString(36).slice(2, 10)

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
  const res = await clubA.call('GET', '/api/dashboard/layout')
  assert.equal(res.status, 200)
  assert.equal(res.data.columns, 12)
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
  const saved = await clubA.call('PUT', '/api/dashboard/layout', { layout })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))

  const read = await clubA.call('GET', '/api/dashboard/layout')
  const revenue = read.data.layout.find(c => c.id === 'revenue_month')
  assert.deepEqual([revenue.x, revenue.y, revenue.w], [0, 0, 4])

  // Les cartes non citees restent disponibles mais masquees, elles ne
  // disparaissent pas du registre.
  const alerts = read.data.layout.find(c => c.id === 'alerts_unread')
  assert.equal(alerts.visible, false)
})

test('une carte inconnue est refusee', async () => {
  const res = await clubA.call('PUT', '/api/dashboard/layout', {
    layout: [{ id: 'admin_secrets', x: 0, y: 0, w: 4, h: 1, visible: true }],
  })
  assert.equal(res.status, 400, JSON.stringify(res.data))
})

test('les dimensions hors bornes sont ramenees dans la grille', async () => {
  await clubA.call('PUT', '/api/dashboard/layout', {
    layout: [{ id: 'members_total', x: 99, y: -5, w: 999, h: 999, visible: true }],
  })
  const read = await clubA.call('GET', '/api/dashboard/layout')
  const card = read.data.layout.find(c => c.id === 'members_total')
  assert.ok(card.w <= 4, `largeur bornee, recu ${card.w}`)
  assert.ok(card.x >= 0 && card.x + card.w <= 12, 'la carte reste dans la grille')
  assert.ok(card.y >= 0, 'ordonnee positive')
})

test('une carte en double est refusee', async () => {
  const res = await clubA.call('PUT', '/api/dashboard/layout', {
    layout: [
      { id: 'members_total', x: 0, y: 0, w: 3, h: 1, visible: true },
      { id: 'members_total', x: 3, y: 0, w: 3, h: 1, visible: true },
    ],
  })
  assert.equal(res.status, 400)
})

test('une coordonnee non numerique est refusee', async () => {
  const res = await clubA.call('PUT', '/api/dashboard/layout', {
    layout: [{ id: 'members_total', x: 'abc', y: 0, w: 3, h: 1, visible: true }],
  })
  assert.equal(res.status, 400)
})

test('la disposition du club A n affecte pas celle du club B', async () => {
  const b = await clubB.call('GET', '/api/dashboard/layout')
  const revenue = b.data.layout.find(c => c.id === 'revenue_month')
  // Le club B garde la disposition par defaut : revenue_month n'est pas en
  // haut a gauche comme chez A.
  assert.notDeepEqual([revenue.x, revenue.y], [0, 0])
  assert.ok(b.data.layout.find(c => c.id === 'members_total').visible)
})

test('reinitialiser rend la disposition par defaut', async () => {
  const res = await clubA.call('DELETE', '/api/dashboard/layout')
  assert.equal(res.status, 200)
  const read = await clubA.call('GET', '/api/dashboard/layout')
  const members = read.data.layout.find(c => c.id === 'members_total')
  assert.deepEqual([members.x, members.y, members.w], [0, 0, 3])
})
