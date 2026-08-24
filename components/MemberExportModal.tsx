'use client'

import { useMemo, useState } from 'react'
import { X, Download } from 'lucide-react'
import {
  type MemberRow, subStatus, insStatus, isDormant,
  SUB_LABEL, INS_LABEL,
} from '@/lib/member-status'
import { toCsv, download } from '@/lib/csv'
import { useScrollLock } from '@/lib/scroll-lock'
import { useModalMotion } from '@/lib/modal-motion'

interface Branch { id: string; name: string }
interface Discipline { id: string; name: string }

/**
 * Export filtre : on choisit qui sort, pas seulement ce qu'on voit.
 *
 * Les criteres se cumulent — « assures ET abonnement expire » est une
 * question qu'un gerant pose vraiment avant de relancer. Le nombre de
 * membres retenus s'affiche en direct : partir sur un fichier vide sans le
 * savoir est le defaut classique de ce genre de boite.
 */

const SUB_CHOICES = [
  { key: 'all', label: 'Tous' },
  { key: 'active', label: 'Actif' },
  { key: 'expiring', label: 'Expire bientôt' },
  { key: 'expired', label: 'Expiré' },
] as const

const INS_CHOICES = [
  { key: 'all', label: 'Toutes' },
  { key: 'active', label: 'Assuré' },
  { key: 'expiring', label: 'Expire bientôt' },
  { key: 'expired', label: 'Expirée' },
  { key: 'uninsured', label: 'Non assuré' },
] as const

export default function MemberExportModal({
  members, branches, disciplines, onClose,
}: {
  members: MemberRow[]
  branches: Branch[]
  disciplines: Discipline[]
  onClose: () => void
}) {
  useScrollLock()
  const { dismiss, cardRef, overlayClass } = useModalMotion(onClose)

  const [sub, setSub] = useState<string>('all')
  const [ins, setIns] = useState<string>('all')
  const [branch, setBranch] = useState('all')
  const [discipline, setDiscipline] = useState('all')
  const [year, setYear] = useState('all')
  const [dormant, setDormant] = useState(false)
  const [noIdDoc, setNoIdDoc] = useState(false)

  const years = useMemo(() => {
    const set = new Set(members.map(m => m.join_date?.slice(0, 4)).filter(Boolean) as string[])
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [members])

  const selected = useMemo(() => members.filter(m => {
    if (sub !== 'all' && subStatus(m) !== sub) return false
    if (ins !== 'all' && insStatus(m) !== ins) return false
    if (branch !== 'all' && m.branch_id !== branch) return false
    if (discipline !== 'all' && m.discipline_id !== discipline) return false
    if (year !== 'all' && m.join_date?.slice(0, 4) !== year) return false
    if (dormant && !isDormant(m)) return false
    if (noIdDoc && m.id_doc_key) return false
    return true
  }), [members, sub, ins, branch, discipline, year, dormant, noIdDoc])

  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '')

  async function run() {
    const params = new URLSearchParams()
    if (sub !== 'all') params.set('sub', sub)
    if (ins !== 'all') params.set('ins', ins)
    if (branch !== 'all') params.set('branchId', branch)
    if (discipline !== 'all') params.set('disciplineId', discipline)
    if (year !== 'all') params.set('year', year)
    if (dormant) params.set('dormant', 'true')
    if (noIdDoc) params.set('noIdDoc', 'true')

    const tag = [sub !== 'all' && `abo-${sub}`, ins !== 'all' && `ass-${ins}`,
                 year !== 'all' && year, dormant && 'inactifs', noIdDoc && 'sans-piece-identite']
      .filter(Boolean).join('_') || 'tous'

    try {
      const res = await fetch(`/api/members/export?${params.toString()}`)
      if (!res.ok) throw new Error('Erreur export')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `membres-${tag}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      const rows: unknown[][] = [
        ['Nom', 'Téléphone', 'E-mail', 'Salle', 'Discipline', 'Grade',
         'Inscription', 'Abonnement', 'Fin abonnement', 'Assurance', 'Fin assurance',
         'Pièce d’identité', 'N° pièce'],
        ...selected.map(m => [
          m.name, m.phone, m.email ?? '', m.branch_name ?? '', m.discipline_name ?? '',
          m.grade_label ?? '', day(m.join_date),
          SUB_LABEL[subStatus(m)], day(m.sub_expiry),
          INS_LABEL[insStatus(m)], m.is_insured ? day(m.ins_expiry) : '',
          m.id_doc_type === 'cin' ? 'Carte nationale'
            : m.id_doc_type === 'passeport' ? 'Passeport' : '',
          m.id_doc_number ?? '',
        ]),
      ]
      download(toCsv(rows), `membres-${tag}-${new Date().toISOString().slice(0, 10)}.csv`)
    }
    dismiss()
  }

  return (
    <div className={`compta-modal-overlay${overlayClass}`} onClick={dismiss} role="dialog" aria-modal="true"
         aria-label="Export filtré des membres">
      <div ref={cardRef} className="compta-modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 6 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Export filtré
          </h2>
          <button className="gf-hide" onClick={dismiss} aria-label="Fermer"><X size={15} /></button>
        </div>
        <p className="dz-card-note" style={{ marginBottom: 18 }}>
          Les critères se cumulent. Laissez sur « Tous » ce qui ne vous intéresse pas.
        </p>

        <Group label="Abonnement">
          {SUB_CHOICES.map(c => (
            <Pill key={c.key} on={sub === c.key} onClick={() => setSub(c.key)}>{c.label}</Pill>
          ))}
        </Group>

        <Group label="Assurance">
          {INS_CHOICES.map(c => (
            <Pill key={c.key} on={ins === c.key} onClick={() => setIns(c.key)}>{c.label}</Pill>
          ))}
        </Group>

        {branches.length > 1 && (
          <Group label="Salle">
            <Pill on={branch === 'all'} onClick={() => setBranch('all')}>Toutes</Pill>
            {branches.map(b => (
              <Pill key={b.id} on={branch === b.id} onClick={() => setBranch(b.id)}>{b.name}</Pill>
            ))}
          </Group>
        )}

        {disciplines.length > 1 && (
          <Group label="Discipline">
            <Pill on={discipline === 'all'} onClick={() => setDiscipline('all')}>Toutes</Pill>
            {disciplines.map(d => (
              <Pill key={d.id} on={discipline === d.id} onClick={() => setDiscipline(d.id)}>{d.name}</Pill>
            ))}
          </Group>
        )}

        {years.length > 1 && (
          <Group label="Année d’inscription">
            <Pill on={year === 'all'} onClick={() => setYear('all')}>Toutes</Pill>
            {years.map(y => (
              <Pill key={y} on={year === y} onClick={() => setYear(y)}>{y}</Pill>
            ))}
          </Group>
        )}

        <Group label="Et aussi">
          <Pill on={dormant} onClick={() => setDormant(v => !v)}>Inactifs +3 mois</Pill>
          <Pill on={noIdDoc} onClick={() => setNoIdDoc(v => !v)}>Sans pièce d’identité</Pill>
        </Group>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--hairline)',
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700,
                         color: selected.length === 0 ? '#f59e0b' : 'var(--text)' }}>
            {selected.length === 0
              ? 'Aucun membre ne correspond'
              : `${selected.length} membre${selected.length > 1 ? 's' : ''} sur ${members.length}`}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="compta-modal-cancel" onClick={dismiss}>Annuler</button>
            <button className="compta-modal-save" onClick={run} disabled={selected.length === 0}>
              <Download size={14} strokeWidth={2.3} style={{ verticalAlign: '-2px', marginInlineEnd: 5 }} />
              Exporter
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: 0, margin: '0 0 14px', padding: 0 }}>
      <legend style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--muted)',
                       marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </legend>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </fieldset>
  )
}

function Pill({ on, onClick, children }: {
  on: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
            style={{
              padding: '0.35rem 0.8rem', borderRadius: 999, cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600,
              background: on ? 'var(--gold)' : 'var(--overlay-soft)',
              color: on ? '#fff' : 'var(--muted)',
              border: `1px solid ${on ? 'transparent' : 'var(--hairline)'}`,
              transition: 'background var(--transition-fast), color var(--transition-fast)',
            }}>
      {children}
    </button>
  )
}
