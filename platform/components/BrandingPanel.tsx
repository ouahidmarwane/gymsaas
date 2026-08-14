'use client'

import { useRef, useState } from 'react'
import { Palette, Upload } from 'lucide-react'
import { api, ApiError, type Branding } from '@/lib/client'
import { SKINS, SKIN_KEYS, type SkinKey } from '@/src/club/branding'

// Palette proposee. Le club peut coller n'importe quelle teinte, mais la
// plupart des proprietaires veulent choisir, pas composer.
const SWATCHES = ['#2f6bff', '#9b72ff', '#16a34a', '#f59e0b', '#ef4444', '#0d9488', '#db2777', '#64748b']

/**
 * Vignettes d'apercu.
 *
 * Elles reprennent les memes degrades que la feuille de style, ecrits ici
 * une seconde fois : une vignette qui lirait les variables du document
 * montrerait l'habillage actif, pas celui qu'on propose — les cinq pastilles
 * seraient identiques.
 */
const PREVIEW: Record<SkinKey, { bg: string; card: string; note: string }> = {
  sombre: {
    bg: '#080b12',
    card: 'linear-gradient(180deg, rgba(24,26,34,0.92), rgba(15,17,24,0.95))',
    note: 'Le bleu nuit d’origine.',
  },
  clair: {
    bg: '#f0f4f8',
    card: 'linear-gradient(180deg, #ffffff, #f7fafd)',
    note: 'Lisible en plein jour, salle vitrée.',
  },
  chaleureux: {
    bg: 'radial-gradient(ellipse at 20% 0%, rgba(234,88,12,0.4), transparent 60%), #f4e9dc',
    card: 'linear-gradient(180deg, #fffaf3, #f8ecdd)',
    note: 'Beige et braise.',
  },
  sport: {
    bg: 'repeating-linear-gradient(115deg, rgba(134,239,172,0.14) 0 2px, transparent 2px 12px), radial-gradient(ellipse at 15% 0%, rgba(22,163,74,0.5), transparent 60%), #07100b',
    card: 'linear-gradient(180deg, rgba(16,32,22,0.94), rgba(8,18,12,0.96))',
    note: 'Couloirs de piste, vert terrain.',
  },
  tatami: {
    bg: 'repeating-linear-gradient(0deg, rgba(203,166,110,0.16) 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, rgba(203,166,110,0.16) 0 1px, transparent 1px 6px), radial-gradient(ellipse at 50% 0%, rgba(185,28,28,0.45), transparent 55%), #12100e',
    card: 'linear-gradient(180deg, rgba(31,27,23,0.94), rgba(18,16,14,0.96))',
    note: 'Tressage de tatami, rouge du dojo.',
  },
}

export default function BrandingPanel({
  initial, onSaved,
}: { initial: Branding | null; onSaved: (b: Branding) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const [bannerUrl, setBannerUrl] = useState(initial?.bannerUrl ?? null)
  const [name, setName] = useState(initial?.name ?? '')
  const [accent, setAccent] = useState(initial?.theme.accent ?? '#2f6bff')
  const [skin, setSkin] = useState<SkinKey>(initial?.theme.skin ?? 'sombre')
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

  /**
   * Les valeurs a ecrire sont passees explicitement.
   *
   * setState est asynchrone : un enregistrement declenche dans la foulee
   * d'un setSkin enverrait l'habillage precedent. C'est exactement le genre
   * de decalage qui donne l'impression que « ca n'a pas ete pris ».
   */
  async function persist(next: { accent?: string; skin?: SkinKey } = {}) {
    setBusy(true); setError(null); setSaved(false)
    try {
      const result = await api.put<Branding>('/api/branding', {
        name: name.trim() || undefined,
        theme: {
          accent: next.accent ?? accent,
          skin: next.skin ?? skin,
          mode: initial?.theme.mode ?? 'system',
        },
      })
      onSaved(result); setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setBusy(false) }
  }

  /**
   * L'habillage s'applique a tout le document, et s'enregistre aussitot.
   *
   * Il proposait sa teinte sans rien ecrire : l'apercu etait immediat, le
   * bouton d'enregistrement se trouvait plus haut dans la carte, et changer
   * de page rendait l'ancien habillage. On avait donc un reglage qui semblait
   * pris et ne l'etait pas. Un choix unique, visible sur-le-champ et
   * reversible d'un clic n'a pas besoin d'une confirmation.
   */
  function previewSkin(next: SkinKey) {
    setSkin(next)
    const root = document.documentElement
    root.setAttribute('data-theme', SKINS[next].base)
    root.setAttribute('data-skin', next)
    preview(SKINS[next].accent)
    persist({ accent: SKINS[next].accent, skin: next })
  }

  async function uploadBanner(file: File) {
    if (file.size > 4 * 1024 * 1024) { setError('Bannière trop volumineuse : 4 Mo maximum'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/branding/banner', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': file.type }, body: file,
      })
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null)
        throw new ApiError(res.status, typeof payload === 'object' && payload && 'error' in payload
          ? String((payload as { error: unknown }).error) : 'Envoi impossible')
      }
      const saved = await res.json() as { bannerUrl: string }
      setBannerUrl(saved.bannerUrl)
      onSaved(await api.get<Branding>('/api/branding'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Envoi impossible')
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
                   style={{ borderRadius: '50%', objectFit: 'contain', background: 'var(--overlay)' }} />
            : <span style={{
                width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center',
                background: accent, color: '#fff', fontWeight: 800, fontSize: '0.85rem',
              }}>{(name || 'GF').slice(0, 2).toUpperCase()}</span>}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
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
                            background: 'none', border: '1px dashed var(--border-hover)' }} />
          </div>
        </fieldset>

      </div>

      {/* Banniere du tableau de bord. Posee par la plateforme : c'est une
          piece d'identite visuelle qu'on installe pour le client. */}
      <fieldset style={{ border: 'none', margin: '22px 0 0', padding: 0 }}>
        <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 10 }}>
          Bannière du tableau de bord
        </legend>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{
            width: 220, height: 76, borderRadius: 14, overflow: 'hidden', flex: 'none',
            border: '1px solid var(--card-border)', background: 'var(--overlay-soft)',
            display: 'grid', placeItems: 'center',
          }}>
            {bannerUrl
              ? <img src={bannerUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span className="dz-card-note" style={{ fontSize: '0.7rem' }}>Aucune bannière</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input ref={bannerRef} type="file" className="sr-only"
                   accept="image/png,image/jpeg,image/webp"
                   onChange={e => { const f = e.target.files?.[0]; if (f) uploadBanner(f) }} />
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                      onClick={() => bannerRef.current?.click()} disabled={busy}>
                <Upload size={14} strokeWidth={2.2} /> {bannerUrl ? 'Remplacer' : 'Choisir'}
              </button>
              {bannerUrl && (
                <button className="gf-mini-btn" data-tone="danger" disabled={busy}
                        onClick={async () => {
                          setBusy(true)
                          try { await api.del('/api/branding/banner'); setBannerUrl(null) }
                          finally { setBusy(false) }
                        }}>Retirer</button>
              )}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)', maxWidth: '34ch' }}>
              Image large, 4 Mo maximum. Sans bannière, le dégradé de la couleur du club
              tient lieu de fond.
            </span>
          </div>
        </div>
      </fieldset>

      <fieldset style={{ border: 'none', margin: '22px 0 0', padding: 0 }}>
        <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 10 }}>
          Habillage
        </legend>
        <div style={{ display: 'grid', gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))' }}>
          {SKIN_KEYS.map(key => {
            const active = skin === key
            const p = PREVIEW[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => previewSkin(key)}
                aria-pressed={active}
                style={{
                  padding: 0, cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
                  borderRadius: 16, background: 'transparent',
                  border: active ? '2px solid var(--gold)' : '2px solid var(--card-border)',
                  transition: 'border-color var(--transition-fast), transform var(--transition-fast)',
                }}
              >
                {/* Une maquette miniature plutot qu'une pastille de couleur :
                    un habillage se juge sur le rapport fond / carte / accent,
                    qu'un rond uni ne montre pas. */}
                <span aria-hidden="true" style={{
                  display: 'block', height: 72, background: p.bg, padding: 10,
                }}>
                  <span style={{
                    display: 'block', height: 30, borderRadius: 8, background: p.card,
                    border: '1px solid rgba(128,128,128,0.25)',
                  }} />
                  <span style={{
                    display: 'block', marginTop: 7, height: 8, width: '55%',
                    borderRadius: 99, background: SKINS[key].accent,
                  }} />
                </span>
                <span style={{ display: 'block', padding: '9px 11px 11px' }}>
                  <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700 }}>
                    {SKINS[key].label}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2 }}>
                    {p.note}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* Le bouton ferme la carte : place au milieu, il avait l'air de ne
          valider que les champs au-dessus de lui. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                onClick={() => persist()} disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer le nom et la couleur'}
        </button>
      </div>
    </section>
  )
}
