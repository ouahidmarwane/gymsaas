// lib/media.ts
// Convertit une URL de stockage (les anciennes URLs « publiques » enregistrées
// en base, ou les nouvelles du même format) vers le proxy authentifié
// /api/media — indispensable depuis que les buckets membres sont privés.
export function mediaUrl(stored: string | null | undefined): string | null {
  if (!stored) return null
  const m = stored.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/)
  if (!m) return stored // URL externe ou déjà proxifiée : on laisse passer
  return `/api/media?bucket=${encodeURIComponent(m[1])}&path=${encodeURIComponent(m[2])}`
}
