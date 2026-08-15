// Celebration : les invariants qui ne demandent pas de navigateur.
//
// Le rendu ne se teste pas ici — il n'y a ni canvas ni ecran. Ce qui se
// teste, c'est l'arithmetique qui a casse : un anneau decale demarre avec une
// vie negative, son rayon devenait negatif, et `ctx.arc` leve IndexSizeError
// sur un rayon negatif. L'exception sortait de la boucle d'animation avant
// son requestAnimationFrame : plus aucune image, et la derniere restait
// peinte a l'ecran. Un amas de particules fige a l'origine.
//
// La couleur du neon se teste aussi : c'est le critere non negociable de
// cette fonctionnalite — elle doit venir du theme, jamais d'une constante.
//
//   node --test test/celebrate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ringRadius, SETS } from '../lib/celebrate.ts'

test('un anneau n a jamais de rayon negatif', () => {
  // Le second anneau part a life = -8 pour arriver apres le premier.
  // Sans plancher, sa premiere image demandait un rayon de -11,7.
  for (let life = -20; life <= 60; life++) {
    const r = ringRadius(life, 42)
    assert.ok(r >= 0, `rayon negatif a life=${life} : ${r}`)
    assert.ok(Number.isFinite(r), `rayon non fini a life=${life}`)
  }
})

test('l anneau s ouvre bien quand il vit', () => {
  // L'invariant ne doit pas avoir aplati l'animation : le rayon croit.
  assert.equal(ringRadius(0, 42), 10)
  assert.ok(ringRadius(21, 42) > ringRadius(0, 42))
  assert.ok(ringRadius(42, 42) > ringRadius(21, 42))
  assert.equal(Math.round(ringRadius(42, 42)), 140)
})

test('les jeux d emojis sont non vides et distincts', () => {
  const keys = Object.keys(SETS)
  assert.ok(keys.length >= 2, 'il faut de quoi choisir')
  for (const k of keys) {
    assert.ok(Array.isArray(SETS[k]) && SETS[k].length > 0, `jeu vide : ${k}`)
  }
})
