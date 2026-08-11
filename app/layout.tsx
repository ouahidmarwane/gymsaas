import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: 'Association Noujoum El Chaouia',
  description: 'Gestion de salle de sport — Association Noujoum El Chaouia',
  icons: {
    icon: '/logo-noujoum-el-chaouia.png',
    apple: '/logo-noujoum-el-chaouia.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // pas de maximumScale : bloquer le zoom nuit à l'accessibilité ;
  // le zoom auto d'iOS est évité par font-size:16px sur les champs
}

// Restaure la « Vue PC » AVANT le premier rendu : si on attendait React, la
// page s'afficherait d'abord en mise en page mobile puis basculerait
// (clignotement). Voir components/DesktopViewToggle.tsx.
// L'échelle vient de `screen.width` (largeur physique, insensible à la balise
// viewport) et non de `innerWidth`, qui vaut 1280 dès la vue PC active.
// Voir components/DesktopViewToggle.tsx.
const RESTORE_VIEWPORT = `try{
  if(localStorage.getItem('gymflow:desktop-view')==='1'){
    var m=document.querySelector('meta[name="viewport"]');
    var w=(screen&&screen.width)||window.innerWidth||390;
    if(m)m.setAttribute('content','width=1280, initial-scale='+Math.min(1,w/1280).toFixed(4));
  }
}catch(e){}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RESTORE_VIEWPORT }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
