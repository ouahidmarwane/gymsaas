'use client'

import { useRef, useState } from 'react'
import { Palette, Upload } from 'lucide-react'
import { api, ApiError, type Branding } from '@/lib/client'

// Palette proposee. Le club peut coller n'importe quelle teinte, mais la
// plupart des proprietaires veulent choisir, pas composer.
const SWATCHES = ['#2f6bff', '#9b72ff', '#16a34a', '#f59e0b', '#ef4444', '#0d9488', '#db2777', '#64748b']

export default function BrandingPanel({
  initial, onSaved,
}: { initial: Branding | null; onSaved: (b: Branding) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [accent, setAccent] = useState(initial?.theme.accent ?? '#2f6bff')
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // La couleur s'applique en direct : on juge une teinte sur l'interface,
  // pas dans une pastille de seize pixels.
  function preview(next: string) {
    setAccent(next)
    document.documentElement.style.setProperty('--gold', next)
    document.documentElement.style.setProperty('--tabs-pill-bg', next)
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false)
    try {
      const result = await api.put<Branding>('/api/branding', {
        name: name.trim() || undefined,
        theme: { accent, mode: initial?.theme.mode ?? 'system' },
      })
      onSaved(result); setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setBusy(false) }
  }

  async function upload(file: File) {
    if (file.size > 2 * 1024 * 1024) { setError('Logo trop volumineux : 2 Mo maximum'); return }
    setBusy(true); setError(null)
    try {
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
    } finally { setBusy(false) }
  }

  return (
    <section className="dz-card" aria-label="Apparence du club">
      <div className="dz-card-head">
        <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Palette size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Apparence
        </h2>
        <div aria-live="polite" style={{ fontSize: '0.78rem' }}>
          {error && <span style={{ color: '#fca5a5' }}>{error}</span>}
          {saved && !error && <span style={{ color: '#6ee7b7' }}>Enregistre</span>}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-end', marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" width={48} height={48}
                   style={{ borderRadius: '50%', objectFit: 'contain', background: 'rgba(255,255,255,0.07)' }} />
            : <span style={{
                width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center',
                background: accent, color: '#fff', fontWeight: 800, fontSize: '0.85rem',
              }}>{(name || 'GF').slice(0, 2).toUpperCase()}</span>}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="sr-only"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }}
          />
          <button className="btn-ghost" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                  onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={14} strokeWidth={2.2} /> Logo
          </button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 200px', minWidth: 0 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>Nom affiche</span>
          <input className="input-dark" value={name} onChange={e => setName(e.target.value)} maxLength={120} />
        </label>

        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>Couleur</legend>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            {SWATCHES.map(hex => (
              <button
                key={hex}
                type="button"
                onClick={() => preview(hex)}
                aria-label={`Couleur ${hex}`}
                aria-pressed={accent.toLowerCase() === hex}
                style={{
                  width: 28, height: 28, borderRadius: '50%', padding: 0, cursor: 'pointer',
                  background: hex,
                  border: accent.toLowerCase() === hex ? '2px solid #fff' : '2px solid transparent',
                  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
                }}
              />
            ))}
            <input type="color" value={accent} onChange={e => preview(e.target.value)}
                   aria-label="Couleur personnalisee"
                   style={{ width: 28, height: 28, borderRadius: '50%', padding: 0, cursor: 'pointer',
                            background: 'none', border: '1px dashed rgba(255,255,255,0.25)' }} />
          </div>
        </fieldset>

        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                onClick={save} disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </section>
  )
}
