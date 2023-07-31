#!/bin/sh

# This script is used in the Dockerfile to download the matrix-sdk-crypto-nodejs native bindings
# This is needed because the SDK only downloads the bindings for the current platform, not for the target platform

set -eux

if [ "$#" -ne 2 ]; then
  echo "usage: $0 [platform] [version]" >&2
  exit 1
fi

PLATFORM="$1"
VERSION="$2"

if [ "$PLATFORM" = "linux/arm64" ] || [ "$PLATFORM" = "linux/arm64/v8" ]; then
  ARCH=arm64
elif [ "$PLATFORM" = "linux/amd64" ]; then
  ARCH=x64
else
  echo "unsupported platform ${PLATFORM}" >&2
  exit 2
fi

curl -sSfL "https://github.com/matrix-org/matrix-rust-sdk/releases/download/matrix-sdk-crypto-nodejs-v${VERSION}/matrix-sdk-crypto.linux-${ARCH}-gnu.node" \
  > "./node_modules/@matrix-org/matrix-sdk-crypto-nodejs/matrix-sdk-crypto.linux-${ARCH}-gnu.node"