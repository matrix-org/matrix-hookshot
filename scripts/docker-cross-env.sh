#!/bin/sh

# This script is used in the Dockerfile to run the build commands with the correct environment variables
# This maps the docker "$TARGETPLATFORM" to relevant npm and cargo environment variables

set -eux

if [ "$#" -lt 2 ]; then
  echo "usage: $0 [platform] [cmd...]" >&2
  exit 1
fi

PLATFORM="$1"
shift

if [ "$PLATFORM" = "linux/arm64" ] || [ "$PLATFORM" = "linux/arm64/v8" ]; then
  export npm_config_target_platform=linux
  export npm_config_target_arch=arm64
  export npm_config_target_libc=glibc
  export CARGO_BUILD_TARGET="aarch64-unknown-linux-gnu"
elif [ "$PLATFORM" = "linux/amd64" ]; then
  export npm_config_target_platform=linux
  export npm_config_target_arch=x64
  export npm_config_target_libc=glibc
  export CARGO_BUILD_TARGET="x86_64-unknown-linux-gnu"
else
  echo "unsupported platform ${PLATFORM}" >&2
  exit 2
fi

exec "$@"