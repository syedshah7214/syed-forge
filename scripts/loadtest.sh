#!/bin/bash
# Auto Scaling demo: drives CPU on the web tier so the ASG scales OUT, then stops so it scales IN.
#   ./scripts/loadtest.sh http://<portal-url> [minutes]
URL=${1:?portal url}; MIN=${2:-6}
END=$(( $(date +%s) + MIN*60 ))
echo "Generating load on $URL for $MIN minutes (watch: EB console > Health, or /ops)"
while [ "$(date +%s)" -lt "$END" ]; do
  for i in $(seq 1 24); do curl -s -o /dev/null "$URL/api/burn?s=15" & done
  wait
  curl -s "$URL/api/whoami"; echo
done
echo "Load stopped - the ASG will scale back in after the low-CPU alarm (~5-10 min)."
