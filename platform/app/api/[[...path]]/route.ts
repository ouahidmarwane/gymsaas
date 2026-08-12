import { getCloudflareContext } from '@opennextjs/cloudflare'
import { handleApi } from '@/src/api'
import type { Env } from '@/src/env'

// Toute l'API passe par ce point de montage unique.
//
// Le routeur vit dans src/api.ts sous la forme d'une fonction pure
// (request, env) -> Response. Deux consequences utiles : la suite de tests
// interroge la meme fonction que la production, et les decisions
// d'autorisation (portee du club, mode support) restent groupees au lieu
// d'etre redecidees dans une vingtaine de fichiers de route.

export const dynamic = 'force-dynamic'

async function handler(request: Request): Promise<Response> {
  const { env } = getCloudflareContext()
  return handleApi(request, env as unknown as Env)
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const HEAD = handler
export const OPTIONS = handler
