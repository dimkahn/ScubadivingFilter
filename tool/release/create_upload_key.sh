#!/usr/bin/env bash
# Crée la clé d'envoi sur le Play Store et android/key.properties, qui reste hors de git.
# Usage : tool/release/create_upload_key.sh [chemin de la clé]
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
store="${1:-$HOME/.config/scuba-see-red/upload-key.jks}"
props="$root/android/key.properties"

# Une clé existante ne s'écrase jamais : la remplacer impose une procédure auprès de Google.
for f in "$store" "$props"; do
  if [ -e "$f" ]; then
    echo "Déjà présent, rien n'a été modifié : $f" >&2
    exit 1
  fi
done

read -rsp "Mot de passe de la clé (12 caractères ou plus) : " pw; echo
read -rsp "Confirmation : " pw2; echo
if [ "$pw" != "$pw2" ]; then echo "Les mots de passe diffèrent." >&2; exit 1; fi
if [ "${#pw}" -lt 12 ]; then echo "Mot de passe trop court." >&2; exit 1; fi

umask 077
mkdir -p "$(dirname "$store")"
# Le mot de passe passe par l'environnement : il n'apparaît ni dans la liste des processus ni dans l'historique.
KEY_PW="$pw" keytool -genkeypair -v -storetype PKCS12 -keystore "$store" -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Scuba See Red" \
  -storepass:env KEY_PW -keypass:env KEY_PW

{
  printf 'storeFile=%s\n' "$store"
  printf 'storePassword=%s\n' "$pw"
  printf 'keyAlias=upload\n'
  printf 'keyPassword=%s\n' "$pw"
} > "$props"

echo
echo "Clé créée : $store"
echo "Configuration : $props"
echo "Sauvegardez la clé et son mot de passe hors de cet ordinateur, par exemple dans un gestionnaire de mots de passe."
