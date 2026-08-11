import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/get-current-profile'
import { buildR2Ref, isMediaBucket, isR2Configured, signedUploadUrl, type MediaBucket } from '@/lib/r2'

// Délivre une URL d'upload signée pour que le navigateur téléverse
// DIRECTEMENT vers R2, sans passer par le serveur Next.
//
// Deux raisons : les fonctions serverless Vercel plafonnent le corps de
// requête à ~4,5 Mo (un passeport sportif scanné le dépasse vite), et les
// clés R2 ne quittent jamais le serveur.
//
// L'autorisation est refaite ici : avec Supabase Storage c'était la RLS du
// bucket qui filtrait ; une URL signée court-circuite toute règle côté
// stockage, donc le contrôle de rôle doit vivre dans cette route.

const MAX_TTL_SECONDS = 300

// Types acceptés par bucket — un passeport ou un document peut être un PDF,
// une photo de membre non.
const ALLOWED: Record<MediaBucket, RegExp> = {
  'member-photos':    /^image\/(jpeg|png|webp|gif|avif)$/,
  'member-passports': /^(image\/(jpeg|png|webp|gif|avif)|application\/pdf)$/,
  'member-documents': /^(image\/(jpeg|png|webp|gif|avif)|application\/pdf)$/,
}

const EXT_OK = /^[a-z0-9]{1,5}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (profile.role !== 'admin' && profile.role !== 'receptionist') {
    return NextResponse.json({ error: 'Droits insuffisants' }, { status: 403 })
  }
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'Stockage non configuré' }, { status: 503 })
  }

  let body: { bucket?: string; memberId?: string; ext?: string; contentType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 })
  }

  const { bucket, memberId, contentType } = body
  const ext = (body.ext ?? '').toLowerCase()

  if (!bucket || !isMediaBucket(bucket)) {
    return NextResponse.json({ error: 'Bucket inconnu' }, { status: 400 })
  }
  if (!memberId || !UUID.test(memberId)) {
    return NextResponse.json({ error: 'Identifiant membre invalide' }, { status: 400 })
  }
  if (!EXT_OK.test(ext)) {
    return NextResponse.json({ error: 'Extension de fichier invalide' }, { status: 400 })
  }
  if (!contentType || !ALLOWED[bucket].test(contentType)) {
    return NextResponse.json({ error: 'Type de fichier non autorisé' }, { status: 400 })
  }

  // Même convention de chemin que Supabase : <memberId>/<timestamp>.<ext>.
  // La migration reste ainsi une copie sans réécriture de chemin.
  const path = `${memberId}/${Date.now()}.${ext}`

  try {
    const uploadUrl = await signedUploadUrl(bucket, path, contentType, MAX_TTL_SECONDS)
    // `ref` est ce qui part en base, pas l'URL signée (qui expire).
    return NextResponse.json({ uploadUrl, ref: buildR2Ref(bucket, path), contentType })
  } catch (e) {
    console.error('signedUploadUrl:', e)
    return NextResponse.json({ error: "Impossible de préparer l'upload" }, { status: 500 })
  }
}
