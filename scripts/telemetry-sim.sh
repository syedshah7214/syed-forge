#!/bin/bash
# Simulates factory-floor machines posting telemetry. One machine overheats -> SNS maintenance alert.
URL=${1:?portal url}
for m in CNC-LATHE-01 CNC-MILL-02 PRESS-BRAKE-03 WELD-ROBOT-04 COMPRESSOR-05; do
  T=$((55 + RANDOM % 25)); H=$((1000 + RANDOM % 9000)); F=""
  [ "$m" = "COMPRESSOR-05" ] && T=97 && F="E-OVHT"
  curl -s -X POST "$URL/api/telemetry" -H 'Content-Type: application/json' \
    -d "{\"machine_id\":\"$m\",\"temperature\":$T,\"run_hours\":$H,\"fault_code\":\"$F\"}"; echo " $m"
done
