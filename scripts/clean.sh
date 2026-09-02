#!/bin/bash

# exit when any command fails
set -e

echo "Cleaning web"
pnpm run clean:web
echo "Cleaning Typescript layer"
pnpm run clean:app
echo "Cleaning Rust layer"
pnpm run clean:app:rs
