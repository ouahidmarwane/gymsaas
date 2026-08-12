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
initOpenNextCloudflareForDev()

export default nextConfig
