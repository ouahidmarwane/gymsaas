'use client'

import { useEffect, useRef, useState } from 'react'
import { Crosshair, MapPin } from 'lucide-react'
import type { Map as LeafletMap, Marker } from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface BranchLocation {
  lat: number
  lng: number
  label: string
}

export default function BranchLocationPicker({ value, onChange }: {
  value: BranchLocation | null
  onChange: (location: BranchLocation) => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const marker = useRef<Marker | null>(null)
  const changeRef = useRef(onChange)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { changeRef.current = onChange }, [onChange])

  useEffect(() => {
    if (!holder.current) return
    let cancelled = false
    ;(async () => {
      try {
        const L = (await import('leaflet')).default
        if (cancelled || !holder.current || map.current) return
        const instance = L.map(holder.current, {
          center: value ? [value.lat, value.lng] : [31.79, -7.09],
          zoom: value ? 15 : 5,
          scrollWheelZoom: false,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(instance)
        instance.on('click', event => {
          const next = { lat: event.latlng.lat, lng: event.latlng.lng, label: '' }
          if (!marker.current) marker.current = L.marker(event.latlng).addTo(instance)
          else marker.current.setLatLng(event.latlng)
          changeRef.current(next)
        })
        map.current = instance
      } catch {
        if (!cancelled) setError('La carte ne peut pas être chargée pour le moment.')
      }
    })()
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
      marker.current = null
    }
    // La carte est créée une seule fois ; les changements passent par le marqueur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!map.current || !value) return
    ;(async () => {
      const L = (await import('leaflet')).default
      const point: [number, number] = [value.lat, value.lng]
      if (!marker.current) marker.current = L.marker(point).addTo(map.current!)
      else marker.current.setLatLng(point)
    })()
  }, [value])

  function locateMe() {
    if (!navigator.geolocation) {
      setError('La localisation n’est pas disponible sur cet appareil.')
      return
    }
    setError(null)
    navigator.geolocation.getCurrentPosition(
      position => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude, label: value?.label ?? '' }
        changeRef.current(next)
        map.current?.setView([next.lat, next.lng], 16)
      },
      () => setError('Autorisez la localisation, ou cliquez directement sur la carte.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  return (
    <div className="branch-location-picker">
      <div className="branch-location-head">
        <div>
          <strong><MapPin size={16} /> Emplacement de la branche</strong>
          <span>Cliquez sur le bâtiment exact. Ce point apparaîtra dans la supervision GymFlow.</span>
        </div>
        <button type="button" className="gf-mini-btn" onClick={locateMe}>
          <Crosshair size={13} /> Ma position
        </button>
      </div>
      {error ? <p className="branch-location-error" role="alert">{error}</p> : null}
      <div ref={holder} className="branch-location-map" role="application" aria-label="Choisir l’emplacement de la branche" />
      <label className="branch-location-label">
        <span>Adresse ou repère affiché</span>
        <input className="input-dark" maxLength={200} placeholder="Ex. Maarif, Casablanca"
               value={value?.label ?? ''}
               onChange={event => value && onChange({ ...value, label: event.target.value })}
               disabled={!value} />
      </label>
      <p className="branch-location-status" aria-live="polite">
        {value
          ? `Point sélectionné : ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`
          : 'Aucun point sélectionné — cliquez sur la carte pour continuer.'}
      </p>
    </div>
  )
}
