import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Proxy média authentifié : les buckets membres sont PRIVÉS.
// Seul un utilisateur connecté obtient une URL signée temporaire (1 h).
// (Le middleware n'intercepte pas /api — la vérification vit ici.)
const BUCKETS = new Set(['member-photos', 'member-passports', 'member-documents'])

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non autorisé', { status: 401 })

  const bucket = req.nextUrl.searchParams.get('bucket') ?? ''
  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!BUCKETS.has(bucket) || !path || path.includes('..')) {
    return new NextResponse('Requête invalide', { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return new NextResponse('Introuvable', { status: 404 })

  return NextResponse.redirect(data.signedUrl, 302)
}
