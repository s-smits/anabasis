#!/bin/sh
# Build Espressif's QEMU with esp32-input.patch into .toolchain/qemu, so fwsim can drive ESP32 GPIO
# input and ADC1 at virtual times.
#
#   sh starter-pack/fwsim/build-qemu.sh [workspace]
#
# Needs git, python3 (3.8 or later), ninja, pkg-config and the development files of glib-2.0,
# pixman-1, libgcrypt and libslirp (this QEMU's build requires libslirp); on macOS, Apple clang.
# The build compiles about 1,400 units, so give the call a long timeout.
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
WORKSPACE=${1:-${WORKSPACE:-$(cd "$SRC/../.." && pwd)}}
WORKSPACE=$(cd "$WORKSPACE" && pwd)
PREFIX="$WORKSPACE/.toolchain/qemu"
TREE="$WORKSPACE/.toolchain/qemu-src"
TAG=esp-develop-9.2.2-20260417

rm -rf "$TREE"
git clone -q --depth 1 --branch "$TAG" https://github.com/espressif/qemu "$TREE"
git -C "$TREE" apply "$SRC/esp32-input.patch"
mkdir -p "$TREE/build"
cd "$TREE/build"
set -- --target-list=xtensa-softmmu --without-default-features --enable-gcrypt --enable-pixman \
  --enable-slirp --disable-fdt --disable-sdl --enable-stack-protector --python=python3 \
  --with-pkgversion="esp_develop_9.2.2_20260417+esp32-input"
if [ "$(uname -s)" = Darwin ]; then
  set -- "$@" --cc=/usr/bin/clang --objcc=/usr/bin/clang --host-cc=/usr/bin/clang
fi
../configure "$@" >configure.log 2>&1 || { tail -20 configure.log >&2; exit 1; }
ninja qemu-system-xtensa >ninja.log 2>&1 || { tail -20 ninja.log >&2; exit 1; }

mkdir -p "$PREFIX/bin" "$PREFIX/share/qemu"
cp qemu-system-xtensa "$PREFIX/bin/qemu-system-xtensa"
cp ../pc-bios/esp32*.bin "$PREFIX/share/qemu/"

# fwsim takes input only from a QEMU whose esp32.gpio model has the stimulus property.
if ! "$PREFIX/bin/qemu-system-xtensa" -device esp32.gpio,help 2>&1 | grep -q stimulus; then
  echo "build-qemu: $PREFIX/bin/qemu-system-xtensa has no esp32.gpio stimulus property" >&2
  exit 1
fi
echo "QEMU with ESP32 input built: $PREFIX/bin/qemu-system-xtensa"
