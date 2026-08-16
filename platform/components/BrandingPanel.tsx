'use client'

import { useRef, useState } from 'react'
import { Palette, Upload } from 'lucide-react'
import { api, ApiError, type Branding } from '@/lib/client'
import ThemePicker from '@/components/ThemePicker'
import BannerPicker from '@/components/BannerPicker'

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

      {/* Banniere : le meme composant que dans la configuration du club, pour
          la meme raison que l'habillage — une seule definition des regles
          d'envoi. La plateforme la pose desormais pour depanner, pas parce
          qu'elle serait seule a en avoir le droit. */}
      <fieldset style={{ border: 'none', margin: '22px 0 0', padding: 0 }}>
        <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 10 }}>
          Bannière du tableau de bord
        </legend>
        <BannerPicker initial={initial} onSaved={onSaved} />
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
