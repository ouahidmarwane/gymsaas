'use client'
// app/(protected)/members/page.tsx
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { enrichMember, STATUS_CONFIG } from '@/lib/gym'
import { addMember, getMembers, updateMember, deleteMember, renewSubscription, renewInsurance, addPayment } from '@/lib/actions'
import { useBranch } from '@/lib/branch-context'
import { useDiscipline } from '@/lib/discipline-context'
import { useT } from '@/lib/i18n'
import GradeBadge from '@/components/GradeBadge'
import DatePicker from '@/components/DatePicker'
import CsvImportModal from '@/components/CsvImportModal'
import MemberCardModal from '@/components/MemberCardModal'
import DocExpiryPanel from '@/components/DocExpiryPanel'
import ToastRise from '@/components/ToastRise'
import { GRADE_LABELS, DISCIPLINE_LABELS, DISCIPLINES } from '@/types'
import { mediaUrl } from '@/lib/media'
import { generateWhatsAppLink, whatsappForMember } from '@/lib/whatsapp'
import type { MemberEnriched } from '@/types'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, HandCoins, MessageCircle, MoreHorizontal, Pencil, Phone, Printer, Trash2 } from 'lucide-react'
import SlidingTabs from '@/components/SlidingTabs'
import BranchTabs from '@/components/BranchTabs'

// « Inactif depuis +3 mois » : abonnement expiré il y a plus de 3 mois.
function isInactiveOver3Months(m: { sub_expiry?: string | null }): boolean {
  if (!m.sub_expiry) return false
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 3)
  return new Date(m.sub_expiry) < cutoff
}

const escapeCsvCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`

// ─── Badge ────────────────────────────────────────────────────
function Badge({ status, type }: { status: string; type: 'sub' | 'ins' }) {
  const cfg = (STATUS_CONFIG[type] as any)[status]
  if (!cfg) return null
  return <span className={clsx('badge', cfg.color)}>{cfg.label}</span>
}

// ─── Toast ───────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return <ToastRise className="members-toast">{msg}</ToastRise>
}

function Avatar({ name, photoUrl, size = 'sm' }: { name: string; photoUrl?: string | null; size?: 'sm' | 'lg' }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const palette = ['bg-indigo-400','bg-sky-400','bg-emerald-400','bg-amber-400','bg-pink-400','bg-violet-400']
  const color = palette[name.charCodeAt(0) % palette.length]
  const dim = size === 'lg' ? 'w-20 h-20 text-2xl' : 'w-9 h-9 text-sm'
  if (photoUrl) {
    return <img src={mediaUrl(photoUrl) ?? photoUrl} alt={name} className={clsx(dim, 'rounded-full object-cover flex-shrink-0')} />
  }
  return (
    <div className={clsx(dim, 'rounded-full flex items-center justify-center text-white font-bold flex-shrink-0', color)}>
      {initials}
    </div>
  )
}

// ─── File Upload Input ────────────────────────────────────────
function FileUploadField({
  label,
  accept,
  currentUrl,
  onChange,
}: {
  label: string
  accept: string
  currentUrl?: string | null
  onChange: (file: File | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    onChange(file)
    if (file) {
      const reader = new FileReader()
      reader.onload = ev => setPreview(ev.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setPreview(currentUrl ?? null)
    }
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</label>
      <div
        className="flex items-center gap-3 border border-dashed border-white/15 rounded-2xl px-4 py-3 cursor-pointer hover:border-white/30 transition-colors"
        onClick={() => ref.current?.click()}
      >
        {preview && accept.includes('image') ? (
          <img src={preview} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
        ) : preview ? (
          <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 text-lg">📄</div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-lg">
            {accept.includes('image') ? '📷' : '📎'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-200 truncate">
            {preview ? (accept.includes('image') ? 'Photo sélectionnée' : 'Fichier sélectionné') : 'Cliquer pour choisir'}
          </div>
          <div className="text-xs text-gray-400">{accept.includes('image') ? 'JPG, PNG, WEBP' : 'PDF, JPG, PNG'}</div>
        </div>
        {preview && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onChange(null); setPreview(null); if (ref.current) ref.current.value = '' }}
            className="text-gray-400 hover:text-red-500 text-lg leading-none"
          >×</button>
        )}
      </div>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={handleChange} />
    </div>
  )
}

// ─── Member Detail Drawer ─────────────────────────────────────
function MemberDrawer({ member, onClose, onEdit }: {
  member: MemberEnriched
  onClose: () => void
  onEdit: () => void
}) {
  const [photoPreview, setPhotoPreview] = useState(false)
  const { t } = useT()

  return (
    <div className="member-drawer-overlay" onClick={onClose}>
      <aside className="member-drawer" onClick={e => e.stopPropagation()}>
        <div className="member-drawer-header">
          <button className="drawer-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Profile section */}
        <div className="drawer-profile">
          {member.photo_url ? (
            <button onClick={() => setPhotoPreview(true)} className="drawer-photo-btn">
              <Avatar name={member.name} photoUrl={member.photo_url} size="lg" />
              <span className="drawer-photo-hint">🔍</span>
            </button>
          ) : (
            <Avatar name={member.name} photoUrl={null} size="lg" />
          )}
          <div>
            <h2 className="drawer-name">{member.name}</h2>
            <p className="drawer-branch">{member.branch === 'rachad' ? t('branch_rachad') : t('branch_sbata')}</p>
          </div>
        </div>
        {photoPreview && member.photo_url && (
          <DocPreviewModal label={t('field_photo')} url={mediaUrl(member.photo_url)!} onClose={() => setPhotoPreview(false)} />
        )}

        {/* Status badges */}
        <div className="drawer-badges">
          <Badge status={member.sub_status} type="sub" />
          <Badge status={member.ins_status} type="ins" />
        </div>

        {/* Info grid */}
        <div className="drawer-section">
          <div className="drawer-section-title">{t('drawer_info')}</div>
          <div className="drawer-info-grid">
            {member.discipline === 'karate' && (
              <div className="drawer-row">
                <span className="drawer-row-label">{t('drawer_belt')}</span>
                <GradeBadge grade={member.grade ?? 0} size="sm" />
              </div>
            )}
            <DrawerRow label={t('drawer_phone')} value={member.phone} />
            <DrawerRow label={t('drawer_email')} value={member.email ?? '—'} />
            <DrawerRow label={t('drawer_join')} value={member.join_date ? new Date(member.join_date).toLocaleDateString('fr-FR') : '—'} />
            <DrawerRow label={t('drawer_sub_end')} value={member.sub_expiry ? new Date(member.sub_expiry).toLocaleDateString('fr-FR') : '—'} />
            {member.sub_days_left !== null && member.sub_days_left >= 0 && (
              <DrawerRow label={t('drawer_days_left')} value={`${member.sub_days_left} ${t('drawer_days')}`} />
            )}
            <DrawerRow label={t('drawer_insured')} value={member.is_insured ? t('drawer_yes') : t('drawer_no')} />
            {member.is_insured && member.ins_expiry && (
              <DrawerRow label={t('drawer_ins_end')} value={new Date(member.ins_expiry).toLocaleDateString('fr-FR')} />
            )}
            {member.notes && <DrawerRow label={t('drawer_notes')} value={member.notes} />}
          </div>
        </div>

        {/* Documents section */}
        <div className="drawer-section">
          <div className="drawer-section-title">{t('drawer_docs')}</div>
          <div className="drawer-docs-grid">
            <DrawerDoc label={t('drawer_passport')} url={mediaUrl(member.sport_passport_url)} icon="🏅" />
            <DrawerDoc label={t('drawer_doc_extra')} url={mediaUrl(member.document_url)} icon="📄" />
          </div>
        </div>

        <button onClick={onEdit} className="btn-dark w-full mt-6">{t('drawer_edit_btn')}</button>
      </aside>
    </div>
  )
}

function DrawerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawer-row">
      <span className="drawer-row-label">{label}</span>
      <span className="drawer-row-value">{value}</span>
    </div>
  )
}

function DocPreviewModal({ label, url, onClose }: { label: string; url: string; onClose: () => void }) {
  const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)
  const { t } = useT()
  return (
    <div className="doc-preview-overlay" onClick={onClose}>
      <div className="doc-preview-box" onClick={e => e.stopPropagation()}>
        <div className="doc-preview-header">
          <span className="doc-preview-title">{label}</span>
          <div className="flex items-center gap-2">
            <a href={url} download target="_blank" rel="noopener noreferrer" className="doc-preview-download">
              {t('doc_download')}
            </a>
            <button className="drawer-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="doc-preview-body">
          {isImage
            ? <img src={url} alt={label} className="doc-preview-img" />
            : <iframe src={url} className="doc-preview-pdf" title={label} />
          }
        </div>
      </div>
    </div>
  )
}

function DrawerDoc({ label, url, icon }: { label: string; url: string | null | undefined; icon: string }) {
  const [preview, setPreview] = useState(false)
  const { t } = useT()
  if (!url) {
    return (
      <div className="drawer-doc drawer-doc-empty">
        <span className="drawer-doc-icon">{icon}</span>
        <span className="drawer-doc-label">{label}</span>
        <span className="drawer-doc-missing">{t('drawer_not_found')}</span>
      </div>
    )
  }
  const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)
  return (
    <>
      <button onClick={() => setPreview(true)} className="drawer-doc drawer-doc-available w-full text-left">
        {isImage
          ? <img src={url} alt={label} className="drawer-doc-thumb" />
          : <span className="drawer-doc-icon">{icon}</span>
        }
        <span className="drawer-doc-label">{label}</span>
        <span className="drawer-doc-action">{t('drawer_view')}</span>
      </button>
      {preview && <DocPreviewModal label={label} url={url} onClose={() => setPreview(false)} />}
    </>
  )
}

// ─── Member Modal ─────────────────────────────────────────────
function MemberModal({ member, onClose, onSaved }: {
  member?: MemberEnriched | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!member
  const { activeBranch, profileBranch, canSwitchBranch } = useBranch()
  const { activeDiscipline, profileDiscipline, canSwitchDiscipline } = useDiscipline()
  const { t } = useT()
  const [form, setForm] = useState({
    name:       member?.name       ?? '',
    phone:      member?.phone      ?? '',
    email:      member?.email      ?? '',
    join_date:  member?.join_date  ?? new Date().toISOString().split('T')[0],
    branch:     member?.branch     ?? profileBranch ?? activeBranch,
    discipline: (member as any)?.discipline ?? profileDiscipline ?? (activeDiscipline === 'all' ? 'karate' : activeDiscipline),
    sub_expiry: member?.sub_expiry ?? '',
    is_insured: member?.is_insured ?? false,
    ins_expiry: member?.ins_expiry ?? '',
    notes:      member?.notes      ?? '',
    grade:      member?.grade      ?? 0,
  })
  const [anim, setAnim] = useState<'pre' | 'open' | 'closing'>('pre')
  const [toggleTouched, setToggleTouched] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])
  const handleClose = () => { setAnim('closing'); setTimeout(onClose, 160) }

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [passportFile, setPassportFile] = useState<File | null>(null)
  const [documentFile, setDocumentFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }))

  // Upload en deux temps vers Cloudflare R2 : le serveur signe une URL
  // d'écriture à usage unique, puis le navigateur envoie le fichier
  // directement à R2. Rien ne transite par Next (plafond de 4,5 Mo sur
  // Vercel) et les clés R2 restent côté serveur.
  // La valeur retournée (« r2://bucket/chemin ») est ce qui part en base.
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

  const uploadFile = async (
    memberId: string,
    file: File,
    bucket: 'member-photos' | 'member-passports' | 'member-documents',
  ): Promise<string | null> => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Fichier trop volumineux (${bucket}) : 10 Mo maximum`)
      return null
    }

    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase()
    const contentType = file.type || 'application/octet-stream'

    try {
      const res = await fetch('/api/media/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, memberId, ext, contentType }),
      })
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: res.statusText }))
        setError(`Erreur upload (${bucket}) : ${msg}`)
        return null
      }
      const { uploadUrl, ref } = await res.json()

      // Content-Type doit correspondre exactement à celui signé, sinon R2
      // rejette la requête avec une erreur de signature.
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      })
      if (!put.ok) {
        console.error(`Upload R2 error (${bucket}):`, put.status, await put.text().catch(() => ''))
        setError(`Erreur upload (${bucket}) : transfert échoué (${put.status})`)
        return null
      }

      return ref as string
    } catch (e) {
      console.error(`Upload error (${bucket}):`, e)
      setError(`Erreur upload (${bucket}) : réseau indisponible`)
      return null
    }
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setError(t('error_required'))
      return
    }
    setError('')
    startTransition(async () => {
      const payload = {
        ...form,
        branch: form.branch || activeBranch,
        discipline: (form as any).discipline || (activeDiscipline === 'all' ? 'karate' : activeDiscipline),
        sub_expiry: form.sub_expiry || undefined,
        ins_expiry: form.ins_expiry || undefined,
      }

      // Add or update basic member first (we need the ID for file uploads)
      const res = isEdit
        ? await updateMember(member!.id, payload)
        : await addMember(payload)

      if (res?.error) {
        setError(res.error)
        return
      }

      // Upload files using the member id (either existing or newly created)
      const memberId: string | null = isEdit
        ? member!.id
        : ('id' in res && typeof res.id === 'string' ? res.id : null)
      if (memberId) {
        const urls: Partial<{ photo_url: string; sport_passport_url: string; document_url: string }> = {}
        const uploadErrors: string[] = []
        if (photoFile) {
          const url = await uploadFile(memberId, photoFile, 'member-photos')
          if (url) urls.photo_url = url
          else uploadErrors.push('photo')
        }
        if (passportFile) {
          const url = await uploadFile(memberId, passportFile, 'member-passports')
          if (url) urls.sport_passport_url = url
          else uploadErrors.push('passeport sportif')
        }
        if (documentFile) {
          const url = await uploadFile(memberId, documentFile, 'member-documents')
          if (url) urls.document_url = url
          else uploadErrors.push('document additionnel')
        }
        if (Object.keys(urls).length > 0) {
          await updateMember(memberId, urls)
        }
        if (uploadErrors.length > 0) {
          return
        }
      }

      onSaved()
      handleClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div className={`t-modal ${anim === 'open' ? 'is-open' : anim === 'closing' ? 'is-closing' : ''} rounded-3xl w-full max-w-lg p-8 shadow-2xl max-h-[90vh] overflow-y-auto border border-white/10`} style={{ background: '#101320' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-black text-white mb-6">{isEdit ? t('modal_edit_title') : t('modal_add_title')}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_name')}</label>
            <input className="input-dark" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Youssef Bennani" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_phone')}</label>
            <input className="input-dark" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0661234567" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_email')}</label>
            <input className="input-dark" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="youssef@email.com" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_join_date')}</label>
            <DatePicker value={form.join_date} onChange={v => set('join_date', v)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_branch')}</label>
            <select className="input-dark" value={form.branch} onChange={e => set('branch', e.target.value)} disabled={!canSwitchBranch}>
              <option value="sbata">{t('branch_sbata')}</option>
              <option value="rachad">{t('branch_rachad')}</option>
            </select>
            {!canSwitchBranch && <p className="text-xs text-gray-400 mt-1">{t('branch_locked')}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Discipline</label>
            <select className="input-dark" value={form.discipline} onChange={e => set('discipline', e.target.value)} disabled={!canSwitchDiscipline}>
              {DISCIPLINES.map(d => (
                <option key={d} value={d}>{DISCIPLINE_LABELS[d]}</option>
              ))}
            </select>
            {!canSwitchDiscipline && <p className="text-xs text-gray-400 mt-1">Verrouillé sur votre discipline</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_sub_expiry')}</label>
            <DatePicker value={form.sub_expiry} onChange={v => set('sub_expiry', v)} />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className={clsx('t-toggle w-10 h-6 rounded-full relative cursor-pointer', toggleTouched && 'is-init', form.is_insured ? 'bg-blue-600' : 'bg-white/15')}
                data-on={form.is_insured ? 'true' : 'false'}
                style={{ ['--toggle-travel' as any]: '16px' }}
                onClick={() => { setToggleTouched(true); set('is_insured', !form.is_insured) }}>
                <div className="t-toggle-thumb absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow" />
              </div>
              <span className="text-sm font-semibold text-slate-200">{t('field_insured')}</span>
            </label>
          </div>
          {form.is_insured && (
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_ins_expiry')}</label>
              <DatePicker value={form.ins_expiry} onChange={v => set('ins_expiry', v)} />
            </div>
          )}
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_notes')}</label>
            <textarea className="input-dark resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Remarques…" />
          </div>
          {/* Grade (ceinture) : karaté uniquement — pas de grade en full contact / aérobic */}
          {form.discipline === 'karate' && (
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_grade')}</label>
              <select className="input-dark" value={form.grade} onChange={e => set('grade', Number(e.target.value))}>
                {Object.entries(GRADE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          )}

          {/* File uploads */}
          <div className="col-span-2 border-t border-white/10 pt-4 mt-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{t('field_documents')}</p>
            <div className="grid gap-3">
              <FileUploadField
                label={t('field_photo')}
                accept="image/*"
                currentUrl={mediaUrl(member?.photo_url)}
                onChange={setPhotoFile}
              />
              <FileUploadField
                label={t('field_passport')}
                accept="image/*,application/pdf"
                currentUrl={mediaUrl(member?.sport_passport_url)}
                onChange={setPassportFile}
              />
              <FileUploadField
                label={t('field_document')}
                accept="image/*,application/pdf"
                currentUrl={mediaUrl(member?.document_url)}
                onChange={setDocumentFile}
              />
            </div>
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="flex gap-3 mt-6">
          <button onClick={handleSave} disabled={isPending} className="btn-dark flex-1 justify-center disabled:opacity-50">
            {isPending ? t('btn_saving') : isEdit ? t('btn_save') : t('btn_add_confirm')}
          </button>
          <button onClick={handleClose} className="btn-ghost flex-1 justify-center">{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modale d'encaissement ────────────────────────────────────
function PaymentModal({ member, onClose, onSaved }: {
  member: MemberEnriched
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const { t } = useT()
  const [anim, setAnim] = useState<'pre' | 'open' | 'closing'>('pre')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<'monthly' | 'insurance' | 'registration' | 'other'>('monthly')
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])
  const handleClose = () => { setAnim('closing'); setTimeout(onClose, 160) }

  const TYPES = [
    { key: 'monthly' as const,      label: t('price_monthly') },
    { key: 'insurance' as const,    label: t('price_insurance') },
    { key: 'registration' as const, label: t('price_registration') },
    { key: 'other' as const,        label: '—' },
  ]

  const handleSave = () => {
    const value = parseFloat(amount)
    if (!value || value <= 0) { setError(t('error_required')); return }
    setError('')
    startTransition(async () => {
      const res = await addPayment({
        member_id: member.id,
        amount: value,
        type,
        paid_at: paidAt,
        notes: notes || undefined,
      })
      if (res?.error) { setError(res.error); return }
      onSaved(`✅ ${value.toLocaleString('fr-FR')} DH — ${member.name}`)
      handleClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div
        className={`t-modal ${anim === 'open' ? 'is-open' : anim === 'closing' ? 'is-closing' : ''} rounded-3xl w-full max-w-sm p-7 shadow-2xl border border-white/10`}
        style={{ background: '#101320' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-black text-white mb-1 flex items-center gap-2">
          <HandCoins size={20} className="text-blue-400" /> Paiement
        </h2>
        <p className="text-sm text-slate-400 mb-5">{member.name}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Montant (DH)</label>
            <input
              type="number" min="0" step="0.5" autoFocus
              className="input-dark"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="100"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map(tp => (
                <button
                  key={tp.key}
                  type="button"
                  onClick={() => setType(tp.key)}
                  className={clsx(
                    'px-3 py-2 rounded-xl text-xs font-semibold border transition-colors',
                    type === tp.key
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/25',
                  )}
                >
                  {tp.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Date</label>
            <DatePicker value={paidAt} onChange={setPaidAt} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_notes')}</label>
            <input className="input-dark" value={notes} onChange={e => setNotes(e.target.value)} placeholder="—" />
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">{error}</div>}

        <div className="flex gap-3 mt-6">
          <button onClick={handleSave} disabled={isPending} className="btn-dark flex-1 justify-center disabled:opacity-50" style={{ background: 'var(--gold)' }}>
            {isPending ? t('btn_saving') : 'Enregistrer'}
          </button>
          <button onClick={handleClose} className="btn-ghost flex-1 justify-center">{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Export filtré (discipline / abonnement / assurance / année) ──
function ExportMembersModal({ onClose }: { onClose: () => void }) {
  const { activeBranch } = useBranch()
  const { activeDiscipline, profileDiscipline, canSwitchDiscipline } = useDiscipline()
  const { t } = useT()

  type Disc = 'all' | 'karate' | 'full_contact' | 'aerobic'
  const initialDisc: Disc = canSwitchDiscipline
    ? (activeDiscipline === 'all' ? 'all' : activeDiscipline)
    : ((profileDiscipline as Disc) ?? 'karate')

  const [disc, setDisc] = useState<Disc>(initialDisc)
  const [branch, setBranch] = useState<'all' | 'sbata' | 'rachad'>('all')
  const [sub, setSub]   = useState<'all' | 'active' | 'inactive'>('all')
  const [ins, setIns]   = useState<'all' | 'insured' | 'uninsured'>('all')
  const [year, setYear] = useState<'all' | number>('all')
  const [rows, setRows] = useState<MemberEnriched[]>([])
  const [loading, setLoading] = useState(true)

  // Recharge les membres selon la discipline choisie (RLS applique le cloisonnement)
  useEffect(() => {
    setLoading(true)
    getMembers(undefined, disc === 'all' ? undefined : disc)
      .then(d => setRows((d ?? []).map(enrichMember)))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [disc])

  const years = useMemo(() => {
    const ys = new Set<number>()
    rows.forEach(m => { if (m.ins_expiry) ys.add(new Date(m.ins_expiry).getFullYear()) })
    return Array.from(ys).sort((a, b) => b - a)
  }, [rows])

  const subset = useMemo(() => rows.filter(m => {
    if (branch !== 'all' && (m.branch ?? 'sbata') !== branch) return false
    if (sub === 'active'   && m.sub_status !== 'active') return false
    if (sub === 'inactive' && m.sub_status === 'active') return false
    if (ins === 'insured'   && !m.is_insured) return false
    if (ins === 'uninsured' &&  m.is_insured) return false
    if (ins === 'insured' && year !== 'all') {
      if (!m.ins_expiry || new Date(m.ins_expiry).getFullYear() !== year) return false
    }
    return true
  }), [rows, branch, sub, ins, year])

  const doExport = () => {
    const headers = ['Nom', 'Téléphone', 'Email', "Date d'inscription", 'Branche', 'Discipline',
      'Statut abonnement', 'Fin abonnement', 'Assuré', 'Fin assurance', 'Notes']
    const discLabel: Record<string, string> = { karate: 'Karaté', full_contact: 'Full contact', aerobic: 'Aérobic' }
    const body = subset.map(m => [
      escapeCsvCell(m.name), escapeCsvCell(m.phone), escapeCsvCell(m.email ?? ''),
      escapeCsvCell(m.join_date ? new Date(m.join_date).toLocaleDateString('fr-FR') : ''),
      escapeCsvCell(m.branch === 'rachad' ? 'Rachad' : 'Sbata'),
      escapeCsvCell(discLabel[(m as any).discipline ?? 'karate'] ?? (m as any).discipline ?? ''),
      escapeCsvCell(m.sub_status),
      escapeCsvCell(m.sub_expiry ? new Date(m.sub_expiry).toLocaleDateString('fr-FR') : ''),
      escapeCsvCell(m.is_insured ? 'Oui' : 'Non'),
      escapeCsvCell(m.ins_expiry ? new Date(m.ins_expiry).toLocaleDateString('fr-FR') : ''),
      escapeCsvCell(m.notes ?? ''),
    ])
    const csv = [headers.map(escapeCsvCell).join(','), ...body.map(r => r.join(','))].join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const parts = [disc === 'all' ? 'toutes' : disc]
    if (branch !== 'all') parts.push(branch)
    if (sub !== 'all') parts.push(sub === 'active' ? 'actifs' : 'inactifs')
    if (ins !== 'all') parts.push(ins === 'insured' ? 'assures' : 'non-assures')
    if (ins === 'insured' && year !== 'all') parts.push(String(year))
    link.href = url
    link.download = `membres-${parts.join('-')}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link); link.click(); document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const sel = 'input-dark'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10" style={{ background: '#101320' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-black text-white mb-1">Export filtré des membres</h2>
        <p className="text-xs text-slate-400 mb-5">Choisis les critères — chaque discipline / statut peut être exporté isolément.</p>

        <div className="grid grid-cols-2 gap-4">
          {canSwitchDiscipline && (
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Discipline</label>
              <select className={sel} value={disc} onChange={e => setDisc(e.target.value as Disc)}>
                <option value="all">Toutes</option>
                {DISCIPLINES.map(d => <option key={d} value={d}>{DISCIPLINE_LABELS[d]}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Succursale</label>
            <select className={sel} value={branch} onChange={e => setBranch(e.target.value as any)}>
              <option value="all">Toutes</option>
              <option value="sbata">Sbata</option>
              <option value="rachad">Rachad</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Abonnement</label>
            <select className={sel} value={sub} onChange={e => setSub(e.target.value as any)}>
              <option value="all">Tous</option>
              <option value="active">Actif</option>
              <option value="inactive">Non actif</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Assurance</label>
            <select className={sel} value={ins} onChange={e => setIns(e.target.value as any)}>
              <option value="all">Tous</option>
              <option value="insured">Assurés</option>
              <option value="uninsured">Non assurés</option>
            </select>
          </div>
          {ins === 'insured' && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Année d'assurance</label>
              <select className={sel} value={year} onChange={e => setYear(e.target.value === 'all' ? 'all' : +e.target.value)}>
                <option value="all">Toutes</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <span className="text-sm text-slate-300">
            {loading ? 'Chargement…' : <><b className="text-white">{subset.length}</b> membre(s)</>}
          </span>
          <div className="flex gap-3">
            <button className="btn-ghost" onClick={onClose}>Annuler</button>
            <button className="btn-dark" onClick={doExport} disabled={loading || subset.length === 0}
              style={{ background: 'var(--gold)' }}>
              Exporter CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function MembersPage() {
  const [members, setMembers] = useState<MemberEnriched[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'name' | 'sub_expiry' | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [csvOpen, setCsvOpen]       = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [cardMember, setCardMember] = useState<MemberEnriched | null>(null)
  const [payMember, setPayMember]   = useState<MemberEnriched | null>(null)
  const [editMember, setEditMember] = useState<MemberEnriched | null>(null)
  const [drawerMember, setDrawerMember] = useState<MemberEnriched | null>(null)
  // Téléphone : on affiche des cartes au lieu du tableau. Le rendu est
  // conditionnel (et non simplement masqué en CSS) pour ne pas doubler le
  // DOM sur PC, où la liste peut compter plusieurs centaines de membres.
  const [isPhone, setIsPhone] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const apply = () => setIsPhone(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  const [deleting, startDelete] = useTransition()
  const [renewingSub, startRenewSub] = useTransition()
  const [renewingIns, startRenewIns] = useTransition()
  const [toast, setToast] = useState('')
  const { activeBranch, profileRole } = useBranch()
  const { activeDiscipline } = useDiscipline()
  const { t } = useT()

  // Ceinture = concept karaté : colonne masquée en full contact / aérobic.
  const showBelt = activeDiscipline !== 'full_contact' && activeDiscipline !== 'aerobic'

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  const fetchMembers = async () => {
    const data = await getMembers(activeBranch, activeDiscipline === 'all' ? undefined : activeDiscipline)
    const enriched = (data ?? []).map(enrichMember)
    setMembers(enriched)
    setLoading(false)
    // Keep drawer in sync if it's open
    setDrawerMember(prev => prev ? (enriched.find(m => m.id === prev.id) ?? null) : null)
  }

  useEffect(() => {
    fetchMembers()
  }, [activeBranch, activeDiscipline])

  // Pré-remplit la recherche depuis l'URL (?search=…)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('search')
    if (q) setSearch(q)
  }, [])

  // Ferme le menu ⋯ au clic en dehors
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('[data-rowmenu]')) setMenuFor(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const counts = useMemo(() => ({
    all: members.length,
    active: members.filter(m => m.sub_status === 'active').length,
    expiring: members.filter(m => m.sub_status === 'expiring').length,
    expired: members.filter(m => m.sub_status === 'expired').length,
    uninsured: members.filter(m => m.ins_status === 'uninsured').length,
    ins_expiring: members.filter(m => m.ins_status === 'expiring').length,
    inactive3m: members.filter(isInactiveOver3Months).length,
  }), [members])

  const filterItems = useMemo(() => [
    { key: 'all',       label: <>{t('grades_filter_all')} <b>{counts.all}</b></> },
    { key: 'active',    label: <>{t('members_filter_sub_active')} <b>{counts.active}</b></> },
    { key: 'expiring',  label: <>{t('members_filter_sub_expiring')} <b>{counts.expiring}</b></> },
    { key: 'expired',   label: <>{t('members_filter_sub_expired')} <b>{counts.expired}</b></> },
    { key: 'uninsured', label: <>{t('members_filter_ins_uninsured')} <b>{counts.uninsured}</b></> },
    { key: 'ins_expiring', label: <>{t('members_filter_ins_expiring')} <b>{counts.ins_expiring}</b></> },
    { key: 'inactive3m', label: <>Inactifs +3&nbsp;mois <b>{counts.inactive3m}</b></> },
  ], [counts, t])

  const filtered = useMemo(() => {
    const list = members.filter(m => {
      const q = search.toLowerCase()
      const matchQ = !q || m.name.toLowerCase().includes(q) || m.phone.includes(q) || (m.email ?? '').toLowerCase().includes(q)
      const matchFilter =
        quickFilter === 'all' ? true :
        quickFilter === 'uninsured' ? m.ins_status === 'uninsured' :
        quickFilter === 'ins_expiring' ? m.ins_status === 'expiring' :
        quickFilter === 'inactive3m' ? isInactiveOver3Months(m) :
        m.sub_status === quickFilter
      return matchQ && matchFilter
    })
    if (sortBy) {
      list.sort((a, b) => {
        const va = (sortBy === 'name' ? a.name : a.sub_expiry ?? '') || ''
        const vb = (sortBy === 'name' ? b.name : b.sub_expiry ?? '') || ''
        return va.localeCompare(vb, 'fr') * sortDir
      })
    }
    return list
  }, [members, search, quickFilter, sortBy, sortDir])

  const toggleSort = (key: 'name' | 'sub_expiry') => {
    if (sortBy === key) {
      if (sortDir === 1) setSortDir(-1)
      else { setSortBy(null); setSortDir(1) }
    } else {
      setSortBy(key)
      setSortDir(1)
    }
  }

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Supprimer ${name} ?`)) return
    startDelete(async () => {
      await deleteMember(id)
      await fetchMembers()
    })
  }

  const handleRenewSubscription = (memberId: string, memberName: string) => {
    startRenewSub(async () => {
      const res = await renewSubscription(memberId)
      if (res?.error) {
        showToast(`❌ ${t('toast_error')} ${res.error}`)
      } else {
        showToast(`✅ ${t('toast_sub_ok')} ${res.newExpiry}`)
        await fetchMembers()
      }
    })
  }

  const handleRenewInsurance = (memberId: string, memberName: string) => {
    startRenewIns(async () => {
      const res = await renewInsurance(memberId)
      if (res?.error) {
        showToast(`❌ ${t('toast_error')} ${res.error}`)
      } else {
        showToast(`✅ ${t('toast_ins_ok')} ${res.newExpiry}`)
        await fetchMembers()
      }
    })
  }

  const escapeCsv = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined) return ''
    const text = String(value).replace(/"/g, '""')
    return `"${text}"`
  }

  const handleExportCsv = () => {
    const headers = ['Nom','Téléphone','Email',"Date d'inscription",'Branche','Statut abonnement','Fin abonnement','Statut assurance','Fin assurance','Notes']
    const rows = filtered.map(m => [
      escapeCsv(m.name), escapeCsv(m.phone), escapeCsv(m.email ?? ''),
      escapeCsv(m.join_date ? new Date(m.join_date).toLocaleDateString('fr-FR') : ''),
      escapeCsv(m.branch), escapeCsv(m.sub_status),
      escapeCsv(m.sub_expiry ? new Date(m.sub_expiry).toLocaleDateString('fr-FR') : ''),
      escapeCsv(m.ins_status),
      escapeCsv(m.ins_expiry ? new Date(m.ins_expiry).toLocaleDateString('fr-FR') : ''),
      escapeCsv(m.notes ?? ''),
    ])
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `membres-${activeBranch}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const openEdit = (m: MemberEnriched) => {
    setDrawerMember(null)
    setEditMember(m)
    setModalOpen(true)
  }

  const canEdit = ['admin', 'receptionist'].includes(profileRole)
  const isAdmin = profileRole === 'admin'

  if (loading) return (
    <div className="max-w-6xl mx-auto">
      <div className="members-skeleton-header" />
      <div className="members-skeleton-filters" />
      <div className="card overflow-hidden" style={{ borderRadius: 22 }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="members-skeleton-row" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div
        className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6"
        style={{ animation: 'fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) forwards' }}
      >
        <div>
          <h1 className="text-3xl font-black text-white" style={{ letterSpacing: '-0.03em' }}>{t('members_title')}</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{members.length} {t('members_count')}</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <button className="btn-ghost" onClick={handleExportCsv} disabled={filtered.length === 0} title="Exporter la vue affichée">
            {t('members_export')}
          </button>
          <button className="btn-ghost" onClick={() => setExportOpen(true)} title="Export filtré (discipline, abonnement, assurance, année)">
            🎯 Export filtré
          </button>
          {canEdit && (
            <button className="btn-ghost" onClick={() => setCsvOpen(true)}>
              📥 {t('csv_btn_open')}
            </button>
          )}
          {canEdit && (
            <button className="btn-dark" onClick={() => { setEditMember(null); setModalOpen(true) }}>
              <span className="text-xl leading-none">+</span> {t('members_add')}
            </button>
          )}
        </div>
      </div>

      {/* Document expiry alerts panel */}
      <DocExpiryPanel members={members} />

      {/* Filters */}
      <div
        className="flex gap-3 mb-5 flex-wrap"
        style={{ animation: 'fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: '60ms', opacity: 0 }}
      >
        <BranchTabs />
        <input className="members-search-input" placeholder={t('members_search')}
          value={search} onChange={e => setSearch(e.target.value)} />
        <SlidingTabs items={filterItems} value={quickFilter} onChange={setQuickFilter} />
      </div>

      {/* Table */}
      {/* ── Vue téléphone : liste de cartes ───────────────────────────
          Le tableau à 6 colonnes est illisible sur un écran de 6 pouces.
          Cette liste répond à l'usage réel dans la salle : retrouver
          quelqu'un, voir d'un coup d'œil si son abonnement est actif, et
          le relancer immédiatement (appel ou WhatsApp).
          Entièrement masquée sur PC — le tableau y reste la référence. */}
      <div className="members-cards">
        {isPhone && filtered.map(m => {
          const wa = whatsappForMember(m)
          const relancable = m.sub_status === 'expired' || m.sub_status === 'expiring'
          return (
            <div
              key={m.id}
              className={clsx('member-card', `is-${m.sub_status}`)}
              onClick={() => setDrawerMember(m)}
            >
              <div className="member-card-top">
                <Avatar name={m.name} photoUrl={m.photo_url} />
                <div className="member-card-id">
                  <div className="member-card-name">{m.name}</div>
                  <div className="member-card-meta">
                    {m.sub_expiry
                      ? `${t('exp_prefix')} ${new Date(m.sub_expiry).toLocaleDateString('fr-FR')}`
                      : '—'}
                  </div>
                </div>
                <Badge status={m.sub_status} type="sub" />
              </div>

              <div className="member-card-actions" onClick={e => e.stopPropagation()}>
                <a href={`tel:${m.phone}`} className="member-card-btn">
                  <Phone size={14} strokeWidth={2.2} /> {m.phone}
                </a>
                <a
                  href={generateWhatsAppLink(m.phone, wa.message)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={wa.label}
                  className="member-card-btn is-whatsapp"
                >
                  <MessageCircle size={14} strokeWidth={2.2} /> WhatsApp
                </a>
                {canEdit && relancable && (
                  <button
                    onClick={() => handleRenewSubscription(m.id, m.name)}
                    disabled={renewingSub}
                    className="member-card-btn is-renew"
                  >
                    {renewingSub ? t('btn_renewing') : t('btn_renew_sub')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {isPhone && filtered.length === 0 && (
          <div className="members-empty">
            <div className="members-empty-icon">👥</div>
            <div className="members-empty-text">{t('empty_members')}</div>
          </div>
        )}
      </div>

      <div
        className="card overflow-hidden members-page-table members-table-wrap"
        style={{ animation: 'fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: '120ms', opacity: 0, borderRadius: 22 }}
      >
        <table className="w-full">
          <thead className="members-page-table-head">
            <tr>
              {[
                { label: t('col_member'),  hide: false, sort: 'name' as const },
                { label: t('col_contact'), hide: true,  sort: null },
                ...(showBelt ? [{ label: t('col_belt'), hide: true, sort: null }] : []),
                { label: t('col_sub'),     hide: false, sort: 'sub_expiry' as const },
                { label: t('col_ins'),     hide: true,  sort: null },
                { label: t('col_actions'), hide: false, sort: null },
              ].map((h, i) => (
                <th key={i} className={`members-th px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wide${h.hide ? ' mobile-hide' : ''}`} style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>
                  {h.sort ? (
                    <button
                      className="inline-flex items-center gap-1 uppercase font-bold"
                      style={{ letterSpacing: '0.12em', color: sortBy === h.sort ? 'var(--gold)' : 'inherit' }}
                      onClick={() => toggleSort(h.sort!)}
                      title="Trier"
                    >
                      {h.label}
                      {sortBy === h.sort && (sortDir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  ) : h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody key={`${search}-${quickFilter}-${sortBy}-${sortDir}`}>
            {filtered.map((m, i) => (
              <tr
                key={m.id}
                className={clsx('members-row cursor-pointer', menuFor === m.id && 'row-menu-open')}
                style={{ animationDelay: `${i * 45}ms` }}
                onClick={() => setDrawerMember(m)}
              >
                <td className="px-4 py-3.5" style={{ overflow: 'hidden' }}>
                  <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                    <div className="members-avatar-wrap" style={{ flexShrink: 0 }}>
                      <Avatar name={m.name} photoUrl={m.photo_url} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <button
                        className="members-name-btn"
                        onClick={() => setDrawerMember(m)}
                        style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {m.name}
                      </button>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        {m.join_date ? new Date(m.join_date).toLocaleDateString('fr-FR') : '—'}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5" style={{ overflow: 'hidden' }}>
                  <div className="text-sm text-slate-200" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.phone}</div>
                  <div className="text-xs text-slate-400" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email ?? '—'}</div>
                </td>
                {showBelt && (
                  <td className="px-4 py-3.5">
                    {m.discipline === 'karate'
                      ? <GradeBadge grade={m.grade ?? 0} size="sm" />
                      : <span className="text-xs text-slate-500">—</span>}
                  </td>
                )}
                <td className="px-4 py-3.5">
                  <Badge status={m.sub_status} type="sub" />
                  <div className="text-xs text-slate-400 mt-1">
                    {m.sub_expiry ? `${t('exp_prefix')} ${new Date(m.sub_expiry).toLocaleDateString('fr-FR')}` : '—'}
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <Badge status={m.ins_status} type="ins" />
                  <div className="text-xs text-slate-400 mt-1">
                    {m.is_insured && m.ins_expiry ? `${t('exp_prefix')} ${new Date(m.ins_expiry).toLocaleDateString('fr-FR')}` : t('not_subscribed')}
                  </div>
                </td>
                <td className="px-4 py-3.5" style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {canEdit && (m.sub_status === 'expiring' || m.sub_status === 'expired') && (
                      <button onClick={() => handleRenewSubscription(m.id, m.name)} disabled={renewingSub}
                        className="text-xs bg-blue-600 hover:bg-blue-500 text-white py-1.5 px-3 rounded-full font-semibold transition-colors disabled:opacity-50">
                        {renewingSub ? t('btn_renewing') : t('btn_renew_sub')}
                      </button>
                    )}
                    {canEdit && (m.ins_status === 'expiring' || m.ins_status === 'expired' || m.ins_status === 'uninsured') && (
                      <button onClick={() => handleRenewInsurance(m.id, m.name)} disabled={renewingIns}
                        className="text-xs bg-white/10 hover:bg-white/20 text-white py-1.5 px-3 rounded-full font-semibold transition-colors disabled:opacity-50">
                        {renewingIns ? t('btn_renewing') : t('btn_renew_ins')}
                      </button>
                    )}
                    {(() => {
                      const wa = whatsappForMember(m)
                      return (
                        <a
                          href={generateWhatsAppLink(m.phone, wa.message)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={wa.label}
                          className="inline-flex items-center justify-center rounded-full text-white transition-colors hover:opacity-85"
                          style={{ backgroundColor: '#25D366', width: 30, height: 30, flexShrink: 0 }}
                        >
                          <MessageCircle size={15} strokeWidth={2.2} />
                        </a>
                      )
                    })()}
                    <div className="relative" data-rowmenu>
                      <button
                        onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                        title="Plus d'actions"
                        className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                      >
                        <MoreHorizontal size={15} strokeWidth={2.1} />
                      </button>
                      {menuFor === m.id && (
                        <div className="row-menu t-dropdown is-open" data-origin="top-right">
                          {canEdit && (
                            <button onClick={() => { setMenuFor(null); openEdit(m) }}>
                              <Pencil size={13} strokeWidth={2.1} /> {t('btn_edit')}
                            </button>
                          )}
                          {canEdit && (
                            <button onClick={() => { setMenuFor(null); setPayMember(m) }}>
                              <HandCoins size={13} strokeWidth={2.1} /> Paiement
                            </button>
                          )}
                          <button onClick={() => { setMenuFor(null); setCardMember(m) }}>
                            <Printer size={13} strokeWidth={2.1} /> {t('print_card_btn')}
                          </button>
                          {isAdmin && (
                            <button className="row-menu-danger" disabled={deleting}
                              onClick={() => { setMenuFor(null); handleDelete(m.id, m.name) }}>
                              <Trash2 size={13} strokeWidth={2.1} /> {t('btn_delete')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="members-empty">
            <div className="members-empty-icon">👥</div>
            <div className="members-empty-text">{t('empty_members')}</div>
          </div>
        )}
      </div>

      {/* Member detail drawer */}
      {drawerMember && (
        <MemberDrawer
          member={drawerMember}
          onClose={() => setDrawerMember(null)}
          onEdit={() => openEdit(drawerMember)}
        />
      )}

      {/* Modal */}
      {modalOpen && (
        <MemberModal
          member={editMember}
          onClose={() => setModalOpen(false)}
          onSaved={fetchMembers}
        />
      )}

      {/* CSV Import */}
      {csvOpen && (
        <CsvImportModal
          onClose={() => setCsvOpen(false)}
          onImported={() => { fetchMembers(); showToast(t('csv_success')) }}
        />
      )}

      {/* Export filtré */}
      {exportOpen && <ExportMembersModal onClose={() => setExportOpen(false)} />}

      {/* Paiement */}
      {payMember && (
        <PaymentModal
          member={payMember}
          onClose={() => setPayMember(null)}
          onSaved={msg => showToast(msg)}
        />
      )}

      {/* Print card */}
      {cardMember && (
        <MemberCardModal
          member={cardMember}
          onClose={() => setCardMember(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast} />}
    </div>
  )
}
