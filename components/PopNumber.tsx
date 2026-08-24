'use client'
// Chiffres qui apparaissent caractere par caractere.
//
// La cle porte la valeur entiere : React remonte le groupe des qu'elle
// change, ce qui rejoue l'animation. Sans cela, passer de 700 a 800 ne
// bougerait pas, la structure du DOM etant identique.
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
