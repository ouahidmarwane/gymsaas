---
name: "GymFlow"
description: "Un poste de pilotage sportif chaleureux, précis et immédiatement lisible."
colors:
  action-orange: "#f05a28"
  action-orange-soft: "#ff9a73"
  canvas-cream: "#eee5dc"
  surface-cream: "#fffaf5"
  ink-day: "#211814"
  muted-day: "#6f6159"
  canvas-night: "#0e0d0c"
  surface-night: "#171412"
  ink-night: "#fff7ef"
  muted-night: "#b9aaa0"
  rail-black: "#070707"
  positive: "#18794e"
typography:
  headline:
    fontFamily: "Outfit, ui-sans-serif, sans-serif"
    fontSize: "clamp(1.7rem, 2.2vw, 2.2rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Outfit, ui-sans-serif, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 700
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
  compact: "10px"
  control: "14px"
  panel: "16px"
  shell: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action-orange}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.surface-cream}"
    textColor: "{colors.ink-day}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  navigation-active:
    backgroundColor: "{colors.action-orange}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    height: "44px"
---

# Design System: GymFlow

## Overview

**Creative North Star: "The Warm Operations Desk"**

GymFlow associe la clarté d’un tableau de gestion professionnel à une présence chaleureuse : un plan de travail crème, une navigation noire franche et un orange énergique réservé à l’action. Le mode clair est la présentation principale. Le mode nuit conserve la même hiérarchie et remplace les surfaces crème par des bruns carbone, sans réintroduire de bleu.

Le changement de luminosité est une préférence personnelle. L’habillage et la marque du club restent des données du club. Les composants consomment les rôles sémantiques de surface, texte, bordure et accent.

**Key Characteristics:**

- Plan de travail crème et surfaces ivoire en mode jour.
- Rail latéral noir dans les deux modes, avec sélection orange.
- Orange réservé aux actions, sélections, focus et compteurs vivants.
- Outfit sur l’ensemble des titres, libellés, formulaires et données.
- Contraste piloté par tokens, jamais par une couleur de texte figée.

## Colors

La palette associe des neutres chauds à un orange sportif. Les couleurs d’erreur, d’avertissement et de succès restent distinctes lorsqu’elles représentent une donnée réelle.

### Primary

- **Orange d’action :** actions principales, onglet actif, focus, navigation sélectionnée et indicateurs non lus.
- **Orange lumineux :** dégradés courts et états de survol, sans devenir un fond de page.

### Neutral

- **Crème de travail :** fond principal du mode jour.
- **Ivoire de surface :** cartes, tableaux, formulaires et panneaux du mode jour.
- **Encre espresso :** texte principal du mode jour.
- **Carbone chaud :** fond principal du mode nuit.
- **Panneau nuit :** cartes et panneaux du mode nuit.
- **Rail noir :** navigation latérale permanente dans les deux modes.

### Named Rules

**The Orange Means Action Rule.** L’orange signale une action, une sélection, un focus ou un état vivant ; il ne remplit pas arbitrairement les grandes surfaces.

**The Semantic Contrast Rule.** Un texte essentiel utilise toujours `--text` ou `--muted` du mode actif. Aucun texte noir n’est posé sur une surface nuit et aucun texte blanc sur une surface claire, sauf dans un contrôle coloré qui l’exige.

## Typography

**Display Font:** Outfit (avec ui-sans-serif et sans-serif)
**Body Font:** Outfit (avec ui-sans-serif et sans-serif)

**Character:** Outfit donne au produit une voix contemporaine et ronde, proche de la référence Figma, tout en restant lisible dans les tableaux denses.

### Hierarchy

- **Headline** (700, fluide, 1.15) : titres de page et grandes zones opérationnelles.
- **Title** (700, 1.08rem, 1.25) : cartes, panneaux et conversations.
- **Body** (400, 0.88rem, 1.55) : contenu courant, messages et descriptions.
- **Label** (600, 0.75rem, 1.3) : filtres, actions, métadonnées et navigation.

**The One Typeface Rule.** Toute l’application utilise Outfit ; Inter reste uniquement un repli technique.

## Layout

La structure existante est préservée : rail flottant repliable, barre d’actions supérieure, zone de travail centrale et panneaux contextuels. Le rail occupe 72px replié et 244px ouvert ; le contenu récupère l’espace libéré sans changer de hiérarchie. Sous 768px, le rail devient un tiroir et la barre mobile prend le relais.

Le rythme repose sur 4, 8, 12, 20 et 24px. Les contrôles importants conservent une cible d’au moins 40px. Les tableaux défilent dans leur propre zone sans provoquer de débordement horizontal.

## Elevation & Depth

Les différences tonales construisent la profondeur. Les ombres restent chaudes et diffuses en mode jour, plus profondes en mode nuit. Elles sont réservées au rail, aux menus, notifications, modales et contrôles actifs.

### Shadow Vocabulary

- **Carte posée** (`0 12px 34px rgba(78,50,33,.08)`) : panneau autonome sur le fond crème.
- **Rail flottant** (`0 24px 54px rgba(0,0,0,.26)`) : navigation indépendante du plan de travail.
- **Surface nuit** (`0 14px 36px rgba(0,0,0,.22)`) : séparation des panneaux sombres.

**The Structural Shadow Rule.** Une ombre exprime une superposition ou une manipulation ; elle n’est pas ajoutée pour décorer une surface plate.

## Shapes

Les contrôles utilisent des angles de 10 à 14px, les panneaux autonomes 16 à 28px et les petits sélecteurs peuvent devenir des pilules. Le rail et le bouton jour/nuit utilisent des silhouettes très arrondies parce qu’ils sont manipulés comme des objets persistants.

## Components

### Buttons

- **Primary:** orange, texte blanc, hauteur 40px et coins de 14px.
- **Hover / Focus:** orange plus profond au survol et anneau orange visible au clavier.
- **Ghost:** fond transparent, texte sémantique et surface tonale au survol.

### Cards / Containers

- **Background:** ivoire en mode jour, carbone en mode nuit.
- **Border:** trait chaud d’un pixel, jamais utilisé comme bande décorative.
- **Internal Padding:** 20 à 28px selon la densité du contenu.

### Inputs / Fields

- **Style:** surface du mode, texte sémantique, bordure fine et coins de 14px.
- **Focus:** bordure orange, halo court et caret orange.
- **Error / Disabled:** l’erreur associe couleur et message ; le désactivé conserve son libellé lisible.

### Navigation

Le rail est noir dans les deux modes. Les éléments inactifs restent gris chauds ; l’élément actif devient une bulle orange avec icône et libellé blancs. La transition d’ouverture et de fermeture conserve la position des destinations.

### Day / Night Toggle

Le sélecteur reprend les visuels jour et nuit de la référence Figma au ratio 369:145. Il apparaît à gauche des alertes et de l’historique, ou en contrôle flottant sur les écrans sans cette barre. Le choix est mémorisé sur l’appareil avant la première peinture.

## Do's and Don'ts

### Do:

- **Do** utiliser les tokens sémantiques pour chaque texte, surface et bordure.
- **Do** garder le rail noir et l’action orange dans les deux modes.
- **Do** vérifier ensemble les modes jour et nuit après chaque nouveau composant.
- **Do** conserver la géométrie et la logique métier lors d’un changement de thème.

### Don't:

- **Don't** réintroduire du bleu comme couleur d’action générale.
- **Don't** coder du noir ou du blanc pour un texte dépendant du mode.
- **Don't** transformer le mode jour/nuit en réglage collectif du club.
- **Don't** déplacer des actions ou changer les permissions pour satisfaire une référence visuelle.
