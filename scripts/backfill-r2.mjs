#!/usr/bin/env node
// scripts/backfill-r2.mjs
//
// Recopie les fichiers membres de Supabase Storage vers Cloudflare R2, puis
// bascule les colonnes correspondantes vers la référence « r2://… ».
//
//   node scripts/backfill-r2.mjs              # simulation (n'écrit RIEN)
//   node scripts/backfill-r2.mjs --apply      # exécution réelle
//   node scripts/backfill-r2.mjs --apply --limit 20
//
// Sûr par construction :
//   - simulation par défaut ; --apply est obligatoire pour écrire ;
//   - une ligne membre n'est mise à jour qu'APRÈS confirmation de la copie ;
//   - rien n'est jamais supprimé de Supabase ;
//   - reprise possible : un objet déjà présent dans R2 est sauté ;
//   - une interruption laisse une base mi-migrée parfaitement fonctionnelle,
//     le proxy /api/media servant les deux origines.
import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Charge .env.local sans dépendance externe.
for (const name of ['.env.local', '.env']) {
  const file = join(ROOT, name)
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (!(m[1] in process.env)) process.env[m[1]] = value
  }
}

const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity

const COLUMNS = [
  { column: 'photo_url',           bucket: 'member-photos' },
  { column: 'sport_passport_url',  bucket: 'member-passports' },
  { column: 'document_url',        bucket: 'member-documents' },
]

function need(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`✗ Variable manquante : ${name} (attendue dans .env.local)`)
    process.exit(1)
  }
  return v
}

const SUPABASE_URL = need('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY  = need('SUPABASE_SERVICE_ROLE_KEY')
const R2_BUCKET    = need('R2_BUCKET')
const ACCOUNT_ID   = need('R2_ACCOUNT_ID')

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: need('R2_ACCESS_KEY_ID'),
    secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
  },
})

/** Extrait { bucket, path } d'une URL Supabase Storage, sinon null. */
function parseSupabaseUrl(stored) {
  if (typeof stored !== 'string') return null
  if (stored.startsWith('r2://')) return null // déjà migré
  const m = stored.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

async function existsInR2(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

const stats = { scanned: 0, already: 0, copied: 0, skipped: 0, failed: 0, bytes: 0 }
const failures = []

async function migrateOne(member, column, bucket) {
  const stored = member[column]
  const parsed = parseSupabaseUrl(stored)

  if (!stored) return null
  if (stored.startsWith('r2://')) { stats.already++; return null }
  if (!parsed) {
    stats.skipped++
    console.warn(`  ~ ${member.name} · ${column} : format non reconnu, ignoré`)
    return null
  }
  if (parsed.bucket !== bucket) {
    stats.skipped++
    console.warn(`  ~ ${member.name} · ${column} : bucket inattendu « ${parsed.bucket} », ignoré`)
    return null
  }

  stats.scanned++
  const key = `${bucket}/${parsed.path}`
  const ref = `r2://${bucket}/${parsed.path}`

  if (!APPLY) {
    console.log(`  → ${member.name} · ${column}`)
    console.log(`      ${parsed.bucket}/${parsed.path}  ⇒  ${ref}`)
    return ref
  }

  if (await existsInR2(key)) {
    console.log(`  = ${member.name} · ${column} : déjà dans R2, bascule de la référence`)
    return ref
  }

  const { data, error } = await supabase.storage.from(bucket).download(parsed.path)
  if (error || !data) {
    stats.failed++
    failures.push(`${member.name} · ${column} : téléchargement Supabase — ${error?.message ?? 'vide'}`)
    return null
  }

  const body = Buffer.from(await data.arrayBuffer())
  try {
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: data.type || 'application/octet-stream',
    }))
  } catch (e) {
    stats.failed++
    failures.push(`${member.name} · ${column} : envoi R2 — ${e.message}`)
    return null
  }

  stats.copied++
  stats.bytes += body.length
  console.log(`  ✓ ${member.name} · ${column} (${(body.length / 1024).toFixed(0)} Ko)`)
  return ref
}

async function main() {
  console.log(APPLY
    ? '⚠  MODE RÉEL — les fichiers sont copiés et la base est modifiée.\n'
    : 'ℹ  SIMULATION — aucune écriture. Ajoutez --apply pour exécuter.\n')

  const { data: members, error } = await supabase
    .from('members')
    .select('id, name, photo_url, sport_passport_url, document_url')
    .or('photo_url.not.is.null,sport_passport_url.not.is.null,document_url.not.is.null')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('✗ Lecture de members impossible :', error.message)
    process.exit(1)
  }

  const withFiles = members.filter(m => COLUMNS.some(c => m[c.column]))
  const todo = withFiles.slice(0, LIMIT)
  console.log(`${withFiles.length} membre(s) avec fichiers ; traitement de ${todo.length}.\n`)

  for (const member of todo) {
    const patch = {}
    for (const { column, bucket } of COLUMNS) {
      const ref = await migrateOne(member, column, bucket)
      if (ref) patch[column] = ref
    }

    if (Object.keys(patch).length === 0) continue

    if (!APPLY) continue

    // La ligne n'est mise à jour qu'après confirmation de chaque copie.
    const { error: upErr } = await supabase.from('members').update(patch).eq('id', member.id)
    if (upErr) {
      stats.failed++
      failures.push(`${member.name} : mise à jour de la ligne — ${upErr.message}`)
      console.error(`  ✗ ${member.name} : fichiers copiés mais base non mise à jour — ${upErr.message}`)
    }
  }

  console.log('\n───────────────────────────────')
  console.log(`Fichiers à migrer   : ${stats.scanned}`)
  console.log(`Déjà en R2          : ${stats.already}`)
  console.log(`Copiés              : ${stats.copied} (${(stats.bytes / 1024 / 1024).toFixed(1)} Mo)`)
  console.log(`Ignorés             : ${stats.skipped}`)
  console.log(`Échecs              : ${stats.failed}`)

  if (failures.length) {
    console.log('\nÉchecs détaillés :')
    for (const f of failures) console.log(`  · ${f}`)
  }

  if (!APPLY) console.log('\nRelancez avec --apply pour exécuter réellement.')
  process.exit(stats.failed > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
