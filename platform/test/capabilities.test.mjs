// Les ecrans proposes doivent correspondre a ce que le club pratique.
//
// Un club de boxe sans ceinture n'a pas de passage de grade : ni dans le
// rail, ni par URL directe. La regle vaut pour tous les clubs, pas seulement
// pour ceux qu'on a pense a configurer.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/capabilities.test.mjs
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
      if ((res.headers.get('content-type') ?? '').includes('json')) {
        try { data = await res.json() } catch { /* vide */ }
      }
      return { status: res.status, data }
    },
  }
}

const uniq = () => Math.random().toString(36).slice(2, 10)

async function makeClub(sport, grades) {
  const s = uniq()
  const c = client()
  const res = await c.call('POST', '/api/auth/signup', {
    clubName: `Club ${sport} ${s}`, slug: `${sport.toLowerCase().replace(/\W+/g, '-')}-${s}`,
    name: `Proprio ${s}`, email: `${sport.toLowerCase().replace(/\W+/g, '')}-${s}@example.ma`,
    password: 'motdepasse-solide-cap',
  })
  assert.equal(res.status, 201, JSON.stringify(res.data))
  await c.call('POST', '/api/branches', { name: 'Salle' })
  await c.call('POST', '/api/disciplines', { name: sport, grades: grades.map(label => ({ label })) })
  return c
}

let boxe, karate

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)
  boxe = await makeClub('Boxe', [])
  karate = await makeClub('Karate', ['Blanche', 'Jaune', 'Noire'])
})

test('un club sans grade le declare', async () => {
  const me = await boxe.call('GET', '/api/me')
  assert.equal(me.status, 200)
  assert.equal(me.data.capabilities.hasGrading, false)
  assert.equal(me.data.capabilities.configured, true)
  assert.equal(me.data.capabilities.disciplineCount, 1)
})

test('un club grade le declare aussi', async () => {
  const me = await karate.call('GET', '/api/me')
  assert.equal(me.data.capabilities.hasGrading, true)
})

test("le passage de grade est refuse au club sans grade, meme par URL", async () => {
  // Masquer le lien ne suffit pas : l'adresse reste tapable.
  const res = await boxe.call('GET', '/api/grades')
  assert.equal(res.status, 409, JSON.stringify(res.data))
})

test('le passage de grade reste ouvert au club grade', async () => {
  const res = await karate.call('GET', '/api/grades')
  assert.equal(res.status, 200, JSON.stringify(res.data))
})

test('ajouter une echelle ouvre l ecran, la retirer le referme', async () => {
  // La capacite suit la realite du club, elle n'est pas un reglage fige.
  const before = await boxe.call('GET', '/api/me')
  assert.equal(before.data.capabilities.hasGrading, false)

  const added = await boxe.call('POST', '/api/disciplines', {
    name: 'Karate contact', grades: [{ label: 'Blanche' }, { label: 'Noire' }],
  })
  assert.equal(added.status, 201, JSON.stringify(added.data))

  const after = await boxe.call('GET', '/api/me')
  assert.equal(after.data.capabilities.hasGrading, true, 'la discipline gradee doit ouvrir l ecran')
  assert.equal((await boxe.call('GET', '/api/grades')).status, 200)

  await boxe.call('DELETE', `/api/disciplines/${added.data.id}`)

  const closed = await boxe.call('GET', '/api/me')
  assert.equal(closed.data.capabilities.hasGrading, false, 'la desactivation doit refermer l ecran')
  assert.equal((await boxe.call('GET', '/api/grades')).status, 409)
})

test('un club neuf n a aucune capacite mais reste configurable', async () => {
  const s = uniq()
  const fresh = client()
  await fresh.call('POST', '/api/auth/signup', {
    clubName: `Neuf ${s}`, slug: `neuf-${s}`, name: 'Neuf',
    email: `neuf-${s}@example.ma`, password: 'motdepasse-solide-neuf',
  })
  const me = await fresh.call('GET', '/api/me')
  assert.equal(me.data.capabilities.configured, false)
  assert.equal(me.data.capabilities.hasGrading, false)
  assert.equal(me.data.capabilities.branchCount, 0)
})
