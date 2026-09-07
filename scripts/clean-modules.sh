#!/usr/bin/env bash

set -euo pipefail

shopt -s nullglob
module_packages=(modules/*/*/package.json)

for package_file in "${module_packages[@]}"; do
  module_dir=${package_file%/package.json}
  module_lib="$module_dir/lib"
  public_module="public/$module_dir"

  if [[ -d "$module_lib" ]]; then
    echo "Removing $module_lib"
    rm -rf -- "$module_lib"
  fi

  if [[ -d "$public_module" ]]; then
    echo "Removing $public_module"
    rm -rf -- "$public_module"
  fi
done
