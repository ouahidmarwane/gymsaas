'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, ExternalLink, ChevronDown } from 'lucide-react'

/**
 * Carte des salles abonnees.
 *
 * Les marqueurs sont des elements du DOM poses par un OverlayView, pas des
 * google.maps.Marker. Trois raisons :
 *
 *  - un marqueur classique prend une image ; on ne peut pas l'animer en CSS,
 *    et le neon demande une animation ;
 *  - AdvancedMarkerElement le permettrait mais exige un Map ID vectoriel,
 *    donc une configuration de plus a la charge de l'exploitant ;
 *  - un noeud DOM se met a jour en place. Sur un rafraichissement toutes les
 *    dix secondes, recreer les marqueurs ferait clignoter la carte entiere.
 *
 * Sans cle, l'ecran ne se ferme pas : il affiche la meme information en
 * liste. Une carte absente ne doit pas emporter la supervision.
 */

export interface MapClub {
  id: string
  name: string
  slug: string
  lat: number | null
  lng: number | null
  label: string | null
  theme: { accent: string }
  online: number
  open_alerts: number
  under_support: number
  last_seen_at: string | null
  status: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Gm = any

declare global {
  interface Window {
    google?: Gm
    __gfMapsPromise?: Promise<Gm>
  }
}

/** Charge l'API une seule fois par page, meme si la carte se remonte. */
function loadMaps(key: string): Promise<Gm> {
  if (window.google?.maps) return Promise.resolve(window.google)
  if (window.__gfMapsPromise) return window.__gfMapsPromise

  window.__gfMapsPromise = new Promise<Gm>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&v=weekly`
    script.async = true
    script.onload = () => {
      if (window.google?.maps) resolve(window.google)
      else reject(new Error('API Google Maps chargee mais incomplete'))
    }
    script.onerror = () => {
      // Sans cela, un echec reseau laisserait la promesse en cache et la
      // carte ne retenterait jamais.
      delete window.__gfMapsPromise
      reject(new Error('Chargement de Google Maps impossible'))
    }
    document.head.appendChild(script)
  })
  return window.__gfMapsPromise
}

/** Etat visuel d'une salle. L'ordre compte : l'alerte prime sur l'activite. */
function stateOf(club: MapClub): 'support' | 'alert' | 'online' | 'idle' {
  if (club.under_support > 0) return 'support'
  if (club.open_alerts > 0) return 'alert'
  if (club.online > 0) return 'online'
  return 'idle'
}

/** Carte sombre, pour que les marqueurs ressortent. */
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#16202c' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7d8b9c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d141c' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e2b3a' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b131c' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2b3a4c' }] },
]

const LIGHT_STYLE = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
]

export default function ClubsMap({
  clubs, mapsKey, onEnter, onLocate,
}: {
  clubs: MapClub[]
  mapsKey: string | null
  onEnter: (club: MapClub) => void
  onLocate: (club: MapClub, at: { lat: number; lng: number; label: string }) => Promise<void>
}) {
  const [locating, setLocating] = useState<string | null>(null)
  // Devoilement par paliers, comme les tableaux de supervision : tout ouvrir
  // d'un coup remplace un mur par un autre.
  const STEP = 6
  const [count, setCount] = useState(STEP)
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<Gm>(null)
  const pinClass = useRef<Gm>(null)
  const markers = useRef(new Map<string, { overlay: Gm; el: HTMLButtonElement }>())
  const fitted = useRef(false)
  const enterRef = useRef(onEnter)
  const clubsRef = useRef(clubs)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Les gestionnaires de clic, poses une seule fois sur chaque marqueur,
  // lisent la liste courante et non celle capturee a leur creation.
  useEffect(() => { enterRef.current = onEnter }, [onEnter])
  useEffect(() => { clubsRef.current = clubs }, [clubs])

  // Memoise : la page de supervision se rend chaque seconde pour faire
  // avancer les durees. Sans cela cette liste serait une nouvelle reference
  // a chaque tick et l'effet des marqueurs tournerait une fois par seconde.
  const located = useMemo(() => clubs.filter(c => c.lat !== null && c.lng !== null), [clubs])

  useEffect(() => {
    if (!mapsKey || !holder.current) return
    let alive = true

    loadMaps(mapsKey).then(google => {
      if (!alive || !holder.current) return

      const dark = document.documentElement.getAttribute('data-theme') !== 'light'
      map.current = new google.maps.Map(holder.current, {
        center: { lat: 33.5731, lng: -7.5898 },   // Casablanca, en attendant les points
        zoom: 6,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        styles: dark ? DARK_STYLE : LIGHT_STYLE,
        backgroundColor: 'transparent',
      })

      // Defini apres le chargement : la classe herite d'un symbole qui
      // n'existe pas avant.
      class Pin extends google.maps.OverlayView {
        constructor(public position: Gm, public el: HTMLElement) { super() }
        onAdd() {
          this.getPanes().overlayMouseTarget.appendChild(this.el)
        }
        draw() {
          const p = this.getProjection()?.fromLatLngToDivPixel(this.position)
          if (!p) return
          // translate3d : le deplacement reste sur le compositeur, donc le
          // zoom ne saccade pas meme avec cinquante salles.
          this.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`
        }
        onRemove() { this.el.remove() }
      }
      pinClass.current = Pin
      setReady(true)
      setError(null)
    }).catch((e: Error) => { if (alive) setError(e.message) })

    return () => { alive = false }
  }, [mapsKey])

  // Mise a jour des marqueurs : creation, mise a jour en place, retrait.
  useEffect(() => {
    const google = window.google
    const Pin = pinClass.current
    if (!ready || !map.current || !google || !Pin) return

    const seen = new Set<string>()

    for (const club of located) {
      seen.add(club.id)
      const position = new google.maps.LatLng(club.lat!, club.lng!)
      let entry = markers.current.get(club.id)

      if (!entry) {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'gf-pin'
        el.innerHTML = '<span class="gf-pin-halo"></span><span class="gf-pin-dot"></span>'
          + '<span class="gf-pin-label"></span>'
        el.addEventListener('click', () => {
          const current = clubsRef.current.find(c => c.id === club.id)
          if (current) enterRef.current(current)
        })
        const overlay = new Pin(position, el)
        overlay.setMap(map.current)
        entry = { overlay, el }
        markers.current.set(club.id, entry)
      } else {
        entry.overlay.position = position
        entry.overlay.draw?.()
      }

      const state = stateOf(club)
      const badge = club.under_support > 0 ? 'support'
        : club.open_alerts > 0 ? `${club.open_alerts} alerte${club.open_alerts > 1 ? 's' : ''}`
        : club.online > 0 ? `${club.online} en ligne`
        : ''

      // On n'ecrit que si la valeur change : reaffecter la meme classe
      // relancerait l'animation a chaque rafraichissement.
      if (entry.el.dataset.state !== state) entry.el.dataset.state = state
      entry.el.style.setProperty('--pin', club.theme?.accent ?? '#2f6bff')
      entry.el.title = `${club.name}${club.label ? ` — ${club.label}` : ''}`
      entry.el.setAttribute('aria-label', `${club.name}, entrer`)
      const label = entry.el.querySelector('.gf-pin-label')
      const text = badge ? `${club.name} · ${badge}` : club.name
      if (label && label.textContent !== text) label.textContent = text
    }

    for (const [id, entry] of markers.current) {
      if (!seen.has(id)) { entry.overlay.setMap(null); markers.current.delete(id) }
    }

    // Cadrage une seule fois : recadrer a chaque rafraichissement
    // arracherait la carte des mains de qui est en train de la deplacer.
    if (!fitted.current && located.length > 0) {
      fitted.current = true
      if (located.length === 1) {
        map.current.setCenter({ lat: located[0]!.lat!, lng: located[0]!.lng! })
        map.current.setZoom(13)
      } else {
        const bounds = new google.maps.LatLngBounds()
        for (const c of located) bounds.extend(new google.maps.LatLng(c.lat!, c.lng!))
        map.current.fitBounds(bounds, 64)
      }
    }
  }, [ready, located])

  // Suit l'habillage : une carte sombre sur une interface claire jure.
  useEffect(() => {
    if (!ready || !map.current) return
    const apply = () => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'light'
      map.current.setOptions({ styles: dark ? DARK_STYLE : LIGHT_STYLE })
    }
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [ready])

  const missing = clubs.length - located.length

  const RANK = { support: 0, alert: 1, online: 2, idle: 3 } as const
  const sorted = useMemo(
    () => [...clubs].sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)] || a.name.localeCompare(b.name, 'fr')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clubs],
  )
  const shown = sorted.slice(0, count)
  const rest = Math.max(0, sorted.length - count)

  return (
    <div className="gf-map-wrap">
      {mapsKey && !error && <div ref={holder} className="gf-map" role="application" aria-label="Carte des salles" />}

      {(!mapsKey || error) && (
        <div className="gf-map-fallback">
          <MapPin size={22} strokeWidth={2} style={{ color: 'var(--muted)' }} />
          <p style={{ fontWeight: 700, fontSize: '0.95rem' }}>
            {error ?? 'Carte non configurée'}
          </p>
          <p className="dz-card-note" style={{ maxWidth: '46ch' }}>
            {error
              ? 'Les salles restent listées ci-dessous.'
              : 'Ajoutez une clé Google Maps de navigateur dans GOOGLE_MAPS_API_KEY pour afficher la carte. Les salles restent listées ci-dessous.'}
          </p>
        </div>
      )}

      {/* Toujours presente : c'est elle qui rend l'ecran utilisable sans cle,
          et c'est aussi la seule facon de reperer une salle sans coordonnees.

          Repliee au-dela de six lignes, et triee par ce qui se passe : avec
          trente-cinq clubs, une liste complete repousse les alertes hors de
          l'ecran, et une salle sous support finirait plus bas qu'une salle
          endormie a cause de l'ordre alphabetique. */}
      <ul className="gf-map-list">
        {shown.map(club => {
          const state = stateOf(club)
          return (
            <li key={club.id} style={{ '--pin': club.theme?.accent ?? '#2f6bff' } as React.CSSProperties}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <button type="button" className="gf-map-row" data-state={state}
                        onClick={() => onEnter(club)}>
                  <span className="gf-map-row-dot" aria-hidden="true" />
                  <span className="gf-map-row-body">
                    <span className="gf-map-row-name">{club.name}</span>
                    <span className="gf-map-row-note">
                      {club.label
                        ?? (club.lat === null ? 'emplacement non renseigné' : `${club.lat!.toFixed(4)}, ${club.lng!.toFixed(4)}`)}
                    </span>
                  </span>
                  <span className="gf-map-row-state">
                    {club.under_support > 0 ? 'support en cours'
                      : club.open_alerts > 0 ? `${club.open_alerts} alerte${club.open_alerts > 1 ? 's' : ''}`
                      : club.online > 0 ? `${club.online} en ligne`
                      : 'calme'}
                  </span>
                  <ExternalLink size={13} strokeWidth={2.2} style={{ flex: 'none', color: 'var(--muted)' }} />
                </button>
                <button type="button" className="gf-mini-btn" style={{ flex: 'none' }}
                        aria-expanded={locating === club.id}
                        onClick={() => setLocating(locating === club.id ? null : club.id)}>
                  <MapPin size={12} strokeWidth={2.4} /> {club.lat === null ? 'Situer' : 'Déplacer'}
                </button>
              </div>
              {locating === club.id && (
                <LocateForm club={club}
                            onCancel={() => setLocating(null)}
                            onSave={async at => { await onLocate(club, at); setLocating(null) }} />
              )}
            </li>
          )
        })}
      </ul>

      {(rest > 0 || count > STEP) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {rest > 0 && (
            <button className="gf-fold" onClick={() => setCount(c => c + STEP)}>
              <ChevronDown size={15} strokeWidth={2.4} />
              Afficher {Math.min(STEP, rest)} de plus
              <span className="gf-fold-rest">
                {rest} salle{rest > 1 ? 's' : ''} restante{rest > 1 ? 's' : ''}
              </span>
            </button>
          )}
          {count > STEP && (
            <button className="gf-fold" onClick={() => setCount(STEP)}>
              <ChevronDown size={15} strokeWidth={2.4} data-open="true" /> Réduire
            </button>
          )}
        </div>
      )}

      {missing > 0 && (
        <p className="dz-card-note" style={{ marginTop: 10 }}>
          {missing} salle{missing > 1 ? 's' : ''} sans emplacement : utilisez « Situer » pour
          la placer sur la carte.
        </p>
      )}
    </div>
  )
}

/**
 * Saisie des coordonnees.
 *
 * Pas de geocodage automatique : il facturerait un appel par enregistrement
 * et se tromperait sur les adresses marocaines mal normalisees. Un clic droit
 * dans Google Maps donne le couple exact, et le champ accepte le
 * « 33.5731, -7.5898 » qu'il met dans le presse-papier.
 */
function LocateForm({ club, onSave, onCancel }: {
  club: MapClub
  onSave: (at: { lat: number; lng: number; label: string }) => Promise<void>
  onCancel: () => void
}) {
  const [pair, setPair] = useState(club.lat !== null ? `${club.lat}, ${club.lng}` : '')
  const [label, setLabel] = useState(club.label ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const parsed = (() => {
    const m = pair.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/)
    if (!m) return null
    const lat = Number(m[1]), lng = Number(m[2])
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
    return { lat, lng }
  })()

  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      margin: '6px 0 2px', padding: '0.7rem 0.85rem',
      borderRadius: 14, background: 'var(--overlay-soft)', border: '1px solid var(--float-border)',
    }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 190px' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)' }}>
          Latitude, longitude
        </span>
        <input className="input-dark" value={pair} placeholder="33.5731, -7.5898"
               inputMode="decimal" onChange={e => { setPair(e.target.value); setProblem(null) }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 190px' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)' }}>Adresse affichée</span>
        <input className="input-dark" value={label} maxLength={200}
               placeholder="Sbata, Casablanca" onChange={e => setLabel(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end', paddingBottom: 2 }}>
        <button className="gf-mini-btn" onClick={onCancel} disabled={busy}>Annuler</button>
        <button className="gf-mini-btn" disabled={busy || !parsed}
                style={{ background: 'var(--gold)', borderColor: 'transparent', color: '#fff' }}
                onClick={async () => {
                  if (!parsed) { setProblem('Deux nombres séparés par une virgule.'); return }
                  setBusy(true)
                  try { await onSave({ ...parsed, label: label.trim() }) }
                  catch (e) { setProblem(e instanceof Error ? e.message : 'Enregistrement impossible') }
                  finally { setBusy(false) }
                }}>
          {busy ? '…' : 'Enregistrer'}
        </button>
      </div>
      {(problem || (pair.trim() && !parsed)) && (
        <p style={{ flexBasis: '100%', margin: 0, fontSize: '0.72rem', color: '#fca5a5' }}>
          {problem ?? 'Format attendu : 33.5731, -7.5898'}
        </p>
      )}
    </div>
  )
}
