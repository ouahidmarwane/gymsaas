// lib/media.ts
// Convertit une référence de stockage enregistrée en base vers le proxy
// authentifié /api/media — indispensable depuis que les fichiers membres
// sont privés.
//
// Deux formats coexistent pendant (et après) la migration vers R2 :
//   - « r2://<bucket>/<chemin> »                         → Cloudflare R2
//   - « https://…/storage/v1/object/public/<b>/<p> »     → Supabase Storage
// Les deux produisent la même forme d'URL côté client ; seul le paramètre
// `src` indique au proxy où aller chercher le fichier. Un membre migré et un
// membre pas encore migré s'affichent donc indifféremment.
const R2_REF = /^r2:\/\/([^/]+)\/(.+)$/
const SUPABASE_URL = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/

export function mediaUrl(stored: string | null | undefined): string | null {
  if (!stored) return null

  const r2 = stored.match(R2_REF)
  if (r2) {
    return `/api/media?bucket=${encodeURIComponent(r2[1])}&path=${encodeURIComponent(r2[2])}&src=r2`
  }

  const sb = stored.match(SUPABASE_URL)
  if (sb) {
    return `/api/media?bucket=${encodeURIComponent(sb[1])}&path=${encodeURIComponent(sb[2])}`
  }

  return stored // URL externe ou déjà proxifiée : on laisse passer
}
