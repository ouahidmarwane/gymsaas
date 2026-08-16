'use client'

import { useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { api, upload as putFile, ApiError, type Branding } from '@/lib/client'

/**
 * Banniere du tableau de bord.
 *
 * Extraite pour vivre a deux endroits : la configuration du club, et le
 * panneau de la plateforme en mode support. Une seule definition des regles
 * d'envoi — format, plafond, message d'erreur — plutot que deux qui
 * divergeraient au premier ajustement.
 *
 * Le fichier part brut dans le corps, comme le logo : la cle R2 est
 * fabriquee cote serveur, donc infalsifiable, et le meme proxy la sert.
 */

const MAX_BYTES = 4 * 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

export default function BannerPicker({ initial, onSaved }: {
  initial: Branding | null
  onSaved?: (b: Branding) => void
}) {
  const [bannerUrl, setBannerUrl] = useState(initial?.bannerUrl ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function send(file: File) {
    // Refuse ici ce que le serveur refuserait : faire monter quatre
    // mega-octets pour lire « format non accepte » est une perte de temps
    // sur la connexion d'une salle de sport.
    if (!ACCEPTED.includes(file.type)) {
      setError('Format accepté : PNG, JPEG ou WebP.'); return
    }
    if (file.size > MAX_BYTES) {
      setError('Bannière trop volumineuse : 4 Mo maximum.'); return
    }
    setBusy(true); setError(null)
    try {
      const saved = await putFile<{ bannerUrl: string }>('PUT', '/api/branding/banner', file)
      setBannerUrl(saved.bannerUrl)
      onSaved?.(await api.get<Branding>('/api/branding'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Envoi impossible')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove() {
    // Le fichier part de R2 et ne revient pas.
    if (!confirm('Retirer la bannière du tableau de bord ?')) return
    setBusy(true); setError(null)
    try {
      await api.del('/api/branding/banner')
      setBannerUrl(null)
      onSaved?.(await api.get<Branding>('/api/branding'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Suppression impossible')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* L'apercu a les proportions de la vraie banniere : une vignette
            carree ne dirait pas qu'un visage centre sera rogne. */}
        <div style={{
          width: 260, height: 90, borderRadius: 14, overflow: 'hidden', flex: 'none',
          border: '1px solid var(--card-border)', background: 'var(--overlay-soft)',
          display: 'grid', placeItems: 'center',
        }}>
          {bannerUrl
            ? <img src={bannerUrl} alt="Bannière actuelle"
                   style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span className="dz-card-note" style={{ fontSize: '0.72rem' }}>Aucune bannière</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <input ref={fileRef} type="file" className="sr-only"
                 accept="image/png,image/jpeg,image/webp"
                 onChange={e => { const f = e.target.files?.[0]; if (f) send(f) }} />
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-ghost" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                    onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={14} strokeWidth={2.2} />
              {busy ? 'Envoi…' : bannerUrl ? 'Remplacer' : 'Choisir une image'}
            </button>
            {bannerUrl && (
              <button className="btn-ghost" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem',
                                                     color: '#f87171' }}
                      onClick={remove} disabled={busy}>
                <Trash2 size={14} strokeWidth={2.2} /> Retirer
              </button>
            )}
          </span>
          <span className="dz-card-note" style={{ fontSize: '0.74rem', maxWidth: 340 }}>
            Image large, PNG, JPEG ou WebP, 4 Mo maximum. Elle est recadrée en
            bandeau : prévoyez de la marge en haut et en bas. Sans bannière, le
            dégradé de la couleur du club prend sa place.
          </span>
        </div>
      </div>

      <div aria-live="polite" style={{ marginTop: 10 }}>
        {error && <p role="alert" className="mdet-problem">{error}</p>}
      </div>
    </div>
  )
}
