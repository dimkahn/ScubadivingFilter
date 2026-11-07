#!/usr/bin/env bash
# PreToolUse : la clé d'envoi Play Store et son mot de passe ne passent jamais par Claude.
# Bloque Read/Edit/Write sur android/key.properties et les fichiers .jks/.keystore/.p12, et les
# commandes shell qui liraient, copieraient ou modifieraient ces fichiers. Vérifier leur
# existence (ls, test, stat, git check-ignore) reste permis.
set -u
input=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$input")
sensitive='(key\.properties|\.jks\b|\.keystore\b|\.p12\b|upload-key)'

deny() {
  echo "Bloqué par .claude/hooks/protect-signing-key.sh : $1. La clé de signature et son mot de passe restent hors de portée de Claude ; l'utilisateur lance lui-même tool/release/create_upload_key.sh dans son propre terminal." >&2
  exit 2
}

case "$tool" in
  Read|Edit|Write|MultiEdit|NotebookEdit)
    path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$input")
    if grep -qiE "$sensitive" <<<"$path"; then deny "accès à $path"; fi
    ;;
  Bash)
    cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
    if grep -qiE "$sensitive" <<<"$cmd"; then
      # Toute commande qui peut lire, copier, déplacer, supprimer ou écrire.
      if grep -qiE '(^|[;&|`( ]|\$\()(cat|less|more|head|tail|grep|rg|sed|awk|cut|sort|cp|mv|rm|scp|rsync|base64|xxd|od|hexdump|strings|python[0-9]*|node|perl|ruby|keytool|tee|source|vi|vim|nano|dd|tar|zip|curl|wget)\b' <<<"$cmd" \
        || grep -qiE "[<>][[:space:]]*['\"]?[^[:space:];&|]*$sensitive" <<<"$cmd"; then
        deny "commande touchant un fichier de clé"
      fi
    fi
    ;;
esac
exit 0
