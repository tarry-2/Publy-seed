#!/bin/bash
# 골든시드 아이콘셋 빌드: public/icon-1024.png → icns / png(192,512) / iconset
# sips + iconutil (macOS 기본). ico는 별도 스크립트(make-ico.mjs).
set -e
cd "$(dirname "$0")/.."
SRC=public/icon-1024.png
[ -f "$SRC" ] || { echo "❌ $SRC 없음 — 먼저 render-icon.mjs 실행"; exit 1; }

# PWA/웹 아이콘
sips -z 192 192 "$SRC" --out public/icon-192.png >/dev/null
sips -z 512 512 "$SRC" --out public/icon-512.png >/dev/null

# macOS icns용 iconset (모든 필요한 크기 = 16~512 @1x/@2x)
ICONSET=scripts/GoldenSeed.iconset
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
sips -z 16   16   "$SRC" --out "$ICONSET/icon_16x16.png"      >/dev/null
sips -z 32   32   "$SRC" --out "$ICONSET/icon_16x16@2x.png"   >/dev/null
sips -z 32   32   "$SRC" --out "$ICONSET/icon_32x32.png"      >/dev/null
sips -z 64   64   "$SRC" --out "$ICONSET/icon_32x32@2x.png"   >/dev/null
sips -z 128  128  "$SRC" --out "$ICONSET/icon_128x128.png"    >/dev/null
sips -z 256  256  "$SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256  256  "$SRC" --out "$ICONSET/icon_256x256.png"    >/dev/null
sips -z 512  512  "$SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512  512  "$SRC" --out "$ICONSET/icon_512x512.png"    >/dev/null
cp "$SRC"                "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o public/icon.icns
rm -rf "$ICONSET"

echo "✅ icns/png 생성 완료:"
ls -la public/icon.icns public/icon-192.png public/icon-512.png
file public/icon.icns
