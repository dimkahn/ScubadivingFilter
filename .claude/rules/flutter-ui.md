---
paths:
  - "lib/**"
  - "test/**"
---

# Interface Flutter

- **Couleurs** : fonds, textes, bordures et accents passent par `C.xxx` (palette courante) ou `darkPalette` /
  `lightPalette`. Un `Color(0x...)` littéral n'est admis que pour une couleur qui a un sens propre, indépendant du
  thème (ex. les couleurs de profondeur dans `sheets.dart`). `C` est dynamique : jamais dans une expression `const`.
- **Exceptions voulues** : incrustations sur la vidéo (pastilles, ligne de comparaison, cadre) en noir et blanc fixes,
  et visionneuses de résultat (`result_player.dart`) toujours sombres. Elles se posent sur l'image, pas sur le thème.
- **Contraste** : toute nouvelle couleur de texte doit atteindre 4,5:1 sur `bg`, `panel` et `panel2`, dans les deux
  palettes ; `test/theme_test.dart` le vérifie, l'y ajouter.
- **Changement de thème** : `RougeApp` reconstruit tout l'arbre quand le système change de thème. Un widget qui met
  une couleur en cache (dans un `State`, un `Paint` gardé, etc.) doit la relire dans `build`.
- **Écrans** : `test/screens_test.dart` vérifie les quatre formats (téléphone, tablette, portrait, paysage), les
  débordements et la taille des cibles tactiles. Un nouvel écran ou outil y est ajouté. Les tests d'écran forcent le
  thème sombre ; le groupe « thème clair » couvre le clair.
- **Textes** : interface en français.
- **État** : la logique va dans `AppState` (testable sans interface, `test/app_state_test.dart`), pas dans les widgets.
