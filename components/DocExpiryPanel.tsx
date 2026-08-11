'use client'
// components/DocExpiryPanel.tsx
// Bandeau d'alertes compact : une seule ligne repliée par défaut,
// le détail par catégorie ne s'ouvre qu'au clic.
import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { useT } from '@/lib/i18n'
import type { MemberEnriched } from '@/types'

interface Props {
  members: MemberEnriched[]
}

export default function DocExpiryPanel({ members }: Props) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const missingPassport = members.filter(m => !m.sport_passport_url)
  const insExpiring     = members.filter(m => m.ins_status === 'expiring')
  const insExpired      = members.filter(m => m.ins_status === 'expired')
  const subExpiring     = members.filter(m => m.sub_status === 'expiring')
  const subExpired      = members.filter(m => m.sub_status === 'expired')

  const groups = [
    { key: 'sub_expired',      list: subExpired,      color: 'border-red-500',    labelKey: 'notif_sub_expired'   },
    { key: 'ins_expired',      list: insExpired,      color: 'border-red-400',    labelKey: 'notif_ins_expired'   },
    { key: 'sub_expiring',     list: subExpiring,     color: 'border-amber-400',  labelKey: 'notif_sub_expiring'  },
    { key: 'ins_expiring',     list: insExpiring,     color: 'border-amber-400',  labelKey: 'notif_ins_expiring'  },
    { key: 'missing_passport', list: missingPassport, color: 'border-purple-400', labelKey: 'doc_passport_missing' },
  ].filter(g => g.list.length > 0)

  if (groups.length === 0) return null

  const total = groups.reduce((s, g) => s + g.list.length, 0)

  return (
    <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/05 overflow-hidden">
      {/* Ligne compacte — clic pour déplier */}
      <button
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-amber-500/05 transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <TriangleAlert size={15} className="text-amber-400 flex-shrink-0" />
        <span className="text-amber-400 font-bold text-xs">{t('doc_expiry_title')}</span>
        <span className="inline-flex items-center justify-center min-w-[1.2rem] h-[1.2rem] rounded-full bg-amber-500/20 text-amber-300 text-[0.65rem] font-bold px-1">
          {total}
        </span>
        <ChevronDown
          size={15}
          className="ml-auto text-amber-400/70 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {/* Détail par catégorie */}
      {open && (
        <div className="px-4 pb-3 flex flex-col gap-1.5 border-t border-amber-500/10 pt-3">
          {groups.map(g => {
            const isOpen = expanded === g.key
            return (
              <div key={g.key} className={`rounded-xl border-l-2 ${g.color} overflow-hidden bg-white/02`}>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/04 transition-colors text-left"
                  onClick={() => setExpanded(isOpen ? null : g.key)}
                >
                  <span className="text-xs text-slate-300 font-semibold flex-1">{t(g.labelKey as any)}</span>
                  <span className="text-xs text-slate-500">{g.list.length} {t('doc_expiry_members')}</span>
                  <ChevronDown size={13} className="text-slate-500" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-2.5 flex flex-col gap-1 border-t border-white/05 pt-2">
                    {g.list.map(m => (
                      <div key={m.id} className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20 flex-shrink-0" />
                        <span className="text-xs text-white font-medium">{m.name}</span>
                        {m.phone && <span className="text-xs text-slate-500 ml-auto">{m.phone}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <Link href="/alerts" className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 self-end mt-1">
            {t('doc_expiry_see_all')}
          </Link>
        </div>
      )}
    </div>
  )
}
