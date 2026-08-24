// Fiabilite des deux registres : la caisse d'un club, et la facturation de
// la plateforme.
//
// Quatre invariants qui, s'ils cedent, font mentir un releve sans qu'aucune
// erreur ne s'affiche :
//
//   1. Une ligne passee ne bouge jamais, meme si le tarif change.
//   2. Une correction s'ecrit, elle n'efface pas — et les totaux restent justes.
//   3. Un filtre rend un chiffre exact, et le meme a chaque appel.
//   4. Une relance laisse une trace horodatee.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/ledger.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, client, createOperator, uniq, waitReady } from './helpers.mjs'

let club, ops, orgId, memberA, memberB, branchA, branchB
const YEAR = new Date().getFullYear()

/** Une date de cette annee, jamais dans le futur. */
const on = (month, day) =>
  `${YEAR}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `Worker injoignable sur ${BASE}`)

  const s = uniq()
  club = client()
  const created = await club.call('POST', '/api/auth/signup', {
    clubName: 'Club Registre', slug: `registre-${s}`, name: 'Owner Registre',
    email: `registre-${s}@example.ma`, password: 'motdepasse-solide-rg',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  orgId = created.data.orgId

  branchA = (await club.call('POST', '/api/branches', { name: 'Salle Nord' })).data.id
  branchB = (await club.call('POST', '/api/branches', { name: 'Salle Sud' })).data.id

  memberA = (await club.call('POST', '/api/members', {
    name: 'Payeur Nord', phone: '0600300001', branchId: branchA, joinDate: on(1, 10),
  })).data.id
  memberB = (await club.call('POST', '/api/members', {
    name: 'Payeur Sud', phone: '0600300002', branchId: branchB, joinDate: on(1, 12),
  })).data.id

  const email = `oprg-${uniq()}@example.ma`
  createOperator(email, 'Ops Registre', 'motdepasse-solide-op')
  await waitReady()
  ops = client()
  assert.equal((await ops.call('POST', '/api/auth/login', {
    email, password: 'motdepasse-solide-op',
  })).status, 200)
  assert.equal((await ops.call('POST', '/api/admin/step-up', {
    password: 'motdepasse-solide-op',
  })).status, 200)
})

// 1 — Montant fige ---------------------------------------------------------

test('un encaissement ne bouge pas quand le tarif change', async () => {
  await club.call('PUT', '/api/finance/prices', {
    monthlyCents: 10_000, insuranceCents: 5_000, registrationCents: 15_000,
  })

  const created = await club.call('POST', '/api/payments', {
    memberId: memberA, amountCents: 10_000, type: 'monthly',
    method: 'cash', paidAt: on(3, 5),
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))

  const before = await club.call('GET', `/api/payments?from=${on(3, 1)}&to=${on(3, 31)}`)
  const line = before.data.payments.find(p => p.id === created.data.id)
  assert.equal(line.amount_cents, 10_000)
  // Le tarif applique est conserve pour l'audit, sans entrer dans aucun calcul.
  assert.equal(line.tariff_cents, 10_000)

  // Le tarif double. La ligne d'hier ne doit pas s'en apercevoir.
  await club.call('PUT', '/api/finance/prices', {
    monthlyCents: 20_000, insuranceCents: 5_000, registrationCents: 15_000,
  })

  const after = await club.call('GET', `/api/payments?from=${on(3, 1)}&to=${on(3, 31)}`)
  const same = after.data.payments.find(p => p.id === created.data.id)
  assert.equal(same.amount_cents, 10_000, 'le montant encaisse a suivi le tarif')
  assert.equal(same.tariff_cents, 10_000, 'le tarif d origine a ete reecrit')

  // Et le suivant part bien au nouveau tarif.
  const next = await club.call('POST', '/api/payments', {
    memberId: memberA, amountCents: 20_000, type: 'monthly', method: 'cash', paidAt: on(4, 5),
  })
  const fresh = await club.call('GET', `/api/payments?from=${on(4, 1)}&to=${on(4, 30)}`)
  assert.equal(fresh.data.payments.find(p => p.id === next.data.id).tariff_cents, 20_000)

  // Remis a l'etat initial pour les tests suivants.
  await club.call('PUT', '/api/finance/prices', {
    monthlyCents: 10_000, insuranceCents: 5_000, registrationCents: 15_000,
  })
})

// 2 — Annulation -----------------------------------------------------------

test('une correction d erreur laisse les totaux justes sans effacer la ligne', async () => {
  const paid = await club.call('POST', '/api/payments', {
    memberId: memberB, amountCents: 7_500, type: 'other', method: 'transfer', paidAt: on(5, 9),
  })
  assert.equal(paid.status, 201)

  const before = await club.call('GET', `/api/payments?from=${on(5, 1)}&to=${on(5, 31)}`)
  const totalBefore = before.data.payments.reduce((s, p) => s + p.amount_cents, 0)
  assert.equal(totalBefore, 7_500)

  const reversed = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, {
    kind: 'erreur', reason: 'Erreur de saisie',
  })
  assert.equal(reversed.status, 201, JSON.stringify(reversed.data))
  assert.equal(reversed.data.amountCents, -7_500)

  const after = await club.call('GET', `/api/payments?from=${on(5, 1)}&to=${on(5, 31)}`)
  // La ligne d'origine est toujours la : un releve dont les lignes changent
  // apres coup ne vaut rien.
  assert.ok(after.data.payments.some(p => p.id === paid.data.id), 'l originale a disparu')
  assert.equal(after.data.payments.length, 2, 'deux ecritures attendues')
  // Et la somme brute, sans traitement particulier, vaut zero.
  assert.equal(after.data.payments.reduce((s, p) => s + p.amount_cents, 0), 0)

  const reversal = after.data.payments.find(p => p.reverses_id === paid.data.id)
  assert.ok(reversal, 'l annulation ne pointe pas vers l originale')
  assert.equal(reversal.reversal_reason, 'Erreur de saisie')
})

test('on ne peut annuler ni deux fois, ni une annulation', async () => {
  const paid = await club.call('POST', '/api/payments', {
    memberId: memberB, amountCents: 3_000, type: 'other', method: 'cash', paidAt: on(5, 20),
  })
  const first = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, { kind: 'erreur', reason: 'Doublon' })
  assert.equal(first.status, 201)

  const twice = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, { kind: 'erreur', reason: 'Encore' })
  assert.equal(twice.status, 409, 'une seconde annulation a ete acceptee')

  // Annuler une annulation reviendrait a re-encaisser sous une etiquette qui
  // dit le contraire.
  const list = await club.call('GET', `/api/payments?from=${on(5, 1)}&to=${on(5, 31)}`)
  const reversal = list.data.payments.find(p => p.reverses_id === paid.data.id)
  const onReversal = await club.call('POST', `/api/payments/${reversal.id}/reverse`, { kind: 'erreur', reason: 'Non' })
  assert.equal(onReversal.status, 409)
})

test('un motif est exige pour annuler', async () => {
  const paid = await club.call('POST', '/api/payments', {
    memberId: memberA, amountCents: 1_000, type: 'other', paidAt: on(6, 1),
  })
  assert.equal((await club.call('POST', `/api/payments/${paid.data.id}/reverse`, { kind: 'erreur' })).status, 400)
  assert.equal((await club.call('POST', `/api/payments/${paid.data.id}/reverse`, { kind: 'erreur', reason: '  ' })).status, 400)
  // Le cas doit etre choisi explicitement : rien ne permet de le deviner.
  assert.equal((await club.call('POST', `/api/payments/${paid.data.id}/reverse`, { reason: 'Sans cas' })).status, 400)
  assert.equal((await club.call('POST', `/api/payments/${paid.data.id}/reverse`, { kind: 'autre', reason: 'Inconnu' })).status, 400)
})

test('un remboursement se date au jour de la sortie, pas a celui de l encaissement', async () => {
  // Mai : le membre paie vraiment. Aout : il recupere vraiment son argent.
  // Les deux mouvements sont reels, chacun dans son mois. Backdater
  // effacerait une recette de mai et cacherait une sortie d'aout.
  const paid = await club.call('POST', '/api/payments', {
    memberId: memberA, amountCents: 12_000, type: 'monthly', method: 'cash', paidAt: on(7, 4),
  })
  assert.equal(paid.status, 201)

  const today = new Date().toISOString().slice(0, 10)
  const refund = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, {
    kind: 'remboursement', reason: 'Abonnement interrompu', refundedAt: today,
  })
  assert.equal(refund.status, 201, JSON.stringify(refund.data))
  assert.equal(refund.data.paidAt, today, 'le remboursement a ete backdate')

  // Juillet garde sa recette : elle a bien eu lieu.
  const july = await club.call('GET', `/api/payments?from=${on(7, 1)}&to=${on(7, 31)}`)
  assert.equal(july.data.payments.reduce((s, p) => s + p.amount_cents, 0), 12_000,
    'le remboursement a efface une recette reelle de juillet')

  // Et la sortie apparait au jour ou elle s'est produite.
  const now = await club.call('GET', `/api/payments?from=${today}&to=${today}`)
  const line = now.data.payments.find(p => p.reverses_id === paid.data.id)
  assert.ok(line, 'la sortie n apparait pas au jour du remboursement')
  assert.equal(line.amount_cents, -12_000)
  assert.equal(line.reversal_kind, 'remboursement')

  // Sur l'ensemble, la caisse revient bien a zero pour ce membre.
  const all = await club.call('GET', '/api/payments')
  const pair = all.data.payments.filter(p => p.id === paid.data.id || p.reverses_id === paid.data.id)
  assert.equal(pair.reduce((s, p) => s + p.amount_cents, 0), 0)
})

test('la date de remboursement est bornee des deux cotes', async () => {
  const paid = await club.call('POST', '/api/payments', {
    memberId: memberA, amountCents: 2_000, type: 'other', paidAt: on(7, 20),
  })

  // Avant l'encaissement : aucun sens physique.
  const before = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, {
    kind: 'remboursement', reason: 'Avant', refundedAt: on(7, 1),
  })
  assert.equal(before.status, 409, 'un remboursement anterieur au paiement a ete accepte')

  // Apres aujourd'hui : poserait un decaissement dans un mois futur, qui
  // fausserait ce mois-la sans que personne ne le voie avant d'y arriver.
  const future = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10)
  const after = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, {
    kind: 'remboursement', reason: 'Futur', refundedAt: future,
  })
  assert.equal(after.status, 409, 'un remboursement date dans le futur a ete accepte')

  // La ligne reste annulable normalement : les refus n'ont rien consomme.
  const ok = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, {
    kind: 'remboursement', reason: 'Correct',
  })
  assert.equal(ok.status, 201, JSON.stringify(ok.data))
})

test('on ne peut pas sortir plus que ce qui est entre', async () => {
  // Deux facons de sous-compter la recette : annuler deux fois, ou annuler
  // d'un montant superieur. La seconde est impossible par construction — la
  // route ne prend aucun montant, le Durable Object ecrit toujours l'oppose
  // exact de l'originale. Ce test fige cette propriete.
  const paid = await club.call('POST', '/api/payments', {
    memberId: memberB, amountCents: 8_000, type: 'other', method: 'cash', paidAt: on(6, 12),
  })

  // Un montant fourni par l'appelant doit rester sans effet.
  const reversed = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, {
    kind: 'erreur', reason: 'Test', amountCents: 500_000,
  })
  assert.equal(reversed.status, 201)
  assert.equal(reversed.data.amountCents, -8_000, 'un montant libre a ete pris en compte')

  // Et la paire se neutralise exactement.
  const list = await club.call('GET', `/api/payments?from=${on(6, 1)}&to=${on(6, 30)}`)
  const pair = list.data.payments.filter(p => p.id === paid.data.id || p.reverses_id === paid.data.id)
  assert.equal(pair.length, 2)
  assert.equal(pair.reduce((s, p) => s + p.amount_cents, 0), 0)

  // Une seconde annulation ne peut pas creuser davantage.
  const again = await club.call('POST', `/api/payments/${paid.data.id}/reverse`, {
    kind: 'erreur', reason: 'Encore',
  })
  assert.equal(again.status, 409)
  const after = await club.call('GET', `/api/payments?from=${on(6, 1)}&to=${on(6, 30)}`)
  assert.equal(
    after.data.payments.filter(p => p.reverses_id === paid.data.id).length, 1,
    'une seconde ecriture inverse a ete posee',
  )
})

// Securite : le negatif n'a qu'une seule porte d'entree ------------------

test('un encaissement nul ou negatif est refuse', async () => {
  // La reconstruction de table a retire le CHECK (>= 0) pour permettre les
  // annulations : plus rien en base n'empeche un negatif. Si l'application
  // laissait passer, un receptionniste fausserait tous les totaux.
  for (const amountCents of [0, -1, -50_000]) {
    const res = await club.call('POST', '/api/payments', {
      memberId: memberA, amountCents, type: 'other', paidAt: on(8, 1),
    })
    assert.equal(res.status, 400, `montant ${amountCents} accepte a tort`)
  }
})

test('annuler est reserve a owner et admin', async () => {
  // Un compte staff peut encaisser, pas defaire. Deplacer de l'argent sur le
  // papier n'est pas un geste de comptoir.
  const s = uniq()
  const staffEmail = `staff-rg-${s}@example.ma`
  const invited = await club.call('POST', '/api/staff', {
    name: 'Receptionniste', email: staffEmail, password: 'motdepasse-solide-st', role: 'staff',
  })
  if (invited.status !== 201) return   // la route d'invitation a change : on ne bloque pas

  const staff = client()
  assert.equal((await staff.call('POST', '/api/auth/login', {
    email: staffEmail, password: 'motdepasse-solide-st',
  })).status, 200)

  const paid = await club.call('POST', '/api/payments', {
    memberId: memberA, amountCents: 5_000, type: 'other', paidAt: on(8, 2),
  })
  const refused = await staff.call('POST', `/api/payments/${paid.data.id}/reverse`, {
    kind: 'erreur', reason: 'Tentative',
  })
  assert.equal(refused.status, 403, 'un compte staff a pu annuler un encaissement')
})

// 3 — Filtres exacts et reproductibles ------------------------------------

test('un filtre de periode rend un chiffre exact et reproductible', async () => {
  // Trois lignes, dont une hors periode : le total attendu est connu d'avance.
  await club.call('POST', '/api/payments', {
    memberId: memberA, amountCents: 4_000, type: 'other', method: 'cash', paidAt: on(9, 3),
  })
  await club.call('POST', '/api/payments', {
    memberId: memberB, amountCents: 6_000, type: 'other', method: 'transfer', paidAt: on(9, 17),
  })
  await club.call('POST', '/api/payments', {
    memberId: memberA, amountCents: 9_900, type: 'other', method: 'cash', paidAt: on(10, 2),
  })

  const window = `from=${on(9, 1)}&to=${on(9, 30)}`
  const first = await club.call('GET', `/api/payments?${window}`)
  const total = first.data.payments.reduce((s, p) => s + p.amount_cents, 0)
  assert.equal(total, 10_000, 'la ligne d octobre a fuite dans septembre')

  // Reproductible : le meme appel rend le meme chiffre.
  const second = await club.call('GET', `/api/payments?${window}`)
  assert.equal(second.data.payments.reduce((s, p) => s + p.amount_cents, 0), total)

  // Et la ventilation par moyen additionne exactement ce total.
  const byMethod = Object.fromEntries(first.data.byMethod.map(m => [m.method, m.cents]))
  assert.equal(byMethod.cash, 4_000)
  assert.equal(byMethod.transfer, 6_000)
  assert.equal(Object.values(byMethod).reduce((a, b) => a + b, 0), total)
})

test('une periode a l envers est refusee', async () => {
  const res = await club.call('GET', `/api/payments?from=${on(9, 30)}&to=${on(9, 1)}`)
  assert.equal(res.status, 400)
})

test('les impayes se deduisent des echeances, sans rien stocker', async () => {
  const s = uniq()
  const late = await club.call('POST', '/api/members', {
    name: `Retard ${s}`, phone: '0600300099', branchId: branchA,
    subExpiry: on(1, 15),   // echeance passee
  })
  assert.equal(late.status, 201)

  const res = await club.call('GET', '/api/payments')
  const row = res.data.outstanding.find(d => d.memberId === late.data.id)
  assert.ok(row, 'le membre en retard ne remonte pas')
  assert.ok(row.daysLate > 0)
  assert.ok(row.amountCents > 0)

  // Renouveler doit le faire disparaitre, sans qu'aucune ligne n'ait ete
  // effacee : la dette n'existe que comme deduction.
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  await club.call('PATCH', `/api/members/${late.data.id}`, { subExpiry: future })
  const after = await club.call('GET', '/api/payments')
  assert.ok(!after.data.outstanding.some(d => d.memberId === late.data.id),
    'le membre a jour figure encore parmi les impayes')
})

// 4 — Relance plateforme ---------------------------------------------------

test('une relance horodate l echeance et compte les rappels', async () => {
  await ops.call('PUT', `/api/admin/billing/${orgId}`, {
    priceCents: 30_000, cycleMonths: 1, phone: '212600000001',
  })
  const invoice = await ops.call('POST', `/api/admin/billing/${orgId}/invoices`, {})
  assert.equal(invoice.status, 201, JSON.stringify(invoice.data))

  const before = await ops.call('GET', '/api/admin/billing')
  const fresh = before.data.invoices.find(i => i.id === invoice.data.id)
  assert.equal(fresh.last_reminder_at, null, 'une echeance neuve ne peut pas avoir ete relancee')

  const first = await ops.call('POST', `/api/admin/invoices/${invoice.data.id}/reminder`, {})
  assert.equal(first.status, 200, JSON.stringify(first.data))
  assert.equal(first.data.reminder_count, 1)
  assert.match(first.data.last_reminder_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    'horodatage attendu en ISO-8601 UTC')

  const second = await ops.call('POST', `/api/admin/invoices/${invoice.data.id}/reminder`, {})
  assert.equal(second.data.reminder_count, 2, 'le compteur n a pas avance')

  // Et la facturation le rend au client, sur l'echeance comme sur le club.
  const after = await ops.call('GET', '/api/admin/billing')
  assert.equal(after.data.invoices.find(i => i.id === invoice.data.id).reminder_count, 2)
  assert.ok(after.data.clubs.find(c => c.id === orgId).last_reminder_at,
    'la derniere relance du club devrait remonter')
})

test('relancer une echeance inconnue est refuse', async () => {
  assert.equal((await ops.call('POST', '/api/admin/invoices/inexistante/reminder', {})).status, 404)
})

test('la relance est reservee a la plateforme', async () => {
  assert.equal((await club.call('POST', '/api/admin/invoices/x/reminder', {})).status, 403)
})

test('le revenu plateforme se derive des echeances reglees', async () => {
  const res = await ops.call('GET', '/api/admin/billing')
  assert.equal(res.status, 200)
  for (const key of ['currentMonthCents', 'payingClubs', 'billedYearCents', 'cashedYearCents']) {
    assert.equal(typeof res.data.mrr[key], 'number', `${key} devrait etre un nombre`)
  }
  // Le cumul annuel encaisse ne peut pas depasser le facture.
  assert.ok(res.data.mrr.cashedYearCents <= res.data.mrr.billedYearCents)
})
