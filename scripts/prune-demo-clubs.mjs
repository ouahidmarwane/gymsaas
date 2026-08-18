// Nettoyage des clubs laisses par les tests.
//
// Chaque execution de la suite cree des clubs jetables — un par scenario
// d'isolation, de provisionnement, de facturation. Ils ne genent personne
// tant qu'on ne regarde pas la liste, puis un jour il y en a quatre cents.
//
// La suppression passe par la route de la plateforme, jamais par un DELETE
// SQL : trois choses meurent ensemble, et l'ordre compte — la base du club
// (son Durable Object), ses fichiers dans R2, puis sa ligne centrale. Un
// DELETE direct sur `organizations` laisserait derriere lui une base vivante
// et des photos que plus rien ne designe.
//
//   node scripts/prune-demo-clubs.mjs            (montre ce qui partirait)
//   node scripts/prune-demo-clubs.mjs --apply    (supprime pour de bon)
import process from 'node:process'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const EMAIL = process.env.OPS_EMAIL ?? 'admin@demo.ma'
const PASSWORD = process.env.OPS_PASSWORD ?? 'demo-motdepasse-2026'

/** Les seuls clubs qui survivent. Tout le reste est du decor de test. */
const KEEP = new Set((process.env.KEEP_SLUGS ?? 'noujoum-chaouia,judo-atlas')
  .split(',').map(s => s.trim()).filter(Boolean))

const apply = process.argv.includes('--apply')

let cookie = null
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  let data = null
  try { data = await res.json() } catch { /* corps vide */ }
  return { status: res.status, data }
}

const login = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD })
if (login.status !== 200) {
  console.error(`Connexion refusee (${login.status}) : ${JSON.stringify(login.data)}`)
  process.exit(1)
}

const list = await call('GET', '/api/admin/clubs')
if (list.status !== 200) {
  console.error(`Liste indisponible (${list.status})`)
  process.exit(1)
}

const clubs = list.data.clubs ?? list.data.organizations ?? []
const doomed = clubs.filter(c => !KEEP.has(c.slug))
const kept = clubs.filter(c => KEEP.has(c.slug))

console.log(`${clubs.length} clubs — ${kept.length} gardes, ${doomed.length} a supprimer`)
for (const c of kept) console.log(`  garde    ${c.slug.padEnd(28)} ${c.name}`)

if (!apply) {
  console.log('\nEssai a blanc. Relancez avec --apply pour supprimer.')
  for (const c of doomed.slice(0, 8)) console.log(`  partirait ${c.slug}`)
  if (doomed.length > 8) console.log(`  … et ${doomed.length - 8} autres`)
  process.exit(0)
}

let gone = 0
const failed = []
for (const c of doomed) {
  // Le corps reprend le slug exact : la route l'exige, precisement pour
  // qu'un appel automatique comme celui-ci ne puisse pas se tromper de club.
  const res = await call('DELETE', `/api/admin/clubs/${c.id}`, { slug: c.slug })
  if (res.status === 200) {
    gone++
    if (gone % 25 === 0) console.log(`  ${gone}/${doomed.length}…`)
  } else {
    failed.push(`${c.slug} → ${res.status} ${JSON.stringify(res.data)}`)
  }
}

console.log(`\n${gone} clubs supprimes.`)
if (failed.length) {
  console.log(`${failed.length} echecs :`)
  for (const f of failed.slice(0, 10)) console.log(`  ${f}`)
}

// Les exploitants de plateforme naissent hors de ce chemin : `createOperator`
// ecrit directement dans la base centrale, et aucun club ne les possede. La
// suppression des clubs ne les emporte donc pas, et ils s'accumulent — des
// comptes superadmin de test, avec tous les droits. Ils ne doivent jamais
// atteindre la production, et ils encombrent l'ecran de supervision.
//
// Pas de route pour cela : c'est un geste d'entretien local, pas une
// fonction du produit.
console.log(
  '\nComptes exploitants de test : la suppression des clubs ne les touche pas.\n'
  + '  node node_modules/wrangler/bin/wrangler.js d1 execute gymflow-control --local \\\n'
  + `     --command "DELETE FROM users WHERE is_platform_admin = 1 AND email_norm <> '${EMAIL}'"`,
)
