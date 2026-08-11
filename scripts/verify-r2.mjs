import { createClient } from '@supabase/supabase-js'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })
const s3 = new S3Client({ region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } })

const { data } = await sb.from('members').select('name, photo_url, sport_passport_url, document_url')
let refs = 0, legacy = 0, present = 0, missing = 0

for (const m of data) {
  for (const col of ['photo_url', 'sport_passport_url', 'document_url']) {
    const v = m[col]
    if (!v) continue
    if (!v.startsWith('r2://')) { legacy++; console.log(`  legacy  ${m.name} · ${col}`); continue }
    refs++
    const key = v.slice('r2://'.length)
    try {
      const h = await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
      present++
      console.log(`  ok      ${m.name} · ${col}  ${(h.ContentLength / 1024).toFixed(0)} Ko  ${h.ContentType}`)
    } catch (e) {
      missing++
      console.log(`  MISSING ${m.name} · ${col} → ${key} (${e.name})`)
    }
  }
}
console.log(`\nRéférences r2:// : ${refs}   restées Supabase : ${legacy}`)
console.log(`Objets présents dans R2 : ${present}   manquants : ${missing}`)
