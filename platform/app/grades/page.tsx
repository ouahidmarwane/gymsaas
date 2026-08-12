import { Award } from 'lucide-react'
import ComingSoon from '@/components/ComingSoon'

export default function Page() {
  return (
    <ComingSoon title="Passage de grade" icon={<Award size={40} strokeWidth={1.6} />}>
      Le moteur de passage de grade — dates fixes de saison, eligibilite, confirmation — arrive une fois les echelles par club branchees.
    </ComingSoon>
  )
}