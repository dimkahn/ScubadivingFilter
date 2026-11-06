# Scuba See Red

Correcteur de couleurs et stabilisateur pour vidéos et photos de plongée, pour téléphone et tablette (Android, iOS).
On peut exporter toute une vidéo ou un extrait, et en tirer des photos.

## Prérequis

Flutter 3.47 ou plus récent. Android 10 minimum, iOS 15 minimum.

```bash
flutter pub get
flutter run
```

## Architecture

- **Interface** : Flutter (`lib/ui`), avec une mise en page par format d'appareil dans `home_screen.dart`.
- **État** : `lib/state/app_state.dart`, seule référence pour les réglages et la liste de vidéos.
- **Moteur vidéo** : `assets/engine/engine.js` (WebGL et WebCodecs), dans une WebView sans interface
  (`lib/engine/webview_engine.dart`). Il tourne hors ligne : aucune ressource n'est chargée depuis Internet.
- **Suivi du sujet** : EdgeTAM (segmentation avec mémoire) calcule la trajectoire à l'avance, à 4 analyses par
  seconde de vidéo, pendant les pauses ou juste avant l'export. NanoTrack couvre les passages pas encore analysés.
  Les modèles se régénèrent avec `tool/edgetam_export/export.py --size 512`.
- **Serveur local** : `lib/engine/local_server.dart` sert le moteur et lit les vidéos par plages. Il écrit
  l'export directement sur le disque. Il n'écoute que sur 127.0.0.1, derrière un jeton aléatoire.
- **Natif** : galerie et veille de l'écran dans `MainActivity.kt` et `AppDelegate.swift`.

## Tests

```bash
flutter test                                # logique, serveur, écrans, gestes, cibles tactiles
node tool/engine_e2e/run.mjs /tmp/rouge-e2e # moteur réel dans Chrome (ffmpeg, dart et google-chrome requis)
flutter test --update-goldens --dart-define=SCREENSHOTS=true test/screens_test.dart  # captures dans test/goldens
```

## Publication

La fiche, les réponses aux formulaires, les visuels et la politique de confidentialité sont dans `store/`.
`tool/release/make_icons.sh` régénère les icônes depuis `branding/`.

```bash
tool/release/create_upload_key.sh   # une seule fois : crée la clé et android/key.properties, hors de git
flutter build appbundle --release   # build/app/outputs/bundle/release/app-release.aab
```

Sauvegarder la clé et son mot de passe hors de l'ordinateur. Sans `android/key.properties`, le build est signé
avec la clé de debug, utile pour essayer une version release, mais refusé par le Play Store.
L'identifiant `com.dkahn.rouge_retrouve` est à confirmer : il devient définitif à la première publication.
