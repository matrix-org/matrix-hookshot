{ pkgs, lib, config, inputs, ... }:
let
  pkgs-upstream = import inputs.nixpkgs-upstream { system = pkgs.stdenv.system; };
in
{
  # https://devenv.sh/packages/
  packages = [ pkgs.git pkgs.gcc pkgs.pkg-config pkgs.openssl ];

  

  enterShell = ''
    hello
    git --version
  '';

  # https://devenv.sh/tests/
  enterTest = ''
    echo "Running tests"
    yarn
  '';

  # https://devenv.sh/services/
  # services.postgres.enable = true;
  services.redis.enable = true;

  # https://devenv.sh/languages/
  languages.typescript.enable = true;
  languages.javascript.yarn.enable = true;
  languages.javascript.enable = true;
  languages.javascript.package = pkgs-upstream.nodejs_22;
  languages.rust.enable = true;
  languages.rust.channel = "stable";

  # https://devenv.sh/pre-commit-hooks/
  # pre-commit.hooks.shellcheck.enable = true;

  # https://devenv.sh/processes/
  # processes.ping.exec = "ping example.com";

  # See full reference at https://devenv.sh/reference/options/
}
