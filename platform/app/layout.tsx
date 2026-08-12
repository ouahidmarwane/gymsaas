import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'GymFlow',
  description: 'Gestion de clubs sportifs',
}

// La langue et la direction sont posees au niveau du club, pas ici : un club
// arabophone bascule en RTL sans que la coquille change.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" dir="ltr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
