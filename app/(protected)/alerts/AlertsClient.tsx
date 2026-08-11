'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { markAllRead, markOneRead, getMembersMissingPassport, getNotifications } from '@/lib/actions'
import { generateWhatsAppLink, WHATSAPP_TEMPLATES } from '@/lib/whatsapp'
import { useT } from '@/lib/i18n'
import { useBranch } from '@/lib/branch-context'
import { useDiscipline } from '@/lib/discipline-context'
import type { Notification } from '@/types'
import clsx from 'clsx'

const NOTIF_ICONS: Record<string, { icon: string; color: string }> = {
  sub_expiring: { icon: '📅', color: 'border-amber-400' },
  sub_expired:  { icon: '❌', color: 'border-red-400' },
  ins_expiring: { icon: '🛡️', color: 'border-amber-400' },
  ins_expired:  { icon: '⚠️', color: 'border-red-400' },
  ins_missing:  { icon: '🚫', color: 'border-purple-400' },
}

function Toast({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl animate-fade-in">
      {msg}
    </div>
  )
}

function getWhatsAppMessage(notification: Notification): string {
  const name = notification.members?.name ?? 'cher membre'
  const type = notification.type
  const m = notification.members as any
  // Jours restants calculés depuis la VRAIE date d'échéance du membre
  const daysUntil = (d: string | null | undefined) =>
    d ? Math.max(1, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)) : 1

  if (type === 'sub_expiring') return WHATSAPP_TEMPLATES.sub_expiring(name, daysUntil(m?.sub_expiry))
  if (type === 'sub_expired') return WHATSAPP_TEMPLATES.sub_expired(name)
  if (type === 'ins_expiring') return WHATSAPP_TEMPLATES.ins_expiring(name, daysUntil(m?.ins_expiry))
  if (type === 'ins_expired') return WHATSAPP_TEMPLATES.ins_expired(name)
  if (type === 'ins_missing') return WHATSAPP_TEMPLATES.ins_missing(name)
  return WHATSAPP_TEMPLATES.generic(name)
}

const URGENCY_KEYS: Record<string, 'urgent' | 'soon'> = {
  sub_expired:  'urgent',
  ins_expired:  'urgent',
  ins_missing:  'urgent',
  sub_expiring: 'soon',
  ins_expiring: 'soon',
}

const NOTIF_LABEL_KEYS: Record<string, 'notif_sub_expiring' | 'notif_sub_expired' | 'notif_ins_expiring' | 'notif_ins_expired' | 'notif_ins_missing'> = {
  sub_expiring: 'notif_sub_expiring',
  sub_expired:  'notif_sub_expired',
  ins_expiring: 'notif_ins_expiring',
  ins_expired:  'notif_ins_expired',
  ins_missing:  'notif_ins_missing',
}

function NotificationItem({ notification, onMarkRead }: {
  notification: Notification
  onMarkRead: (id: string) => void
}) {
  const { t } = useT()
  const cfg = NOTIF_ICONS[notification.type] || { icon: '🔔', color: 'border-gray-400' }
  const label = NOTIF_LABEL_KEYS[notification.type] ? t(NOTIF_LABEL_KEYS[notification.type]) : 'Notification'
  const phone = notification.members?.phone ?? ''
  const name  = notification.members?.name ?? ''
  const waMessage = getWhatsAppMessage(notification)
  const waLink = phone ? generateWhatsAppLink(phone, waMessage) : null
  const urgencyKey = URGENCY_KEYS[notification.type]
  const isUrgent = urgencyKey === 'urgent'

  return (
    <div className={clsx(
      'card p-5 flex items-start gap-4 border-l-4 transition-all',
      cfg.color,
      notification.is_read ? 'opacity-60' : 'bg-slate-950/80'
    )}>
      <div className="text-2xl flex-shrink-0 mt-0.5">{cfg.icon}</div>

      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-bold text-white">{label}</span>
          {urgencyKey && (
            <span className={clsx(
              'text-[0.65rem] font-bold px-2 py-0.5 rounded-full',
              isUrgent ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
            )}>
              {isUrgent ? t('urgent') : t('soon')}
            </span>
          )}
          {notification.is_read && (
            <span className="text-[0.65rem] text-gray-500 ml-auto">{t('read_label')}</span>
          )}
        </div>

        {/* Message */}
        <div className="text-sm text-gray-300 mb-3">{notification.message}</div>

        {/* Member info */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href={`/members?search=${encodeURIComponent(name)}`}
            className="flex items-center gap-1.5 text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            👤 {name}
          </Link>
          {phone && (
            <a href={`tel:${phone}`} className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
              📞 {phone}
            </a>
          )}
          <span className="text-xs text-gray-500 ml-auto">
            {new Date(notification.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 flex-shrink-0">
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => !notification.is_read && onMarkRead(notification.id)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full text-white transition-all hover:opacity-90 hover:-translate-y-px"
            style={{ backgroundColor: '#25D366' }}
          >
            💬 WhatsApp
          </a>
        )}
        {!notification.is_read && (
          <button
            onClick={() => onMarkRead(notification.id)}
            className="text-xs px-3 py-1.5 rounded-full border border-white/20 text-gray-400 hover:text-white hover:border-white/40 transition-all"
          >
            {t('mark_read')}
          </button>
        )}
      </div>
    </div>
  )
}

export default function AlertsClient({
  initialNotifications,
}: {
  initialNotifications: Notification[]
}) {
  const { activeBranch } = useBranch()
  const { activeDiscipline } = useDiscipline()
  const disc = activeDiscipline === 'all' ? undefined : activeDiscipline
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [filter, setFilter] = useState<'all' | 'unread'>('unread')
  const [toast, setToast] = useState('')
  const [isPending, startTransition] = useTransition()
  const [missingPassport, setMissingPassport] = useState<{ id: string; name: string; phone: string }[]>([])
  const { t } = useT()

  // Alertes + passeports manquants suivent le filtre discipline global (+ branche)
  useEffect(() => {
    getNotifications(activeBranch, disc)
      .then(n => setNotifications(n as Notification[]))
      .catch(() => {})
    getMembersMissingPassport(activeBranch, disc)
      .then(data => setMissingPassport(data as any[]))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, activeDiscipline])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const displayed = filter === 'unread'
    ? notifications.filter(n => !n.is_read)
    : notifications

  const unreadCount = notifications.filter(n => !n.is_read).length

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllRead(activeBranch, disc)
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      showToast(t('toasted_read'))
    })
  }

  const handleMarkRead = (id: string) => {
    startTransition(async () => {
      await markOneRead(id)
      // Optimistic update
      setNotifications(prev => prev.map(n =>
        n.id === id ? { ...n, is_read: true } : n
      ))
    })
  }

  return (
    <div className="max-w-3xl mx-auto text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-black text-white">{t('alerts_title')}</h1>
          <p className="text-gray-300 mt-0.5">
            {unreadCount > 0 ? `${unreadCount} ${t('alerts_unread')}` : t('alerts_ok')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="btn-ghost text-sm text-white border border-white/20 px-4 py-2 rounded-lg hover:bg-white/10 transition">
            {t('back')}
          </Link>
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} disabled={isPending} className="btn-ghost text-sm">
              {t('mark_all_read')}
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-slate-800/80 p-1 rounded-xl w-fit">
        {(['unread', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-semibold transition-all', filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-300 hover:text-white')}>
            {f === 'unread' ? t('filter_unread') : t('filter_all')}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      <div className="space-y-3">
        {displayed.length === 0 ? (
          <div className="text-center py-12 text-gray-300">
            {filter === 'unread' ? t('no_unread') : t('no_alerts')}
          </div>
        ) : (
          displayed.map(notification => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkRead={handleMarkRead}
            />
          ))
        )}
      </div>

      {/* Missing passport section — always visible regardless of filter */}
      {missingPassport.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-purple-400 font-bold text-sm">🚫 {t('doc_passport_missing')}</span>
            <span className="text-xs text-purple-400/60">— {missingPassport.length} {t('doc_expiry_members')}</span>
          </div>
          <div className="space-y-2">
            {missingPassport.map(m => (
              <div key={m.id} className="card p-4 flex items-center gap-4 border-l-4 border-purple-400">
                <div className="text-2xl flex-shrink-0">🚫</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-white">{t('doc_passport_missing')}</span>
                    <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                      {t('urgent')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mt-1">
                    <Link
                      href={`/members?search=${encodeURIComponent(m.name)}`}
                      className="flex items-center gap-1.5 text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      👤 {m.name}
                    </Link>
                    {m.phone && (
                      <a href={`tel:${m.phone}`} className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
                        📞 {m.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast} />}
    </div>
  )
}