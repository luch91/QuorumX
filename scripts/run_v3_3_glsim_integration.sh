#!/bin/sh
set -eu

PIP_DEFAULT_TIMEOUT=120 python -m pip install -q --retries 3 'genlayer-test[sim]==0.29.2' 'numpy<3'

# genlayer-test 0.29.2 discovers the latest GenVM release when its cache is
# empty, but newer releases no longer publish the genvm-universal.tar.xz asset
# that this loader expects. Cache the release containing the contract's pinned
# runner so every validator resolves the same reproducible SDK bundle.
python - <<'PY'
from gltest.direct.sdk_loader import download_artifacts

download_artifacts("v0.2.16")
PY

glsim --port 4012 --host 0.0.0.0 --validators 5 --no-browser --seed 35 >/tmp/quorumx-glsim.log 2>&1 &
glsim_pid=$!
cleanup() {
  kill "$glsim_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

attempt=0
until python - <<'PY' >/dev/null 2>&1
import json
import urllib.request

request = urllib.request.Request(
    "http://127.0.0.1:4012/api",
    data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}).encode(),
    headers={"Content-Type": "application/json"},
)
urllib.request.urlopen(request, timeout=1).read()
PY
do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    cat /tmp/quorumx-glsim.log
    exit 1
  fi
  sleep 1
done

gltest contracts/genlayer_localnet_tests/test_v3_3_release_localnet.py -v -s \
  --rpc-url http://127.0.0.1:4012/api \
  --chain-type localnet
