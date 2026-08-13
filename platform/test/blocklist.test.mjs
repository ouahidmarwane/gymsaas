// Supervision : blocage d'adresses et emplacement des salles.
//
// Le blocage doit tenir a l'entree, pas seulement dans l'affichage : une
// adresse bloquee ne doit ni se connecter, ni s'inscrire, ni conserver ses
// sessions ouvertes. Et il ne doit pas etre possible de se bloquer soi-meme,
// ce qui fermerait la porte de l'exterieur.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/blocklist.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, createOperator, uniq, waitReady } from './helpers.mjs'

let ops, clubId, victimEmail
const FAKE_IP = '203.0.113.77'   // plage TEST-NET-3, jamais routee

/** Requete avec une adresse forgee : en local le Worker lit cet en-tete. */
async function from(ip, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'CF-Connecting-IP': ip,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* vide */ }
  return { status: res.status, data }
}

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)

  const s = uniq()
  victimEmail = `cible-${s}@example.ma`
  const owner = client()
  const created = await owner.call('POST', '/api/auth/signup', {
    clubName: 'Club Cible', slug: `cible-${s}`, name: 'Cible',
    email: victimEmail, password: 'motdepasse-solide-bl',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  clubId = created.data.orgId

  const email = `opbl-${uniq()}@example.ma`
  createOperator(email, 'Ops Blocklist', 'motdepasse-solide-op')
  await waitReady()
  ops = client()
  assert.equal((await ops.call('POST', '/api/auth/login', {
    email, password: 'motdepasse-solide-op',
  })).status, 200)
})

after(async () => {
  // Une adresse laissee bloquee ferait echouer les fichiers suivants.
  if (ops) await ops.call('DELETE', `/api/admin/blocklist/${encodeURIComponent(FAKE_IP)}`)
})

test('la supervision remonte les adresses en echec, pas seulement les comptes', async () => {
  for (let i = 0; i < 4; i++) {
    await from(FAKE_IP, 'POST', '/api/auth/login', {
      email: `inconnu-${i}-${uniq()}@example.ma`, password: 'faux',
    })
  }

  const res = await ops.call('GET', '/api/admin/supervision')
  assert.equal(res.status, 200)
  const row = res.data.offenders.find(o => o.ip === FAKE_IP)
  // Groupee par compte, cette attaque serait invisible : un seul echec par
  // e-mail ne franchit aucun seuil. C'est le regroupement par adresse qui
  // la fait apparaitre.
  assert.ok(row, 'l adresse fautive doit remonter')
  assert.ok(row.failures >= 4, `4 echecs attendus, vu ${row.failures}`)
  assert.ok(row.accounts >= 4, 'plusieurs comptes vises depuis la meme adresse')
  assert.equal(row.blocked, 0)
})

test('bloquer une adresse lui ferme la connexion ET l inscription', async () => {
  const blocked = await ops.call('POST', '/api/admin/blocklist', {
    ip: FAKE_IP, reason: 'balayage de comptes',
  })
  assert.equal(blocked.status, 201, JSON.stringify(blocked.data))

  // Meme avec des identifiants valides.
  const login = await from(FAKE_IP, 'POST', '/api/auth/login', {
    email: victimEmail, password: 'motdepasse-solide-bl',
  })
  assert.equal(login.status, 403, JSON.stringify(login.data))

  // Bloquer la connexion sans bloquer l'inscription laisserait l'attaquant
  // se creer un compte neuf depuis la meme adresse.
  const s = uniq()
  const signup = await from(FAKE_IP, 'POST', '/api/auth/signup', {
    clubName: 'Contournement', slug: `contour-${s}`, name: 'Contournement',
    email: `contour-${s}@example.ma`, password: 'motdepasse-solide-x1',
  })
  assert.equal(signup.status, 403, JSON.stringify(signup.data))
})

test('une autre adresse n est pas affectee', async () => {
  const ok = await from('198.51.100.9', 'POST', '/api/auth/login', {
    email: victimEmail, password: 'motdepasse-solide-bl',
  })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
})

test('debloquer rouvre la porte', async () => {
  assert.equal((await ops.call('DELETE', `/api/admin/blocklist/${encodeURIComponent(FAKE_IP)}`)).status, 200)
  const login = await from(FAKE_IP, 'POST', '/api/auth/login', {
    email: victimEmail, password: 'motdepasse-solide-bl',
  })
  assert.equal(login.status, 200, JSON.stringify(login.data))
})

test('on ne peut pas bloquer sa propre adresse', async () => {
  // Le geste est irreversible depuis l'exterieur : plus personne ne peut se
  // connecter pour le defaire.
  const mine = await ops.call('GET', '/api/admin/supervision')
  const self = mine.data.sessions.find(s => s.is_platform_admin === 1)
  if (!self?.ip) return   // en local l'adresse peut etre absente

  const res = await fetch(`${BASE}/api/admin/blocklist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': self.ip,
      Cookie: ops.cookie,
    },
    body: JSON.stringify({ ip: self.ip }),
  })
  assert.equal(res.status, 400)
})

test('la liste noire est reservee a la plateforme', async () => {
  const outsider = client()
  const s = uniq()
  await outsider.call('POST', '/api/auth/signup', {
    clubName: 'Curieux', slug: `curieux-bl-${s}`, name: 'Curieux',
    email: `curieux-bl-${s}@example.ma`, password: 'motdepasse-solide-x2',
  })
  assert.equal((await outsider.call('POST', '/api/admin/blocklist', { ip: '1.2.3.4' })).status, 403)
  assert.equal((await outsider.call('DELETE', '/api/admin/blocklist/1.2.3.4')).status, 403)
  assert.equal((await outsider.call('GET', '/api/admin/supervision')).status, 403)
  assert.equal((await outsider.call('PUT', `/api/admin/clubs/${clubId}/location`,
    { lat: 0, lng: 0 })).status, 403)
})

test('un emplacement se pose, se relit et se retire', async () => {
  const saved = await ops.call('PUT', `/api/admin/clubs/${clubId}/location`, {
    lat: 33.5731, lng: -7.5898, label: 'Casablanca',
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))

  const res = await ops.call('GET', '/api/admin/supervision')
  const club = res.data.clubs.find(c => c.id === clubId)
  assert.ok(club, 'le club doit figurer sur la carte')
  assert.equal(Math.round(club.lat * 1e4), 335731)
  assert.equal(club.label, 'Casablanca')
  // La carte peint chaque point a la couleur du club : sans theme exploitable
  // ils seraient tous identiques.
  assert.match(club.theme.accent, /^#[0-9a-f]{6}$/i)

  assert.equal((await ops.call('DELETE', `/api/admin/clubs/${clubId}/location`)).status, 200)
  const after = await ops.call('GET', '/api/admin/supervision')
  assert.equal(after.data.clubs.find(c => c.id === clubId).lat, null)
})

test('des coordonnees hors du globe sont refusees', async () => {
  for (const at of [
    { lat: 91, lng: 0 }, { lat: -91, lng: 0 },
    { lat: 0, lng: 181 }, { lat: 0, lng: -181 },
    { lat: 'nord', lng: 0 }, { lat: 0 },
  ]) {
    const res = await ops.call('PUT', `/api/admin/clubs/${clubId}/location`, at)
    assert.equal(res.status, 400, `accepte a tort : ${JSON.stringify(at)}`)
  }
})

test('situer un club inconnu est refuse', async () => {
  const res = await ops.call('PUT', '/api/admin/clubs/inexistant/location', { lat: 0, lng: 0 })
  assert.equal(res.status, 404)
})

test('la supervision livre ce que la carte consomme', async () => {
  const res = await ops.call('GET', '/api/admin/supervision')
  assert.equal(res.status, 200)
  for (const key of ['sessions', 'events', 'offenders', 'blocklist', 'clubs']) {
    assert.ok(Array.isArray(res.data[key]), `${key} devrait etre une liste`)
  }
  // La carte lit ces champs sur chaque point ; leur absence la viderait sans
  // qu'aucun autre test ne bronche.
  const club = res.data.clubs.find(c => c.id === clubId)
  for (const key of ['name', 'slug', 'theme', 'online', 'open_alerts', 'under_support']) {
    assert.ok(key in club, `champ manquant pour la carte : ${key}`)
  }
  assert.ok('mapsKey' in res.data, 'la cle de carte doit accompagner la reponse')
})
