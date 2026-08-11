'use client'
// app/portal/[token]/page.tsx
// Portail athlète public (accès par token unique, sans compte).
// Le token est vérifié via la policy RLS "tokens: public verify" ;
// l'insertion du rapport passe par "reports: public insert via token".
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type State = 'loading' | 'form' | 'sent' | 'invalid'

interface TokenRow {
  championship_id: string
  member_id: string
}

// Numéro de semaine ISO (même convention que les rapports existants)
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

const inputCls = 'w-full rounded-2xl px-4 py-3 bg-white/5 border border-white/10 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-white/25'
const labelCls = 'block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-widest'

function Scale({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)}
          className={`w-10 h-10 rounded-full text-sm font-bold transition-colors ${value === n ? 'bg-amber-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>
          {n}
        </button>
      ))}
    </div>
  )
}

function Toggle({ value, onChange, labels = ['Oui', 'Non'] }: { value: boolean; onChange: (v: boolean) => void; labels?: [string, string] | string[] }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange(true)}
        className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${value ? 'bg-emerald-600 text-white' : 'bg-white/10 text-slate-300'}`}>{labels[0]}</button>
      <button type="button" onClick={() => onChange(false)}
        className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${!value ? 'bg-red-600/80 text-white' : 'bg-white/10 text-slate-300'}`}>{labels[1]}</button>
    </div>
  )
}

export default function PortalPage({ params }: { params: { token: string } }) {
  const [state, setState] = useState<State>('loading')
  const [tokenRow, setTokenRow] = useState<TokenRow | null>(null)
  const [champName, setChampName] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const [form, setForm] = useState({
    has_injury: false,
    injury_description: '',
    training_feeling: 3,
    sleep_time: '7-8h',
    sleep_duration: 8,
    wants_improvement: false,
    improvement_description: '',
    nutrition_ok: true,
    nutrition_notes: '',
    motivation_level: 3,
    weight_kg: '',
    athlete_notes: '',
  })
  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    const supabase = createClient()
    // Vérification sécurisée : la fonction ne renvoie que la ligne de CE token
    supabase
      .rpc('verify_portal_token', { p_token: params.token })
      .then(({ data, error }) => {
        const row = Array.isArray(data) ? data[0] : null
        if (error || !row) { setState('invalid'); return }
        setTokenRow({ championship_id: row.championship_id, member_id: row.member_id })
        setChampName(row.championship_name ?? '')
        setState('form')
      })
  }, [params.token])

  const handleSubmit = async () => {
    if (!tokenRow) return
    setError('')
    setSending(true)
    const supabase = createClient()
    // Envoi sécurisé : le token est validé côté serveur et championship_id/
    // member_id sont dérivés du token (impossible à usurper).
    const { error: insertError } = await supabase.rpc('submit_weekly_report', {
      p_token: params.token,
      p_payload: {
        week_number: isoWeek(new Date()),
        has_injury: form.has_injury,
        injury_description: form.has_injury ? form.injury_description || null : null,
        training_feeling: form.training_feeling,
        sleep_time: form.sleep_time,
        sleep_duration: form.sleep_duration,
        wants_improvement: form.wants_improvement,
        improvement_description: form.wants_improvement ? form.improvement_description || null : null,
        nutrition_ok: form.nutrition_ok,
        nutrition_notes: form.nutrition_ok ? null : form.nutrition_notes || null,
        motivation_level: form.motivation_level,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        athlete_notes: form.athlete_notes || null,
      },
    })
    setSending(false)
    if (insertError) {
      setError(insertError.code === '23505'
        ? 'Vous avez déjà soumis votre rapport cette semaine. Merci !'
        : `Erreur lors de l'envoi : ${insertError.message}`)
      return
    }
    setState('sent')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-gray-800 flex items-start justify-center p-4 py-10">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <img src="/logo-noujoum-el-chaouia.png" alt="ANCS" className="w-14 h-14 rounded-full object-contain mx-auto mb-3" />
          <h1 className="text-2xl font-black text-white">Suivi de préparation</h1>
          {champName && <p className="text-slate-400 text-sm mt-1">🏆 {champName}</p>}
        </div>

        {state === 'loading' && (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 border-2 border-white/30 border-t-white rounded-full" />
          </div>
        )}

        {state === 'invalid' && (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-lg font-bold text-white mb-2">Lien invalide ou expiré</h2>
            <p className="text-sm text-slate-400">
              Ce lien de suivi n&apos;est plus actif. Contactez votre entraîneur pour en recevoir un nouveau.
            </p>
          </div>
        )}

        {state === 'sent' && (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-4">✅</div>
            <h2 className="text-lg font-bold text-white mb-2">Rapport envoyé, merci !</h2>
            <p className="text-sm text-slate-400">Votre staff a bien reçu votre suivi de la semaine. Bon entraînement 💪</p>
          </div>
        )}

        {state === 'form' && (
          <div className="card p-7 space-y-6">
            <div>
              <label className={labelCls}>Avez-vous une blessure ? / هل لديك إصابة؟</label>
              <Toggle value={form.has_injury} onChange={v => set('has_injury', v)} />
              {form.has_injury && (
                <textarea className={`${inputCls} mt-3 resize-none`} rows={2} placeholder="Décrivez la blessure…"
                  value={form.injury_description} onChange={e => set('injury_description', e.target.value)} />
              )}
            </div>

            <div>
              <label className={labelCls}>Sensation à l&apos;entraînement (1 = mauvaise, 5 = excellente)</label>
              <Scale value={form.training_feeling} onChange={v => set('training_feeling', v)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Heure de coucher</label>
                <select className={inputCls} value={form.sleep_time} onChange={e => set('sleep_time', e.target.value)}>
                  {['avant 22h', '22h-23h', '23h-00h', 'après 00h', '7-8h'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Heures de sommeil</label>
                <select className={inputCls} value={form.sleep_duration} onChange={e => set('sleep_duration', Number(e.target.value))}>
                  {[4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => <option key={h} value={h}>{h}h</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Un point à améliorer cette semaine ?</label>
              <Toggle value={form.wants_improvement} onChange={v => set('wants_improvement', v)} />
              {form.wants_improvement && (
                <textarea className={`${inputCls} mt-3 resize-none`} rows={2} placeholder="Ce que vous voulez travailler…"
                  value={form.improvement_description} onChange={e => set('improvement_description', e.target.value)} />
              )}
            </div>

            <div>
              <label className={labelCls}>Alimentation correcte cette semaine ?</label>
              <Toggle value={form.nutrition_ok} onChange={v => set('nutrition_ok', v)} />
              {!form.nutrition_ok && (
                <textarea className={`${inputCls} mt-3 resize-none`} rows={2} placeholder="Expliquez…"
                  value={form.nutrition_notes} onChange={e => set('nutrition_notes', e.target.value)} />
              )}
            </div>

            <div>
              <label className={labelCls}>Motivation (1 = faible, 5 = très motivé)</label>
              <Scale value={form.motivation_level} onChange={v => set('motivation_level', v)} />
            </div>

            <div>
              <label className={labelCls}>Poids actuel (kg, optionnel)</label>
              <input className={inputCls} type="number" step="0.1" min="20" max="200" placeholder="ex : 62.5"
                value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Remarques (optionnel)</label>
              <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Autre chose à signaler…"
                value={form.athlete_notes} onChange={e => set('athlete_notes', e.target.value)} />
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">{error}</div>
            )}

            <button onClick={handleSubmit} disabled={sending}
              className="btn-dark w-full justify-center disabled:opacity-50">
              {sending ? 'Envoi…' : 'Envoyer mon rapport'}
            </button>
          </div>
        )}

        <p className="text-center text-slate-500 text-xs mt-6">Association Noujoum El Chaouia — suivi des athlètes</p>
      </div>
    </div>
  )
}
