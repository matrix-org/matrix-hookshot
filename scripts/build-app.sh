#!/bin/sh
echo "Building web"
yarn run build:web
echo "Building Rust layer"
yarn run build:app:rs
echo "Running rust-typescript definitions fix"
yarn run build:app:fix-defs
echo "Building Typescript layer"
yarn run build:app
