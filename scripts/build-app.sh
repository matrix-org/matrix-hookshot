#!/bin/sh

# exit when any command fails
set -e

echo "Building web"
yarn run build:web
echo "Building Rust layer"
yarn run build:app:rs
cat src/libRs.d.ts
echo "Running rust-typescript definitions fix"
yarn run build:app:fix-defs
echo "Building Typescript layer"
yarn run build:app
