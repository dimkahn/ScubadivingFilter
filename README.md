# Rouge Retrouvé

Correcteur de couleurs et stabilisateur pour vidéos de plongée, pour téléphone et tablette (Android, iOS).

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
- **Serveur local** : `lib/engine/local_server.dart` sert le moteur et lit les vidéos par plages. Il écrit
  l'export directement sur le disque. Il n'écoute que sur 127.0.0.1, derrière un jeton aléatoire.
- **Natif** : galerie et veille de l'écran dans `MainActivity.kt` et `AppDelegate.swift`.

## Tests

```bash
flutter test                                # logique, serveur, écrans, gestes, cibles tactiles
node tool/engine_e2e/run.mjs /tmp/rouge-e2e # moteur réel dans Chrome (ffmpeg, dart et google-chrome requis)
flutter test --update-goldens --dart-define=SCREENSHOTS=true test/screens_test.dart  # captures dans test/goldens
```

## Avant une publication

Remplacer l'icône par défaut et configurer une clé de signature. L'identifiant `com.dkahn.rouge_retrouve`
est à confirmer.
