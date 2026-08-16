import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {
  // En-tetes de securite sur toutes les reponses. L'API pose deja les siennes
  // reponse par reponse ; celles-ci couvrent les pages.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

// Rend les bindings Cloudflare (D1, R2, Durable Objects) disponibles sous
// `next dev`, sans quoi getCloudflareContext serait vide en developpement.
//
// GARDE-FOU : cet appel demarre un proxy wrangler des le chargement de la
// configuration — donc AUSSI pendant `next build`, ou il n'a rien a faire.
// Ce proxy exige desormais un acces a l'API Cloudflare pour les bindings
// distants : un jeton expire, un compte sans sous-domaine workers.dev ou une
// machine hors ligne suffisent a faire echouer la construction, avec une
// erreur d'API qui ne dit rien du code. La construction ne doit dependre
// d'aucun reseau.
//
// `next build` pose NODE_ENV=production, `next dev` pose development : la
// distinction est exacte. Ce projet ne se sert de toute facon pas de
// `next dev` (PASSATION §9), l'appel reste pour qui voudrait l'essayer.
if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev()
}

export default nextConfig
