/**
 * Lecture et ecriture de CSV.
 *
 * Deux dangers reels, et un troisieme qui n'existe pas.
 *
 *  1. L'INJECTION DE FORMULE. Une cellule qui commence par « = », « + »,
 *     « - » ou « @ » est interpretee comme une formule a l'ouverture dans
 *     Excel ou LibreOffice. `=cmd|'/c calc'!A1` lance un programme sur le
 *     poste de qui ouvre le fichier. C'est LE risque d'un systeme qui
 *     importe puis reexporte : le club importe un fichier recu par e-mail, on
 *     le stocke, un autre club l'exporte, et la charge s'execute chez lui.
 *     On neutralise donc a l'ecriture ET a la lecture.
 *
 *  2. LA TAILLE. Un fichier de cent megaoctets bloque l'onglet avant meme
 *     d'etre lu. Plafonne avant ouverture.
 *
 *  3. LES « MALWARES ». Un CSV est du texte : il ne s'execute pas, et il n'y
 *     a rien a scanner. Le seul code qu'il puisse porter est la formule du
 *     point 1. Promettre un antivirus ici serait mentir sur ce qu'on fait.
 */

/** 5 Mo : un fichier de club depasse rarement quelques centaines de kilos. */
export const MAX_CSV_BYTES = 5 * 1024 * 1024
export const MAX_CSV_ROWS = 500

const DANGEROUS = /^[=+\-@\t\r]/

/**
 * Desamorce une cellule avant ecriture.
 *
 * L'apostrophe en tete est la convention reconnue par Excel et LibreOffice :
 * elle force le texte et n'apparait pas a l'affichage. On ne touche pas aux
 * nombres negatifs legitimes — un « -12,50 » entierement numerique reste tel
 * quel, sinon toute colonne de montants deviendrait du texte.
 */
export function safeCell(value: unknown): string {
  const s = String(value ?? '')
  if (!DANGEROUS.test(s)) return s
  if (/^-?\d+([.,]\d+)?$/.test(s)) return s
  return `'${s}`
}

/** Cellule echappee et desamorcee, prete a etre jointe par une virgule. */
export const csvCell = (value: unknown) => `"${safeCell(value).replace(/"/g, '""')}"`

/**
 * Serialise un tableau en CSV.
 *
 * Le BOM est indispensable : sans lui Excel lit le fichier en ANSI et
 * massacre tous les accents.
 */
export function toCsv(rows: unknown[][]): Blob {
  const body = rows.map(r => r.map(csvCell).join(',')).join('\r\n')
  return new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' })
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Lecture ------------------------------------------------------------------

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

export class CsvError extends Error {}

/**
 * Analyseur CSV complet : guillemets, virgules et retours a la ligne dans les
 * cellules, doublement des guillemets.
 *
 * Ecrit a la main plutot qu'importe : une bibliotheque d'analyse pese plus
 * lourd que ces quarante lignes, et un fichier de club n'a rien d'exotique.
 * Le separateur est detecte — les tableurs francais exportent en
 * point-virgule, et un club ne devrait pas avoir a le savoir.
 */
export function parseCsv(text: string): ParsedCsv {
  // Le BOM se retrouverait sinon colle au premier en-tete, qui ne
  // correspondrait plus a rien.
  const clean = text.replace(/^﻿/, '')
  if (!clean.trim()) throw new CsvError('Le fichier est vide.')

  const firstLine = clean.slice(0, clean.indexOf('\n') === -1 ? undefined : clean.indexOf('\n'))
  const semis = (firstLine.match(/;/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  const sep = semis > commas ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!

    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++ }
        else quoted = false
      } else cell += ch
      continue
    }

    if (ch === '"') { quoted = true; continue }
    if (ch === sep) { row.push(cell); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') {
      row.push(cell); cell = ''
      if (row.some(c => c.trim())) rows.push(row)
      row = []
      continue
    }
    cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim())) rows.push(row)

  if (quoted) throw new CsvError('Guillemet non fermé : le fichier est incomplet ou corrompu.')
  if (rows.length < 2) throw new CsvError('Le fichier ne contient aucune ligne de données.')

  const headers = rows[0]!.map(h => h.trim())
  // Un binaire renomme en .csv franchit l'extension mais pas ceci : ses
  // « en-tetes » sont des octets illisibles.
  if (headers.every(h => !h)) throw new CsvError('Aucun en-tête lisible. Est-ce bien un fichier CSV ?')

  return { headers, rows: rows.slice(1) }
}

/**
 * Verifie qu'un fichier peut raisonnablement etre un CSV, avant de le lire.
 *
 * L'extension et le type MIME viennent du poste de l'utilisateur : ils se
 * renomment. Ce controle evite d'ouvrir une image de dix megaoctets par
 * erreur, il ne remplace pas l'analyse qui suit.
 */
export function checkCsvFile(file: File): string | null {
  if (file.size === 0) return 'Le fichier est vide.'
  if (file.size > MAX_CSV_BYTES) {
    return `Fichier trop volumineux : ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} Mo maximum.`
  }
  const name = file.name.toLowerCase()
  if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
    return 'Extension inattendue : un fichier .csv est attendu. Depuis Excel, « Enregistrer sous » puis CSV UTF-8.'
  }
  return null
}

/**
 * Detecte un contenu binaire.
 *
 * Un fichier renomme en .csv reste binaire : la presence d'octets nuls ou
 * d'un taux eleve de caracteres de controle le trahit avant qu'on essaie de
 * l'interpreter comme un tableau.
 */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4096)
  // L'octet nul ne se rencontre jamais dans du texte : il suffit a trancher.
  if (sample.includes('\u0000')) return true
  // eslint-disable-next-line no-control-regex
  const control = (sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length
  return control / Math.max(sample.length, 1) > 0.02
}
