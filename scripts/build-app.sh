#!/bin/sh

# exit when any command fails
set -e

echo "Building web"
yarn run build:web
echo "Building Rust layer"
yarn run build:app:rs
echo "Building Typescript layer"
yarn run build:app
