'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Ecran de bienvenue, apres une connexion reussie.
 *
 * Le mot « welcome » s'ecrit d'un trait, marque un temps, puis s'efface dans
 * le sens de l'ecriture avant que le splash disparaisse. Le trace, le degrade
 * et l'enchainement viennent de la maquette telle quelle : rien n'a ete
 * redessine.
 *
 * LE FOND SUIT LE THEME. La maquette le posait en sombre pour la
 * demonstration ; ici il reprend `--bg` ET `--page-wash`, exactement ce que
 * `body` applique. Sans le second, le splash serait plat la ou l'application
 * porte ses degrades, et on verrait un ressaut au moment ou il s'efface —
 * precisement le flash qu'on cherche a eviter.
 *
 * A CHAQUE connexion. La premiere version ne le jouait qu'une fois par
 * appareil, pour ne pas imposer une animation tous les matins ; a l'usage,
 * se deconnecter puis se reconnecter sans rien voir donnait l'impression que
 * la fonctionnalite etait cassee. Un clic ou Echap la saute a tout moment,
 * ce qui suffit a qui est presse.
 */

/**
 * Durees, en millisecondes. SOURCE UNIQUE : la feuille de style les recoit
 * en variables, posees ici. Elles etaient ecrites des deux cotes et auraient
 * diverge au premier reglage — les minuteurs auraient lance l'effacement
 * avant la fin du trace, ou attendu dans le vide apres.
 */
const DELAY = 150            // retard du trace, laisse le mot apparaitre d'abord
const DRAW = 1700            // ecriture
const HOLD = 100             // temps de lecture, une fois le mot fini
const ERASE = Math.round(DRAW * 0.6)   // 1020 : l'effacement est plus vif
const EXIT = 600             // fondu du splash lui-meme
const TAIL = 100             // marge avant demontage

/** Pose par la page de connexion, consomme ici. */
export const JUST_LOGGED_IN = 'justLoggedIn'
/** Ancienne memoire « deja vu », abandonnee. Nettoyee pour ne pas laisser
 *  une cle morte sur les appareils qui l'ont recue. */
const LEGACY_SHOWN = 'welcome_shown'
/** Emis par la page de connexion : la navigation apres login ne remonte pas
 *  la coquille, donc lire le drapeau au montage ne suffirait pas. */
export const LOGIN_EVENT = 'gf:login'

export default function WelcomeSplash() {
  const [playing, setPlaying] = useState(false)
  const [erasing, setErasing] = useState(false)
  const [hiding, setHiding] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clear = useCallback(() => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
  }, [])

  /** Saute a la fin : plus de trace, plus d'attente, le splash s'en va. */
  const skip = useCallback(() => {
    clear()
    setHiding(true)
    timers.current.push(setTimeout(() => setPlaying(false), EXIT))
  }, [clear])

  /**
   * Attend que l'habillage du club soit pose avant de se montrer.
   *
   * C'est le seul moment ou le probleme existe, et il est garanti : le splash
   * ne joue qu'a la PREMIERE connexion sur un appareil, donc `gf-skin` n'est
   * pas encore en memoire et `data-skin` pas encore sur <html>. Sans cette
   * attente, un club en habillage clair verrait un splash sombre virer au
   * clair — exactement le flash qu'on veut eviter.
   *
   * Plafonnee : si la coquille tarde ou echoue, on joue quand meme. Un splash
   * qui n'apparait jamais parce qu'un appel reseau traine serait pire qu'un
   * fond approximatif.
   */
  const whenThemeReady = useCallback((run: () => void) => {
    if (document.documentElement.hasAttribute('data-skin')) { run(); return }
    const observer = new MutationObserver(() => {
      if (document.documentElement.hasAttribute('data-skin')) { observer.disconnect(); run() }
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] })
    timers.current.push(setTimeout(() => { observer.disconnect(); run() }, 900))
  }, [])

  const begin = useCallback(() => {
    clear()
    setErasing(false)
    setHiding(false)
    setPlaying(true)
    // DELAY compte.
    //
    // Les minuteurs partaient a `DRAW + HOLD`, sans tenir compte du retard du
    // trace : l'effacement commencait donc 150 ms trop tot, et la pause
    // annoncee a 750 ms n'en durait que 600. Maintenant HOLD veut dire ce
    // qu'il dit — le temps entre la fin du mot et le debut de l'effacement.
    const drawn = DELAY + DRAW
    timers.current.push(setTimeout(() => setErasing(true), drawn + HOLD))
    timers.current.push(setTimeout(() => setHiding(true), drawn + HOLD + ERASE))
    // Le demontage attend la fin du fondu du splash lui-meme.
    timers.current.push(setTimeout(() => setPlaying(false), drawn + HOLD + ERASE + EXIT + TAIL))
  }, [clear])

  const start = useCallback(() => { whenThemeReady(begin) }, [whenThemeReady, begin])

  /**
   * Le drapeau est CONSOMME des sa lecture.
   *
   * C'est lui, et lui seul, qui limite la lecture a une par connexion : sans
   * cela, chaque navigation dans l'application rejouerait l'animation. Il est
   * pose au login et efface ici.
   */
  const tryPlay = useCallback(() => {
    let flagged = false
    try {
      flagged = sessionStorage.getItem(JUST_LOGGED_IN) === '1'
      if (flagged) sessionStorage.removeItem(JUST_LOGGED_IN)
      localStorage.removeItem(LEGACY_SHOWN)
    } catch {
      // Navigation privee, stockage refuse : on ne joue rien plutot que de
      // rejouer a chaque page. Un splash impossible a taire serait pire que
      // pas de splash du tout.
      return
    }
    if (flagged) start()
  }, [start])

  useEffect(() => {
    // Au montage : cas du rechargement complet apres connexion.
    tryPlay()
    // Et a l'evenement : apres un login, `router.replace` navigue sans
    // remonter la coquille — ce composant ne serait jamais remonte.
    window.addEventListener(LOGIN_EVENT, tryPlay)
    return () => window.removeEventListener(LOGIN_EVENT, tryPlay)
  }, [tryPlay])

  useEffect(() => clear, [clear])

  useEffect(() => {
    if (!playing) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') skip() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [playing, skip])

  if (!playing) return null

  return (
    <div className={`welcome-splash${hiding ? ' hide' : ''}`}
         onClick={skip}
         // La feuille de style lit ces durees : un seul endroit ou les regler.
         style={{
           '--welcome-delay': `${DELAY}ms`,
           '--welcome-draw': `${DRAW}ms`,
           '--welcome-erase': `${ERASE}ms`,
           '--welcome-exit': `${EXIT}ms`,
         } as React.CSSProperties}
         // Decoratif : rien a annoncer, et le lecteur d'ecran ne doit pas
         // s'arreter sur un mot dessine.
         aria-hidden="true">
      <div className="welcome-stage">
        <svg className="welcome-word" viewBox="0 0 1023 280">
          <defs>
            <linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#31c48d" />
              <stop offset="0.18" stopColor="#a7d129" />
              <stop offset="0.34" stopColor="#f6c026" />
              <stop offset="0.5" stopColor="#f97316" />
              <stop offset="0.64" stopColor="#ef4444" />
              <stop offset="0.78" stopColor="#ec4899" />
              <stop offset="0.9" stopColor="#c026d3" />
              <stop offset="1" stopColor="#6366f1" />
            </linearGradient>

            {/*
              La deformation du verre. Un bruit fractal deplace le trace
              pixel par pixel : c'est ce qu'on voit a travers une goutte, et
              c'est la seule facon d'obtenir une VRAIE refraction — un flou,
              meme fort, ne courbe rien, il estompe.

              Le filtre ne sert qu'a la copie enfermee dans la bulle. Le mot
              du dessous reste droit : la difference entre les deux est
              precisement ce qui donne le relief.
            */}
            <filter id="welcome-liquid" x="-25%" y="-25%" width="150%" height="150%"
                    colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.007 0.019"
                            numOctaves={2} seed={7} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={28}
                                 xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
          <path className={`welcome-path${erasing ? ' erase' : ''}`} pathLength="1"
                d={WORD} />
        </svg>

        {/*
          La bulle de verre liquide. Elle suit la pointe du stylo : meme
          duree, meme retard, meme courbe que le trace, donc elle avance avec
          l'ecriture de la premiere lettre a la derniere.

          Trois couches, et chacune fait un travail que les autres ne peuvent
          pas faire : la lentille montre les lettres deformees, le fond floute
          ce qui reste visible autour d'elles, la peau pose l'eclat et les
          franges de couleur du bord.
        */}
        <span className="welcome-blob-track">
          <span className="welcome-blob">
            <span className="welcome-lens">
              {/* Deplacement inverse exact de celui de la bulle : la copie
                  reste calee sur le mot pendant que la lentille passe
                  dessus. Sans cela, les lettres glisseraient dans la bulle. */}
              <span className="welcome-lens-shift">
                <svg className="welcome-word-copy" viewBox="0 0 1023 280">
                  <path className={`welcome-path${erasing ? ' erase' : ''}`} pathLength="1"
                        d={WORD} filter="url(#welcome-liquid)" />
                </svg>
              </span>
            </span>
          </span>
        </span>
      </div>
    </div>
  )
}

/** Le trace cursif du mot, repris tel quel de la maquette. */
const WORD = "M 68.6 154.3 C 68.6 154.3 54.2 165.7 49.5 173.3 C 44.5 181.4 41.4 193.2 40.0 201.9 C 38.9 208.8 38.5 214.8 40.0 221.0 C 41.5 227.5 44.5 236.9 49.5 240.0 C 54.2 242.9 62.4 241.5 68.6 240.0 C 75.1 238.5 81.6 234.8 87.6 230.5 C 94.4 225.6 106.6 211.4 106.7 211.4 M 125.7 154.3 C 125.7 154.3 109.0 197.3 106.7 211.4 C 105.4 219.3 104.6 225.5 106.7 230.5 C 108.4 234.6 112.0 238.3 116.2 240.0 C 121.1 242.1 129.1 241.5 135.2 240.0 C 141.8 238.5 148.3 234.8 154.3 230.5 C 161.1 225.6 168.6 219.1 173.3 211.4 C 178.3 203.3 181.3 192.5 182.9 182.9 C 184.4 173.5 181.6 154.4 182.9 154.3 C 184.3 154.1 187.8 184.3 192.4 192.4 C 195.1 197.1 197.7 200.2 201.9 201.9 C 206.9 204.0 214.8 203.4 221.0 201.9 C 227.5 200.4 240.0 192.4 240.0 192.4 M 249.5 221.0 C 249.5 220.9 263.5 215.1 268.6 211.4 C 272.6 208.5 275.2 205.9 278.1 201.9 C 281.7 196.9 286.1 189.4 287.6 182.9 C 289.1 176.7 289.7 168.8 287.6 163.8 C 285.9 159.6 281.6 155.7 278.1 154.3 C 275.2 153.1 272.2 153.4 268.6 154.3 C 263.2 155.6 254.3 159.0 249.5 163.8 C 244.8 168.6 241.7 175.6 240.0 182.9 C 238.0 191.2 238.0 203.1 240.0 211.4 C 241.7 218.6 244.8 225.7 249.5 230.5 C 254.3 235.2 262.0 238.5 268.6 240.0 C 274.8 241.5 281.4 241.5 287.6 240.0 C 294.2 238.5 301.6 234.1 306.7 230.5 C 310.7 227.6 312.7 225.2 316.2 221.0 C 321.8 214.2 328.9 201.9 335.2 192.4 C 341.6 182.9 347.4 174.6 354.3 163.8 C 363.0 150.0 376.0 128.6 382.9 116.2 C 387.1 108.5 389.4 104.3 392.4 97.1 C 395.9 88.7 400.5 77.2 401.9 68.6 C 403.0 61.7 404.0 54.5 401.9 49.5 C 400.2 45.4 396.4 40.6 392.4 40.0 C 387.3 39.2 378.1 44.8 373.3 49.5 C 368.6 54.3 366.6 60.9 363.8 68.6 C 360.0 78.9 357.1 92.1 354.3 106.7 C 350.6 125.7 346.3 151.9 344.8 173.3 C 343.4 193.1 340.4 219.8 344.8 230.5 C 346.9 235.6 350.8 238.5 354.3 240.0 C 357.2 241.2 360.2 240.9 363.8 240.0 C 369.2 238.7 377.8 234.1 382.9 230.5 C 386.9 227.6 388.9 225.2 392.4 221.0 C 397.9 214.2 411.4 192.4 411.4 192.4 M 478.1 173.3 C 478.1 173.3 479.3 166.8 478.1 163.8 C 476.6 160.3 472.7 156.0 468.6 154.3 C 463.6 152.2 455.7 152.8 449.5 154.3 C 443.0 155.8 435.5 160.2 430.5 163.8 C 426.5 166.7 423.8 169.3 421.0 173.3 C 417.3 178.4 413.0 185.8 411.4 192.4 C 410.0 198.6 410.0 205.2 411.4 211.4 C 413.0 218.0 416.2 225.7 421.0 230.5 C 425.7 235.2 432.8 238.3 440.0 240.0 C 448.4 242.0 459.4 242.8 468.6 240.0 C 478.6 237.0 489.2 228.9 497.1 221.0 C 505.1 213.0 516.2 192.4 516.2 192.4 M 573.3 154.3 C 573.3 154.3 560.5 152.8 554.3 154.3 C 547.7 155.8 540.3 160.2 535.2 163.8 C 531.2 166.7 528.6 169.3 525.7 173.3 C 522.1 178.4 517.7 185.8 516.2 192.4 C 514.7 198.6 514.7 205.2 516.2 211.4 C 517.7 218.0 521.0 225.7 525.7 230.5 C 530.5 235.2 538.2 238.5 544.8 240.0 C 550.9 241.5 557.6 241.5 563.8 240.0 C 570.3 238.5 577.8 234.1 582.9 230.5 C 586.9 227.6 589.5 225.0 592.4 221.0 C 596.0 215.9 600.4 208.4 601.9 201.9 C 603.4 195.7 603.4 189.0 601.9 182.9 C 600.4 176.3 597.1 168.6 592.4 163.8 C 587.6 159.0 578.4 153.5 573.3 154.3 C 569.3 154.9 565.5 159.6 563.8 163.8 C 561.8 168.8 562.4 176.7 563.8 182.9 C 565.4 189.4 568.6 197.1 573.3 201.9 C 578.1 206.7 585.2 209.7 592.4 211.4 C 600.7 213.4 612.6 213.4 621.0 211.4 C 628.2 209.7 635.0 205.5 640.0 201.9 C 644.0 199.0 646.0 196.6 649.5 192.4 C 655.1 185.6 661.3 170.3 668.6 163.8 C 674.3 158.7 682.6 153.5 687.6 154.3 C 691.6 154.9 695.7 160.3 697.1 163.8 C 698.4 166.8 697.7 169.1 697.1 173.3 C 696.1 181.8 691.0 199.7 687.6 211.4 C 684.6 221.7 678.1 240.0 678.1 240.0 M 687.6 211.4 C 687.6 211.4 693.2 199.2 697.1 192.4 C 702.2 183.7 708.9 170.3 716.2 163.8 C 721.9 158.7 728.7 155.8 735.2 154.3 C 741.4 152.8 749.3 152.2 754.3 154.3 C 758.4 156.0 762.4 160.3 763.8 163.8 C 765.0 166.8 764.3 169.1 763.8 173.3 C 762.8 181.8 757.7 199.7 754.3 211.4 C 751.3 221.7 744.8 240.0 744.8 240.0 M 754.3 211.4 C 754.3 211.4 759.8 199.2 763.8 192.4 C 768.9 183.7 775.5 170.3 782.9 163.8 C 788.6 158.7 795.4 155.8 801.9 154.3 C 808.1 152.8 816.0 152.2 821.0 154.3 C 825.1 156.0 828.8 159.6 830.5 163.8 C 832.5 168.8 831.6 176.0 830.5 182.9 C 829.1 191.5 822.4 202.8 821.0 211.4 C 819.8 218.3 818.9 225.5 821.0 230.5 C 822.7 234.6 827.0 238.5 830.5 240.0 C 833.4 241.2 836.4 240.9 840.0 240.0 C 845.4 238.7 854.0 234.1 859.0 230.5 C 863.1 227.6 865.1 225.2 868.6 221.0 C 874.1 214.2 887.6 192.4 887.6 192.4 M 897.1 221.0 C 897.2 220.9 911.2 215.1 916.2 211.4 C 920.2 208.5 922.8 205.9 925.7 201.9 C 929.3 196.9 933.7 189.4 935.2 182.9 C 936.7 176.7 937.3 168.8 935.2 163.8 C 933.5 159.6 929.2 155.7 925.7 154.3 C 922.8 153.1 919.8 153.4 916.2 154.3 C 910.8 155.6 901.9 159.0 897.1 163.8 C 892.4 168.6 889.3 175.6 887.6 182.9 C 885.6 191.2 885.6 203.1 887.6 211.4 C 889.3 218.6 892.4 225.7 897.1 230.5 C 901.9 235.2 909.7 238.5 916.2 240.0 C 922.4 241.5 929.1 241.5 935.2 240.0 C 941.8 238.5 949.2 234.1 954.3 230.5 C 958.3 227.6 960.3 225.2 963.8 221.0 C 969.4 214.2 982.8 192.4 982.9 192.4"
