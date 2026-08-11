#!/usr/bin/env node
// scripts/set-r2-cors.mjs
//
// Déclare les origines autorisées à téléverser directement vers le bucket R2.
// Sans cette règle, le navigateur bloque le PUT signé au moment du preflight
// et l'app affiche « réseau indisponible » — l'erreur n'a alors pas de code
// HTTP, puisque la requête ne part jamais.
//
//   node scripts/set-r2-cors.mjs http://localhost:3000
//   node scripts/set-r2-cors.mjs http://localhost:3000 https://mon-app.vercel.app
//
// Passez TOUTES les origines à chaque appel : la règle est remplacée, pas
// fusionnée. Comptez jusqu'à une minute de propagation côté Cloudflare.
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3'
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

const origins = process.argv.slice(2)
if (!origins.length || !origins.every(o => /^https?:\/\//.test(o))) {
  console.error('Usage : node scripts/set-r2-cors.mjs <origine> [origine...]')
  console.error('Exemple : node scripts/set-r2-cors.mjs http://localhost:3000 https://mon-app.vercel.app')
  process.exit(1)
}

const Bucket = process.env.R2_BUCKET
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

await s3.send(new PutBucketCorsCommand({
  Bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedOrigins: origins,
      AllowedMethods: ['PUT', 'GET', 'HEAD'],
      AllowedHeaders: ['content-type'],
      ExposeHeaders: ['etag'],
      MaxAgeSeconds: 3600,
    }],
  },
}))

const { CORSRules } = await s3.send(new GetBucketCorsCommand({ Bucket }))
console.log(`Bucket « ${Bucket} » — règle CORS en place :`)
console.log(JSON.stringify(CORSRules, null, 2))
console.log('\nLa propagation peut prendre jusqu\'à une minute.')
