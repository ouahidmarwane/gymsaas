'use client'
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n'

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false)
  const { t } = useT()

  useEffect(() => {
    const goOff = () => setOffline(true)
    const goOn  = () => setOffline(false)
    window.addEventListener('offline', goOff)
    window.addEventListener('online',  goOn)
    setOffline(!navigator.onLine)
    return () => {
      window.removeEventListener('offline', goOff)
      window.removeEventListener('online',  goOn)
    }
  }, [])

  if (!offline) return null
  return (
    <div className="offline-banner" role="alert">
      ⚠ {t('offline_msg')}
    </div>
  )
}
