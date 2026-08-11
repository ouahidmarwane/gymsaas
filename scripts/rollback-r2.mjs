#!/usr/bin/env node
// scripts/rollback-r2.mjs
//
// Remet les colonnes fichiers des membres sur les URLs Supabase d'origine.
// Filet de sécurité si le code R2 n'est pas encore déployé en production :
// l'ancien code ne sait pas lire une référence « r2:// » et n'affiche alors
// aucune image.
//
//   node scripts/rollback-r2.mjs           # simulation
//   node scripts/rollback-r2.mjs --apply   # exécution réelle
//
// Aucune perte possible : les objets sont restés dans Supabase Storage (le
// backfill ne supprime jamais) et restent aussi dans R2. Seule la référence
// enregistrée en base change ; on peut donc refaire l'aller-retour autant de
// fois que nécessaire.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const name of ['.env.local', '.env']) {
  const file = join(ROOT, name)
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const APPLY = process.argv.includes('--apply')
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const COLUMNS = ['photo_url', 'sport_passport_url', 'document_url']

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** « r2://bucket/chemin » → URL publique Supabase équivalente. */
function toSupabaseUrl(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('r2://')) return null
  const rest = ref.slice('r2://'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const bucket = rest.slice(0, slash)
  const path = rest.slice(slash + 1)
  // Ré-encode chaque segment : c'est la forme produite à l'origine par
  // getPublicUrl (« logo%20noujoum.png »).
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encoded}`
}

console.log(APPLY
  ? '⚠  MODE RÉEL — les références repassent sur Supabase.\n'
  : 'ℹ  SIMULATION — aucune écriture. Ajoutez --apply pour exécuter.\n')

const { data: members, error } = await supabase
  .from('members')
  .select(['id', 'name', ...COLUMNS].join(', '))

if (error) {
  console.error('✗ Lecture de members impossible :', error.message)
  process.exit(1)
}

/** L'objet est-il réellement présent dans Supabase Storage ? */
async function existsInSupabase(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
  return Boolean(data?.signedUrl) && !error
}

let restored = 0, untouched = 0, failed = 0
const orphans = []

for (const m of members) {
  const patch = {}
  for (const col of COLUMNS) {
    const ref = m[col]
    if (!ref) continue
    if (!ref.startsWith('r2://')) { untouched++; continue }

    const rest = ref.slice('r2://'.length)
    const slash = rest.indexOf('/')
    const bucket = rest.slice(0, slash)
    const path = rest.slice(slash + 1)

    // Un fichier téléversé APRÈS la migration n'existe que dans R2 : le
    // remettre sur une URL Supabase pointerait vers le vide. On le laisse
    // en r2:// et on le signale.
    if (!(await existsInSupabase(bucket, path))) {
      orphans.push(`${m.name} · ${col}`)
      continue
    }

    patch[col] = toSupabaseUrl(ref)
    console.log(`  ← ${m.name} · ${col}`)
  }

  if (!Object.keys(patch).length) continue
  restored += Object.keys(patch).length
  if (!APPLY) continue
  const { error: upErr } = await supabase.from('members').update(patch).eq('id', m.id)
  if (upErr) { failed++; console.error(`  ✗ ${m.name} — ${upErr.message}`) }
}

console.log('\n───────────────────────────────')
console.log(`Références remises sur Supabase : ${restored}`)
console.log(`Déjà sur Supabase               : ${untouched}`)
console.log(`Échecs                          : ${failed}`)

if (orphans.length) {
  console.log(`\n⚠  ${orphans.length} fichier(s) présent(s) uniquement dans R2 — non réversibles :`)
  for (const o of orphans) console.log(`   · ${o}`)
  console.log('   Ils resteront invisibles tant que le code R2 n\'est pas déployé.')
  console.log('   Un retour arrière ne peut donc être que partiel : déployer est préférable.')
}

if (!APPLY) console.log('\nRelancez avec --apply pour exécuter réellement.')

process.exitCode = failed > 0 ? 1 : 0
