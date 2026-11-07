---
paths:
  - "android/**"
  - "ios/**"
  - "store/**"
  - "tool/release/**"
  - "pubspec.yaml"
---

# Publication et plateformes

- **Signature** : `android/app/build.gradle.kts` signe avec `android/key.properties` s'il existe, sinon avec la clé
  de debug, que le Play Store refuse. Avant tout envoi, vérifier `Signed by "CN=Scuba See Red"`
  (`jarsigner -verify -verbose -certs`). Ne jamais lire `key.properties` ni le `.jks`.
- **Identifiant** `com.dkahn.scubaseered` : ne plus le changer (Android `applicationId`/`namespace`, iOS
  `PRODUCT_BUNDLE_IDENTIFIER`). Le package Kotlin suit le même chemin (`kotlin/com/dkahn/scubaseered/`).
- **Version** : `versionCode` strictement croissant d'un AAB envoyé à l'autre ; le commiter avec le build qu'il
  accompagne. Pas de changement de `versionName` sans demande.
- **Permissions** : n'en ajouter aucune sans mettre à jour `store/privacy-policy.html` (section Autorisations) et le
  formulaire « Sécurité des données » de `store/fiche-play-store.md`.
- **Politique de confidentialité** : la version en ligne est la branche `gh-pages`
  (https://dimkahn.github.io/ScubadivingFilter/privacy-policy.html). Après une modification de
  `store/privacy-policy.html`, proposer de mettre `gh-pages` à jour (push : demander d'abord).
- **Fiche Play Store** : limites de Google (nom 30, description courte 80, complète 4 000 caractères) ; les vérifier
  après chaque modification de `store/fiche-play-store.md`.
- **iOS** : rien ne se compile sous Linux. Signaler qu'une modification iOS n'est pas vérifiée.
