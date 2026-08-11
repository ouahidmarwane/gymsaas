'use client'
// components/PopNumber.tsx
// Chiffres qui apparaissent chiffre par chiffre (transition « number pop-in »
// de transitions.dev). key force le remontage quand la valeur change,
// donc l'animation rejoue.
export default function PopNumber({ value }: { value: number | string }) {
  const chars = String(value).split('')
  return (
    <span className="t-digit-group is-animating" key={String(value)}>
      {chars.map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          className="t-digit"
          data-stagger={i === chars.length - 2 ? '1' : i === chars.length - 1 ? '2' : undefined}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}
