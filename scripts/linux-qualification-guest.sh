#!/bin/bash
set -euo pipefail
finish() {
  status=$?
  printf '\nOF_QUALIFICATION_RESULT=%s\n' "$status"
  sync
  poweroff -f
}
trap finish EXIT
export DEBIAN_FRONTEND=noninteractive
export CI=true
export TERM=dumb
mkdir -p /workspace /opt/node /opt/qualification-pm
tar -xf /dev/vdb -C /workspace
cd /workspace
printf 'SOURCE_COMMIT=%s\n' "$QUALIFY_COMMIT"
uname -a
cat /etc/os-release
apt-get -qq update
apt-get -qq install -y --no-install-recommends ca-certificates curl xz-utils openssl git libatomic1
curl -fsS --max-time 60 https://nodejs.org/dist/index.json -o /tmp/node-index.json
# Resolve the latest stable 26.x; this fixture does not pin future security updates.
version=$(sed -n 's/.*"version":"\(v26\.[0-9]*\.[0-9]*\)".*/\1/p' /tmp/node-index.json | awk 'NR == 1 {print}')
[[ "$version" =~ ^v26\.[0-9]+\.[0-9]+$ ]]
artifact="node-$version-linux-x64.tar.xz"
curl -fsS --max-time 120 "https://nodejs.org/dist/$version/$artifact" -o "/tmp/$artifact"
curl -fsS --max-time 60 "https://nodejs.org/dist/$version/SHASUMS256.txt" -o /tmp/node-shasums
awk -v name="$artifact" '$2 == name {print}' /tmp/node-shasums > /tmp/node-checksum
test -s /tmp/node-checksum
(cd /tmp && sha256sum -c node-checksum)
tar -xJf "/tmp/$artifact" -C /opt/node --strip-components=1
export PATH=/opt/node/bin:/opt/qualification-pm/bin:$PATH
node -e 'if(process.platform!=="linux"||process.versions.node.split(".")[0]!=="26"||!process.release.lts)throw Error("Linux Node 26 LTS required");console.log(JSON.stringify({node:process.version,lts:process.release.lts,platform:process.platform,arch:process.arch}))'
npm install --global --prefix /opt/qualification-pm corepack@0 --ignore-scripts --no-audit --no-fund
corepack enable --install-directory /opt/qualification-pm/bin
pnpm --version
pnpm install --frozen-lockfile
for gate in format:check lint build typecheck:built api:check:built test:coverage migration-check stable-release-gate pack:check:built release-readiness; do
  printf '\nQUALIFICATION_GATE=%s\n' "$gate"
  pnpm run "$gate"
done
pnpm --filter openfeature-local-provider-node-basic-example start
pnpm --filter openfeature-local-provider-node-basic-example run smoke:lifecycle
pnpm --filter openfeature-local-provider-node-basic-example run smoke:gitops
OPENFEATURE_SERVER_SDK_VERSION=peer pnpm run packed-smoke:built
