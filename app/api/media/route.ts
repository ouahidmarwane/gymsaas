import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMediaBucket, isR2Configured, signedReadUrl } from '@/lib/r2'

// Proxy média authentifié : les fichiers membres sont PRIVÉS, sur R2 comme
// sur Supabase. Seul un utilisateur connecté obtient une URL signée (1 h).
// (Le middleware n'intercepte pas /api — la vérification vit ici.)
//
// Lecture double pendant la migration : `src=r2` sert depuis Cloudflare R2,
// tout le reste retombe sur Supabase Storage. Un membre déjà migré et un
// membre pas encore migré s'affichent donc côte à côte sans interruption.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non autorisé', { status: 401 })

  const bucket = req.nextUrl.searchParams.get('bucket') ?? ''
  const path = req.nextUrl.searchParams.get('path') ?? ''
  const src = req.nextUrl.searchParams.get('src') ?? 'sb'
  if (!isMediaBucket(bucket) || !path || path.includes('..')) {
    return new NextResponse('Requête invalide', { status: 400 })
  }

  if (src === 'r2') {
    if (!isR2Configured()) return new NextResponse('Stockage indisponible', { status: 503 })
    try {
      return NextResponse.redirect(await signedReadUrl(bucket, path, 3600), 302)
    } catch {
      return new NextResponse('Introuvable', { status: 404 })
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return new NextResponse('Introuvable', { status: 404 })

  return NextResponse.redirect(data.signedUrl, 302)
}
