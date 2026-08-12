'use client'

import { useRef, useState } from 'react'
import { api, ApiError, type Branding } from '@/lib/client'
import styles from './branding.module.css'

// Palette proposee. Le club peut coller n'importe quelle teinte hexadecimale,
// mais la plupart des proprietaires veulent choisir, pas composer.
const SWATCHES = [
  '#0e4f8f', '#a8232b', '#1f6b47', '#7a3fa8',
  '#b45309', '#0f766e', '#be185d', '#334155',
]

export default function BrandingPanel({
  initial, onSaved,
}: { initial: Branding | null; onSaved: (b: Branding) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [accent, setAccent] = useState(initial?.theme.accent ?? '#0e4f8f')
  const [mode, setMode] = useState<Branding['theme']['mode']>(initial?.theme.mode ?? 'system')
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // La couleur s'applique en direct : on juge une teinte sur l'interface,
  // pas dans une pastille de 16 pixels.
  function preview(next: string) {
    setAccent(next)
    document.documentElement.style.setProperty('--primary', next)
    document.documentElement.style.setProperty('--primary-hover', next)
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false)
    try {
      const result = await api.put<Branding>('/api/branding', {
        name: name.trim() || undefined,
        theme: { accent, mode },
      })
      onSaved(result)
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally {
      setBusy(false)
    }
  }

  async function upload(file: File) {
    if (file.size > 2 * 1024 * 1024) { setError('Logo trop volumineux : 2 Mo maximum'); return }
    setBusy(true); setError(null)
    try {
      // Envoi direct : le serveur fabrique la cle et la range sous le club.
      const res = await fetch('/api/branding/logo', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null)
        const message = typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : 'Envoi impossible'
        throw new ApiError(res.status, message)
      }
      const refreshed = await api.get<Branding>('/api/branding')
      setLogoUrl(refreshed.logoUrl)
      onSaved(refreshed)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Envoi impossible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.panel} aria-label="Apparence du club">
      <div className={styles.row}>
        <div className={styles.logoBlock}>
          <span className="label">Logo</span>
          <div className={styles.logoRow}>
            <span className={styles.preview}>
              {logoUrl
                ? <img src={logoUrl} alt="" width={40} height={40} className={styles.previewImg} />
                : <span className={styles.previewFallback} style={{ background: accent }}>
                    {(name || 'GF').slice(0, 2).toUpperCase()}
                  </span>}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }}
            />
            <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              Choisir un fichier
            </button>
          </div>
          <span className="hint">PNG, JPG, WEBP ou SVG. 2 Mo maximum.</span>
        </div>

        <div className="field">
          <label className="label" htmlFor="club-name">Nom affiche</label>
          <input
            id="club-name"
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={120}
          />
        </div>
      </div>

      <div className={styles.row}>
        <fieldset className={styles.fieldset}>
          <legend className="label">Couleur</legend>
          <div className={styles.swatches}>
            {SWATCHES.map(hex => (
              <button
                key={hex}
                type="button"
                className={styles.swatch}
                style={{ background: hex }}
                aria-label={`Couleur ${hex}`}
                aria-pressed={accent.toLowerCase() === hex}
                onClick={() => preview(hex)}
              />
            ))}
            <label className={styles.custom}>
              <span className="sr-only">Couleur personnalisee</span>
              <input
                type="color"
                value={accent}
                onChange={e => preview(e.target.value)}
                className={styles.colorInput}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className="label">Theme</legend>
          <div className={styles.segmented} role="radiogroup">
            {(['system', 'light', 'dark'] as const).map(option => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                className={styles.segment}
                onClick={() => setMode(option)}
              >
                {option === 'system' ? 'Systeme' : option === 'light' ? 'Clair' : 'Sombre'}
              </button>
            ))}
          </div>
        </fieldset>

        <div className={styles.actions}>
          <div aria-live="polite" className={styles.status}>
            {error && <span className={styles.error}>{error}</span>}
            {saved && !error && <span className={styles.ok}>Enregistre</span>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={save} data-busy={busy}>
            Enregistrer l&apos;apparence
          </button>
        </div>
      </div>
    </section>
  )
}
