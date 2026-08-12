import { Wallet } from 'lucide-react'
import ComingSoon from '@/components/ComingSoon'

export default function Page() {
  return (
    <ComingSoon title="Comptabilite" icon={<Wallet size={40} strokeWidth={1.6} />}>
      Encaissements reels et estimations tarifaires, en dirhams, exportables. A porter apres les membres.
    </ComingSoon>
  )
}