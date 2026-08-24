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
import { BASE, client, uniq } from './helpers.mjs'

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

test('renommer un niveau ne fait pas perdre son grade au membre', async () => {
  // LA regression que l'editeur d'echelle rendrait quotidienne. L'ancienne
  // ecriture effacait la table des niveaux et la reinserait avec de nouveaux
  // identifiants : members.grade_id est en ON DELETE SET NULL, donc corriger
  // une faute de frappe dans « Ceinture blanche » remettait tout le club a
  // « sans grade ». Le defaut se serait vu des semaines plus tard, sur des
  // donnees qu'on ne peut pas reconstituer.
  const s = uniq()
  const club = client()
  assert.equal((await club.call('POST', '/api/auth/signup', {
    clubName: 'Club Echelle', slug: `echelle-${s}`, name: 'Proprietaire',
    email: `echelle-${s}@example.ma`, password: 'motdepasse-solide-ec',
  })).status, 201)

  const disc = await club.call('POST', '/api/disciplines', {
    name: 'Karate', grades: [{ label: 'Blanche' }, { label: 'Jaune' }],
  })
  assert.equal(disc.status, 201, JSON.stringify(disc.data))
  const disciplineId = disc.data.id

  const read = () => club.call('GET', '/api/disciplines')
    .then(r => r.data.disciplines.find(d => d.id === disciplineId).grades)

  const levels = await read()
  assert.equal(levels.length, 2)

  const member = await club.call('POST', '/api/members', {
    name: `Amine ${s}`, phone: `0641${s.slice(0, 6)}`, disciplineId,
  })
  assert.equal(member.status, 201, JSON.stringify(member.data))

  // La creation n'accepte pas de grade — seule la modification le pose.
  assert.equal((await club.call('PATCH', `/api/members/${member.data.id}`, {
    gradeId: levels[0].id,
  })).status, 200)

  // Renommer le premier niveau, en renvoyant son identifiant.
  assert.equal((await club.call('PUT', `/api/disciplines/${disciplineId}/grades`, {
    grades: [
      { id: levels[0].id, label: 'Ceinture blanche', color: '#f8fafc' },
      { id: levels[1].id, label: 'Jaune' },
    ],
  })).status, 200)

  const renamed = await read()
  assert.equal(renamed[0].id, levels[0].id, 'l identifiant doit survivre au renommage')
  assert.equal(renamed[0].label, 'Ceinture blanche')

  const row = (await club.call('GET', '/api/members')).data
    .members.find(m => m.id === member.data.id)
  assert.ok(row, 'le membre doit toujours exister')
  assert.equal(row.grade_id, levels[0].id,
    'le membre doit garder exactement le niveau qu il portait')
  assert.equal(row.grade_label, 'Ceinture blanche', 'et voir le nouveau libelle')
})

test('inverser deux niveaux respecte l unicite du rang', async () => {
  // UNIQUE (discipline_id, rank) : un echange naif fait collisionner les deux
  // lignes a mi-chemin. On verifie l'ORDRE obtenu, pas seulement l'absence
  // d'erreur — une transaction annulee en silence laisserait l'ancien ordre.
  const s = uniq()
  const club = client()
  assert.equal((await club.call('POST', '/api/auth/signup', {
    clubName: 'Club Ordre', slug: `ordre-${s}`, name: 'Proprietaire',
    email: `ordre-${s}@example.ma`, password: 'motdepasse-solide-or',
  })).status, 201)

  const disc = await club.call('POST', '/api/disciplines', {
    name: 'Judo', grades: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
  })
  const id = disc.data.id
  const read = () => club.call('GET', '/api/disciplines')
    .then(r => r.data.disciplines.find(d => d.id === id).grades)

  const before = await read()
  assert.equal((await club.call('PUT', `/api/disciplines/${id}/grades`, {
    grades: [
      { id: before[1].id, label: 'B' },
      { id: before[0].id, label: 'A' },
      { id: before[2].id, label: 'C' },
    ],
  })).status, 200)

  const after = await read()
  assert.deepEqual(after.map(g => g.label), ['B', 'A', 'C'])
  assert.deepEqual(after.map(g => g.id), [before[1].id, before[0].id, before[2].id],
    'les identifiants suivent leur niveau, ils ne sont pas reattribues')
})

test('un niveau retire disparait, et lui seul', async () => {
  const s = uniq()
  const club = client()
  assert.equal((await club.call('POST', '/api/auth/signup', {
    clubName: 'Club Retrait', slug: `retrait-${s}`, name: 'Proprietaire',
    email: `retrait-${s}@example.ma`, password: 'motdepasse-solide-re',
  })).status, 201)

  const disc = await club.call('POST', '/api/disciplines', {
    name: 'Taekwondo', grades: [{ label: 'X' }, { label: 'Y' }],
  })
  const id = disc.data.id
  const read = () => club.call('GET', '/api/disciplines')
    .then(r => r.data.disciplines.find(d => d.id === id).grades)

  const before = await read()
  assert.equal((await club.call('PUT', `/api/disciplines/${id}/grades`, {
    grades: [{ id: before[1].id, label: 'Y' }],
  })).status, 200)

  assert.deepEqual((await read()).map(g => g.id), [before[1].id])
})

test('un sport declare avec grades demarre sans niveau, et ouvre l ecran', async () => {
  // La creation ne pose plus d'echelle toute faite : le club coche
  // « avec grades » puis saisit la sienne. La capacite doit donc suivre le
  // drapeau, pas le nombre de niveaux — sinon l'ecran resterait ferme et on
  // n'aurait nulle part ou saisir l'echelle.
  const s = uniq()
  const club = client()
  assert.equal((await club.call('POST', '/api/auth/signup', {
    clubName: 'Club Vide', slug: `vide-${s}`, name: 'Proprietaire',
    email: `vide-${s}@example.ma`, password: 'motdepasse-solide-vd',
  })).status, 201)

  const disc = await club.call('POST', '/api/disciplines', {
    name: 'Boxe francaise', hasGrading: true,
  })
  assert.equal(disc.status, 201, JSON.stringify(disc.data))

  const listed = (await club.call('GET', '/api/disciplines')).data
    .disciplines.find(d => d.id === disc.data.id)
  assert.equal(listed.has_grading, 1)
  assert.equal(listed.grades.length, 0, 'aucune echelle imposee a la creation')

  assert.equal((await club.call('GET', '/api/me')).data.capabilities.hasGrading, true)
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
