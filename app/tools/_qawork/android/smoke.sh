#!/usr/bin/env bash
# Android emülatöründe açılış sınaması: APK'yı kurar, açar, WebView'in DevTools kapısını yönlendirir ve smoke.mjs'i
# çalıştırır. GitHub Actions'taki emülatör adımı çağırır (depo kökünden): bash app/tools/_qawork/android/smoke.sh <apk>
set -u
APK="${1:-$(ls apk/*.apk | head -1)}"
OUT=smoke-out
mkdir -p "$OUT"
echo "APK: $APK"
adb install -r "$APK" || exit 1
adb logcat -c || true
adb shell am start -W -n app.anatomi3d.atlas/.MainActivity || exit 1

# WebView hata ayıklama kapısı (yalnız hata ayıklama derlemesinde açıktır): webview_devtools_remote_<pid>
SOCK=""
for i in $(seq 1 40); do
  SOCK=$(adb shell cat /proc/net/unix 2>/dev/null | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
  [ -n "$SOCK" ] && break
  sleep 3
done
echo "DevTools kapısı: ${SOCK:-bulunamadı}"
if [ -z "$SOCK" ]; then
  adb logcat -d | tail -80 > "$OUT/logcat.txt"; tail -40 "$OUT/logcat.txt"; exit 1
fi
adb forward tcp:9333 "localabstract:$SOCK"

node app/tools/_qawork/android/smoke.mjs "$OUT" > "$OUT/result.json"
CODE=$?
echo "=== sonuç ==="
cat "$OUT/result.json"
echo "=== WebView ve uygulama günlüğü (son satırlar) ==="
adb logcat -d -v brief 2>/dev/null | grep -E "Capacitor|chromium|AndroidRuntime|anatomi3d" | tail -150 > "$OUT/logcat.txt" || true
tail -60 "$OUT/logcat.txt"
exit $CODE
