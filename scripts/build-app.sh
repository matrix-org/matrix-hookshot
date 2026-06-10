#!/usr/bin/env bash

# exit when any command fails
set -e

echo "Building Rust layer"
pnpm run build:app:rs
echo "Building Typescript layer"
pnpm run build:app
echo "Building web"
pnpm run build:web
