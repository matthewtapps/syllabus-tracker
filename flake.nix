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
        toolchain = pkgs.rust-bin.beta.latest.minimal.override {
          targets = [
            "x86_64-unknown-linux-gnu"
          ];
        };
      in
      with pkgs;
      {
        devShells.default = pkgs.mkShell {
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

            rustc
            rust-analyzer-unwrapped
            rustfmt
            clippy
            cargo
            #
            # xorg.libXcursor
            # xorg.libXrandr
            # xorg.libXi
            # xorg.libX11
            # xorg.libxcb

            openssl
            pkg-config
            lld
            vulkan-loader
          ];
        };

        NIX_LD_LIBRARY_PATH = "${lib.makeLibraryPath buildInputs}";
        LD_LIBRARY_PATH = "${lib.makeLibraryPath buildInputs}";
        NIX_LD = lib.fileContents "${stdenv.cc}/nix-support/dynamic-linker";

        RUST_SRC_PATH = "${toolchain}/lib/rustlib/src/rust/library";

      }
    );
}
