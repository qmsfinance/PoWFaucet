#!/usr/bin/env bash
# One arm of the net3 stall rehearsal against FAUCET_IMAGE.
#   run.sh <image> fresh      new DB, 5 claims, lowest in-flight tx dropped + RPC down 25 s, then mining
#   run.sh <image> resume     same DB and chain, just start this image and keep mining (image swap)
set -uo pipefail
cd "$(dirname "$0")"
export FAUCET_IMAGE="$1"
MODE="${2:-fresh}"
API=http://localhost:18080/api
FAUCET=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
dc() { docker compose "$@"; }
cast_() { dc exec -T anvil cast "$@" --rpc-url http://localhost:8545 < /dev/null; }
nonce() { cast_ nonce "$FAUCET" 2>/dev/null; }
pool() { local j; j=$(cast_ rpc txpool_status 2>/dev/null); printf 'pending=%d queued=%d' "$(jq -r .pending <<< "$j")" "$(jq -r .queued <<< "$j")"; }
pending() { printf '%d' "$(cast_ rpc txpool_status 2>/dev/null | jq -r .pending)"; }

if [ "$MODE" = fresh ]; then
  dc down -v > /dev/null 2>&1
  dc up -d anvil proxy mysql > /dev/null 2>&1
fi
dc up -d --force-recreate faucet > /dev/null 2>&1
for _ in $(seq 60); do curl -sf $API/getFaucetConfig > /dev/null && break; sleep 2; done
curl -sf $API/getFaucetConfig > /dev/null || { echo "faucet did not come up"; dc logs faucet | tail -20; exit 1; }
echo "== $FAUCET_IMAGE $MODE: faucet up, chain nonce $(nonce)"

if [ "$MODE" = fresh ]; then
  : > addrs.txt
  for i in 1 2 3 4 5; do
    addr=$(printf '0x%040x' $((0xe2e000 + i)))
    echo "$addr" >> addrs.txt
    s=$(curl -s -X POST -H 'content-type: application/json' -d "{\"addr\":\"$addr\"}" $API/startSession)
    sid=$(jq -r '.session' <<< "$s"); st=$(jq -r '.status' <<< "$s")
    sleep 2 # the session row is written asynchronously; a claim right after the start finds no session
    c=$(curl -s -X POST -H 'content-type: application/json' -d "{\"session\":\"$sid\"}" $API/claimReward)
    echo "claim $i: session $st, claim $(jq -r '.status // .error // .' <<< "$c" | head -c 80)"
  done
  for _ in $(seq 30); do [ "$(pending)" -ge 3 ] && break; sleep 1; done
  echo "pool before the fault: $(pool)  (window ethMaxPending=3)"
  low=$(cast_ rpc txpool_content | jq -r --arg f "$(tr A-F a-f <<< $FAUCET)" '.pending | to_entries[] | select((.key|ascii_downcase)==$f) | .value | to_entries | min_by(.key|tonumber) | .value.hash')
  cast_ rpc anvil_dropTransaction "$low" > /dev/null && echo "dropped lowest in-flight tx $low"
  echo "pool after drop: $(pool)"
  dc stop proxy > /dev/null 2>&1; echo "RPC down"; sleep 25; dc start proxy > /dev/null 2>&1; echo "RPC back"
fi

for t in $(seq 1 45); do
  cast_ rpc evm_mine > /dev/null 2>&1
  sleep 3
  [ $((t % 9)) = 0 ] && echo "t=$((t*3))s chain nonce $(nonce) pool $(pool)"
done
echo "== result: chain nonce $(nonce) (5 = every claim paid)"
paid=0; while read -r a; do b=$(cast_ balance "$a"); [ "$b" != 0 ] && paid=$((paid+1)); done < addrs.txt
echo "recipients paid: $paid/5"
curl -s $API/getQueueStatus | jq -c '[.claims[].status] | group_by(.) | map({(.[0]): length}) | add'
dc logs faucet 2>&1 | grep -E 'WARN|ERROR|dropped|unknown|re-send|resend|giving' | grep -v nginx | sed -E 's/^faucet-[^|]*\| //' | cut -c1-170 | tail -8
dc exec -T mysql mysql -ufaucet -pfaucetpw faucet -N -e "select Status, JSON_EXTRACT(ClaimData,'$.claimStatus'), JSON_EXTRACT(ClaimData,'$.txNonce'), TargetAddr from Sessions order by TargetAddr" 2>/dev/null < /dev/null
