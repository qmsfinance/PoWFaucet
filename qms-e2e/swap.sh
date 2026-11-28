#!/usr/bin/env bash
# Image swap mid-stall: OLD signs and leaves pending claims, every tx is lost from the pool,
# then NEW starts on the same DB (schema migration included) and must pay them all.
set -uo pipefail
cd "$(dirname "$0")"
OLD="$1"; NEW="$2"
API=http://localhost:18080/api
FAUCET=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
dc() { FAUCET_IMAGE="${IMG:-$OLD}" docker compose "$@"; }
cast_() { dc exec -T anvil cast "$@" --rpc-url http://localhost:8545 < /dev/null; }
pending() { # the pool's pending count; exits the run if the RPC gave no number
  local h; h=$(cast_ rpc txpool_status | jq -r .pending 2> /dev/null)
  [[ "$h" =~ ^0x[0-9a-fA-F]+$ ]] || { echo "FAIL: txpool_status unreadable: '$h'"; exit 1; }
  printf '%d' "$h"
}
up() { IMG="$1" dc up -d --force-recreate faucet > /dev/null 2>&1; for _ in $(seq 60); do curl -sf $API/getFaucetConfig > /dev/null && return; sleep 2; done; echo "faucet $1 did not come up"; exit 1; }
dc down -v > /dev/null 2>&1; dc up -d anvil proxy mysql > /dev/null 2>&1
up "$OLD"
: > addrs.txt
for i in 1 2 3 4 5; do
  addr=$(printf '0x%040x' $((0xe2e100 + i))); echo "$addr" >> addrs.txt
  sid=$(curl -s -X POST -H 'content-type: application/json' -d "{\"addr\":\"$addr\"}" $API/startSession | jq -r .session)
  sleep 2
  curl -s -X POST -H 'content-type: application/json' -d "{\"session\":\"$sid\"}" $API/claimReward > /dev/null
done
sleep 8
echo "OLD signed: pool $(cast_ rpc txpool_status | jq -c .), queue $(curl -s $API/getQueueStatus | jq -c '[.claims[].status]|group_by(.)|map({(.[0]):length})|add')"
IMG="$OLD" dc stop faucet > /dev/null 2>&1
n=$(pending) || exit 1; [ "$n" -ge 3 ] || { echo "FAIL: OLD left nothing in the pool to lose"; exit 1; }
cast_ rpc anvil_dropAllTransactions > /dev/null || { echo "FAIL: could not drop the pool"; exit 1; }
n=$(pending) || exit 1; [ "$n" = 0 ] || { echo "FAIL: the pool still holds transactions after the drop"; exit 1; }
[ "$(cast_ nonce $FAUCET)" = 0 ] || { echo "FAIL: payouts were mined before the swap, nothing left to recover"; exit 1; }
echo "all txs dropped: pool $(cast_ rpc txpool_status | jq -c .), chain nonce $(cast_ nonce $FAUCET)"
dc exec -T mysql mysql -ufaucet -pfaucetpw faucet -N -e "select Status, JSON_EXTRACT(ClaimData,'$.claimStatus') s, count(*) from Sessions group by 1,2" 2>/dev/null < /dev/null
up "$NEW"; echo "NEW up on the same DB"
for t in $(seq 1 30); do cast_ rpc evm_mine > /dev/null; sleep 3; done
echo "== chain nonce $(cast_ nonce $FAUCET) (5 = all paid)"
paid=0; while read -r a; do [ "$(cast_ balance "$a")" = 10000000000000000000 ] && paid=$((paid+1)); done < addrs.txt; echo "recipients paid exactly once: $paid/5"
dc exec -T mysql mysql -ufaucet -pfaucetpw faucet -N -e "select Status, JSON_EXTRACT(ClaimData,'$.claimStatus'), JSON_EXTRACT(ClaimData,'$.txNonce') from Sessions order by TargetAddr; select * from SchemaVersion" 2>/dev/null < /dev/null
IMG="$NEW" dc logs faucet 2>&1 | grep -E 'WARN|ERROR|re-?send|unknown|giving|Schema|upgrade' | grep -v nginx | sed -E 's/^faucet-[^|]*\| //' | cut -c1-170 | tail -6
[ "$(cast_ nonce $FAUCET)" = 5 ] && [ "$paid" = 5 ] || { echo "FAIL"; exit 1; }
echo "PASS"
