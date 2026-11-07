---
name: release-aab
description: Prépare un AAB signé pour le Play Store - incrémente le versionCode, compile, vérifie la signature, l'identifiant et le contenu, puis commite le changement de version. À utiliser quand l'utilisateur demande de compiler, recompiler ou préparer l'AAB ou une nouvelle version pour le Play Store.
---

# Préparer un AAB pour le Play Store

```bash
cd "$CLAUDE_PROJECT_DIR"
export PATH="$HOME/Developpement/Tools/.flutter-3.47.9/bin:$PATH"
AAB=build/app/outputs/bundle/release/app-release.aab
```

## Avant

1. **Clé** : `ls android/key.properties ~/.config/scuba-see-red/upload-key.jks`. Ne jamais lire ces fichiers.
   S'ils manquent, s'arrêter : sans eux, Gradle signe avec la clé de debug, refusée par le Play Store. L'utilisateur
   crée la clé lui-même avec `tool/release/create_upload_key.sh` **dans un terminal séparé** (le préfixe `!` de
   Claude Code n'a pas de vrai terminal et le script s'arrête sans message).
2. **Arbre propre** : `git status --short` ; signaler tout changement non commité qui partirait dans l'AAB.
3. **Tests** : `flutter analyze` et `flutter test` doivent passer ; pour un changement du moteur, faire tourner
   l'agent `engine-verifier`.

## Version

Le versionCode est le nombre après `+` dans `pubspec.yaml`. Il doit dépasser celui du dernier AAB **envoyé** au
Play Store (demander si inconnu ; l'incrémenter ne coûte rien). Le `versionName` ne change que sur demande.

## Compiler et vérifier

```bash
flutter build appbundle --release
jarsigner -verify $AAB                                   # « jar verified. »
jarsigner -verify -verbose -certs $AAB | grep -m1 'Signed by'   # CN=Scuba See Red
unzip -p $AAB base/manifest/AndroidManifest.xml | grep -c com.dkahn.scubaseered   # ≥ 1
sha256sum $AAB
```

Le manifeste ne doit pas contenir `debuggable`. Si un changement récent doit être dans l'AAB, le vérifier dans
`base/assets/flutter_assets/...` (ex. `unzip -p $AAB base/assets/flutter_assets/assets/engine/engine.js | grep ...`).

## Après

- Commiter le changement de version seul : `Passe au code de version N pour le Play Store`, avec l'identité
  `ICUDROID <icudroid@gmail.com>`.
- Rapport : chemin, taille, signataire, versionCode, SHA-256, commit correspondant.
- Rappeler que l'envoi se fait par l'utilisateur dans la Play Console, et qu'une version installée par câble
  (signature différente, versionCode +2000) doit être désinstallée avant d'installer celle du Play Store.
