#!/bin/bash
# Decoupling demo: fires N orders at once. The web tier answers instantly; SQS buffers;
# the worker ASG scales out on queue depth and SWF drains the backlog.
URL=${1:?portal url}; N=${2:-60}
for i in $(seq 1 $N); do
  curl -s -o /dev/null -X POST "$URL/orders" -d "company=LoadTest Plant $i&email=loadtest$i@megafab.test&qty_SAF-GLV-CUT5=$((RANDOM%20+1))&qty_FST-HEX-M12=2" &
  [ $((i % 15)) -eq 0 ] && wait
done; wait; echo "$N orders submitted"
