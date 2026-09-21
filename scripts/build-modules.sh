#!/usr/bin/env bash

set -euo pipefail

shopt -s nullglob
module_packages=(modules/*/*/package.json)

for package_file in "${module_packages[@]}"; do
  module_dir=${package_file%/package.json}
  artifact="$module_dir/lib/index.js"
  public_artifact="public/$module_dir/index.js"

  echo "Building $module_dir"
  pnpm --dir "$module_dir" run prepare

  if [[ ! -f "$artifact" ]]; then
    echo "Module build did not produce $artifact" >&2
    exit 1
  fi

  mkdir -p "${public_artifact%/index.js}"
  cp "$artifact" "$public_artifact"
done
