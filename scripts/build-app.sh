#!/bin/bash

# exit when any command fails
set -e

echo "Building Rust layer"
# Check if we're trying to build for a specific target
# This requires zig to be installed
if [ -n "$CARGO_BUILD_TARGET" ]; then
  yarn run build:app:rs --target "$CARGO_BUILD_TARGET"
else
  yarn run build:app:rs
fi

echo "Running rust-typescript definitions fix"
yarn run build:app:fix-defs
echo "Building Typescript layer"
yarn run build:app
echo "Building web"
yarn run build:web
