#!/bin/bash

# exit when any command fails
set -e

# Workaround for non-x64 / ia32 targets
pushd node_modules/@turt2live/matrix-sdk-crypto-nodejs
echo "Checking matrix-sdk-crypto-nodejs bindings (and building if required)"
node check-exists.js
popd

echo "Building Rust layer"
yarn run build:app:rs
echo "Running rust-typescript definitions fix"
yarn run build:app:fix-defs
echo "Building Typescript layer"
yarn run build:app
echo "Building web"
yarn run build:web
