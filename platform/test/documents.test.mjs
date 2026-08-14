// Piece d'identite d'un membre : carte nationale ou passeport.
//
// Ce qui se verifie ici n'est pas « le fichier remonte bien » mais qui peut
// le lire. Un scan de carte nationale est la donnee la plus sensible que la
// plateforme detienne : elle ne doit avoir aucune adresse publique, et le
// club d'a cote ne doit pas pouvoir la demander.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/documents.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, uniq } from './helpers.mjs'

// PNG 1x1 valide : le serveur se fie au Content-Type, mais un vrai fichier
// evite de tester le chemin d'erreur sans le vouloir.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const PNG2 = Buffer.concat([PNG, Buffer.from([0])])   // autre contenu, meme format

let owner, memberId, orgSlug

/** Envoi d'un fichier brut, avec la session d'un client donne. */
async function put(session, path, body, contentType) {
  const res = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, Cookie: session.cookie ?? '' },
    body,
  })
  const data = (res.headers.get('content-type') ?? '').includes('json')
    ? await res.json().catch(() => null) : null
  return { status: res.status, data }
}

async function get(session, path) {
  const res = await fetch(BASE + path, { headers: { Cookie: session.cookie ?? '' } })
  const type = res.headers.get('content-type') ?? ''
  return {
    status: res.status,
    type,
    cacheControl: res.headers.get('cache-control') ?? '',
    bytes: res.ok && !type.includes('json') ? Buffer.from(await res.arrayBuffer()) : null,
  }
}

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)
  const s = uniq()
  orgSlug = `docs-${s}`
  owner = client()
  const created = await owner.call('POST', '/api/auth/signup', {
    clubName: 'Club Documents', slug: orgSlug, name: 'Owner Docs',
    email: `docs-${s}@example.ma`, password: 'motdepasse-solide-doc',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))

  const member = await owner.call('POST', '/api/members', {
    name: 'Saad Sbata', phone: `0612${s.slice(0, 6)}`,
  })
  assert.equal(member.status, 201, JSON.stringify(member.data))
  memberId = member.data.id
})

test('une piece se depose, se relit et se remplace', async () => {
  const up = await put(owner, `/api/members/${memberId}/document?type=cin&number=AB123456`,
                       PNG, 'image/png')
  assert.equal(up.status, 200, JSON.stringify(up.data))

  const list = await owner.call('GET', '/api/members?limit=50')
  const row = list.data.members.find(m => m.id === memberId)
  assert.equal(row.id_doc_type, 'cin')
  assert.equal(row.id_doc_number, 'AB123456')
  assert.ok(row.id_doc_key, 'la cle du fichier n a pas ete enregistree')
  assert.ok(row.id_doc_at, 'la date de depot manque')

  const file = await get(owner, `/api/members/${memberId}/document`)
  assert.equal(file.status, 200)
  assert.equal(file.type, 'image/png')
  // Une piece d'identite n'a rien a faire dans le cache d'un intermediaire.
  assert.match(file.cacheControl, /private/)
  assert.match(file.cacheControl, /no-store/)
  assert.deepEqual(file.bytes, PNG)

  // Remplacement : le club s'est trompe de scan et doit pouvoir corriger.
  const again = await put(owner, `/api/members/${memberId}/document?type=passeport`,
                          PNG2, 'image/png')
  assert.equal(again.status, 200, JSON.stringify(again.data))
  const replaced = await get(owner, `/api/members/${memberId}/document`)
  assert.deepEqual(replaced.bytes, PNG2, 'l ancien fichier est toujours servi')

  const after = await owner.call('GET', '/api/members?limit=50')
  const row2 = after.data.members.find(m => m.id === memberId)
  assert.equal(row2.id_doc_type, 'passeport')
  // Le numero n'accompagnait pas le remplacement : il doit disparaitre, pas
  // rester colle a une piece qui n'est plus la meme.
  assert.equal(row2.id_doc_number, null)
})

test('seules la carte nationale et le passeport sont acceptes', async () => {
  for (const type of ['permis', 'sport_passport', '', 'CIN']) {
    const res = await put(owner, `/api/members/${memberId}/document?type=${type}`,
                          PNG, 'image/png')
    assert.equal(res.status, 400, `type accepte a tort : « ${type} »`)
  }
})

test('un format executable est refuse', async () => {
  // Un SVG porte du script et sera ouvert par un exploitant ; un HTML aussi.
  for (const ct of ['image/svg+xml', 'text/html', 'application/x-msdownload']) {
    const res = await put(owner, `/api/members/${memberId}/document?type=cin`, PNG, ct)
    assert.equal(res.status, 400, `format accepte a tort : ${ct}`)
  }
})

test('un membre inconnu ne cree pas de fichier orphelin', async () => {
  const res = await put(owner, '/api/members/inexistant/document?type=cin', PNG, 'image/png')
  assert.equal(res.status, 404)
})

test('un autre club ne peut pas lire la piece', async () => {
  const s = uniq()
  const other = client()
  assert.equal((await other.call('POST', '/api/auth/signup', {
    clubName: 'Club Voisin', slug: `voisin-${s}`, name: 'Owner Voisin',
    email: `voisin-${s}@example.ma`, password: 'motdepasse-solide-vo',
  })).status, 201)

  // Meme identifiant de membre, autre session : la requete part vers un autre
  // Durable Object, qui ne connait pas ce membre. L'isolation ne repose pas
  // sur un filtre a ne pas oublier, mais sur l'objet interroge.
  const stolen = await get(other, `/api/members/${memberId}/document`)
  assert.equal(stolen.status, 404)
  assert.equal(stolen.bytes, null)
})

test('sans session, aucun fichier ne sort', async () => {
  const res = await fetch(`${BASE}/api/members/${memberId}/document`)
  assert.ok(res.status === 401 || res.status === 403, `statut inattendu : ${res.status}`)
})

// Photo du membre ---------------------------------------------------------

test('la photo se depose, se date et se remplace', async () => {
  const up = await put(owner, `/api/members/${memberId}/photo`, PNG, 'image/png')
  assert.equal(up.status, 200, JSON.stringify(up.data))

  const list = await owner.call('GET', '/api/members?limit=50')
  const row = list.data.members.find(m => m.id === memberId)
  assert.ok(row.photo_key, 'la cle de la photo manque')
  // La date entre dans l'adresse servie au navigateur : sans elle, l'adresse
  // serait fixe et l'ancienne photo resterait affichee apres remplacement.
  assert.ok(row.photo_at, 'la date de depot manque')

  const file = await get(owner, `/api/members/${memberId}/photo`)
  assert.equal(file.status, 200)
  assert.equal(file.type, 'image/png')
  assert.deepEqual(file.bytes, PNG)

  await put(owner, `/api/members/${memberId}/photo`, PNG2, 'image/png')
  const after = await get(owner, `/api/members/${memberId}/photo`)
  assert.deepEqual(after.bytes, PNG2, 'l ancienne photo est toujours servie')
})

test('un PDF n est pas une photo', async () => {
  // Il passe pour une piece d'identite, pas pour un portrait : une balise
  // <img> n'afficherait qu'un cadre vide, sans dire pourquoi.
  const res = await put(owner, `/api/members/${memberId}/photo`, PNG, 'application/pdf')
  assert.equal(res.status, 400)
})

test('un autre club ne voit pas la photo', async () => {
  const s = uniq()
  const other = client()
  assert.equal((await other.call('POST', '/api/auth/signup', {
    clubName: 'Club Photo', slug: `photo-${s}`, name: 'Owner Photo',
    email: `photo-${s}@example.ma`, password: 'motdepasse-solide-ph',
  })).status, 201)
  assert.equal((await get(other, `/api/members/${memberId}/photo`)).status, 404)
})

test('la photo se retire', async () => {
  assert.equal((await owner.call('DELETE', `/api/members/${memberId}/photo`)).status, 200)
  assert.equal((await get(owner, `/api/members/${memberId}/photo`)).status, 404)
  const list = await owner.call('GET', '/api/members?limit=50')
  const row = list.data.members.find(m => m.id === memberId)
  assert.equal(row.photo_key, null)
  assert.equal(row.photo_at, null)
})

test('le retrait est reserve aux responsables', async () => {
  const s = uniq()
  const staffEmail = `staff-doc-${s}@example.ma`
  const invited = await owner.call('POST', '/api/staff', {
    name: 'Comptoir', email: staffEmail, password: 'motdepasse-solide-st', role: 'staff',
  })
  if (invited.status === 201) {
    const staff = client()
    assert.equal((await staff.call('POST', '/api/auth/login', {
      email: staffEmail, password: 'motdepasse-solide-st',
    })).status, 200)

    // Le comptoir depose — c'est son travail — mais ne retire pas : un
    // retrait efface le fichier definitivement.
    assert.equal((await put(staff, `/api/members/${memberId}/document?type=cin`,
                            PNG, 'image/png')).status, 200)
    assert.equal((await staff.call('DELETE', `/api/members/${memberId}/document`)).status, 403)
  }

  assert.equal((await owner.call('DELETE', `/api/members/${memberId}/document`)).status, 200)
  assert.equal((await get(owner, `/api/members/${memberId}/document`)).status, 404)

  const list = await owner.call('GET', '/api/members?limit=50')
  const row = list.data.members.find(m => m.id === memberId)
  assert.equal(row.id_doc_key, null)
  assert.equal(row.id_doc_type, null)
})
