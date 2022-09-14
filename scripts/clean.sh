#!/bin/bash

# exit when any command fails
set -e

echo "Cleaning web"
yarn run clean:web
echo "Cleaning Typescript layer"
yarn run clean:app
echo "Cleaning Rust layer"
yarn run clean:app:rs
