import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'
import './platform.css'

// Meme chargement que l'application d'origine : Inter en variable CSS, Outfit
// arrive par l'@import en tete de globals.css.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata = {
  title: 'GymFlow',
  description: 'Gestion de clubs sportifs',
}

// La langue et la direction sont posees par le client une fois le club connu :
// un club arabophone bascule en RTL sans que la coquille change.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" dir="ltr" className={inter.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
