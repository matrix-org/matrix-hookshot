#!/usr/bin/env bash

# exit when any command fails
set -e

echo "Building Rust layer"
yarn run build:app:rs
echo "Running rust-typescript definitions fix"
yarn run build:app:fix-defs
echo "Building Typescript layer"
yarn run build:app
echo "Building web"
yarn run build:web
