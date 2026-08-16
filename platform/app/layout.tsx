import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { SKINS } from '@/src/club/branding'
import WelcomeSplash from '@/components/WelcomeSplash'
import './globals.css'
import './platform.css'

// Meme chargement que l'application d'origine : Inter en variable CSS, Outfit
// arrive par l'@import en tete de globals.css.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata = {
  title: 'GymFlow',
  description: 'Gestion de clubs sportifs',
}

/**
 * L'habillage est pose avant la premiere peinture.
 *
 * La coquille ne le connait qu'apres /api/me ; sur un rechargement complet,
 * l'application s'afficherait donc en sombre pendant l'aller-retour avant de
 * basculer. Ce script lit le dernier habillage connu et l'applique tout de
 * suite. La table des bases est derivee du catalogue, pas recopiee : un
 * habillage ajoute ne peut pas manquer ici.
 */
const SKIN_BASES = JSON.stringify(
  Object.fromEntries(Object.entries(SKINS).map(([key, s]) => [key, s.base])),
)
const APPLY_SKIN = `try{var b=${SKIN_BASES},s=localStorage.getItem('gf-skin');
if(s&&b[s]){var e=document.documentElement;e.setAttribute('data-skin',s);e.setAttribute('data-theme',b[s])}}catch(_){}`

// La langue et la direction sont posees par le client une fois le club connu :
// un club arabophone bascule en RTL sans que la coquille change.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" dir="ltr" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_SKIN }} />
      </head>
      <body>
        {children}
        {/* Monte une seule fois, au-dessus de tout. Il ne rend rien tant
            qu'une connexion ne vient pas de reussir. */}
        <WelcomeSplash />
      </body>
    </html>
  )
}
