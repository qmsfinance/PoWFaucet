#!/bin/bash
set -e

if [ -n "$FAUCET_NETWORK" ] || [ -n "$REQUEST_AMOUNT" ] || [ -n "$REQUEST_CIRCLE" ]; then
  node -e '
    const fs = require("fs");
    const path = "/app/static/config.json";
    const config = JSON.parse(fs.readFileSync(path, "utf8"));
    if (process.env.FAUCET_NETWORK) {
      if (!["devnet", "stagenet", "testnet"].includes(process.env.FAUCET_NETWORK))
        throw new Error("Unsupported FAUCET_NETWORK (expected devnet, stagenet or testnet)");
      config.network = process.env.FAUCET_NETWORK;
    }
    for (const [env, key] of [["REQUEST_AMOUNT", "requestAmount"], ["REQUEST_CIRCLE", "requestCircle"]]) {
      if (!process.env[env]) continue;
      const value = Number(process.env[env]);
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(env + " must be a positive integer");
      config[key] = value;
    }
    fs.writeFileSync(path, JSON.stringify(config) + "\n");
  '
fi

if [ -z "$DISABLE_NGINX" ]; then
  # Enable nginx access log to stdout if requested
  if [ "$FAUCET_NGINX_LOG" = "1" ]; then
    sed -i 's/access_log off/access_log \/dev\/stdout/' /etc/nginx/conf.d/default.conf
  fi

  # Override server port and proxy offset for internal nginx proxy
  export FAUCET_SERVER_PORT=8082
  export FAUCET_HTTP_PROXY_OFFSET=1

  # Start nginx in background
  nginx -g 'daemon off;' &
  NGINX_PID=$!
fi

# Forward signals to child processes for graceful shutdown
trap 'kill $NODE_PID ${NGINX_PID:-} 2>/dev/null; wait; exit' SIGTERM SIGINT

# Start the Node.js backend in foreground
node --no-deprecation /app/bundle/powfaucet.cjs "$@" &
NODE_PID=$!
wait $NODE_PID
EXIT_CODE=$?

# Kill nginx when node exits (if running)
kill ${NGINX_PID:-} 2>/dev/null
wait 2>/dev/null
exit $EXIT_CODE
