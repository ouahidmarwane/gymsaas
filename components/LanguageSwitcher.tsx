'use client'
import { useT } from '@/lib/i18n'

export default function LanguageSwitcher() {
  const { lang, setLang, t } = useT()

  return (
    <button
      onClick={() => setLang(lang === 'fr' ? 'ar' : 'fr')}
      className="lang-switcher-btn"
      title={lang === 'fr' ? 'Switch to Arabic' : 'Passer en français'}
      aria-label="Switch language"
    >
      <span className="lang-switcher-flag">{lang === 'fr' ? '🇲🇦' : '🇫🇷'}</span>
      <span className="lang-switcher-label">{t('lang_label')}</span>
    </button>
  )
}
