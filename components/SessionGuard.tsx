'use client'
// components/SessionGuard.tsx
// (1) Auto-déconnexion après 10 min d'inactivité (mesure de sécurité).
// (2) Plafond de session absolu : re-login forcé au-delà de MAX_SESSION.
// (3) Force-déconnexion admin : détectée via touchPresence (revoked).
// (4) Battement de présence pour la supervision admin (/supervision).
// Monté dans le layout protégé → actif sur toutes les pages connectées.
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { touchPresence, endPresence } from '@/lib/actions'

const IDLE_MS        = 600_000        // 10 min sans activité → déconnexion
const MAX_SESSION_MS = 3 * 3_600_000  // 3 h max par session (plafond absolu)
const HEARTBEAT_MS   = 30_000         // fréquence du battement de présence

export default function SessionGuard() {
  const router = useRouter()
  const lastActivity = useRef(Date.now())
  const loginAtMs = useRef<number | null>(null)

  useEffect(() => {
    let loggingOut = false
    const bump = () => { lastActivity.current = Date.now() }
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach(e => window.addEventListener(e, bump, { passive: true }))

    const doLogout = async (reason: 'idle' | 'expired' | 'revoked') => {
      if (loggingOut) return
      loggingOut = true
      clearInterval(hb); clearInterval(watch)
      try { await endPresence() } catch {}
      try { await createClient().auth.signOut() } catch {}
      router.replace(`/login?reason=${reason}`)
    }

    // Battement de présence : met à jour la présence + détecte une révocation
    const beat = async () => {
      const res = await touchPresence().catch(() => null)
      if (!res) return
      if (res.revoked) { doLogout('revoked'); return }
      if (res.loginAt) loginAtMs.current = new Date(res.loginAt).getTime()
    }
    beat()
    const hb = setInterval(beat, HEARTBEAT_MS)

    // Surveillance inactivité + plafond absolu
    const watch = setInterval(() => {
      if (loggingOut) return
      if (Date.now() - lastActivity.current >= IDLE_MS) { doLogout('idle'); return }
      if (loginAtMs.current && Date.now() - loginAtMs.current >= MAX_SESSION_MS) { doLogout('expired'); return }
    }, 5_000)

    return () => {
      events.forEach(e => window.removeEventListener(e, bump))
      clearInterval(hb); clearInterval(watch)
    }
  }, [router])

  return null
}
