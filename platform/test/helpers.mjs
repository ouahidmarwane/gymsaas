// Outils partages par les tests.
//
// Ils vivaient dupliques dans chaque fichier, ce qui a coute une soiree :
// une correction appliquee a deux copies sur quatre laissait les deux autres
// echouer de facon intermittente. Un seul exemplaire, une seule correction.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// On invoque l'entree JS de wrangler avec node plutot que le lanceur npx :
// depuis Node 24, spawn d'un .cmd sous Windows echoue en EINVAL, et passer
// par un shell rendrait la citation des chaines SQL fragile.
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))

export const uniq = () => Math.random().toString(36).slice(2, 10)

/** Client HTTP avec bocal a cookies : chaque session est independante. */
export function client() {
  let cookie = null
  return {
    get cookie() { return cookie },
    async call(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) {
        const raw = setCookie.split(';')[0]
        cookie = raw.endsWith('=') ? null : raw
      }
      let data = null
      if ((res.headers.get('content-type') ?? '').includes('json')) {
        try { data = await res.json() } catch { /* corps vide */ }
      }
      return { status: res.status, data }
    },
  }
}

/** Recupere une page HTML, sans session. */
export async function page(path) {
  const res = await fetch(BASE + path)
  return { status: res.status, html: await res.text() }
}

/**
 * Requete directe sur la base centrale, comme le ferait un exploitant.
 *
 * En local, le fichier SQLite est partage avec le serveur de developpement :
 * sous charge, une ecriture concurrente rend SQLITE_BUSY. On reessaie plutot
 * que de faire echouer un test pour une contention passagere.
 */
export function control(sql, attempts = 8) {
  for (let i = 1; ; i++) {
    try {
      return execFileSync(
        process.execPath,
        [WRANGLER, 'd1', 'execute', 'gymflow-control', '--local', '--json', '--command', sql],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT },
      )
    } catch (error) {
      const output = String(error.stdout ?? '') + String(error.stderr ?? '')
      if (i >= attempts || !/SQLITE_BUSY|database is locked/i.test(output)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * i)
    }
  }
}

/** Cree un exploitant de plateforme, sans club, hors application. */
export function createOperator(email, name, password) {
  for (let i = 1; ; i++) {
    try {
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL('../scripts/create-operator.mjs', import.meta.url)), email, name, password],
        { stdio: 'ignore', cwd: ROOT },
      )
      return
    } catch (error) {
      if (i >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * i)
    }
  }
}

/**
 * Attend que le Worker reponde.
 *
 * Lancer wrangler en parallele pour ecrire dans la base locale fait
 * brievement tomber le serveur de developpement ; sans cette attente, la
 * requete suivante echoue en ECONNRESET et le test accuse le code.
 */
export async function waitReady(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return } catch { /* pas encore la */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`Worker injoignable sur ${BASE}`)
}
