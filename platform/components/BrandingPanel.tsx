'use client'

import { useRef, useState } from 'react'
import { Palette, Upload } from 'lucide-react'
import { api, ApiError, type Branding } from '@/lib/client'
import ThemePicker from '@/components/ThemePicker'

/**
 * Panneau de marque de la plateforme.
 *
 * Il garde ce qui appartient a l'exploitant : le nom affiche, le logo, la
 * banniere du tableau de bord. L'habillage et la couleur sont passes a
 * ThemePicker, partage avec la configuration du club — un seul endroit ou
 * les cinq habillages sont definis.
 */
export default function BrandingPanel({
  initial, onSaved,
}: { initial: Branding | null; onSaved: (b: Branding) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const [bannerUrl, setBannerUrl] = useState(initial?.bannerUrl ?? null)
  const [name, setName] = useState(initial?.name ?? '')
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  /**
   * Enregistre le nom affiche.
   *
   * Le theme n'est plus envoye d'ici : ThemePicker l'ecrit lui-meme. Le
   * renvoyer aurait remis l'habillage tel qu'il etait au montage du panneau,
   * ecrasant en silence le choix fait juste au-dessus.
   */
  async function persist() {
    setBusy(true); setError(null); setSaved(false)
    try {
      const result = await api.put<Branding>('/api/branding', {
        name: name.trim() || undefined,
      })
      onSaved(result); setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setBusy(false) }
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
                // var(--gold) plutot qu'une copie locale de l'accent : la
                // pastille suit ainsi le choix fait dans ThemePicker en
                // direct, sans avoir a remonter l'etat.
                background: 'var(--gold)', color: '#fff', fontWeight: 800, fontSize: '0.85rem',
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

      {/* Habillage et couleur : le meme composant que dans la configuration
          du club. Une seule definition des cinq habillages — recopiee, elle
          aurait diverge au premier ajout, et le client aurait vu des themes
          que la plateforme ne connait pas. */}
      <div style={{ marginTop: 22 }}>
        <ThemePicker initial={initial} onSaved={onSaved} />
      </div>

      {/* Le bouton ferme la carte : place au milieu, il avait l'air de ne
          valider que les champs au-dessus de lui. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                onClick={() => persist()} disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer le nom'}
        </button>
      </div>
    </section>
  )
}
