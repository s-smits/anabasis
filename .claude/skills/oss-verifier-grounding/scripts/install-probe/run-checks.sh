#!/bin/sh
# Drive every install check through the two real Builder cells.
#
# Each check has two halves and they run behind different walls on purpose:
#   install  -- the authoring cell, which has network
#   verify   -- the workshop cell, which does not
# A check counts as working only when the verify half computes something real offline. An import is
# not enough: a package can import and still fail the moment it is asked to do arithmetic, which is
# how two numpy-2 incompatibilities were found on 2026-08-19.
#
# A third half, added 2026-08-20, declared the installed tool as a candidate engine and walked the
# parser, the admission and the engine wall. That chain is gone (2026-09-03): the host resolves an
# installed executable by name, and there is nothing left to declare. The question it answered —
# can the product run what the cells installed — now belongs to run-tool.mts on its own.
set -u
BASE="${1:?usage: run-checks.sh <work-dir> [check...]}"
shift
CHECKS="${*:-python-wheel python-sdist bun cargo binary-tarball git-make}"

REPO=$(cd "$(dirname "$0")/../../../../.." && pwd)
SDKROOT="${SDKROOT:-$(/usr/bin/xcrun --show-sdk-path 2>/dev/null || true)}"
REAL_HOME="$HOME"
FIX="$BASE/fixture"
STAGE="$BASE/stage"
mkdir -p "$FIX" "$STAGE"

BUN=$(command -v bun)
[ -n "$BUN" ] || { echo "no bun on PATH"; exit 2; }
OSS=$("$BUN" --no-env-file "$(dirname "$0")/emit-profiles.mts" "$FIX") || exit 2
AUTHOR="$BASE/author.sb"
WORKSHOP="$BASE/workshop.sb"
echo "cell profiles: $AUTHOR $WORKSHOP"
echo "workshop tree: $OSS"
echo

# Run a command behind one wall, with the cell's own HOME/TMPDIR/cache so nothing reaches the
# operator's. The cwd is the staging tree: the authoring cell cannot read the workshop tree and the
# process would die on getcwd before its first instruction.
confine() {
  _profile="$1"; _cwd="$2"; shift 2
  mkdir -p "$_cwd"
  cat > "$_cwd/.step.sh" <<INNER
cd "$_cwd" || exit 97
export HOME="$_cwd/.home" TMPDIR="$_cwd/.tmp" XDG_CACHE_HOME="$_cwd/.cache"
export UV_CACHE_DIR="$_cwd/.cache/uv" MPLCONFIGDIR="$_cwd/.cache/mpl"
export CARGO_HOME="$_cwd/.cache/cargo" BUN_INSTALL_CACHE_DIR="$_cwd/.cache/bun"
# Without SDKROOT, clang on this host cannot find assert.h and every source build fails at the
# first #include. Measured 2026-08-19: it fails identically unconfined, so it is a property of the
# host's clang and not of either wall. Naming the SDK is what a Builder compiling anything from
# source has to do, inside a cell or outside one.
export SDKROOT="${SDKROOT:-$(/usr/bin/xcrun --show-sdk-path 2>/dev/null)}"
# hostToolchainEnv() in src/verify/wall-policy.ts hands the real cells these two, pointing at the
# operator's own toolchain state. The check sets HOME to a per-cell directory, so without them
# rustup reads an empty ~/.rustup and reports "no default is configured" for a host that has one.
export RUSTUP_HOME="${RUSTUP_HOME:-$REAL_HOME/.rustup}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-$REAL_HOME/.local}"
export PYTHONPATH="$STAGE/pylibs"
export PATH="$STAGE/bin:\$PATH"
$*
INNER
  mkdir -p "$_cwd/.home" "$_cwd/.tmp" "$_cwd/.cache"
  # The step script sits in the cell's own cwd. Written to a shared parent instead, the workshop
  # cell cannot read it and every check reports "Operation not permitted" from /bin/sh, which reads
  # as six broken sessions rather than one misplaced file.
  /usr/bin/sandbox-exec -f "$_profile" /bin/sh "$_cwd/.step.sh" 2>&1
}

report() { printf '%-22s %-12s %s\n' "$1" "$2" "$3"; }

for check in $CHECKS; do
  case "$check" in
    python-wheel)
      PY=$(command -v python3)
      out=$(confine "$AUTHOR" "$STAGE" uv pip install --quiet --target "$STAGE/pylibs" --python "$PY" numpy sympy shapely)
      [ -d "$STAGE/pylibs/numpy" ] || { report "$check" INSTALL-FAIL "$(echo "$out" | tail -1)"; continue; }
      out=$(confine "$WORKSHOP" "$OSS" "$PY" -c "'import numpy,sympy,shapely.geometry as g,sys;
print(numpy.linalg.det([[3.,1.],[1.,3.]]), sympy.integrate(sympy.sin(sympy.Symbol(chr(120)))**2,(sympy.Symbol(chr(120)),0,sympy.pi)), g.Polygon([(0,0),(4,0),(4,3)]).area)'")
      case "$out" in *8.0*) report "$check" OK "$out";; *) report "$check" VERIFY-FAIL "$out";; esac
      ;;
    python-sdist)
      PY=$(command -v python3)
      out=$(confine "$AUTHOR" "$STAGE" uv pip install --quiet --no-binary :all: --target "$STAGE/pysrc" --python "$PY" msgpack)
      [ -d "$STAGE/pysrc/msgpack" ] || { report "$check" INSTALL-FAIL "$(echo "$out" | tail -1)"; continue; }
      out=$(confine "$WORKSHOP" "$OSS" "PYTHONPATH=$STAGE/pysrc" "$PY" -c "'import msgpack;print(msgpack.unpackb(msgpack.packb({chr(107):2})))'")
      case "$out" in *"'k': 2"*) report "$check" OK "compiled from source, $out";; *) report "$check" VERIFY-FAIL "$out";; esac
      ;;
    bun)
      BUN_PROJECT="$STAGE/bun"
      SEMVER="$BUN_PROJECT/node_modules/semver/index.js"
      VERIFY_SCRIPT="$BUN_PROJECT/verify.mjs"
      mkdir -p "$BUN_PROJECT"
      out=$(confine "$AUTHOR" "$STAGE" "\"$BUN\" --no-env-file add --cwd \"$BUN_PROJECT\" --silent semver")
      [ -f "$SEMVER" ] || { report "$check" INSTALL-FAIL "$(echo "$out" | tail -1)"; continue; }
      printf '%s\n' 'import semver from "semver"; console.log(semver.gt("2.0.0", "1.9.9"));' > "$VERIFY_SCRIPT"
      out=$(confine "$WORKSHOP" "$OSS" "\"$BUN\" --no-env-file \"$VERIFY_SCRIPT\"")
      case "$out" in *true*) report "$check" OK "$out";; *) report "$check" VERIFY-FAIL "$out";; esac
      ;;
    cargo)
      command -v cargo >/dev/null || { report "$check" UNAVAILABLE "no cargo"; continue; }
      # rustup shims answer `command -v` and then refuse to run when no toolchain is the default.
      # That is a host setup gap, not an install failure, and it reports as one.
      cargo --version >/dev/null 2>&1 || { report "$check" UNAVAILABLE "cargo shim present, no default toolchain"; continue; }
      out=$(confine "$AUTHOR" "$STAGE" cargo install --quiet --root "$STAGE" hexyl)
      [ -x "$STAGE/bin/hexyl" ] || { report "$check" INSTALL-FAIL "$(echo "$out" | tail -2)"; continue; }
      out=$(confine "$WORKSHOP" "$OSS" "printf 'hi' > t.bin; hexyl t.bin | head -3")
      case "$out" in *6869*|*"68 69"*) report "$check" OK "built and ran offline";; *) report "$check" VERIFY-FAIL "$out";; esac
      printf 'hi' > "$STAGE/probe.bin"
      ;;
    binary-tarball)
      out=$(confine "$AUTHOR" "$STAGE" "curl -sSL -o jq.tar.gz https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-macos-arm64 && mv jq.tar.gz $STAGE/bin/jq 2>/dev/null || (mkdir -p $STAGE/bin && mv jq.tar.gz $STAGE/bin/jq); chmod +x $STAGE/bin/jq")
      [ -x "$STAGE/bin/jq" ] || { report "$check" INSTALL-FAIL "$(echo "$out" | tail -1)"; continue; }
      out=$(confine "$WORKSHOP" "$OSS" "echo '{\"pin\":13}' | jq -r .pin")
      case "$out" in *13*) report "$check" OK "downloaded binary ran offline";; *) report "$check" VERIFY-FAIL "$out";; esac
      printf '{"pin":13}' > "$STAGE/probe.json"
      ;;
    git-make)
      out=$(confine "$AUTHOR" "$STAGE" "git clone --quiet --depth 1 https://github.com/DaveGamble/cJSON.git cjson")
      [ -f "$STAGE/cjson/cJSON.c" ] || { report "$check" INSTALL-FAIL "$(echo "$out" | tail -1)"; continue; }
      out=$(confine "$WORKSHOP" "$STAGE/cjson" "cc -c cJSON.c -o /dev/null && echo COMPILED")
      case "$out" in *COMPILED*) report "$check" OK "C source compiled offline";; *) report "$check" VERIFY-FAIL "$out";; esac
      ;;
    *) report "$check" UNKNOWN "no such check";;
  esac
done

echo "--- network denial control (workshop cell) ---"
confine "$WORKSHOP" "$OSS" "curl -sS --max-time 8 https://pypi.org/simple/ >/dev/null && echo 'REACHED - wall failed' || echo 'refused, as intended'"
