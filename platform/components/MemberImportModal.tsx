'use client'

import { useRef, useState } from 'react'
import { X, Upload, CheckCircle2, TriangleAlert, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import {
  parseCsv, checkCsvFile, looksBinary, safeCell, CsvError, MAX_CSV_ROWS, toCsv, download,
} from '@/lib/csv'

interface Branch { id: string; name: string }
interface Discipline { id: string; name: string }

interface Draft {
  line: number
  name: string
  phone: string
  email: string | null
  joinDate: string | null
  subExpiry: string | null
  insExpiry: string | null
  isInsured: boolean
  branchId: string | null
  disciplineId: string | null
  problem: string | null
}

/**
 * Import CSV.
 *
 * Le fichier ne quitte jamais le navigateur : il est analyse ici, montre a
 * l'utilisateur, puis envoye sous forme de lignes structurees. Le serveur ne
 * lit donc aucun format, et chaque ligne y traverse les memes validations
 * qu'une creation a la main.
 *
 * On relit avant d'ecrire. Reprendre un fichier de deux cents membres est
 * exactement le moment ou une colonne decalee passe inapercue, et ou la
 * corriger apres coup coute une soiree.
 */

const HEADER_HINTS: Record<keyof Omit<Draft, 'line' | 'problem'>, string[]> = {
  name: ['nom', 'name', 'membre', 'nom complet', 'prenom nom'],
  phone: ['telephone', 'téléphone', 'phone', 'tel', 'gsm', 'mobile'],
  email: ['email', 'e-mail', 'mail', 'courriel'],
  joinDate: ['inscription', 'date inscription', 'join', 'join_date', 'adhesion', 'adhésion'],
  subExpiry: ['abonnement', 'fin abonnement', 'expiration', 'sub_expiry', 'echeance', 'échéance'],
  insExpiry: ['assurance', 'fin assurance', 'ins_expiry'],
  isInsured: ['assure', 'assuré', 'insured'],
  branchId: ['salle', 'branche', 'succursale', 'branch'],
  disciplineId: ['discipline', 'sport'],
}

const norm = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Retrouve la colonne correspondant a un champ, quel que soit son libelle. */
function findColumn(headers: string[], field: keyof typeof HEADER_HINTS): number {
  const hints = HEADER_HINTS[field].map(norm)
  return headers.findIndex(h => hints.includes(norm(h)))
}

/** Accepte 12/06/2026, 2026-06-12 et 12-06-2026. Rend toujours l'ISO. */
function toIso(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  return null
}

const TRUE_WORDS = ['oui', 'yes', 'true', '1', 'x', 'vrai']

export default function MemberImportModal({
  branches, disciplines, onClose, onDone,
}: {
  branches: Branch[]
  disciplines: Discipline[]
  onClose: () => void
  onDone: (created: number) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ created: number; rejected: Array<{ line: number; reason: string }> } | null>(null)

  async function read(file: File) {
    setProblem(null); setDrafts(null); setReport(null)

    const bad = checkCsvFile(file)
    if (bad) { setProblem(bad); return }

    const text = await file.text()
    if (looksBinary(text)) {
      setProblem('Ce fichier n’est pas du texte. Un .csv renommé depuis un .xlsx ou une image ne peut pas être lu — exportez en CSV depuis votre tableur.')
      return
    }

    let parsed
    try { parsed = parseCsv(text) }
    catch (e) { setProblem(e instanceof CsvError ? e.message : 'Fichier illisible.'); return }

    const cols = Object.fromEntries(
      (Object.keys(HEADER_HINTS) as Array<keyof typeof HEADER_HINTS>)
        .map(f => [f, findColumn(parsed.headers, f)]),
    ) as Record<keyof typeof HEADER_HINTS, number>

    if (cols.name === -1 || cols.phone === -1) {
      setProblem(
        `Colonnes « Nom » et « Téléphone » introuvables. En-têtes lus : ${parsed.headers.join(', ') || '(aucun)'}.`,
      )
      return
    }
    if (parsed.rows.length > MAX_CSV_ROWS) {
      setProblem(`${parsed.rows.length} lignes : ${MAX_CSV_ROWS} au maximum par import. Découpez le fichier.`)
      return
    }

    const at = (row: string[], i: number) => (i === -1 ? '' : (row[i] ?? '').trim())
    // Correspondance par nom : un fichier venu d'ailleurs ne connait pas nos
    // identifiants internes.
    const byName = <T extends { id: string; name: string }>(list: T[], v: string) =>
      list.find(x => norm(x.name) === norm(v))?.id ?? null

    const seen = new Set<string>()
    const list: Draft[] = parsed.rows.map((row, i) => {
      // safeCell des la lecture : une formule stockee ressortirait armee au
      // prochain export, chez quelqu'un d'autre.
      const name = safeCell(at(row, cols.name)).slice(0, 200)
      const phone = safeCell(at(row, cols.phone)).slice(0, 30)
      const rawJoin = at(row, cols.joinDate)
      const rawSub = at(row, cols.subExpiry)
      const rawIns = at(row, cols.insExpiry)

      let problem: string | null = null
      if (!name) problem = 'Nom manquant'
      else if (!phone) problem = 'Téléphone manquant'
      else if (rawJoin && !toIso(rawJoin)) problem = `Date d’inscription illisible : « ${rawJoin} »`
      else if (rawSub && !toIso(rawSub)) problem = `Fin d’abonnement illisible : « ${rawSub} »`
      else if (rawIns && !toIso(rawIns)) problem = `Fin d’assurance illisible : « ${rawIns} »`
      else if (seen.has(phone)) problem = 'Téléphone en double dans le fichier'
      if (!problem) seen.add(phone)

      const insDate = toIso(rawIns)
      const insuredCell = at(row, cols.isInsured)

      return {
        line: i + 2,   // +1 pour l'en-tete, +1 pour compter a partir de 1
        name, phone,
        email: safeCell(at(row, cols.email)).slice(0, 200) || null,
        joinDate: toIso(rawJoin),
        subExpiry: toIso(rawSub),
        insExpiry: insDate,
        // Assure si la colonne le dit, ou si une echeance est renseignee :
        // un fichier qui porte une date d'assurance sans colonne « assuré »
        // est explicite malgre tout.
        isInsured: insuredCell ? TRUE_WORDS.includes(norm(insuredCell)) : insDate !== null,
        branchId: byName(branches, at(row, cols.branchId)),
        disciplineId: byName(disciplines, at(row, cols.disciplineId)),
        problem,
      }
    })

    setFileName(file.name)
    setDrafts(list)
  }

  const valid = (drafts ?? []).filter(d => !d.problem)
  const invalid = (drafts ?? []).filter(d => d.problem)

  async function send() {
    setBusy(true); setProblem(null)
    try {
      const res = await api.post<{ created: number; rejected: Array<{ line: number; reason: string }> }>(
        '/api/members/import',
        {
          rows: valid.map(d => ({
            name: d.name, phone: d.phone, email: d.email,
            joinDate: d.joinDate, subExpiry: d.subExpiry, insExpiry: d.insExpiry,
            isInsured: d.isInsured, branchId: d.branchId, disciplineId: d.disciplineId,
          })),
        },
      )
      setReport(res)
      if (res.rejected.length === 0) onDone(res.created)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Import impossible')
    } finally { setBusy(false) }
  }

  /** Modele vide : la moitie des echecs viennent d'un en-tete mal nomme. */
  function template() {
    download(
      toCsv([
        ['Nom', 'Téléphone', 'E-mail', 'Salle', 'Discipline', 'Inscription', 'Fin abonnement', 'Assuré', 'Fin assurance'],
        ['Youssef Alaoui', '0661000001', 'youssef@example.ma',
         branches[0]?.name ?? '', disciplines[0]?.name ?? '', '12/06/2026', '12/07/2026', 'oui', '12/06/2027'],
      ]),
      'modele-import-membres.csv',
    )
  }

  return (
    <div className="compta-modal-overlay" onClick={onClose} role="dialog" aria-modal="true"
         aria-label="Importer des membres">
      <div className="compta-modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 6 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Importer des membres
          </h2>
          <button className="gf-hide" onClick={onClose} aria-label="Fermer"><X size={15} /></button>
        </div>
        <p className="dz-card-note" style={{ marginBottom: 16 }}>
          Colonnes reconnues quel que soit leur ordre. Seuls « Nom » et « Téléphone » sont
          obligatoires. Dates au format 12/06/2026 ou 2026-06-12.
        </p>

        {!drafts && !report && (
          <>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only"
                   onChange={e => { const f = e.target.files?.[0]; if (f) read(f) }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                      onClick={() => fileRef.current?.click()}>
                <Upload size={15} strokeWidth={2.2} /> Choisir un fichier CSV
              </button>
              <button className="btn-ghost" onClick={template}>Télécharger un modèle</button>
            </div>

            <div style={{
              marginTop: 18, padding: '0.85rem 1rem', borderRadius: 14,
              background: 'var(--overlay-soft)', border: '1px solid var(--hairline)',
              display: 'flex', gap: 10,
            }}>
              <ShieldCheck size={16} strokeWidth={2.1} style={{ color: 'var(--positive)', flex: 'none', marginTop: 2 }} />
              <p className="dz-card-note" style={{ margin: 0 }}>
                Le fichier est lu dans votre navigateur : il n’est jamais téléversé. Seules les
                lignes que vous validez partent, et elles passent les mêmes contrôles qu’une
                saisie manuelle. Les cellules commençant par <code>=</code> sont neutralisées —
                c’est ainsi qu’un tableur peut être détourné pour exécuter une commande.
              </p>
            </div>
          </>
        )}

        <div aria-live="polite">
          {problem && (
            <p role="alert" style={{
              marginTop: 14, padding: '0.7rem 1rem', borderRadius: 12,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5', fontSize: '0.82rem', fontWeight: 600,
            }}>{problem}</p>
          )}
        </div>

        {drafts && !report && (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '16px 0 10px',
                          flexWrap: 'wrap' }}>
              <span className="dz-card-note" style={{ fontWeight: 700 }}>{fileName}</span>
              <span style={{ color: 'var(--positive)', fontWeight: 700, fontSize: '0.82rem' }}>
                <CheckCircle2 size={13} strokeWidth={2.4} style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />
                {valid.length} prêt{valid.length > 1 ? 's' : ''}
              </span>
              {invalid.length > 0 && (
                <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.82rem' }}>
                  <TriangleAlert size={13} strokeWidth={2.4} style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />
                  {invalid.length} ignoré{invalid.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div style={{ maxHeight: 240, overflowY: 'auto', borderRadius: 12,
                          border: '1px solid var(--hairline)' }}>
              <table className="gf-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr><th>Ligne</th><th>Nom</th><th>Téléphone</th><th>Abonnement</th><th>État</th></tr>
                </thead>
                <tbody>
                  {drafts.map(d => (
                    <tr key={d.line} style={{ opacity: d.problem ? 0.6 : 1 }}>
                      <td className="gf-table-sub">{d.line}</td>
                      <td className="gf-table-name">{d.name || '—'}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{d.phone || '—'}</td>
                      <td className="gf-table-sub">{d.subExpiry ?? '—'}</td>
                      <td style={{ color: d.problem ? '#f59e0b' : 'var(--positive)',
                                   fontWeight: 600, fontSize: '0.75rem' }}>
                        {d.problem ?? 'Prêt'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="compta-modal-actions" style={{ marginTop: 16 }}>
              <button className="compta-modal-cancel" onClick={() => { setDrafts(null); setFileName(null) }}
                      disabled={busy}>Choisir un autre fichier</button>
              <button className="compta-modal-save" onClick={send} disabled={busy || valid.length === 0}>
                {busy ? 'Import…' : `Importer ${valid.length} membre${valid.length > 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}

        {report && (
          <>
            <p style={{ marginTop: 16, fontSize: '0.9rem', fontWeight: 700,
                        color: 'var(--positive)' }}>
              {report.created} membre{report.created > 1 ? 's' : ''} importé{report.created > 1 ? 's' : ''}.
            </p>
            {report.rejected.length > 0 && (
              <>
                <p className="dz-card-note" style={{ marginTop: 8 }}>
                  {report.rejected.length} ligne(s) refusée(s) par le serveur :
                </p>
                <ul className="dz-card-note" style={{ marginTop: 6, paddingInlineStart: '1.1rem' }}>
                  {report.rejected.slice(0, 10).map(r => (
                    <li key={r.line}>Ligne {r.line} — {r.reason}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="compta-modal-actions" style={{ marginTop: 16 }}>
              <button className="compta-modal-save" onClick={() => onDone(report.created)}>Terminer</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
