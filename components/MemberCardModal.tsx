'use client'
import { mediaUrl } from '@/lib/media'
import { useRef } from 'react'
import { useT } from '@/lib/i18n'
import type { Member } from '@/types'

interface Props {
  member: Member
  onClose: () => void
}

const LOGO_PATH = '/logo-noujoum-el-chaouia.png'

async function toBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

export default function MemberCardModal({ member, onClose }: Props) {
  const { t } = useT()
  const cardRef = useRef<HTMLDivElement>(null)

  const handlePrint = async () => {
    const win = window.open('', '_blank', 'width=500,height=380')
    if (!win) return

    const [logoB64, photoB64] = await Promise.all([
      toBase64(LOGO_PATH),
      member.photo_url ? toBase64(mediaUrl(member.photo_url) ?? member.photo_url) : Promise.resolve(''),
    ])

    const photoHtml = photoB64
      ? `<img class="photo" src="${photoB64}" alt="" />`
      : `<div class="photo photo-placeholder">${member.name.charAt(0).toUpperCase()}</div>`

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Carte — ${member.name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #f0f0f0;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; font-family: 'Outfit', sans-serif;
    }
    .card {
      width: 85.6mm; height: 54mm;
      border-radius: 10px;
      background: linear-gradient(135deg, #0a0f1e 0%, #0d1a35 55%, #0f2040 100%);
      color: #fff;
      position: relative;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      padding: 5mm 5mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    /* subtle glow top-right */
    .card::after {
      content: '';
      position: absolute;
      top: -12mm; right: -8mm;
      width: 32mm; height: 32mm;
      border-radius: 50%;
      background: rgba(255,255,255,0.05);
      pointer-events: none;
    }

    /* ── TOP ROW: logo + association name ── */
    .top-row {
      display: flex;
      align-items: center;
      gap: 2.5mm;
    }
    .logo {
      height: 7mm;
      width: auto;
      object-fit: contain;
      flex-shrink: 0;
    }
    .assoc-name {
      font-size: 5.8pt;
      font-weight: 800;
      color: rgba(255,255,255,0.75);
      letter-spacing: 0.03em;
      text-transform: uppercase;
      line-height: 1.3;
    }

    /* ── MIDDLE: member name ── */
    .member-name {
      font-size: 14pt;
      font-weight: 900;
      color: #fff;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    /* ── BOTTOM ROW: phone left, photo right ── */
    .bottom-row {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
    }
    .phone-block {}
    .phone-label {
      font-size: 5pt;
      font-weight: 600;
      color: rgba(255,255,255,0.35);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 1mm;
    }
    .phone-value {
      font-size: 9pt;
      font-weight: 700;
      color: rgba(255,255,255,0.9);
      letter-spacing: 0.02em;
    }
    .photo {
      width: 22mm; height: 22mm;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid rgba(255,255,255,0.3);
      flex-shrink: 0;
    }
    .photo-placeholder {
      width: 22mm; height: 22mm;
      border-radius: 50%;
      background: rgba(255,255,255,0.12);
      border: 2px solid rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 14pt; font-weight: 800; color: rgba(255,255,255,0.65);
    }
    @media print {
      body { background: #fff; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="top-row">
      ${logoB64 ? `<img class="logo" src="${logoB64}" alt="logo" />` : ''}
      <div class="assoc-name">Association<br>Noujoum El Chaouia</div>
    </div>
    <div class="member-name">${member.name}</div>
    <div class="bottom-row">
      <div class="phone-block">
        <div class="phone-label">Téléphone</div>
        <div class="phone-value">${member.phone}</div>
      </div>
      ${photoHtml}
    </div>
  </div>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 800); }<\/script>
</body>
</html>`)
    win.document.close()
  }

  const hasPhoto = !!member.photo_url

  // Shared style helpers for preview
  const photoStyle: React.CSSProperties = {
    width: '22%',
    aspectRatio: '1',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid rgba(255,255,255,0.3)',
    flexShrink: 0,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-[#0e1220] border border-white/10 rounded-3xl w-full max-w-md p-7 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-5">{t('print_card_title')}</h2>

        {/* Live card preview */}
        <div
          ref={cardRef}
          style={{
            width: '100%',
            aspectRatio: '85.6 / 54',
            borderRadius: 10,
            background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1a35 55%, #0f2040 100%)',
            color: '#fff',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            marginBottom: '1.5rem',
            padding: '6% 6%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          {/* Decorative circle */}
          <div style={{
            position: 'absolute', top: '-22%', right: '-8%',
            width: '35%', paddingBottom: '35%',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)',
            pointerEvents: 'none',
          }} />

          {/* Top row: logo + association name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3%' }}>
            <img
              src={LOGO_PATH}
              alt="logo"
              style={{ height: '1.2rem', width: 'auto', objectFit: 'contain', flexShrink: 0 }}
            />
            <div style={{ fontSize: '0.5rem', fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.03em', textTransform: 'uppercase', lineHeight: 1.3 }}>
              Association<br />Noujoum El Chaouia
            </div>
          </div>

          {/* Member name */}
          <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            {member.name}
          </div>

          {/* Bottom row: phone left, photo right */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.4rem', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.2rem' }}>
                Téléphone
              </div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>
                {member.phone}
              </div>
            </div>
            {hasPhoto ? (
              <img src={member.photo_url!} alt="" style={photoStyle} />
            ) : (
              <div style={{
                ...photoStyle,
                background: 'rgba(255,255,255,0.12)',
                border: '2px solid rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.85rem', fontWeight: 800, color: 'rgba(255,255,255,0.65)',
              }}>
                {member.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={handlePrint} className="btn-dark flex-1 justify-center">🖨 {t('print_card_btn')}</button>
          <button onClick={onClose} className="btn-ghost flex-1 justify-center">{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  )
}
