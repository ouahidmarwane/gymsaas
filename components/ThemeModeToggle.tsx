'use client'

import { useEffect, useState } from 'react'

/** Preference jour/nuit personnelle, independante de l'habillage du club. */
export default function ThemeModeToggle() {
  const [mode, setMode] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    setMode(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  }, [])

  function toggle() {
    const next = mode === 'light' ? 'dark' : 'light'
    setMode(next)
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('gf-color-mode', next) } catch { /* stockage indisponible */ }
  }

  return (
    <button
      type="button"
      className={`theme-mode-toggle ${mode}`}
      onClick={toggle}
      aria-label={mode === 'light' ? 'Activer le mode nuit' : 'Activer le mode jour'}
      aria-pressed={mode === 'dark'}
      title={mode === 'light' ? 'Mode jour — passer en mode nuit' : 'Mode nuit — passer en mode jour'}
    >
      <span className="theme-mode-toggle-art" aria-hidden="true" />
      <span className="sr-only">{mode === 'light' ? 'Jour' : 'Nuit'}</span>
    </button>
  )
}
