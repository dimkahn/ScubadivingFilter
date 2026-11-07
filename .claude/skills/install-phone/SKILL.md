---
name: install-phone
description: Compile l'APK release arm64 et l'installe sur le téléphone Android de test par USB (adb), en gérant les pièges Xiaomi. À utiliser quand l'utilisateur demande d'installer, réinstaller ou mettre à jour l'application sur son téléphone.
---

# Installer Scuba See Red sur le téléphone de test

Téléphone : Xiaomi 23078PND5G, Android 16, arm64.

```bash
cd "$CLAUDE_PROJECT_DIR"
export PATH="$HOME/Developpement/Tools/.flutter-3.47.9/bin:$PATH"
ADB=~/Developpement/Tools/Android/Sdk/platform-tools/adb
APK=build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
```

## Étapes

1. **Compiler** : `flutter build apk --release --split-per-abi --target-platform android-arm64`
   (le split arm64 ajoute 2000 au versionCode : un APK universel serait refusé comme rétrogradation).
2. **Vérifier la signature** :
   `"$(ls -d ~/Developpement/Tools/Android/Sdk/build-tools/*/apksigner | sort -V | tail -1)" verify --print-certs $APK`
   → `CN=Scuba See Red` si `android/key.properties` existe, sinon clé de debug.
3. **Trouver le téléphone** : `$ADB devices -l`. S'il manque alors que `lsusb | grep -i xiaomi` le voit, redémarrer
   le service (`$ADB kill-server; $ADB start-server`, attendre quelques secondes). S'il est absent de `lsusb` :
   demander de rebrancher (autre câble ou port, mode Transfert de fichiers, débogage USB autorisé).
4. **Installer** : `$ADB install -r $APK`, puis confirmer avec
   `$ADB shell dumpsys package com.dkahn.scubaseered | grep -E 'versionCode|lastUpdateTime'`.

## Pièges connus

- `INSTALL_FAILED_USER_RESTRICTED` : Xiaomi demande de valider l'installation sur l'écran du téléphone. Demander à
  l'utilisateur de déverrouiller, d'activer **Installer via USB** (Options pour les développeurs) et de toucher
  **Installer** ; puis réessayer. Ne pas contourner. En dernier recours : `adb push` de l'APK dans `/sdcard/Download/`
  pour une installation manuelle, puis supprimer la copie une fois l'application installée.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (signature différente, ex. debug → clé d'envoi, ou version du Play Store) :
  il faut désinstaller, ce qui **efface les données locales de l'application**. Demander l'accord avant
  `$ADB uninstall com.dkahn.scubaseered`.
- `INSTALL_FAILED_VERSION_DOWNGRADE` : versionCode installé plus grand ; ne pas désinstaller sans accord, recompiler
  en split arm64.
- `adb shell input` est refusé (INJECT_EVENTS) tant que « Débogage USB (paramètres de sécurité) » est désactivé.

## Compte rendu

Dire ce qui est installé (commit, versionCode, signature), ce qui a échoué et pourquoi, et rappeler que l'application
n'a pas été lancée si c'est le cas.
