#!/usr/bin/env bash
# Creates the VAPID key pair that signs phone notifications (5.15, S35) and turns them on for the live site.
# Needs `az login` and `npm install` in api/. The private key is never printed or written to disk.
#
# Replacing the keys stops every phone's notifications until each person turns them on again, because a phone's
# subscription is tied to the public key it was made with. So an existing pair is kept unless --replace is given.
set -euo pipefail
cd "$(dirname "$0")/.."

app=familyplanner
existing="$(az staticwebapp appsettings list -n "$app" --query "properties.VAPID_PUBLIC_KEY" -o tsv 2>/dev/null || true)"
if [[ -n "$existing" && "${1:-}" != "--replace" ]]; then
  echo 'Notification keys are already set. Run with --replace to make new ones, which turns notifications off on every phone.' >&2
  exit 1
fi

# The contact push services are given. Apple refuses localhost and example addresses, so it is the site itself.
host="$(az staticwebapp show -n "$app" --query "customDomains[0]" -o tsv 2>/dev/null || true)"
[[ -z "$host" || "$host" == "None" ]] && host="$(az staticwebapp show -n "$app" --query defaultHostname -o tsv)"

keys="$(node -e 'const k = require("./api/node_modules/web-push").generateVAPIDKeys(); process.stdout.write(k.publicKey + " " + k.privateKey)')"
public="${keys% *}"
private="${keys#* }"

az staticwebapp appsettings set -n "$app" -o none --setting-names \
  "VAPID_PUBLIC_KEY=$public" "VAPID_PRIVATE_KEY=$private" "VAPID_SUBJECT=https://$host"
echo "Notification keys saved to the app settings of https://$host. Each person can now turn notifications on from the account menu."
