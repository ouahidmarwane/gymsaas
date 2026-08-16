#!/usr/bin/env node
// Pose la politique CORS du bucket R2 sur des origines nommees.
//
// A LIRE AVANT DE S'EN SERVIR : en l'etat, GymFlow n'en a pas besoin.
//
// Le navigateur ne parle JAMAIS a R2 directement. Photos, documents
// d'identite, logos et bannieres transitent tous par le Worker
// (`env.MEDIA.put` / `env.MEDIA.get` dans src/api.ts), donc en meme origine :
// il n'y a pas de requete inter-origines a autoriser. Aucune URL signee,
// aucun client S3, aucun domaine r2.dev dans le code — verifiable par
// recherche.
//
// Ce script existe pour le jour ou cela changera : servir les medias depuis
// un domaine R2 dedie pour decharger le Worker, ou televerser directement
// depuis le navigateur avec une URL signee. Ce jour-la, la politique doit
// deja etre ecrite quelque part plutot qu'improvisee.
//
// JAMAIS "*" : le bucket porte des pieces d'identite. Une origine ouverte
// laisserait n'importe quelle page lue par un membre connecte piocher dedans
// avec ses jetons.
//
//   node scripts/set-r2-cors.mjs https://gymflow.ma
//   node scripts/set-r2-cors.mjs https://gymflow.ma https://www.gymflow.ma
//   node scripts/set-r2-cors.mjs --show
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BUCKET = 'gymsaas'

const args = process.argv.slice(2)
const show = args.includes('--show')
const origins = args.filter(a => !a.startsWith('--'))

function wrangler(...argv) {
  return execFileSync(process.execPath, [WRANGLER, ...argv],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], cwd: ROOT })
}

if (show) {
  console.log(wrangler('r2', 'bucket', 'cors', 'list', BUCKET))
  process.exit(0)
}

if (origins.length === 0) {
  console.error('Usage : node scripts/set-r2-cors.mjs <origine> [autre origine...]')
  console.error('        node scripts/set-r2-cors.mjs --show')
  process.exit(1)
}

// Une origine, c'est un schema et un hote — pas de chemin, pas de barre
// finale. R2 compare la chaine telle quelle : "https://gymflow.ma/" ne
// correspondrait a aucune requete, et l'erreur ne se verrait qu'a l'usage,
// dans la console du navigateur d'un client.
for (const origin of origins) {
  let url
  try { url = new URL(origin) } catch { console.error(`Origine illisible : ${origin}`); process.exit(1) }
  if (url.protocol !== 'https:') { console.error(`HTTPS obligatoire : ${origin}`); process.exit(1) }
  if (url.pathname !== '/' || origin.endsWith('/')) {
    console.error(`Une origine ne porte ni chemin ni barre finale : ${origin}`)
    process.exit(1)
  }
  if (url.hostname === '*') { console.error('Jamais de joker : ce bucket porte des pieces d identite.') ; process.exit(1) }
}

const policy = [
  {
    AllowedOrigins: origins,
    // GET et HEAD pour lire, PUT pour un televersement direct eventuel.
    // Pas de DELETE : rien ne doit pouvoir effacer un document depuis un
    // navigateur, la suppression passe par le Worker qui verifie le club.
    AllowedMethods: ['GET', 'HEAD', 'PUT'],
    // Content-Type pour un envoi, Range pour reprendre une lecture de gros
    // fichier. Rien d'autre : chaque en-tete autorise est une surface.
    AllowedHeaders: ['Content-Type', 'Range'],
    ExposeHeaders: ['Content-Length', 'Content-Type', 'ETag'],
    // Une heure. Assez pour eviter un prevol a chaque image, assez court
    // pour qu'un retrait d'origine prenne effet dans la journee.
    MaxAgeSeconds: 3600,
  },
]

const file = join(tmpdir(), `gymflow-r2-cors-${process.pid}.json`)
writeFileSync(file, JSON.stringify(policy, null, 2), 'utf8')

console.log(JSON.stringify(policy, null, 2))
console.log(`\nApplication sur le bucket ${BUCKET}…`)
wrangler('r2', 'bucket', 'cors', 'set', BUCKET, '--file', file, '--force')
console.log('Politique posee. Relire avec : node scripts/set-r2-cors.mjs --show')
