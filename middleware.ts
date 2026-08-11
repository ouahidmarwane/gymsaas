import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// En-têtes de sécurité posés sur TOUTE réponse (y compris les
// redirections du middleware, que next.config headers() ne couvre pas).
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return res
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // Public routes — always accessible
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    if (user && pathname.startsWith('/login')) {
      return withSecurityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)))
    }
    return withSecurityHeaders(supabaseResponse)
  }

  // Athlete portal — public, token-gated
  if (pathname.startsWith('/portal')) {
    return withSecurityHeaders(supabaseResponse)
  }

  if (!user) {
    return withSecurityHeaders(NextResponse.redirect(new URL('/login', request.url)))
  }

  return withSecurityHeaders(supabaseResponse)
}

export const config = {
  // Exclut les routes internes Next, l'API et les fichiers statiques
  // (images du dossier public/) — sinon le middleware redirige les
  // assets vers /login pour les visiteurs non connectés.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|webp|svg|gif|ico|txt|xml)$).*)'],
}