---
name: "GymFlow"
description: "Un espace opérationnel net, rapide et sécurisé pour piloter et faire communiquer les clubs."
colors:
  primary-cobalt: "#2f6bff"
  primary-cobalt-soft: "#7ea5ff"
  canvas-night: "#080b12"
  surface-night: "#0d1220"
  ink-night: "#f5f3ef"
  muted-night: "#8c95a8"
  line-night: "rgba(255,255,255,0.09)"
  canvas-day: "#f0f4f8"
  surface-day: "#ffffff"
  ink-day: "#0f172a"
  muted-day: "#475569"
  line-day: "rgba(15,23,42,0.12)"
  positive: "#4ade80"
typography:
  headline:
    fontFamily: "Outfit, ui-sans-serif, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Outfit, ui-sans-serif, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 650
    lineHeight: 1.25
  body:
    fontFamily: "Outfit, ui-sans-serif, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Outfit, ui-sans-serif, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  compact: "8px"
  control: "10px"
  avatar: "12px"
  composer: "14px"
  panel: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary-cobalt}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "40px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.muted-night}"
    rounded: "{rounded.control}"
    size: "38px"
  input-search:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.ink-night}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  composer:
    backgroundColor: "{colors.surface-night}"
    textColor: "{colors.ink-night}"
    rounded: "{rounded.composer}"
    padding: "7px 7px 7px 13px"
    height: "58px"
  status-chip:
    backgroundColor: "{colors.primary-cobalt}"
    textColor: "#ffffff"
    rounded: "{rounded.compact}"
    padding: "3px 7px"
---

# Design System: GymFlow

## Overview

**Creative North Star: "The Adaptive Operations Hub"**

GymFlow est un environnement opérationnel dense mais calme : chaque information utile est immédiatement lisible, chaque action est située près de son contexte et les surfaces restent stables pendant que le contenu évolue. L’identité vient du cobalt rare et fonctionnel, d’une typographie géométrique chaleureuse et de panneaux plats qui s’assemblent comme un poste de travail plutôt que comme une collection de cartes.

Le système doit rester identique dans son comportement à travers les thèmes clairs et sombres. Les valeurs sémantiques du thème pilotent le contraste ; la structure, la hiérarchie et les états ne changent pas. Les références à Telegram ou WhatsApp concernent la fluidité et la familiarité des interactions, jamais leur marque ni leurs fonctions d’appel.

**Key Characteristics:**

- Surfaces pleines, calmes et clairement hiérarchisées.
- Accent cobalt réservé aux sélections, actions actives et focus.
- Densité opérationnelle avec zones tactiles généreuses.
- Adaptation responsive par repli et redistribution, pas par réduction illisible.
- Profondeur rare et fonctionnelle, jamais décorative.

## Colors

La palette associe un cobalt franc à des neutres froids, avec des couples jour/nuit qui conservent les mêmes rôles sémantiques dans tous les thèmes GymFlow.

### Primary

- **Cobalt d’action :** sélection active, action principale, focus visible et indicateur non lu.
- **Cobalt lumineux :** accent secondaire sur fond sombre et nuance de soutien, sans concurrencer l’action principale.

### Neutral

- **Nuit profonde :** sol principal des thèmes sombres et des espaces de travail continus.
- **Panneau minéral :** navigation, en-têtes, panneaux contextuels et compositeurs sombres.
- **Encre chaude :** texte principal sur surfaces sombres.
- **Brume froide :** texte secondaire, métadonnées et contrôles inactifs sombres.
- **Jour bleuté :** sol principal des thèmes clairs.
- **Papier net :** surfaces de premier plan claires.
- **Encre ardoise :** texte principal sur surfaces claires.
- **Ardoise calme :** texte secondaire et métadonnées claires.

### Named Rules

**The Cobalt Means Action Rule.** Le cobalt signale une action, une sélection, un focus ou un état vivant ; il ne remplit pas de grandes zones décoratives.

**The Semantic Theme Rule.** Un composant consomme les rôles de fond, surface, texte, atténuation et bordure du thème actif au lieu d’imposer une couleur conçue pour un seul thème.

## Typography

**Display Font:** Outfit (avec ui-sans-serif et sans-serif)
**Body Font:** Outfit (avec ui-sans-serif et sans-serif)

**Character:** Outfit donne à GymFlow une voix contemporaine, directe et légèrement humaine. La hiérarchie repose davantage sur le poids, la taille et l’espacement que sur des changements de famille.

### Hierarchy

- **Headline** (650, 1.15rem, 1.2) : titres de zones et points d’entrée principaux.
- **Title** (650, 1.08rem, 1.25) : titre de conversation, panneau ou bloc fonctionnel.
- **Body** (400, 0.88rem, 1.55) : messages et contenu courant, limités à environ 72 caractères par ligne dans les longs fils.
- **Label** (600, 0.75rem, 1.3) : filtres, contrôles, libellés de navigation et métadonnées importantes.
- **Metadata** (400–600, 0.58–0.67rem) : heures, compteurs et contexte secondaire ; toujours avec un contraste lisible.

### Named Rules

**The Read Before Decorate Rule.** Aucun libellé essentiel ne descend sous le contraste du texte secondaire du thème, même lorsqu’il s’agit d’une métadonnée.

## Layout

GymFlow utilise des espaces de travail adaptatifs en pleine surface. Les zones principales s’assemblent bord à bord avec des séparateurs d’un pixel ; les grands panneaux flottants et les bordures extérieures décoratives sont évités. La messagerie exprime cette règle par un navigateur de conversations de 320px, un contenu central flexible et un panneau contextuel de 320px ; cette composition détaillée reste documentée dans son brief de surface.

Le rythme repose principalement sur 4, 8, 12, 20 et 24px. Les actions compactes conservent néanmoins des cibles tactiles proches de 40–44px. Sous 1180px, le contexte devient un tiroir superposé ; sous 900px, les colonnes se resserrent ; sous 680px, la navigation, le fil et le contexte deviennent des vues pleine largeur successives sans perte de fonction.

**The Space Follows Intent Rule.** Quand un panneau contextuel est fermé, le contenu actif récupère immédiatement l’espace libéré.

## Elevation & Depth

Le système est plat par défaut. Les séparateurs et les différences tonales construisent l’essentiel de la profondeur ; les ombres sont réservées au compositeur, aux menus, aux modales et aux tiroirs qui passent réellement devant le contenu. Le panneau contextuel peut recevoir une ombre latérale structurelle pour matérialiser son isolation.

### Shadow Vocabulary

- **Compositeur posé** (`0 10px 28px rgba(0,0,0,.12)`) : détache légèrement la zone de saisie du fil.
- **Panneau contextuel** (`-14px 0 34px rgba(0,0,0,.14)`) : marque une frontière latérale sur grand écran.
- **Tiroir contextuel** (`-18px 0 44px rgba(0,0,0,.28)`) : indique la superposition aux formats intermédiaires et mobiles.

### Named Rules

**The Structural Shadow Rule.** Une ombre n’apparaît que lorsqu’un élément flotte, se superpose ou doit être manipulé indépendamment du plan qu’il couvre.

## Shapes

Les contrôles utilisent des angles doucement arrondis de 8 à 14px ; les panneaux structurels restent rectangulaires et continus. Les avatars et icônes emploient des carrés arrondis, tandis que le bouton d’envoi est circulaire pour rester immédiatement reconnaissable. Les bordures sont fines et sémantiques ; elles décrivent une limite ou un état plutôt qu’un encadrement décoratif.

**The Joined Panels Rule.** Les colonnes qui composent un même espace de travail partagent leurs bords ; elles ne deviennent pas des cartes flottantes indépendantes.

## Components

### Buttons

- **Shape:** contrôles compacts à angles doux (10px) ; envoi circulaire (40px).
- **Primary:** cobalt d’action avec texte blanc et hauteur de 40px.
- **Hover / Focus:** changement tonal discret ; focus visible de 2px dans la couleur d’action avec décalage de 2px.
- **Ghost:** fond transparent, texte secondaire, puis surface de survol tonale.

### Chips

- **Style:** petits indicateurs fortement lisibles ; cobalt pour les états actifs ou non lus, surface tonale pour les états neutres.
- **State:** un filtre sélectionné utilise simultanément couleur, contraste et bordure ; l’état ne dépend jamais de la couleur seule.

### Cards / Containers

- **Corner Style:** les conteneurs autonomes utilisent jusqu’à 16px ; les panneaux d’espace de travail restent joints et sans coins flottants.
- **Background:** rôle surface du thème, posé sur le rôle fond.
- **Shadow Strategy:** plat au repos ; voir la règle d’ombre structurelle.
- **Border:** séparateur sémantique d’un pixel.
- **Internal Padding:** 20 à 24px pour les zones principales, 12 à 14px pour les lignes denses.

### Inputs / Fields

- **Style:** fond du thème, bordure d’un pixel, angles de 10 à 14px et texte principal.
- **Focus:** bordure cobalt et halo fin dérivé du cobalt.
- **Error / Disabled:** l’erreur associe teinte, texte et rôle d’alerte ; l’état désactivé réduit le contraste sans masquer le contrôle.

### Navigation

La navigation est une liste dense de lignes pleine largeur. Le survol utilise une teinte légère, la sélection une surface cobalt atténuée et un trait actif d’un pixel. Les libellés restent alignés, tronqués avec ellipse si nécessaire et accompagnés de métadonnées secondaires. Sur mobile, la liste et le contenu deviennent des vues successives avec une action de retour explicite.

### Conversation Composer

Le compositeur est une barre unique légèrement surélevée, avec saisie flexible, action de pièce jointe et bouton d’envoi circulaire. La saisie reste centrée verticalement, le bouton actif devient cobalt et toutes les actions conservent une cible tactile accessible.

## Do's and Don'ts

### Do:

- **Do** utiliser les rôles sémantiques du thème pour chaque fond, texte, bordure et état.
- **Do** préserver une cible tactile de 40–44px pour les actions compactes importantes.
- **Do** redistribuer l’espace quand une navigation ou un panneau contextuel se replie.
- **Do** garder le contenu principal lisible et dominant, avec une longueur de ligne maîtrisée.
- **Do** proposer des états explicites pour chargement, vide, erreur, focus, sélection et lecture seule.

### Don't:

- **Don't** transformer un espace opérationnel en grille de cartes décoratives.
- **Don't** utiliser des dégradés, du verre dépoli ou des ombres sans fonction structurelle.
- **Don't** coder une couleur de texte claire ou sombre sans tenir compte du thème actif.
- **Don't** réduire les contrôles mobiles au point de rendre leur usage tactile incertain.
- **Don't** reprendre la marque, les appels audio ou les appels vidéo d’une messagerie grand public.
