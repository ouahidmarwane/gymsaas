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
    email: 'boxe@demo.ma', accent: '#a8232b',
    branches: ['Salle Maarif'],
    disciplines: [{ name: 'Boxe anglaise', grades: [] }],
    members: [['Mehdi Fassi', '0663000001'], ['Zineb Kadiri', '0663000002']],
  },
]

const today = new Date()
const inDays = n => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10)

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
    'org_stats', 'sessions', 'memberships', 'organizations', 'users',
  ]) {
    control(`DELETE FROM ${table}`)
  }
  console.log('Plan de controle vide.\n')
}

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
  club.members.forEach.length
  for (const [index, [name, phone]] of club.members.entries()) {
    const offsets = [40, 22, 5, -3, 60, 15]
    await call('POST', '/api/members', {
      name, phone,
      branchId: branchIds[index % branchIds.length],
      disciplineId: disciplineIds[0],
      subExpiry: inDays(offsets[index % offsets.length]),
    })
  }

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

// Remplit le cache d'agregats pour que la supervision affiche des chiffres
// tout de suite, au lieu d'attendre le prochain passage du cron.
// (wrangler dev expose la tache planifiee sous /cdn-cgi/handler/scheduled)
await fetch(`${BASE}/cdn-cgi/handler/scheduled`).catch(() => {})

console.log(`\nMot de passe pour tous les comptes : ${PASSWORD}`)
console.log(`\n  ${BASE}/login`)
