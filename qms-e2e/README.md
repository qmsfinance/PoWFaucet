# qms-e2e

Rehearsal of the faucet's payout queue under the failure that stalled net3 on 2026-11-27:
in-flight payouts lost from the pool while the RPC is unreachable. Run it before moving `qms`
to a new upstream base, with the image being shipped and the one it replaces.

Needs docker. anvil mines only on request, so the pool and the nonce are under the script's control.

| Command | Passes when |
|---|---|
| `./run.sh <image> fresh` | chain nonce 5, recipients paid 5/5, queue all `confirmed` |
| `./swap.sh <old-image> <new-image>` | the new image pays the 5 claims the old one left pending, each once |

A control run with the image being replaced is what shows the check can fail: on
`6b2d668f2f` both end with payouts unpaid. `docker compose down -v` cleans up.
