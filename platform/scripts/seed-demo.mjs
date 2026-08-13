#!/usr/bin/env node
// Remplit la base LOCALE de donnees de demonstration.
//
// Trois clubs volontairement dissemblables : un club de karate a deux salles,
// un club de judo, une salle de boxe sans grades. C'est ce contraste qui
// montre que rien n'est presuppose du sport pratique.
//
//   node scripts/seed-demo.mjs
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const PASSWORD = 'demo-motdepasse-2026'

function control(sql) {
  return execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', 'gymflow-control', '--local', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT },
  )
}

function session() {
  let cookie = null
  return async (method, path, body) => {
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
      data = await res.json().catch(() => null)
    }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`)
    return data
  }
}

const CLUBS = [
  {
    slug: 'noujoum-chaouia', name: 'Noujoum El Chaouia', owner: 'Marwane Ouahid',
    at: { lat: 33.5650, lng: -7.6300, label: 'Sbata, Casablanca' },
    email: 'karate@demo.ma', accent: '#0e4f8f',
    branches: ['Salle Sbata', 'Salle Rachad'],
    disciplines: [
      { name: 'Karate', grades: ['Blanche', 'Jaune', 'Orange', 'Verte', 'Bleue', 'Marron', 'Noire'] },
      { name: 'Aerobic', grades: [] },
    ],
    members: [
      ['Youssef Alaoui', '0661000001'], ['Salma Bennani', '0661000002'],
      ['Omar Tazi', '0661000003'], ['Nour El Idrissi', '0661000004'],
      ['Anas Berrada', '0661000005'], ['Lina Cherkaoui', '0661000006'],
    ],
  },
  {
    slug: 'judo-atlas', name: 'Judo Club Atlas', owner: 'Hicham Mansouri',
    at: { lat: 31.6295, lng: -7.9811, label: 'Gueliz, Marrakech' },
    email: 'judo@demo.ma', accent: '#1f6b47',
    branches: ['Dojo Central'],
    disciplines: [
      { name: 'Judo', grades: ['6e kyu', '5e kyu', '4e kyu', '3e kyu', '2e kyu', '1er kyu', '1er dan'] },
    ],
    members: [
      ['Rachid Amrani', '0662000001'], ['Imane Saidi', '0662000002'],
      ['Karim Belhaj', '0662000003'],
    ],
  },
  {
    slug: 'ring-casablanca', name: 'Ring Casablanca', owner: 'Sofia Naciri',
    at: { lat: 33.5883, lng: -7.6114, label: 'Maarif, Casablanca' },
    email: 'boxe@demo.ma', accent: '#a8232b',
    branches: ['Salle Maarif'],
    disciplines: [{ name: 'Boxe anglaise', grades: [] }],
    members: [['Mehdi Fassi', '0663000001'], ['Zineb Kadiri', '0663000002']],
  },
]

const today = new Date()
const inDays = n => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10)

// Mois d'adhesion, bornes plus bas au mois courant.
const JOIN_MONTHS = [0, 3, 4, 4, 5, 7, 1, 6, 2, 9]

console.log(`Cible : ${BASE}\n`)

// --reset vide le plan de controle avant de semer.
//
// Par SQL et non en supprimant .wrangler/state : on n'a donc pas besoin
// d'arreter le serveur. Les bases des clubs (Durable Objects) survivent, mais
// plus rien ne les designe — les nouveaux clubs recoivent de nouveaux
// identifiants, donc de nouveaux objets.
if (process.argv.includes('--reset')) {
  for (const table of [
    'platform_audit', 'security_events', 'known_ips', 'login_attempts',
    'ip_blocklist', 'org_locations', 'org_invoices', 'org_billing',
    'org_stats', 'sessions', 'memberships', 'organizations', 'users',
  ]) {
    control(`DELETE FROM ${table}`)
  }
  console.log('Plan de controle vide.\n')
}

const located = []

for (const club of CLUBS) {
  const call = session()
  const { orgId } = await call('POST', '/api/auth/signup', {
    clubName: club.name, slug: club.slug, name: club.owner,
    email: club.email, password: PASSWORD,
  })

  await call('PUT', '/api/branding', { theme: { accent: club.accent, mode: 'system' } })

  const branchIds = []
  for (const name of club.branches) {
    const { id } = await call('POST', '/api/branches', { name })
    branchIds.push(id)
  }

  const disciplineIds = []
  for (const d of club.disciplines) {
    const { id } = await call('POST', '/api/disciplines', {
      name: d.name,
      grades: d.grades.map(label => ({ label })),
    })
    disciplineIds.push(id)
  }

  // Echeances etalees : certains abonnements courent, un expire bientot, un
  // a deja expire. Un tableau de bord ou tout est vert n'apprend rien.
  //
  // Les dates d'adhesion sont reparties sur l'annee, et jamais dans le futur :
  // la comptabilite compte les inscriptions par mois, un seul mois rempli ne
  // montrerait pas ce que le graphique sait faire.
  for (const [index, [name, phone]] of club.members.entries()) {
    const offsets = [40, 22, 5, -3, 60, 15]
    const month = Math.min(JOIN_MONTHS[index % JOIN_MONTHS.length], today.getMonth())
    const day = 1 + ((index * 7) % 27)
    const joinDate = `${today.getFullYear()}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    // Un non-assure par club : c'est precisement ce cas que l'ecran des
    // alertes doit faire remonter.
    const insured = index % 4 !== 3

    const { id } = await call('POST', '/api/members', {
      name, phone,
      branchId: branchIds[index % branchIds.length],
      disciplineId: disciplineIds[0],
      subExpiry: inDays(offsets[index % offsets.length]),
      joinDate,
      isInsured: insured,
      insExpiry: insured ? inDays(offsets[index % offsets.length] + 30) : null,
    })

    // Encaissements : l'inscription au jour de l'adhesion, l'assurance dans
    // la foulee, puis quelques mensualites. La caisse reelle diverge donc de
    // l'estimation tarifaire — c'est exactement ce que la page doit montrer.
    await call('POST', '/api/payments', {
      memberId: id, amountCents: 15_000, type: 'registration', paidAt: joinDate,
    })
    if (insured) {
      await call('POST', '/api/payments', {
        memberId: id, amountCents: 5_000, type: 'insurance', paidAt: joinDate,
      })
    }
    for (let m = month; m <= today.getMonth(); m += 2) {
      await call('POST', '/api/payments', {
        memberId: id, amountCents: 10_000, type: 'monthly',
        paidAt: `${today.getFullYear()}-${String(m + 1).padStart(2, '0')}-05`,
      })
    }
  }

  located.push({ orgId, at: club.at })
  console.log(`  ${club.name.padEnd(22)} ${club.email.padEnd(16)} ${club.members.length} membres  ${orgId}`)
}

// Compte exploitant : cree SANS club. Il supervise la plateforme, il n'en
// gere aucun — lui donner une organisation n'aurait pas de sens et lui
// afficherait des ecrans de club vides.
execFileSync(
  process.execPath,
  [fileURLToPath(new URL('./create-operator.mjs', import.meta.url)),
   'admin@demo.ma', 'Operateur GymFlow', PASSWORD],
  { stdio: 'ignore', cwd: ROOT },
)
console.log(`  ${'Exploitant (sans club)'.padEnd(22)} admin@demo.ma`)

// create-operator lance wrangler, ce qui fait brievement tomber le serveur de
// developpement : sans cette attente, l'appel suivant echoue en ECONNRESET et
// le seed accuse le code.
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break } catch { /* pas encore la */ }
  await new Promise(r => setTimeout(r, 500))
}

// Emplacements des salles, poses par l'exploitant : la route est reservee a
// la plateforme, un proprietaire de club ne peut pas se situer lui-meme.
const ops = session()
await ops('POST', '/api/auth/login', { email: 'admin@demo.ma', password: PASSWORD })
for (const { orgId, at } of located) {
  if (at) await ops('PUT', `/api/admin/clubs/${orgId}/location`, at)
}
console.log(`  ${'Emplacements poses'.padEnd(22)} ${located.filter(l => l.at).length} salle(s) sur la carte`)

// Abonnements a la plateforme.
//
// Trois situations volontairement differentes : un club a jour, un dont
// l'echeance approche, un deja expire. Un ecran de facturation ou tout est
// regle ne montre rien de ce qu'il sait faire.
const iso = d => d.toISOString().slice(0, 10)
const shift = n => iso(new Date(today.getTime() + n * 86_400_000))

// « Couvert jusqu'au » est la fin de la derniere periode REGLEE. Un club dont
// l'echeance en cours reste ouverte est donc expire, pas « bientot » : pour
// obtenir le cas « expire bientot », tout doit etre paye et la couverture
// s'arreter dans quelques jours.
const PLANS = [
  { price: 40_000, cycle: 3, phone: '212661000001', endsIn: 70, leaveOpen: false },  // a jour
  { price: 15_000, cycle: 1, phone: '212662000001', endsIn: 6, leaveOpen: false },   // expire bientot
  { price: 15_000, cycle: 1, phone: '212663000001', endsIn: -18, leaveOpen: true },  // expire, impaye
]

for (const [i, { orgId }] of located.entries()) {
  const plan = PLANS[i % PLANS.length]
  await ops('PUT', `/api/admin/billing/${orgId}`, {
    priceCents: plan.price, cycleMonths: plan.cycle, phone: plan.phone,
    startedAt: shift(-plan.cycle * 30 * 3), expiresAt: null,
  })

  // Trois periodes consecutives, dont la derniere se termine a la date
  // voulue : les deux premieres sont reglees, la derniere depend du cas.
  for (let k = 2; k >= 0; k--) {
    const end = shift(plan.endsIn - k * plan.cycle * 30)
    const start = shift(plan.endsIn - (k + 1) * plan.cycle * 30 + 1)
    const { id } = await ops('POST', `/api/admin/billing/${orgId}/invoices`, {
      periodStart: start, periodEnd: end, amountCents: plan.price, dueDate: start,
    })
    if (k > 0 || !plan.leaveOpen) {
      await ops('POST', `/api/admin/invoices/${id}/paid`, { paidAt: start })
    }
  }
}
console.log(`  ${'Abonnements'.padEnd(22)} ${located.length} club(s) : a jour, bientot, expire`)

// Remplit le cache d'agregats pour que la supervision affiche des chiffres
// tout de suite, au lieu d'attendre le prochain passage du cron.
// (wrangler dev expose la tache planifiee sous /cdn-cgi/handler/scheduled)
await fetch(`${BASE}/cdn-cgi/handler/scheduled`).catch(() => {})

console.log(`\nMot de passe pour tous les comptes : ${PASSWORD}`)
console.log(`\n  ${BASE}/login`)
