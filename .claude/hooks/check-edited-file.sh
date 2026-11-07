#!/usr/bin/env bash
# PostToolUse sur Edit|Write : contrôle rapide du fichier modifié.
#  - JavaScript du moteur (assets/engine/*.js, hors vendor) : node --check
#  - Dart (lib/, test/, tool/) : dart analyze sur ce fichier
# En cas d'erreur, le code de sortie 2 renvoie le message à Claude pour qu'il corrige.
set -u
input=$(cat)
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // ""' <<<"$input")
[ -n "$f" ] && [ -f "$f" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
case "$f" in "$root"/*) ;; *) exit 0 ;; esac

case "$f" in
  "$root"/assets/engine/vendor/*) exit 0 ;;
  "$root"/assets/engine/*.js|"$root"/tool/*.mjs|"$root"/tool/*/*.mjs)
    if ! out=$(node --check "$f" 2>&1); then
      printf 'Erreur de syntaxe JavaScript dans %s :\n%s\n' "${f#$root/}" "$out" >&2
      exit 2
    fi
    ;;
  "$root"/lib/*.dart|"$root"/test/*.dart|"$root"/tool/*.dart|"$root"/lib/*/*.dart|"$root"/test/*/*.dart|"$root"/tool/*/*.dart)
    dart="$HOME/Developpement/Tools/.flutter-3.47.9/bin/cache/dart-sdk/bin/dart"
    [ -x "$dart" ] || dart=$(command -v dart) || exit 0
    if ! out=$(cd "$root" && "$dart" analyze --fatal-infos "${f#$root/}" 2>&1); then
      printf 'dart analyze signale des problèmes dans %s :\n%s\n' "${f#$root/}" "$(grep -E ' (error|warning|info) ' <<<"$out" | head -20)" >&2
      exit 2
    fi
    ;;
esac
exit 0
