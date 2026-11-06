#!/usr/bin/env bash
# Génère les icônes Android et iOS et les visuels du Play Store depuis branding/. Exige inkscape et magick.
# Usage : tool/release/make_icons.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
src=branding/logo-mark.svg
render() { inkscape "$1" -w "$3" -h "$4" -o "$2" >/dev/null 2>&1; }

# Sans les coins arrondis : Android, iOS et le Play Store appliquent leur propre masque.
sed 's| clip-path="url(#tile)"||' "$src" > "$tmp/square.svg"
render "$tmp/square.svg" "$tmp/square.png" 1024 1024

# Premier plan adaptatif : sans le fond, réduit pour que la tête et la sangle du masque tiennent dans la zone sûre de 66 dp.
python3 - "$src" "$tmp/fg.svg" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = s.replace('<rect width="1024" height="1024" fill="url(#water)"/>', '')
s = s.replace('<g clip-path="url(#tile)">', '<g transform="translate(102.4 102.4) scale(.8)">')
open(sys.argv[2], 'w').write(s)
PY
render "$tmp/fg.svg" "$tmp/fg.png" 1024 1024

res=android/app/src/main/res
for pair in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read -r d legacy fg <<<"$pair"
  render "$src" "$res/mipmap-$d/ic_launcher.png" "$legacy" "$legacy"
  magick "$tmp/fg.png" -filter Lanczos -resize "${fg}x${fg}" "PNG32:$res/mipmap-$d/ic_launcher_foreground.png"
done
mkdir -p "$res/mipmap-anydpi-v26"
cat > "$res/mipmap-anydpi-v26/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
XML
cat > "$res/drawable/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:angle="270" android:startColor="#1590AE" android:centerColor="#0B5E82"
        android:centerY="0.55" android:endColor="#07344F" android:type="linear"/>
</shape>
XML

# iOS : carré et sans transparence, tailles lues dans le nom des fichiers.
python3 - "$tmp/square.png" <<'PY'
import glob, re, subprocess, sys
for f in glob.glob('ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-*.png'):
    m = re.search(r'-([\d.]+)x[\d.]+@(\d)x', f)
    px = round(float(m[1]) * int(m[2]))
    subprocess.check_call(['magick', sys.argv[1], '-filter', 'Lanczos', '-resize', f'{px}x{px}',
                           '-background', '#0B5E82', '-alpha', 'remove', '-alpha', 'off', f])
PY

# Play Store : icône 512×512 et bannière 1024×500.
mkdir -p store
magick "$tmp/square.png" -filter Lanczos -resize 512x512 -alpha off store/icon-512.png
render branding/logo-horizontal-on-dark.svg "$tmp/logo.png" 720 0 2>/dev/null || inkscape branding/logo-horizontal-on-dark.svg -w 720 -o "$tmp/logo.png" >/dev/null 2>&1
magick -size 1024x500 gradient:'#0B5E82'-'#07344F' "$tmp/logo.png" -gravity center -composite -alpha off store/feature-graphic.png
