{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      rust-overlay,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        inherit (pkgs) lib stdenv;
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
          config = {
            allowUnfree = true;
          };
        };
        rust = pkgs.rust-bin.stable.latest.default.override {
          extensions = [
            "rust-analyzer"
          ];
          targets = [ "x86_64-unknown-linux-gnu" ];
        };
      in
      with pkgs;
      {
        devShells.default = mkShell {
          buildInputs = [
            python313Packages.sqlfmt
            sqlfluff
            sqls
            postgresql_16
            terraform
            terraform-ls
            htmx-lsp
            nodePackages.prettier
            djlint
            sqlx-cli
            sqlite
            docker-buildx

            rust

            openssl
            pkg-config
            lld

            typescript-language-server

            # New frontend
            pnpm
            nodejs-slim_22
          ];
        };

        NIX_LD_LIBRARY_PATH = "${lib.makeLibraryPath buildInputs}";
        LD_LIBRARY_PATH = "${lib.makeLibraryPath buildInputs}";
        NIX_LD = lib.fileContents "${stdenv.cc}/nix-support/dynamic-linker";

        COMPOSE_BAKE = true;

      }
    );
}
