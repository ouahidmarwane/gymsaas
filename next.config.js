/** @type {import('next').NextConfig} */

// Origines autorisées pour les Server Actions.
// En production, Vercel fournit VERCEL_URL (le domaine du déploiement) ;
// on ajoute aussi un domaine personnalisé optionnel via APP_ORIGIN.
// Le même-origine est de toute façon toujours autorisé par Next.js.
const allowedOrigins = ['localhost:3000', '192.168.1.21:3000']
if (process.env.VERCEL_URL) allowedOrigins.push(process.env.VERCEL_URL)
if (process.env.APP_ORIGIN) allowedOrigins.push(process.env.APP_ORIGIN)

const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins },
  },
  // En-têtes de sécurité HTTP (constatés absents au pentest du 2026-08-02)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Empêche l'affichage du site dans une iframe (clickjacking)
          { key: 'X-Frame-Options', value: 'DENY' },
          // Empêche le navigateur de deviner le type MIME (XSS via fichiers)
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Ne fuite pas l'URL complète vers les sites externes
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Coupe l'accès aux capteurs sensibles par défaut
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
