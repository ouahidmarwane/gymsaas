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

// Le chemin extrait d'une URL Supabase est déjà percent-encodé (« logo%20x.png »).
// Le ré-encoder tel quel produisait « logo%2520x.png » : le proxy demandait
// alors un fichier dont le nom contient littéralement « %20 », d'où un 404 sur
// tout fichier comportant une espace. On décode donc avant de ré-encoder.
// Les références r2:// sont stockées décodées et n'ont pas ce problème.
function once(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment // séquence d'échappement invalide : on garde tel quel
  }
}

export function mediaUrl(stored: string | null | undefined): string | null {
  if (!stored) return null

  const r2 = stored.match(R2_REF)
  if (r2) {
    return `/api/media?bucket=${encodeURIComponent(r2[1])}&path=${encodeURIComponent(r2[2])}&src=r2`
  }

  const sb = stored.match(SUPABASE_URL)
  if (sb) {
    return `/api/media?bucket=${encodeURIComponent(sb[1])}&path=${encodeURIComponent(once(sb[2]))}`
  }

  return stored // URL externe ou déjà proxifiée : on laisse passer
}
