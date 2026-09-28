# faucet-client

This is the client side code for the PoWFaucet.

This builds:
- /static/js/powfaucet.js  (entry src/main.ts)
- /static/js/powfaucet-worker-sc.js  (entry src/worker/worker-scrypt.ts)
- /static/js/powfaucet-worker-cn.js  (entry src/worker/worker-cryptonight.ts)
- /static/js/powfaucet-worker-a2.js  (entry src/worker/worker-argon2.ts)
- /static/css/powfaucet.css  (all css imports)

# How to build

`npm install`

`node ./build-client.js`
## Runtime network configuration

The browser loads `/config.json` during splash initialization with caching disabled.
The JS bundle includes these predefined networks:

| Selector | Network | Chain ID | RPC |
| --- | --- | --- | --- |
| `stagenet` | QMS Stagenet / net1 | 424242 | https://rpc.net1.test-qms.com |
| `devnet` (default) | QMS devnet / net2 | 424243 | https://rpc.net2.test-qms.com |

Each preset also contains its explorer, DEX API, and native currency details.
The selected preset controls displayed network details and transaction explorer
links. It does not change the backend RPC or transaction settings; configure those
separately to match the selected environment.

Switch the same prebuilt Docker image at startup:

```zsh
docker run -e FAUCET_NETWORK=devnet -p 8080:8080 YOUR_IMAGE
docker run -e FAUCET_NETWORK=stagenet -p 8080:8080 YOUR_IMAGE
```

Add the variable to your existing deployment arguments and config/data mounts.
Startup writes the selector to `/app/static/config.json`. Unknown selectors stop
startup rather than showing the wrong network.

For static hosting or an existing read-only config mount, omit `FAUCET_NETWORK`
and supply the runtime file yourself:

```json
{ "network": "devnet" }
```

```zsh
docker run --mount type=bind,src="$PWD/config.json",dst=/app/static/config.json,readonly -p 8080:8080 YOUR_IMAGE
```

Reload the browser after changing the runtime file. Missing or unknown runtime
configuration prevents frontend initialization and logs the config error.
Legacy `{ "chainId": "424242" }` files still display only the chain ID.

To add the future `testnet`, add its verified values to `NETWORKS` in
`src/common/RuntimeConfig.ts` and allow `testnet` in `docker/entrypoint.sh`.
Build one updated image; runtime environment selection still needs no rebuild.
