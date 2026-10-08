#!/usr/bin/env bash
# Signs the newest Android build published by GitHub Actions and installs it as the
# website's download (/download/android). The signing key lives only on this server.
#
# Run by vidvault-apk-sync.timer. Config (env or /etc/vidvault-apk-sync.env):
#   REPO          GitHub repo (owner/name)
#   SIGN_DIR      directory with release.jks + password (chmod 600, owned by root)
#   DOWNLOADS_DIR where vidvault.apk is served from
set -euo pipefail

REPO="${REPO:-dhdhdh51/Kiwanis}"
SIGN_DIR="${SIGN_DIR:-/etc/vidvault/signing}"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-/var/lib/vidvault/downloads}"
STATE="$SIGN_DIR/last-release-id"
APKSIGNER="$SIGN_DIR/apksigner.jar"
ALIAS="${KEY_ALIAS:-vidvault}"

log() { echo "[apk-sync] $*"; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Newest release (pre-releases included) that GitHub Actions published with an APK attached.
curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases?per_page=10" -o "$work/releases.json"
read -r rid url name sha < <(python3 - "$work/releases.json" <<'PY'
import json, re, sys
for r in json.load(open(sys.argv[1])):
    if r.get("draft") or r.get("author", {}).get("login") != "github-actions[bot]":
        continue
    for a in r.get("assets", []):
        if a["name"].endswith(".apk"):
            m = re.search(r"sha256: `([0-9a-f]{64})`", r.get("body") or "")
            print(r["id"], a["browser_download_url"], a["name"], m.group(1) if m else "-")
            sys.exit(0)
print("- - - -")
PY
)

if [ "$rid" = "-" ]; then log "no APK release found"; exit 0; fi
if [ -f "$STATE" ] && [ "$(cat "$STATE")" = "$rid" ]; then exit 0; fi

log "new build: $name (release $rid)"
curl -fsSL -o "$work/in.apk" "$url"
if [ "$sha" != "-" ]; then
  echo "$sha  $work/in.apk" | sha256sum -c --quiet || { log "checksum mismatch — refusing to sign"; exit 1; }
fi

pw=$(cat "$SIGN_DIR/password")
# Strip any existing signature so already-signed builds are re-signed with this server's key.
python3 - "$work/in.apk" "$work/clean.apk" <<'PY'
import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w") as zo:
    for i in zi.infolist():
        n = i.filename
        if n.startswith("META-INF/") and (n.endswith((".SF", ".RSA", ".DSA", ".EC")) or n == "META-INF/MANIFEST.MF"):
            continue
        zo.writestr(i, zi.read(n))
PY
# Re-align (4-byte for uncompressed entries, 16 KB for .so) then sign with v1+v2+v3 schemes.
"$SIGN_DIR/zipalign" -f -P 16 4 "$work/clean.apk" "$work/aligned.apk"
java -jar "$APKSIGNER" sign --ks "$SIGN_DIR/release.jks" --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$pw" --key-pass "pass:$pw" --out "$work/signed.apk" "$work/aligned.apk"
java -jar "$APKSIGNER" verify "$work/signed.apk" >/dev/null

install -d -o vidvault -g vidvault "$DOWNLOADS_DIR"
install -o vidvault -g vidvault -m 644 "$work/signed.apk" "$DOWNLOADS_DIR/vidvault.apk.new"
mv -f "$DOWNLOADS_DIR/vidvault.apk.new" "$DOWNLOADS_DIR/vidvault.apk"
echo "$name" > "$DOWNLOADS_DIR/vidvault.apk.version"
echo "$rid" > "$STATE"
log "installed signed ${name%-unsigned.apk}.apk ($(stat -c %s "$DOWNLOADS_DIR/vidvault.apk") bytes)"
