'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShieldAlert, Upload, RefreshCw, CheckCircle2, Clock, MessageCircle, Building2,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'

/**
 * Abonnement du club, vu par le club.
 *
 * Bilingue francais / arabe cote a cote, sans selecteur : un gerant marocain
 * lit l'un ou l'autre selon le moment, et lui demander de choisir une langue
 * avant de comprendre pourquoi son acces est coupe serait une marche de plus
 * au pire moment.
 */

interface InvoiceRow {
  id: string
  period_start: string
  period_end: string
  amount_cents: number
  due_date: string
  paid_at: string | null
  proof_status: 'pending' | 'accepted' | 'rejected' | null
  proof_reference: string | null
  proof_at: string | null
  reject_reason: string | null
}

interface Subscription {
  orgName: string
  configured: boolean
  priceCents: number | null
  cycleMonths: number | null
  expiresAt: string | null
  daysLeft: number | null
  expired: boolean
  dueCents: number
  invoices: InvoiceRow[]
  bankDetails: string | null
  today: string
}

const dh = (cents: number) => `${Math.round(cents / 100).toLocaleString('fr-FR')} DH`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—')

/** Revient toutes les 20 s : l'exploitant valide a la main, pas a la seconde. */
const POLL_MS = 20_000

export default function AbonnementPage() {
  const router = useRouter()
  const [data, setData] = useState<Subscription | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [lastCheck, setLastCheck] = useState<number | null>(null)
  const wasExpired = useRef<boolean | null>(null)

  const load = useCallback(async (manual = false) => {
    if (manual) setChecking(true)
    try {
      const d = await api.get<Subscription>('/api/subscription')
      setData(d); setError(null); setLastCheck(Date.now())

      // Debloque de lui-meme des que l'exploitant a valide : le gerant n'a
      // pas a deviner qu'il faut recharger la page.
      if (wasExpired.current === true && !d.expired) {
        router.replace('/dashboard')
        router.refresh()
      }
      wasExpired.current = d.expired
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
    } finally { if (manual) setChecking(false) }
  }, [router])

  useEffect(() => {
    load()
    const timer = setInterval(() => load(), POLL_MS)
    // On revérifie aussi au retour sur l'onglet : le gérant part payer, puis
    // revient — c'est le moment exact où l'état a pu changer.
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  const open = (data?.invoices ?? []).filter(i => !i.paid_at)
  const current = open[0] ?? null
  const pendingReview = open.some(i => i.proof_status === 'pending')

  return (
    <div className="dashboard-shell">
      <Bilingual
        fr="Abonnement" ar="الاشتراك"
        as="eyebrow"
      />

      {data?.expired ? (
        <section className="dz-card" style={{ borderColor: 'rgba(239,68,68,0.35)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <ShieldAlert size={22} strokeWidth={2.2} style={{ color: '#f87171', flex: 'none', marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                Votre abonnement a expiré
              </h1>
              <p dir="rtl" lang="ar" style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4 }}>
                انتهت صلاحية اشتراككم
              </p>
              <p className="dz-sub" style={{ marginTop: 10 }}>
                Il a pris fin le {day(data.expiresAt)}
                {data.daysLeft !== null && ` (${Math.abs(data.daysLeft)} jour(s))`}.
                Consultez le lien de paiement envoyé sur WhatsApp, puis revenez sur cette page.
              </p>
              <p dir="rtl" lang="ar" className="dz-sub" style={{ marginTop: 6 }}>
                انتهى بتاريخ {day(data.expiresAt)}. يرجى الاطلاع على رابط الأداء المرسل عبر
                واتساب، ثم العودة إلى هذه الصفحة.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <div>
          <h1 className="dz-hello">Mon abonnement</h1>
          <p className="dz-sub">
            {data
              ? data.configured
                ? `${data.orgName} · couvert jusqu’au ${day(data.expiresAt)}`
                : 'Aucun abonnement n’a encore été défini pour ce club.'
              : 'Chargement…'}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" style={{
          padding: '0.7rem 1rem', borderRadius: 14,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', fontSize: '0.85rem', fontWeight: 600,
        }}>{error}</p>
      )}

      {/* Verification : bouton manuel + sondage en arriere-plan. */}
      {data && (data.expired || data.dueCents > 0) && (
        <section className="dz-card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-dark"
                    style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                    onClick={() => load(true)} disabled={checking}>
              <RefreshCw size={15} strokeWidth={2.3} />
              {checking ? 'Vérification…' : 'Vérifier mon paiement'}
            </button>
            <div style={{ minWidth: 0 }}>
              <p className="dz-card-note">
                {pendingReview
                  ? 'Votre justificatif est en cours de vérification. Cette page se débloquera seule.'
                  : 'La page se revérifie toute seule toutes les 20 secondes.'}
                {lastCheck && ` Dernière vérification à ${new Date(lastCheck).toLocaleTimeString('fr-FR')}.`}
              </p>
              <p dir="rtl" lang="ar" className="dz-card-note" style={{ marginTop: 3 }}>
                {pendingReview
                  ? 'يتم التحقق من الوصل. ستُفتح الصفحة تلقائيا.'
                  : 'يتم التحقق تلقائيا كل 20 ثانية.'}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Comment payer. */}
      {data?.configured && data.dueCents > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Building2 size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} />
              Régler par virement
            </h2>
            <span className="dz-card-note" style={{ fontWeight: 800, color: '#f59e0b' }}>
              {dh(data.dueCents)}
            </span>
          </div>

          <p dir="rtl" lang="ar" className="dz-card-note" style={{ marginTop: 4 }}>
            الأداء عن طريق التحويل البنكي
          </p>

          <pre style={{
            marginTop: 14, padding: '0.9rem 1rem', borderRadius: 14,
            background: 'var(--overlay-soft)', border: '1px solid var(--hairline)',
            fontSize: '0.85rem', whiteSpace: 'pre-wrap', fontFamily: 'inherit',
          }}>
            {data.bankDetails ?? 'Les coordonnées bancaires vous seront communiquées par WhatsApp.'}
          </pre>

          {current && (
            <ProofForm invoice={current} onDone={() => load(true)} />
          )}
        </section>
      )}

      {/* Historique. */}
      {data && data.invoices.length > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Échéances</h2>
            <span className="dz-card-note" dir="rtl" lang="ar">الاستحقاقات</span>
          </div>
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr><th>Période</th><th>Montant</th><th>Statut</th></tr>
              </thead>
              <tbody>
                {data.invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="gf-table-sub" style={{ whiteSpace: 'nowrap' }}>
                      {day(inv.period_start)} → {day(inv.period_end)}
                    </td>
                    <td style={{ fontWeight: 700 }}>{dh(inv.amount_cents)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {inv.paid_at ? (
                        <span style={{ color: 'var(--positive)', fontWeight: 700 }}>
                          <CheckCircle2 size={13} strokeWidth={2.4}
                                        style={{ verticalAlign: '-2px', marginInlineEnd: 5 }} />
                          Payé le {day(inv.paid_at)}
                        </span>
                      ) : inv.proof_status === 'pending' ? (
                        <span style={{ color: 'var(--gold)', fontWeight: 700 }}>
                          <Clock size={13} strokeWidth={2.4}
                                 style={{ verticalAlign: '-2px', marginInlineEnd: 5 }} />
                          Justificatif en vérification
                        </span>
                      ) : inv.proof_status === 'rejected' ? (
                        <span style={{ color: '#f87171', fontWeight: 700 }}>
                          Refusé{inv.reject_reason ? ` — ${inv.reject_reason}` : ''}
                        </span>
                      ) : (
                        <span style={{ color: '#f59e0b', fontWeight: 700 }}>À régler</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && !data.configured && (
        <section className="dz-card">
          <p className="dz-card-note">
            Aucun tarif n’a encore été défini pour votre club. Vous n’avez rien à régler.
          </p>
          <p dir="rtl" lang="ar" className="dz-card-note" style={{ marginTop: 6 }}>
            لم يتم بعد تحديد أي تعرفة لناديكم. لا يوجد ما يستوجب الأداء.
          </p>
        </section>
      )}
    </div>
  )
}

function Bilingual({ fr, ar, as }: { fr: string; ar: string; as: 'eyebrow' }) {
  if (as !== 'eyebrow') return null
  return (
    <p className="section-heading" style={{ marginBottom: 0 }}>
      {fr} <span dir="rtl" lang="ar" style={{ marginInlineStart: 8 }}>· {ar}</span>
    </p>
  )
}

/**
 * Depot du justificatif.
 *
 * La reference du virement compte autant que le fichier : c'est elle qui
 * permet de retrouver l'operation sur le releve bancaire. Un reçu sans
 * reference oblige l'exploitant a chercher a l'aveugle.
 */
function ProofForm({ invoice, onDone }: { invoice: InvoiceRow; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [reference, setReference] = useState(invoice.proof_reference ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function send(file: File | null) {
    setBusy(true); setProblem(null)
    try {
      const query = reference.trim() ? `?reference=${encodeURIComponent(reference.trim())}` : ''
      const path = `/api/subscription/invoices/${invoice.id}/proof${query}`
      if (file) {
        if (file.size > 4 * 1024 * 1024) throw new ApiError(413, 'Fichier trop volumineux : 4 Mo maximum')
        const res = await fetch(path, {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': file.type }, body: file,
        })
        if (!res.ok) {
          const payload: unknown = await res.json().catch(() => null)
          throw new ApiError(res.status, typeof payload === 'object' && payload && 'error' in payload
            ? String((payload as { error: unknown }).error) : 'Envoi impossible')
        }
      } else {
        await api.put(path, {})
      }
      setSent(true); onDone()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Envoi impossible')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--hairline)' }}>
      <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 4 }}>
        Envoyer le justificatif
      </p>
      <p dir="rtl" lang="ar" className="dz-card-note" style={{ marginBottom: 12 }}>
        إرسال وصل التحويل
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 220px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>
            Référence du virement
          </span>
          <input className="input-dark" value={reference} maxLength={80}
                 placeholder="Ex. VIR-2026-08-1234"
                 onChange={e => setReference(e.target.value)} />
        </label>

        <input ref={fileRef} type="file" className="sr-only"
               accept="image/png,image/jpeg,image/webp,application/pdf"
               onChange={e => { const f = e.target.files?.[0]; if (f) send(f) }} />

        <button className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={15} strokeWidth={2.2} /> Joindre le reçu
        </button>
        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                disabled={busy || !reference.trim()} onClick={() => send(null)}>
          {busy ? 'Envoi…' : 'Déclarer le virement'}
        </button>
      </div>

      <div aria-live="polite">
        {problem && (
          <p role="alert" style={{ marginTop: 10, fontSize: '0.8rem', color: '#fca5a5', fontWeight: 600 }}>
            {problem}
          </p>
        )}
        {sent && !problem && (
          <p style={{ marginTop: 10, fontSize: '0.8rem', color: '#6ee7b7', fontWeight: 600 }}>
            Reçu. Votre paiement sera vérifié, la page se débloquera seule.
            <span dir="rtl" lang="ar" style={{ display: 'block', marginTop: 3 }}>
              تم التوصل. سيتم التحقق من الأداء وستُفتح الصفحة تلقائيا.
            </span>
          </p>
        )}
      </div>

      <p className="dz-card-note" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <MessageCircle size={13} strokeWidth={2.2} style={{ color: '#25D366', flex: 'none' }} />
        Vous pouvez aussi envoyer le reçu par WhatsApp au numéro habituel.
      </p>
    </div>
  )
}
