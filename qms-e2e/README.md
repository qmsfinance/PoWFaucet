# qms-e2e

Rehearsal of the faucet's payout queue under the failure that stalled net3 on 2026-11-27:
in-flight payouts lost from the pool while the RPC is unreachable. Run it before moving `qms`
to a new upstream base, with the image being shipped and the one it replaces.

Needs docker. anvil mines only on request, so the pool and the nonce are under the script's control.

| Command | Exits 0 (prints PASS) when |
|---|---|
| `./run.sh <image> fresh` | chain nonce 5 and each of the 5 recipients holds exactly one drop |
| `./swap.sh <old-image> <new-image>` | the new image pays the 5 claims the old one left pending, each once |

A fault that could not be injected exits 1 too: a pass needs the fault to have happened.
The faucet reads `e2e-config.yaml`; the repo's `.gitignore` ignores `faucet-config.yaml`.

A control run with the image being replaced is what shows the check can fail: on
`6b2d668f2f` both end with payouts unpaid. `docker compose down -v` cleans up.
