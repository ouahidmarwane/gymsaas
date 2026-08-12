#!/usr/bin/env node
// Cree un compte exploitant de la plateforme — SANS club.
//
// Un exploitant supervise les clubs, il n'en possede aucun. Il n'a donc ni
// organisation, ni appartenance : les ecrans d'un club ne le concernent pas.
//
// Volontairement hors application : aucune route ne delivre ce statut, donc
// aucun bug applicatif ne peut y conduire. Le mot de passe est hache ici avec
// exactement le meme schema que le Worker (voir src/auth/crypto.ts).
//
//   node scripts/create-operator.mjs admin@exemple.ma "Nom Prenom" motdepasse
//   node scripts/create-operator.mjs admin@exemple.ma "Nom Prenom" motdepasse --remote
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { webcrypto as crypto } from 'node:crypto'

const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const PBKDF2_ITERATIONS = 210_000
const SALT_BYTES = 16
const KEY_BITS = 256

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const [email, name, password] = args.filter(a => !a.startsWith('--'))

if (!email || !name || !password) {
  console.error('Usage : node scripts/create-operator.mjs <email> "<nom>" <motdepasse> [--remote]')
  process.exit(1)
}
if (password.length < 10) {
  console.error('Mot de passe : 10 caracteres minimum.')
  process.exit(1)
}

const toBase64 = bytes => Buffer.from(bytes).toString('base64')

async function hashPassword(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(plain), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, KEY_BITS,
  )
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`
}

/** Identifiant trie par le temps, meme forme que newId() cote Worker. */
function newId() {
  const time = Date.now().toString(36).padStart(9, '0')
  let suffix = ''
  for (const b of crypto.getRandomValues(new Uint8Array(10))) suffix += b.toString(36).padStart(2, '0')
  return `${time}${suffix}`
}

/**
 * Execute une requete sur le plan de controle.
 *
 * En local, le fichier SQLite est partage avec le serveur de developpement :
 * une ecriture concurrente rend SQLITE_BUSY. On reessaie brievement plutot
 * que d'echouer sur une contention passagere.
 */
function d1(sql, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      return execFileSync(
        process.execPath,
        [WRANGLER, 'd1', 'execute', 'gymflow-control', remote ? '--remote' : '--local', '--json', '--command', sql],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT },
      )
    } catch (error) {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
      if (i >= attempts || !/SQLITE_BUSY|database is locked/i.test(output)) throw error
      // Attente synchrone : ce script est un outil en ligne de commande.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * i)
    }
  }
}

const norm = email.trim().toLowerCase()
const escaped = s => s.replace(/'/g, "''")

const existing = d1(`SELECT id FROM users WHERE email_norm = '${escaped(norm)}'`)

if (/"id"/.test(existing)) {
  // Compte deja present : on se contente de le promouvoir, sans toucher a son
  // mot de passe ni a ses eventuelles appartenances.
  d1(`UPDATE users SET is_platform_admin = 1 WHERE email_norm = '${escaped(norm)}'`)
  console.log(`Compte existant promu exploitant : ${norm}`)
} else {
  const id = newId()
  const hash = await hashPassword(password)
  d1(
    `INSERT INTO users (id, email, email_norm, name, password_hash, is_platform_admin)
     VALUES ('${id}', '${escaped(email.trim())}', '${escaped(norm)}', '${escaped(name)}', '${hash}', 1)`,
  )
  console.log(`Exploitant cree : ${norm}`)
}

console.log('Aucun club rattache — ce compte supervise, il ne gere pas de club.')
console.log(`Connexion : ${remote ? 'votre domaine' : 'http://127.0.0.1:8787'}/login`)
