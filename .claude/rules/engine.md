---
paths:
  - "assets/engine/**"
  - "tool/engine_e2e/**"
---

# Moteur vidéo (assets/engine/engine.js)

- **Shader et JavaScript en miroir.** La correction des couleurs existe deux fois : dans le shader `FS` et dans
  `computeHist()` (histogramme corrigé). Les fonctions `lampWeight` et `litColor` reprennent aussi le shader.
  Toute modification de l'un se reporte dans l'autre.
- **Nouveau paramètre du shader** : déclarer l'uniforme dans `FS`, l'ajouter à la liste `U`, le transmettre dans
  `render()` (`gl.uniform*`), et l'initialiser dans `P` s'il est lissé par `blend()`. Un uniforme oublié vaut 0 :
  bug déjà rencontré (sujet devenu noir).
- **Réglages** : les valeurs par défaut de `S` doivent rester égales à celles de `lib/model/settings.dart`
  (`SliderSpec`), qui font référence. Un nouveau curseur s'ajoute des deux côtés, et aux préréglages `WaterPreset`.
- **Statistiques de couleur** : ne pas exclure de pixels de `analyze()` sans vérifier sur une vraie image ; retirer
  les zones éclairées des statistiques a déjà fait virer l'eau au violet (le gain du rouge s'emballe).
- **Débit d'export** : `exportBitrate()` sert à la conversion rapide (WebCodecs) et au repli `MediaRecorder` ;
  garder les deux chemins alignés.
- **Aucune ressource externe** : la CSP du moteur limite tout à l'application. Les bibliothèques sont dans `vendor/`,
  avec leur licence dans `vendor/THIRD_PARTY.md`.
- **Mesurer avant d'affirmer.** Pour un changement visuel, comparer avant/après sur de vraies images
  (`tool/engine_e2e/serve.dart` + Chrome headless, comme `run.mjs`) et regarder les images, pas seulement les chiffres.
- **Vérification** : `node tool/engine_e2e/run.mjs <dossier vide>` ; ajouter un contrôle dans `run.mjs` pour toute
  nouvelle fonction du moteur.
