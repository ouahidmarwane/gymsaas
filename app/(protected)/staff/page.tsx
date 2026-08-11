'use client'
// app/(protected)/staff/page.tsx
import { useEffect, useState, useTransition } from 'react'
import { createStaffAccount, updateStaffAccess, deleteStaffAccount, getStaff, setSuperadmin } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'
import ToastRise from '@/components/ToastRise'
import { useT } from '@/lib/i18n'
import type { Profile, UserRole, Discipline } from '@/types'
import { DISCIPLINE_LABELS } from '@/types'
import clsx from 'clsx'

const ROLE_BADGE: Record<UserRole, string> = {
  admin:        'text-violet-300 bg-violet-500/10 ring-violet-500/30',
  receptionist: 'text-blue-300   bg-blue-500/10   ring-blue-500/30',
  viewer:       'text-slate-300  bg-white/5       ring-white/15',
}

const PERM_KEYS = [
  { key: 'perm_view_members',   admin: true,  recep: true,  viewer: true  },
  { key: 'perm_add_members',    admin: true,  recep: true,  viewer: false },
  { key: 'perm_del_member',     admin: true,  recep: false, viewer: false },
  { key: 'perm_send_reminders', admin: true,  recep: true,  viewer: false },
  { key: 'perm_view_alerts',    admin: true,  recep: true,  viewer: true  },
  { key: 'perm_manage_staff',   admin: true,  recep: false, viewer: false },
  { key: 'perm_edit_roles',     admin: true,  recep: false, viewer: false },
] as const

function AddStaffModal({ onClose, onSaved, canCreateAdmin }: { onClose: () => void; onSaved: () => void; canCreateAdmin: boolean }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'receptionist' as UserRole,
    branch: 'both' as 'both' | 'sbata' | 'rachad',
    discipline: 'karate' as 'all' | 'karate' | 'full_contact' | 'aerobic',
  })
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [anim, setAnim] = useState<'pre' | 'open' | 'closing'>('pre')
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])
  const handleClose = () => { setAnim('closing'); setTimeout(onClose, 160) }
  const { t } = useT()
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const ROLES_T = [
    { value: 'receptionist' as UserRole, labelKey: 'role_receptionist', descKey: 'role_desc_recep' },
    { value: 'viewer'       as UserRole, labelKey: 'role_viewer',       descKey: 'role_desc_viewer' },
  ] as const

  const handleSave = () => {
    if (!form.name || !form.email || !form.password) { setError(t('all_required')); return }
    if (form.password.length < 8) { setError(t('password_min')); return }
    startTransition(async () => {
      const res = await createStaffAccount(form)
      if (res?.error) setError(res.error)
      else { onSaved(); handleClose() }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div className={`t-modal ${anim === 'open' ? 'is-open' : anim === 'closing' ? 'is-closing' : ''} rounded-3xl w-full max-w-md p-8 shadow-2xl border border-white/10`} style={{ background: '#101320' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-black text-white mb-6">{t('modal_staff_title')}</h2>
        <div className="space-y-4">
          {([['field_fullname', 'name', 'text'], ['field_email_req', 'email', 'email'], ['field_password', 'password', 'password']] as const).map(([labelKey, key, type]) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t(labelKey)}</label>
              <input className="input-dark" type={type} value={(form as any)[key]} onChange={e => set(key, e.target.value)} />
            </div>
          ))}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_role')}</label>
            <div className="space-y-2">
              {/* Créer un compte admin est réservé au superadmin */}
              {ROLES_T.filter(r => r.value !== 'admin' || canCreateAdmin).map(r => (
                <label key={r.value} className={clsx('flex items-start gap-3 p-3 rounded-xl cursor-pointer border-2 transition-colors',
                  form.role === r.value ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 hover:border-white/25')}>
                  <input type="radio" name="role" value={r.value} checked={form.role === r.value}
                    onChange={() => set('role', r.value)} className="mt-0.5" />
                  <div>
                    <div className="text-sm font-bold text-white">{t(r.labelKey)}</div>
                    <div className="text-xs text-slate-400">{t(r.descKey)}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_branch_assign')}</label>
            <select className="input-dark" value={form.branch} onChange={e => set('branch', e.target.value)}>
              <option value="both">{t('staff_both')}</option>
              <option value="sbata">{t('branch_sbata')}</option>
              <option value="rachad">{t('branch_rachad')}</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">{t('branch_hint')}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Discipline</label>
            <select className="input-dark" value={form.discipline} onChange={e => set('discipline', e.target.value)}>
              <option value="all">Toutes les disciplines</option>
              <option value="karate">Karaté</option>
              <option value="full_contact">Full contact</option>
              <option value="aerobic">Aérobic</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Le personnel ne verra que les membres de cette discipline.</p>
          </div>
        </div>
        {error && <div className="mt-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="flex gap-3 mt-6">
          <button onClick={handleSave} disabled={isPending} className="btn-dark flex-1 justify-center disabled:opacity-50">
            {isPending ? t('creating') : t('create_account')}
          </button>
          <button onClick={handleClose} className="btn-ghost flex-1 justify-center">{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modification des accès d'un compte existant ─────────────────
// Permet d'ajouter une succursale / changer de discipline ou de rôle sans
// recréer de compte. Réservé à l'admin ; les comptes admin/superadmin ne
// sont modifiables que par un superadmin (garde-fou aussi côté serveur).
function EditAccessModal({ target, canManageAdmin, isSelf, onClose, onSaved }: {
  target: Profile
  canManageAdmin: boolean
  isSelf: boolean
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const { t } = useT()
  const [form, setForm] = useState({
    name: target.name,
    email: target.email,
    role: target.role,
    branch: (target.branch ?? 'both') as 'both' | 'sbata' | 'rachad',
    discipline: ((target as any).discipline ?? 'all') as 'all' | 'karate' | 'full_contact' | 'aerobic',
  })
  const [forceLogout, setForceLogout] = useState(true)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [anim, setAnim] = useState<'pre' | 'open' | 'closing'>('pre')
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])
  const handleClose = () => { setAnim('closing'); setTimeout(onClose, 160) }
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const isSuperTarget = (target as any).is_superadmin === true
  const isAdminRole = form.role === 'admin'
  // Un superadmin doit rester admin (invariant migration 025)
  const roleLocked = isSelf || isSuperTarget

  const ROLE_OPTIONS = [
    { value: 'admin'        as UserRole, label: t('role_col_admin'),  desc: 'Accès total : toutes les succursales et disciplines.' },
    { value: 'receptionist' as UserRole, label: t('role_col_recep'),  desc: t('role_desc_recep') },
    { value: 'viewer'       as UserRole, label: t('role_col_viewer'), desc: t('role_desc_viewer') },
  ].filter(r => r.value !== 'admin' || canManageAdmin)

  const scopeChanged =
    form.role !== target.role ||
    form.email.trim().toLowerCase() !== (target.email ?? '').toLowerCase() ||
    (form.branch === 'both' ? null : form.branch) !== (target.branch ?? null) ||
    (form.discipline === 'all' || isAdminRole ? null : form.discipline) !== ((target as any).discipline ?? null)

  const handleSave = () => {
    if (!form.name.trim() || !form.email.trim()) { setError(t('all_required')); return }
    startTransition(async () => {
      const res = await updateStaffAccess(target.id, { ...form, forceLogout: forceLogout && !isSelf })
      if (res?.error) setError(res.error)
      else { onSaved(`Accès mis à jour — ${form.name}`); handleClose() }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div className={`t-modal ${anim === 'open' ? 'is-open' : anim === 'closing' ? 'is-closing' : ''} rounded-3xl w-full max-w-md p-8 shadow-2xl border border-white/10`} style={{ background: '#101320' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-black text-white">Modifier les accès</h2>
        <p className="text-xs text-slate-400 mt-1 mb-6">
          Compte de {target.name} — le personnel ne peut pas modifier son nom ni son email lui-même.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_fullname')}</label>
            <input className="input-dark" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_email_req')}</label>
            <input className="input-dark" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">C&apos;est son identifiant de connexion — il devra utiliser la nouvelle adresse.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_role')}</label>
            {roleLocked ? (
              <div className="text-xs text-slate-400 rounded-xl border border-white/10 px-3 py-2.5">
                <span className={clsx('badge mr-2', ROLE_BADGE[target.role])}>{t(`role_col_${target.role === 'receptionist' ? 'recep' : target.role}` as any)}</span>
                {isSelf
                  ? 'Vous ne pouvez pas modifier votre propre rôle.'
                  : 'Retirez d\'abord le statut superadmin pour changer le rôle.'}
              </div>
            ) : (
              <div className="space-y-2">
                {ROLE_OPTIONS.map(r => (
                  <label key={r.value} className={clsx('flex items-start gap-3 p-3 rounded-xl cursor-pointer border-2 transition-colors',
                    form.role === r.value ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 hover:border-white/25')}>
                    <input type="radio" name="edit-role" value={r.value} checked={form.role === r.value}
                      onChange={() => set('role', r.value)} className="mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-white">{r.label}</div>
                      <div className="text-xs text-slate-400">{r.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('field_branch_assign')}</label>
            <select className="input-dark" value={form.branch} onChange={e => set('branch', e.target.value)}>
              <option value="both">{t('staff_both')}</option>
              <option value="sbata">{t('branch_sbata')}</option>
              <option value="rachad">{t('branch_rachad')}</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">{t('branch_hint')}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Discipline</label>
            <select className="input-dark disabled:opacity-50" value={isAdminRole ? 'all' : form.discipline}
              disabled={isAdminRole} onChange={e => set('discipline', e.target.value)}>
              <option value="all">Toutes les disciplines</option>
              <option value="karate">Karaté</option>
              <option value="full_contact">Full contact</option>
              <option value="aerobic">Aérobic</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              {isAdminRole
                ? 'Un administrateur voit toujours toutes les disciplines.'
                : 'Le personnel ne verra que les membres de cette discipline.'}
            </p>
          </div>

          {!isSelf && scopeChanged && (
            <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer rounded-xl border border-white/10 p-3">
              <input type="checkbox" checked={forceLogout} onChange={e => setForceLogout(e.target.checked)} className="mt-0.5" />
              <span>
                Déconnecter le compte pour appliquer immédiatement
                <span className="block text-slate-500">Sinon les nouveaux droits s&apos;appliqueront à sa prochaine connexion.</span>
              </span>
            </label>
          )}
        </div>

        {error && <div className="mt-4 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">{error}</div>}
        <div className="flex gap-3 mt-6">
          <button onClick={handleSave} disabled={isPending} className="btn-dark flex-1 justify-center disabled:opacity-50">
            {isPending ? '…' : 'Enregistrer'}
          </button>
          <button onClick={handleClose} className="btn-ghost flex-1 justify-center">{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  )
}

export default function StaffPage() {
  const [staff, setStaff] = useState<Profile[]>([])
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState('')
  const { t } = useT()

  const ROLES_T = [
    { value: 'admin'        as UserRole, labelKey: 'role_col_admin' as const  },
    { value: 'receptionist' as UserRole, labelKey: 'role_col_recep' as const  },
    { value: 'viewer'       as UserRole, labelKey: 'role_col_viewer' as const },
  ]

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchStaff = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    setCurrentUserId(user?.id ?? '')
    const data = await getStaff()
    setStaff(data as Profile[])
    setLoading(false)
  }

  useEffect(() => { fetchStaff() }, [])

  const handleDelete = (profileId: string, name: string) => {
    if (!confirm(`${t('confirm_delete_staff')} ${name} ?`)) return
    startTransition(async () => {
      const res = await deleteStaffAccount(profileId)
      if (res?.error) showToast(`${t('toast_error')} ${res.error}`)
      else { showToast(`${t('account_deleted')} — ${name}`); await fetchStaff() }
    })
  }

  // Le compte connecté est-il superadmin ? (pilote les actions réservées)
  const meSuper = staff.some(s => s.user_id === currentUserId && (s as any).is_superadmin)

  const handleSuperToggle = (profileId: string, name: string, value: boolean) => {
    const msg = value
      ? `Donner les droits SUPERADMIN à ${name} ?\nIl pourra gérer les admins, les tarifs et la supervision.`
      : `Retirer les droits superadmin à ${name} ?`
    if (!confirm(msg)) return
    startTransition(async () => {
      const res = await setSuperadmin(profileId, value)
      if (res?.error) showToast(`${t('toast_error')} ${res.error}`)
      else { showToast(value ? `${name} est superadmin` : `Droits superadmin retirés — ${name}`); await fetchStaff() }
    })
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full" /></div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-black text-white">{t('staff_title')}</h1>
          <p className="text-gray-500 mt-0.5">{t('staff_sub')}</p>
        </div>
        <button className="btn-dark" onClick={() => setModalOpen(true)}>
          {t('staff_new')}
        </button>
      </div>

      {/* Permissions matrix */}
      <div className="card p-6 mb-6">
        <h2 className="font-bold text-white mb-4">{t('staff_perms')}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left pb-3 text-xs font-bold text-gray-500 uppercase">Permission</th>
              {[t('role_col_admin'), t('role_col_recep'), t('role_col_viewer')].map(r => (
                <th key={r} className="text-center pb-3 text-xs font-bold text-gray-500 uppercase">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {PERM_KEYS.map(p => (
              <tr key={p.key}>
                <td className="py-2.5 text-slate-300">{t(p.key)}</td>
                {[p.admin, p.recep, p.viewer].map((v, i) => (
                  <td key={i} className="py-2.5 text-center">
                    {v
                      ? <span className="text-emerald-500 font-bold">✓</span>
                      : <span className="text-white/15 font-bold">✗</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Staff list */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="font-bold text-white">{t('staff_accounts')} ({staff.length})</h2>
        </div>
        <div className="divide-y divide-white/5">
          {staff.map(s => {
            const isSelf = s.user_id === currentUserId
            const sSuper = (s as any).is_superadmin === true
            // Un admin normal ne peut pas gérer un compte admin/superadmin
            const locked = !meSuper && (s.role === 'admin' || sSuper)
            return (
              <div key={s.id} className="staff-row flex items-center gap-4 px-6 py-4">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-slate-200 flex-shrink-0">
                  {s.name.split(' ').map((w: string) => w[0]).slice(0,2).join('').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{s.name}</span>
                    {sSuper && (
                      <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(250,204,21,0.15)', color: '#facc15' }}>
                        ★ SUPER ADMIN
                      </span>
                    )}
                    {isSelf && <span className="text-xs text-gray-400">{t('staff_you')}</span>}
                  </div>
                  <div className="text-xs text-gray-400">{s.email}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {t('staff_branch')} {s.branch ?? t('staff_both')}
                    {' · '}
                    {(s as any).discipline ? DISCIPLINE_LABELS[(s as any).discipline as Discipline] : 'Toutes disciplines'}
                  </div>
                </div>
                <div className="staff-row-actions flex items-center gap-3">
                  <span className={clsx('badge', ROLE_BADGE[s.role])}>{t(ROLES_T.find(r => r.value === s.role)?.labelKey ?? 'role_viewer')}</span>
                  {/* Modifier les accès (rôle, succursale, discipline) sans recréer le compte */}
                  {!locked && (
                    <button onClick={() => setEditing(s)} disabled={isPending}
                      title="Modifier les accès de ce compte"
                      className="text-xs font-semibold py-1.5 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 border border-white/15 transition-colors disabled:opacity-50">
                      ⚙︎ Accès
                    </button>
                  )}
                  {/* Attribution du statut superadmin — superadmin uniquement */}
                  {meSuper && !isSelf && (
                    <button onClick={() => handleSuperToggle(s.id, s.name, !sSuper)} disabled={isPending}
                      title={sSuper ? 'Retirer les droits superadmin' : 'Donner les droits superadmin'}
                      className="text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors disabled:opacity-50"
                      style={sSuper
                        ? { background: 'rgba(250,204,21,0.15)', color: '#facc15' }
                        : { background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}>
                      {sSuper ? '★ Retirer' : '☆ Superadmin'}
                    </button>
                  )}
                  {!isSelf && !locked && (
                    <button onClick={() => handleDelete(s.id, s.name)} disabled={isPending}
                      className="text-xs bg-red-600 hover:bg-red-700 text-white py-1.5 px-3 rounded-lg font-medium transition-colors disabled:opacity-50">{t('staff_delete')}</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {modalOpen && <AddStaffModal onClose={() => setModalOpen(false)} onSaved={fetchStaff} canCreateAdmin={meSuper} />}
      {editing && (
        <EditAccessModal
          target={editing}
          canManageAdmin={meSuper}
          isSelf={editing.user_id === currentUserId}
          onClose={() => setEditing(null)}
          onSaved={async msg => { showToast(msg); await fetchStaff() }}
        />
      )}
      {toast && (
        <ToastRise className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl">
          {toast}
        </ToastRise>
      )}
    </div>
  )
}
