'use client'
// components/NotifBell.tsx
import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useAnimPresence } from '@/lib/use-anim-presence'
import { getNotifications, markAllRead, markOneRead } from '@/lib/actions'
import { generateWhatsAppLink, WHATSAPP_TEMPLATES } from '@/lib/whatsapp'
import type { Notification } from '@/types'
import clsx from 'clsx'

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  sub_expiring: { icon: '📅', label: 'Abonnement expire bientôt', color: '#f59e0b' },
  sub_expired:  { icon: '❌', label: 'Abonnement expiré',          color: '#ef4444' },
  ins_expiring: { icon: '🛡️', label: 'Assurance expire bientôt',  color: '#f59e0b' },
  ins_expired:  { icon: '⚠️', label: 'Assurance expirée',          color: '#ef4444' },
  ins_missing:  { icon: '🚫', label: "Pas d'assurance",            color: '#8b5cf6' },
}

function getWaLink(n: Notification): string | null {
  const phone = n.members?.phone
  if (!phone) return null
  const name = n.members?.name ?? 'cher membre'
  let msg = ''
  if (n.type === 'sub_expiring') msg = WHATSAPP_TEMPLATES.sub_expiring(name, 7)
  else if (n.type === 'sub_expired') msg = WHATSAPP_TEMPLATES.sub_expired(name)
  else if (n.type === 'ins_expiring') msg = WHATSAPP_TEMPLATES.ins_expiring(name, 30)
  else if (n.type === 'ins_expired') msg = WHATSAPP_TEMPLATES.ins_expired(name)
  else if (n.type === 'ins_missing') msg = WHATSAPP_TEMPLATES.ins_missing(name)
  else msg = WHATSAPP_TEMPLATES.generic(name)
  return generateWhatsAppLink(phone, msg)
}

export default function NotifBell({ activeBranch, initialCount }: {
  activeBranch: 'sbata' | 'rachad'
  initialCount: number
}) {
  const panel = useAnimPresence(160)
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [unread, setUnread] = useState(initialCount)
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) panel.close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Poll badge count every 30s so it updates without page reload
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getNotifications(activeBranch)
        const list = (data ?? []) as Notification[]
        setUnread(list.filter(n => !n.is_read).length)
      } catch {}
    }
    const interval = setInterval(poll, 30000)
    return () => clearInterval(interval)
  }, [activeBranch])

  const fetchNotifs = async () => {
    setLoading(true)
    try {
      const data = await getNotifications(activeBranch)
      const list = (data ?? []) as Notification[]
      setNotifs(list)
      setUnread(list.filter(n => !n.is_read).length)
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = () => {
    if (panel.isOpen) {
      panel.close()
    } else {
      panel.open()
      fetchNotifs().then(() => {
        // Consulter les alertes = les marquer lues : le badge tombe à zéro
        // jusqu'à l'arrivée de nouvelles notifications. L'affichage du panneau
        // garde la séparation lues/non-lues de cette consultation.
        startTransition(async () => {
          await markAllRead(activeBranch)
          setUnread(0)
        })
      })
    }
  }

  const handleMarkOne = (id: string) => {
    startTransition(async () => {
      await markOneRead(id)
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      setUnread(prev => Math.max(0, prev - 1))
    })
  }

  const handleMarkAll = () => {
    startTransition(async () => {
      await markAllRead(activeBranch)
      setNotifs(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnread(0)
    })
  }

  const unreadNotifs = notifs.filter(n => !n.is_read)
  const readNotifs   = notifs.filter(n =>  n.is_read)

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="icon-btn relative"
        aria-label="Alertes"
      >
        <Bell size={17} strokeWidth={2.1} />
        <span className="t-badge" data-open={unread > 0 ? 'true' : 'false'}>
          <span className="t-badge-dot min-w-[1.1rem] h-[1.1rem] rounded-full bg-red-500 text-white text-[0.6rem] font-bold flex items-center justify-center px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        </span>
      </button>

      {/* Dropdown */}
      {panel.mounted && (
        <div className={`notif-dropdown t-dropdown ${panel.stateClass}`} data-origin="top-right">
          {/* Header */}
          <div className="notif-dropdown-header">
            <span className="notif-dropdown-title">
              Alertes {unread > 0 && <span className="notif-count-badge">{unread}</span>}
            </span>
            {unread > 0 && (
              <button onClick={handleMarkAll} disabled={isPending} className="notif-mark-all">
                ✓ Tout lire
              </button>
            )}
          </div>

          {/* Body */}
          <div className="notif-dropdown-body">
            {loading && (
              <div className="notif-empty">
                <div className="animate-spin w-5 h-5 border-2 border-white/20 border-t-white/80 rounded-full mx-auto" />
              </div>
            )}

            {!loading && notifs.length === 0 && (
              <div className="notif-empty">
                <span className="text-2xl">🎉</span>
                <p>Aucune alerte</p>
              </div>
            )}

            {/* Unread */}
            {!loading && unreadNotifs.map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? { icon: '🔔', label: 'Notification', color: '#6b7280' }
              const waLink = getWaLink(n)
              return (
                <div key={n.id} className="notif-item notif-item-unread glossy-new">
                  <div className="notif-item-icon" style={{ color: cfg.color }}>{cfg.icon}</div>
                  <div className="notif-item-body">
                    <div className="notif-item-label">{cfg.label}</div>
                    <div className="notif-item-name">{n.members?.name}</div>
                    <div className="notif-item-msg">{n.message}</div>
                    <div className="notif-item-actions">
                      {waLink && (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => handleMarkOne(n.id)}
                          className="notif-wa-btn"
                        >
                          💬 WhatsApp
                        </a>
                      )}
                      <button onClick={() => handleMarkOne(n.id)} className="notif-read-btn">
                        ✓ Lu
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Separator */}
            {!loading && unreadNotifs.length > 0 && readNotifs.length > 0 && (
              <div className="notif-separator">Lues</div>
            )}

            {/* Read */}
            {!loading && readNotifs.slice(0, 5).map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? { icon: '🔔', label: 'Notification', color: '#6b7280' }
              return (
                <div key={n.id} className="notif-item notif-item-read">
                  <div className="notif-item-icon" style={{ color: cfg.color, opacity: 0.5 }}>{cfg.icon}</div>
                  <div className="notif-item-body">
                    <div className="notif-item-label" style={{ opacity: 0.6 }}>{cfg.label}</div>
                    <div className="notif-item-name" style={{ opacity: 0.5 }}>{n.members?.name}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <Link
            href="/alerts"
            onClick={() => panel.close()}
            className="notif-dropdown-footer"
          >
            Voir toutes les alertes →
          </Link>
        </div>
      )}
    </div>
  )
}
