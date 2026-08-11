'use client'
import { useRef, useState, useTransition, DragEvent, ChangeEvent } from 'react'
import { addMember } from '@/lib/actions'
import { useT } from '@/lib/i18n'
import { useBranch } from '@/lib/branch-context'
import clsx from 'clsx'

interface ParsedRow {
  name: string
  phone: string
  grade: number
  join_date: string
  valid: boolean
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/)
  // Skip header row if first cell looks like a label
  const dataLines = /^[a-zA-Z؀-ۿnom]/i.test(lines[0]) ? lines.slice(1) : lines
  return dataLines
    .filter(l => l.trim())
    .map(line => {
      // Support comma and semicolon separators
      const sep = line.includes(';') ? ';' : ','
      const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''))
      const name  = cols[0] ?? ''
      const phone = cols[1] ?? ''
      const grade = parseInt(cols[2] ?? '0', 10)
      const join_date = cols[3] ?? new Date().toISOString().slice(0, 10)
      const valid = name.length >= 2 && /^[\d+ ()-]{6,}$/.test(phone)
      return { name, phone, grade: isNaN(grade) ? 0 : Math.max(0, Math.min(12, grade)), join_date, valid }
    })
}

export default function CsvImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useT()
  const { activeBranch } = useBranch()
  const inputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows]         = useState<ParsedRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(0)
  const [isPending, start]      = useTransition()

  const handleFile = (file: File) => {
    setError('')
    setRows([])
    if (!file.name.match(/\.(csv|txt|xls|xlsx)$/i)) {
      setError('Format non supporté. Utilisez CSV ou Excel (.csv, .xlsx).')
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (!parsed.length) { setError('Aucune donnée trouvée dans le fichier.'); return }
      setRows(parsed)
    }
    reader.readAsText(file, 'utf-8')
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleImport = () => {
    const validRows = rows.filter(r => r.valid)
    start(async () => {
      let count = 0
      for (const row of validRows) {
        const res = await addMember({
          name:      row.name,
          phone:     row.phone,
          grade:     row.grade,
          join_date: row.join_date || new Date().toISOString().slice(0, 10),
          is_insured: false,
          branch: activeBranch,
        })
        if (!res?.error) count++
      }
      setDone(count)
      onImported()
    })
  }

  const validCount = rows.filter(r => r.valid).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-[#0e1220] border border-white/10 rounded-3xl w-full max-w-2xl p-7 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-white mb-5">{t('csv_import_title')}</h2>

        {done > 0 ? (
          <div className="text-center py-10">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-white font-bold text-lg">{done} {t('csv_success')}</div>
            <button onClick={onClose} className="mt-6 btn-dark">{t('btn_cancel')}</button>
          </div>
        ) : rows.length === 0 ? (
          <>
            <div
              className={clsx('csv-drop-zone relative', dragOver && 'dragover')}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input ref={inputRef} type="file" accept=".csv,.txt,.xls,.xlsx" className="hidden" onChange={onInputChange} />
              <div className="text-3xl mb-3">📂</div>
              <div className="text-sm text-slate-300 font-medium">{t('csv_drop_hint')}</div>
              <div className="text-xs text-slate-500 mt-2">Colonnes attendues : Nom, Téléphone, Grade, Date d'inscription</div>
            </div>
            {error && <div className="mt-4 text-sm text-red-400 bg-red-400/10 rounded-xl px-4 py-3">{error}</div>}
            <div className="flex gap-3 mt-5">
              <button onClick={onClose} className="btn-ghost flex-1 justify-center">{t('btn_cancel')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-slate-400 mb-3">{t('csv_preview_title')} — <span className="text-white font-bold">{validCount}</span> / {rows.length} lignes valides</div>
            <div className="overflow-auto max-h-72 rounded-xl border border-white/08">
              <table className="w-full text-sm">
                <thead className="bg-white/05">
                  <tr>
                    {[t('csv_col_name'), t('csv_col_phone'), t('csv_col_grade'), t('csv_col_status')].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-bold text-slate-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/05">
                  {rows.map((row, i) => (
                    <tr key={i} className={clsx(!row.valid && 'opacity-40')}>
                      <td className="px-3 py-2 text-white">{row.name || '—'}</td>
                      <td className="px-3 py-2 text-slate-300">{row.phone || '—'}</td>
                      <td className="px-3 py-2 text-slate-300">{row.grade}</td>
                      <td className="px-3 py-2">
                        <span className={clsx('text-xs font-bold px-2 py-0.5 rounded-full', row.valid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400')}>
                          {row.valid ? t('csv_ok') : t('csv_invalid')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={handleImport}
                disabled={isPending || validCount === 0}
                className="btn-dark flex-1 justify-center disabled:opacity-50"
              >
                {isPending ? t('csv_importing') : `${t('csv_import_btn')} (${validCount})`}
              </button>
              <button onClick={() => setRows([])} className="btn-ghost">{t('btn_cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
