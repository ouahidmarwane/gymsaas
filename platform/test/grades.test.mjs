// Passage de grade : cadence, eligibilite, resultat.
//
// Ce que ces tests protegent, c'est la REGLE, pas l'affichage. Trois choses
// s'y sont deja revelees fragiles :
//
//   1. L'anciennete se mesure A LA DATE DE LA SESSION, pas aujourd'hui.
//      Mesuree au present, un membre qui atteint ses trois mois l'avant-veille
//      du passage disparaissait de la liste pendant tout le trimestre.
//
//   2. Un membre deja grade ne se juge pas sur sa date d'inscription mais sur
//      son dernier passage. L'ancienne requete ne regardait que l'inscription :
//      un membre inscrit il y a trois ans etait eligible tous les jours.
//
//   3. Un abonnement expire ne cache pas le membre, il le deplace.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/grades.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, uniq } from './helpers.mjs'
import { nextGradeDate, gradeGrid, isOnGrid } from '../src/club/grade-cycle.ts'

let club, disciplineId, ladder

/** Date isolee, en AAAA-MM-JJ, decalee de N mois par rapport a aujourd'hui. */
function monthsAgo(n) {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 10)
}

function inDays(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)
  const s = uniq()
  club = client()
  assert.equal((await club.call('POST', '/api/auth/signup', {
    clubName: 'Club Grades', slug: `grades-${s}`, name: 'Sensei',
    email: `grades-${s}@example.ma`, password: 'motdepasse-solide-gr',
  })).status, 201)

  // Une discipline graduee, avec une echelle a trois niveaux.
  const created = await club.call('POST', '/api/disciplines', {
    name: 'Karate', hasGrading: true,
    grades: [{ label: 'Blanche' }, { label: 'Orange' }, { label: 'Verte' }],
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  disciplineId = created.data.id

  const view = await club.call('GET', '/api/grades')
  assert.equal(view.status, 200, JSON.stringify(view.data))
  ladder = view.data.ladders[disciplineId]
  assert.equal(ladder.length, 3, 'echelle a trois niveaux attendue')
})

// 1 — La grille trimestrielle (pure, sans serveur) -------------------------

test('la grille tombe tous les trois mois depuis le mois d ancrage', () => {
  assert.deepEqual(gradeGrid(9, 2026),
    ['2026-03-01', '2026-06-01', '2026-09-01', '2026-12-01'])
  // Ancrage en janvier : la grille se decale entierement.
  assert.deepEqual(gradeGrid(1, 2026),
    ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'])
})

test('la prochaine session est la premiere date de grille non passee', () => {
  assert.equal(nextGradeDate(9, '2026-08-15'), '2026-09-01')
  assert.equal(nextGradeDate(9, '2026-09-01'), '2026-09-01')   // le jour meme compte
  assert.equal(nextGradeDate(9, '2026-09-02'), '2026-12-01')
  // Passage d'annee : depuis decembre, la suivante est en mars de l'an d'apres.
  assert.equal(nextGradeDate(9, '2026-12-02'), '2027-03-01')
  assert.ok(isOnGrid(9, '2026-06-01'))
  assert.ok(!isOnGrid(9, '2026-06-02'))
})

test('un mois d ancrage absurde retombe sur le defaut', () => {
  // Un reglage abime ne doit pas casser l'ecran.
  assert.equal(nextGradeDate(0, '2026-08-15'), nextGradeDate(9, '2026-08-15'))
  assert.equal(nextGradeDate(99, '2026-08-15'), nextGradeDate(9, '2026-08-15'))
})

// 2 — Eligibilite ----------------------------------------------------------

test('premier grade : trois mois d inscription, mesures a la date de session', async () => {
  const s = uniq()
  // Inscrit il y a deux mois et demi : pas encore eligible AUJOURD'HUI, mais
  // il le sera a une session dans un mois. C'est tout l'enjeu.
  const jeune = await club.call('POST', '/api/members', {
    name: `Jeune ${s}`, phone: `0631${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(2), subExpiry: inDays(300),
  })
  assert.equal(jeune.status, 201, JSON.stringify(jeune.data))

  const ancien = await club.call('POST', '/api/members', {
    name: `Ancien ${s}`, phone: `0632${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(8), subExpiry: inDays(300),
  })
  assert.equal(ancien.status, 201)

  // A aujourd'hui : seul l'ancien passe.
  const now = await club.call('GET', `/api/grades?date=${inDays(0)}`)
  const nowNames = now.data.eligible.map(m => m.name)
  assert.ok(nowNames.includes(`Ancien ${s}`), 'l ancien devrait etre eligible')
  assert.ok(!nowNames.includes(`Jeune ${s}`), 'le jeune ne l est pas encore')

  // A une session dans deux mois : le jeune a franchi ses trois mois.
  const later = await club.call('GET', `/api/grades?date=${inDays(62)}`)
  const laterNames = later.data.eligible.map(m => m.name)
  assert.ok(laterNames.includes(`Jeune ${s}`),
    'le jeune atteint ses trois mois avant la session, il doit apparaitre')
})

test('grade suivant : trois mois depuis le dernier passage, pas depuis l inscription', async () => {
  const s = uniq()
  const m = await club.call('POST', '/api/members', {
    name: `Grade ${s}`, phone: `0633${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(36), subExpiry: inDays(300),
  })
  const id = m.data.id

  // Inscrit il y a trois ans : eligible tout de suite.
  let view = await club.call('GET', '/api/grades')
  assert.ok(view.data.eligible.some(e => e.id === id))

  // On le convoque et on tranche AUJOURD'HUI : son dernier passage est donc
  // aujourd'hui, et il ne redevient eligible que dans trois mois.
  const conv = await club.call('POST', '/api/grades/sessions', {
    memberId: id, scheduledDate: inDays(0), toGradeId: ladder[0].id,
  })
  assert.equal(conv.status, 201, JSON.stringify(conv.data))
  assert.equal((await club.call('POST', `/api/grades/sessions/${conv.data.id}/decision`,
    { passed: true })).status, 200)

  view = await club.call('GET', '/api/grades')
  assert.ok(!view.data.eligible.some(e => e.id === id),
    'trois ans d anciennete ne doivent pas rendre eligible le lendemain d un passage')

  // A une session dans quatre mois, les trois mois sont ecoules.
  view = await club.call('GET', `/api/grades?date=${inDays(125)}`)
  assert.ok(view.data.eligible.some(e => e.id === id),
    'trois mois apres le passage, il redevient eligible')
})

test('un abonnement expire n est pas convocable mais reste visible', async () => {
  const s = uniq()
  const m = await club.call('POST', '/api/members', {
    name: `Expire ${s}`, phone: `0634${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(10), subExpiry: monthsAgo(1),
  })
  const id = m.data.id

  const view = await club.call('GET', '/api/grades')
  assert.ok(!view.data.eligible.some(e => e.id === id),
    'un abonnement expire ne doit pas etre convocable')
  // Mais il ne disparait pas : sans cela, personne ne saurait qu il attend.
  assert.ok(view.data.blocked.some(e => e.id === id),
    'il doit apparaitre dans la bande a verifier')
})

// 3 — Resultat -------------------------------------------------------------

test('reussi fait avancer la ceinture, echoue la laisse', async () => {
  const s = uniq()
  const mk = async (n, tel) => (await club.call('POST', '/api/members', {
    name: n, phone: tel, disciplineId, joinDate: monthsAgo(10), subExpiry: inDays(300),
  })).data.id

  const winner = await mk(`Recu ${s}`, `0635${s.slice(0, 6)}`)
  const loser = await mk(`Recale ${s}`, `0636${s.slice(0, 6)}`)

  const c1 = await club.call('POST', '/api/grades/sessions', {
    memberId: winner, scheduledDate: inDays(0), toGradeId: ladder[1].id,
  })
  const c2 = await club.call('POST', '/api/grades/sessions', {
    memberId: loser, scheduledDate: inDays(0), toGradeId: ladder[1].id,
  })

  await club.call('POST', `/api/grades/sessions/${c1.data.id}/decision`, { passed: true })
  await club.call('POST', `/api/grades/sessions/${c2.data.id}/decision`, { passed: false })

  const list = await club.call('GET', '/api/members?limit=200')
  const found = n => list.data.members.find(m => m.id === n)
  assert.equal(found(winner).grade_label, ladder[1].label, 'la ceinture doit avancer')
  assert.equal(found(loser).grade_label, null, 'un echec laisse la ceinture inchangee')
})

test('la ceinture visee doit appartenir a l echelle de la discipline', async () => {
  const s = uniq()
  const m = await club.call('POST', '/api/members', {
    name: `Hors ${s}`, phone: `0637${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(10), subExpiry: inDays(300),
  })
  // Un identifiant invente ne doit pas passer : sans cette verification, un
  // appel direct ferait passer un karateka a une ceinture d une autre
  // discipline.
  const res = await club.call('POST', '/api/grades/sessions', {
    memberId: m.data.id, scheduledDate: inDays(0), toGradeId: 'niveau-invente',
  })
  assert.ok(res.status >= 400, `statut inattendu : ${res.status}`)
})

// 4 — Convocation manuelle -------------------------------------------------

test('un membre hors des regles se convoque a la main, avec son motif', async () => {
  const s = uniq()
  // Inscrit hier : la regle des trois mois l'exclut de tous les eligibles.
  const m = await club.call('POST', '/api/members', {
    name: `Transfert ${s}`, phone: `0638${s.slice(0, 6)}`,
    disciplineId, joinDate: inDays(-1), subExpiry: inDays(300),
  })
  const id = m.data.id

  const view = await club.call('GET', '/api/grades')
  assert.ok(!view.data.eligible.some(e => e.id === id),
    'inscrit hier : il ne doit pas etre dans les eligibles')

  // Mais il doit etre convocable a la main : la regle est un defaut, pas une
  // loi — celui-ci arrive d'un autre club avec son grade.
  const list = await club.call('GET', '/api/grades/schedulable')
  const row = list.data.members.find(p => p.id === id)
  assert.ok(row, 'il doit apparaitre dans les convocables')
  assert.equal(row.senior_ok, 0, 'et etre signale comme hors des regles')
  assert.equal(row.sub_ok, 1)

  const conv = await club.call('POST', '/api/grades/sessions', {
    memberId: id, scheduledDate: inDays(0), toGradeId: ladder[1].id,
    notes: 'Arrive du club voisin, ceinture deja acquise',
  })
  assert.equal(conv.status, 201, JSON.stringify(conv.data))

  const after = await club.call('GET', '/api/grades')
  const sess = after.data.sessions.find(x => x.id === conv.data.id)
  assert.match(sess.notes, /club voisin/, 'le motif doit rester attache au passage')

  // Et il doit survivre a la decision : sans commentaire de jugement, la
  // raison de la convocation est la seule trace expliquant l'exception.
  assert.equal((await club.call('POST', `/api/grades/sessions/${conv.data.id}/decision`,
    { passed: true })).status, 200)
  const done = await club.call('GET', '/api/grades')
  const hist = done.data.sessions.find(x => x.id === conv.data.id)
  assert.match(hist.notes, /club voisin/,
    'une decision sans commentaire ne doit pas effacer le motif')
  assert.equal(hist.status, 'passed')
})

test('exactement trois mois le jour de la session : eligible', async () => {
  const s = uniq()
  // La borne est « au moins trois mois », pas « plus de trois mois ». Un
  // membre qui les atteint pile le jour du passage doit passer.
  const session = inDays(40)
  const exactly = new Date(`${session}T00:00:00Z`)
  exactly.setUTCMonth(exactly.getUTCMonth() - 3)
  const joinDate = exactly.toISOString().slice(0, 10)

  const m = await club.call('POST', '/api/members', {
    name: `Pile ${s}`, phone: `0640${s.slice(0, 6)}`,
    disciplineId, joinDate, subExpiry: inDays(300),
  })
  assert.equal(m.status, 201, JSON.stringify(m.data))

  const view = await club.call('GET', `/api/grades?date=${session}`)
  assert.ok(view.data.eligible.some(e => e.id === m.data.id),
    `inscrit le ${joinDate} pour une session le ${session} : trois mois pile, il doit etre eligible`)

  // Et un jour de moins ne suffit pas : la borne est bien la, pas ailleurs.
  const s2 = uniq()
  const tooYoung = new Date(`${session}T00:00:00Z`)
  tooYoung.setUTCMonth(tooYoung.getUTCMonth() - 3)
  tooYoung.setUTCDate(tooYoung.getUTCDate() + 1)
  const m2 = await club.call('POST', '/api/members', {
    name: `Presque ${s2}`, phone: `0641${s2.slice(0, 6)}`,
    disciplineId, joinDate: tooYoung.toISOString().slice(0, 10), subExpiry: inDays(300),
  })
  const view2 = await club.call('GET', `/api/grades?date=${session}`)
  assert.ok(!view2.data.eligible.some(e => e.id === m2.data.id),
    'un jour de moins que trois mois ne doit pas suffire')
})

test('un passage ne se juge pas avant sa date', async () => {
  const s = uniq()
  const m = await club.call('POST', '/api/members', {
    name: `Futur ${s}`, phone: `0642${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(10), subExpiry: inDays(300),
  })
  const conv = await club.call('POST', '/api/grades/sessions', {
    memberId: m.data.id, scheduledDate: inDays(20), toGradeId: ladder[0].id,
  })
  assert.equal(conv.status, 201)

  // Le bouton est grise cote ecran, mais un bouton grise est une politesse,
  // pas une regle : la route doit refuser d'elle-meme.
  const early = await club.call('POST', `/api/grades/sessions/${conv.data.id}/decision`,
    { passed: true })
  assert.ok(early.status >= 400, `juge en avance, statut ${early.status}`)

  const list = await club.call('GET', '/api/members?limit=200')
  assert.equal(list.data.members.find(x => x.id === m.data.id).grade_label, null,
    'aucune ceinture ne doit avoir ete accordee')
})

test('un passage ne se juge qu une fois', async () => {
  const s = uniq()
  const m = await club.call('POST', '/api/members', {
    name: `Unique ${s}`, phone: `0643${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(10), subExpiry: inDays(300),
  })
  const conv = await club.call('POST', '/api/grades/sessions', {
    memberId: m.data.id, scheduledDate: inDays(0), toGradeId: ladder[1].id,
  })
  assert.equal((await club.call('POST', `/api/grades/sessions/${conv.data.id}/decision`,
    { passed: true })).status, 200)

  // Le second jugement doit etre refuse. Sans ce garde, un « echoue » pose
  // apres coup faisait mentir l'historique : le statut passait a echoue, mais
  // la ceinture restait acquise — seule la reussite la fait monter.
  const again = await club.call('POST', `/api/grades/sessions/${conv.data.id}/decision`,
    { passed: false })
  assert.ok(again.status >= 400, `second jugement accepte, statut ${again.status}`)

  const done = await club.call('GET', '/api/grades')
  const sess = done.data.sessions.find(x => x.id === conv.data.id)
  assert.equal(sess.status, 'passed', 'le resultat d origine doit tenir')
  const list = await club.call('GET', '/api/members?limit=200')
  assert.equal(list.data.members.find(x => x.id === m.data.id).grade_label, ladder[1].label)
})

test('la ceinture du tableau des membres suit le passage reussi', async () => {
  const s = uniq()
  const m = await club.call('POST', '/api/members', {
    name: `Tableau ${s}`, phone: `0644${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(10), subExpiry: inDays(300),
  })
  const id = m.data.id

  const before = await club.call('GET', '/api/members?limit=200')
  const b = before.data.members.find(x => x.id === id)
  assert.equal(b.grade_label, null, 'sans grade au depart')

  const conv = await club.call('POST', '/api/grades/sessions', {
    memberId: id, scheduledDate: inDays(0), toGradeId: ladder[2].id,
  })
  await club.call('POST', `/api/grades/sessions/${conv.data.id}/decision`, { passed: true })

  // Meme source de verite que l'ecran des passages : members.grade_id.
  const after = await club.call('GET', '/api/members?limit=200')
  const a = after.data.members.find(x => x.id === id)
  assert.equal(a.grade_label, ladder[2].label)
  assert.equal(a.grade_color, ladder[2].color, 'la vraie couleur de la ceinture, pas l accent')
})

test('un membre deja convoque ne l est pas deux fois', async () => {
  const s = uniq()
  const m = await club.call('POST', '/api/members', {
    name: `Double ${s}`, phone: `0639${s.slice(0, 6)}`,
    disciplineId, joinDate: monthsAgo(10), subExpiry: inDays(300),
  })
  const id = m.data.id
  assert.equal((await club.call('POST', '/api/grades/sessions', {
    memberId: id, scheduledDate: inDays(30), toGradeId: ladder[0].id,
  })).status, 201)

  const list = await club.call('GET', '/api/grades/schedulable')
  assert.ok(!list.data.members.some(p => p.id === id),
    'une convocation en attente tient la place, meme pour la saisie manuelle')

  // Et la route refuse d'elle-meme : un filtre d'affichage n'est pas une
  // regle. Deux onglets ouverts suffisaient a convoquer deux fois.
  const twice = await club.call('POST', '/api/grades/sessions', {
    memberId: id, scheduledDate: inDays(30), toGradeId: ladder[0].id,
  })
  assert.ok(twice.status >= 400, `double convocation acceptee, statut ${twice.status}`)
})

test('la date de session affichee est bien celle du cycle, sans decalage', async () => {
  // Le KPI affiche « convoques pour le <date de session> ». Cette date vient
  // du serveur ; on verifie qu'elle tombe sur la grille et dans l'annee
  // attendue, pour qu'aucun decalage d'annee ne puisse s'y glisser.
  const view = await club.call('GET', '/api/grades')
  const d = view.data.sessionDate
  const today = new Date().toISOString().slice(0, 10)
  assert.equal(d, view.data.nextSessionDate, 'sans date choisie, la session est la prochaine')
  assert.ok(d >= today, 'la prochaine session ne peut pas etre passee')
  assert.ok(isOnGrid(view.data.anchorMonth, d), `${d} doit tomber sur la grille`)
  // Au plus un an devant : la grille a quatre dates par an.
  const inAYear = new Date(); inAYear.setUTCFullYear(inAYear.getUTCFullYear() + 1)
  assert.ok(d <= inAYear.toISOString().slice(0, 10),
    `${d} est trop loin : la prochaine session ne peut pas depasser un an`)

  // Et une date explicite est rendue telle quelle, sans reinterpretation.
  const picked = await club.call('GET', '/api/grades?date=2026-12-01')
  assert.equal(picked.data.sessionDate, '2026-12-01')
})

test('le mois d ancrage se regle et deplace la grille', async () => {
  assert.equal((await club.call('PUT', '/api/grades/settings', { anchorMonth: 1 })).status, 200)
  const view = await club.call('GET', '/api/grades')
  assert.equal(view.data.anchorMonth, 1)
  assert.ok(isOnGrid(1, view.data.nextSessionDate),
    `${view.data.nextSessionDate} devrait tomber sur la grille ancree en janvier`)

  assert.equal((await club.call('PUT', '/api/grades/settings', { anchorMonth: 13 })).status, 400)
  assert.equal((await club.call('PUT', '/api/grades/settings', { anchorMonth: 9 })).status, 200)
})
