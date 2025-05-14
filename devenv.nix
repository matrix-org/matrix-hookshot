{ pkgs, lib, config, inputs, ... }:
let
  pkgs-upstream = import inputs.nixpkgs-upstream { system = pkgs.stdenv.system; };
in
{
  packages = [ pkgs.git pkgs.gcc pkgs.pkg-config pkgs.openssl ];

  # https://devenv.sh/tests/
  enterTest = ''
    echo "Running tests"
    yarn
  '';

  # https://devenv.sh/services/
  services.redis.enable = true;

  # https://devenv.sh/languages/
  languages.typescript.enable = true;
  languages.javascript.yarn.enable = true;
  languages.javascript.enable = true;
  languages.javascript.package = pkgs-upstream.nodejs_22;
  languages.rust.enable = true;
  languages.rust.channel = "stable";
}
