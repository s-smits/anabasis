#!/bin/sh
# Install fwsim into a workspace's .toolchain and expose it as .toolchain/bin/fwsim.
#
#   sh starter-pack/fwsim/install.sh [workspace]
#
# The workspace defaults to $WORKSPACE, else the directory two levels above this script. Running it
# again replaces the install in place. Dependencies install exactly as pinned in bun.lock.
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
WORKSPACE=${1:-${WORKSPACE:-$(cd "$SRC/../.." && pwd)}}
if [ ! -d "$WORKSPACE" ]; then
  echo "fwsim install: no workspace directory at $WORKSPACE" >&2
  exit 2
fi
WORKSPACE=$(cd "$WORKSPACE" && pwd)
TOOLCHAIN="$WORKSPACE/.toolchain"
DEST="$TOOLCHAIN/fwsim"

if [ -x "$TOOLCHAIN/bun" ]; then
  BUN="$TOOLCHAIN/bun"
elif BUN=$(command -v bun); then
  :
else
  echo "fwsim install: no bun at $TOOLCHAIN/bun or on PATH" >&2
  exit 3
fi

# Resolve a version manager's shim to the interpreter behind it before HOME changes under it.
BUN=$("$BUN" -e 'process.stdout.write(process.execPath)')

mkdir -p "$TOOLCHAIN/home" "$TOOLCHAIN/bin" "$DEST/src" "$DEST/runtime"
# The toolchain's home, as the Builder's install shell has it, so nothing lands in a per-session one.
HOME="$TOOLCHAIN/home"
export HOME

cp "$SRC"/src/*.ts "$DEST/src/"
cp "$SRC/package.json" "$SRC/bun.lock" "$SRC/rp2040-bootrom-b1.bin" "$SRC/README.md" "$DEST/"
(cd "$DEST" && "$BUN" install --frozen-lockfile --production --ignore-scripts --no-progress)
(cd "$DEST" && "$BUN" build src/main.ts --target=bun --outfile fwsim.js >/dev/null)

# A private copy of the runtime, so the wrapper never depends on a bun outside the toolchain.
if ! cmp -s "$BUN" "$DEST/runtime/bun"; then
  rm -f "$DEST/runtime/bun.new"
  if [ "$(uname -s)" = Darwin ]; then
    cp -c "$BUN" "$DEST/runtime/bun.new" 2>/dev/null || cp "$BUN" "$DEST/runtime/bun.new"
  else
    cp "$BUN" "$DEST/runtime/bun.new"
  fi
  chmod 755 "$DEST/runtime/bun.new"
  mv -f "$DEST/runtime/bun.new" "$DEST/runtime/bun"
fi

cat > "$TOOLCHAIN/bin/fwsim.new" <<'WRAPPER'
#!/bin/sh
# fwsim: run a firmware image on a simulated board against scripted input; see .toolchain/fwsim/README.md.
SELF=$0
while [ -L "$SELF" ]; do
  LINK=$(readlink "$SELF")
  case $LINK in /*) SELF=$LINK ;; *) SELF=$(dirname "$SELF")/$LINK ;; esac
done
ROOT=$(cd "$(dirname "$SELF")/.." && pwd)
FWSIM_TOOLCHAIN=$ROOT
export FWSIM_TOOLCHAIN
for BUN in "$ROOT/fwsim/runtime/bun" "$ROOT/bun"; do
  if [ -x "$BUN" ]; then exec "$BUN" --no-env-file "$ROOT/fwsim/fwsim.js" "$@"; fi
done
exec bun --no-env-file "$ROOT/fwsim/fwsim.js" "$@"
WRAPPER
chmod 755 "$TOOLCHAIN/bin/fwsim.new"
mv -f "$TOOLCHAIN/bin/fwsim.new" "$TOOLCHAIN/bin/fwsim"

# The bundle must load: a bare `run` is a usage error (exit 2), anything else is a broken install.
status=0
"$TOOLCHAIN/bin/fwsim" run >/dev/null 2>&1 || status=$?
if [ "$status" -ne 2 ]; then
  echo "fwsim install: $TOOLCHAIN/bin/fwsim did not start (exit $status)" >&2
  exit 1
fi
echo "fwsim installed: $TOOLCHAIN/bin/fwsim"
