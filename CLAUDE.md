# Scuba See Red

Application Flutter (Android, iOS) qui corrige les couleurs et stabilise les vidéos et photos de plongée,
entièrement sur l'appareil. Éditeur : ICUDROID. Identifiant : `com.dkahn.scubaseered` (définitif depuis le Play Store).
Vue d'ensemble, prérequis et publication : @README.md

## Langue

Tout est en français : interface, commentaires, messages de commit, réponses à l'utilisateur.
Le nom du paquet Dart reste `rouge_retrouve` (imports `package:rouge_retrouve/...`) et le canal natif
`rouge_retrouve/device` : noms internes, ne pas les renommer.

## Outils (hors PATH)

```bash
export PATH="$HOME/Developpement/Tools/.flutter-3.47.9/bin:$HOME/Developpement/Tools/.flutter-3.47.9/bin/cache/dart-sdk/bin:$PATH"
ADB=~/Developpement/Tools/Android/Sdk/platform-tools/adb
```

## Vérifier un changement

| Quoi | Commande | Attendu |
|---|---|---|
| Analyse | `flutter analyze` | aucun problème |
| Tests unitaires et écrans | `flutter test` | tout passe |
| Moteur vidéo réel (Chrome, ffmpeg) | `node tool/engine_e2e/run.mjs <dossier vide du scratchpad>` | un seul échec connu : « suivi : le sujet est suivi pendant son déplacement » (NanoTrack en lecture, instable) |
| Captures d'écran | `flutter test --update-goldens --dart-define=SCREENSHOTS=true test/screens_test.dart` | régénère `test/goldens/` |

Toute modification de `assets/engine/engine.js` passe par le test de bout en bout, pas seulement par `flutter test`.
Ne jamais affaiblir un contrôle pour le faire passer : signaler l'échec.

## Architecture en bref

- `lib/state/app_state.dart` : état et file de vidéos ; parle au moteur par messages JSON (`engine.send`).
- `assets/engine/engine.js` : moteur dans une WebView (WebGL, WebCodecs, mp4box, mp4-muxer), servi par
  `lib/engine/local_server.dart` sur 127.0.0.1 avec jeton. Seule raison de la permission `INTERNET`.
- Suivi du sujet : EdgeTAM en ONNX (`assets/engine/vendor/`, 512 px, ONNX Runtime Web en worker), NanoTrack en repli.
  Reconversion des modèles : `tool/edgetam_export/`.
- `lib/theme.dart` : palettes claire et sombre ; `C` lit la palette courante (voir `.claude/rules/flutter-ui.md`).

## Règles absolues

- **Clé de signature** : `android/key.properties` et `~/.config/scuba-see-red/upload-key.jks` ne sont jamais lus,
  copiés ni affichés (un hook le bloque). Le mot de passe passe uniquement par le terminal de l'utilisateur
  (`tool/release/create_upload_key.sh`, à lancer hors de Claude Code : le préfixe `!` n'a pas de vrai terminal).
- **Confidentialité** : aucune donnée ne quitte l'appareil. Pas de SDK d'analyse, de publicité ou de rapport de plantage,
  pas d'adresse externe dans `lib/` ou le moteur. Toute évolution sur ce point impose de mettre à jour
  `store/privacy-policy.html` et la section « Sécurité des données » de `store/fiche-play-store.md`.
- **Identité git publique** : le dépôt `dimkahn/ScubadivingFilter` est public. Les commits portent
  `ICUDROID <icudroid@gmail.com>` ; ne jamais publier l'adresse personnelle de l'utilisateur.
- **Actions extérieures** (push, publication, Play Console, désinstallation sur le téléphone) : demander d'abord.
- **Versions** : chaque AAB envoyé au Play Store a un `versionCode` (après le `+` dans `pubspec.yaml`) plus grand que le
  précédent. L'APK `--split-per-abi` arm64 ajoute 2000 au code.

## Téléphone de test

Xiaomi 23078PND5G, Android 16, arm64. Installation : `flutter build apk --release --split-per-abi --target-platform android-arm64`
puis `adb install -r`. Détails et pièges : compétence `install-phone`.
