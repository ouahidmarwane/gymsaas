// Point d'entree du Worker deploye.
//
// Le worker genere par OpenNext n'exporte qu'un gestionnaire fetch. Une
// classe Durable Object doit pourtant etre exportee par le script qui la
// declare, sans quoi le binding echoue avec « No such Durable Object class
// is exported from the worker ». On enveloppe donc la sortie d'OpenNext pour
// y adjoindre la classe et la tache planifiee.
//
// @ts-expect-error genere au build par opennextjs-cloudflare
import openNextHandler from './.open-next/worker.js'
import { ClubDatabase } from './src/club/club-database'
import { refreshAllStats } from './src/api'
import type { Env } from './src/env'

type Fetcher = (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>

export default {
  fetch(request, env, ctx) {
    return (openNextHandler as { fetch: Fetcher }).fetch(request, env, ctx)
  },

  // Rafraichit le cache d'agregats lu par le tableau de bord plateforme.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshAllStats(env))
  },
} satisfies ExportedHandler<Env>

export { ClubDatabase }
