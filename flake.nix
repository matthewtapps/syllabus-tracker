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
        # Pinned to the workspace MSRV (Cargo.toml `rust-version`) rather than
        # `stable.latest` so the toolchain doesn't silently drift when the
        # flake inputs update. CI consumes this exact toolchain via the `ci`
        # devShell, so dev and CI compile with the same rustc.
        rust = pkgs.rust-bin.stable."1.86.0".default.override {
          extensions = [
            "rust-src"
            "rust-analyzer"
          ];
          targets = [ "x86_64-unknown-linux-gnu" ];
        };

        # nixpkgs tracks sqlx-cli 0.9.x, whose CLI can emit an offline-cache
        # format the workspace's `sqlx` 0.8 macros cannot read. Pin to the
        # 0.8 series so the CLI that writes .sqlx/ matches the library that
        # reads it. Dev and CI both take this exact build, which is what
        # makes `sqlx prepare` reproducible (the CLI statically bundles its
        # own SQLite; a version skew here produced nondeterministic
        # sqlx-check failures). Hashes mirror the nixpkgs 0.8.6 derivation.
        sqlx-cli = pkgs.rustPlatform.buildRustPackage rec {
          pname = "sqlx-cli";
          version = "0.8.6";
          src = pkgs.fetchFromGitHub {
            owner = "launchbadge";
            repo = "sqlx";
            rev = "v${version}";
            hash = "sha256-Trnyrc17KWhX8QizKyBvXhTM7HHEqtywWgNqvQNMOAY=";
          };
          cargoHash = "sha256-FxvzCe+dRfMUcPWA4lp4L6FJaSpMiXTqEyhzk+Dv1B8=";
          buildNoDefaultFeatures = true;
          buildFeatures = [
            "native-tls"
            "sqlite"
          ];
          doCheck = false;
          cargoBuildFlags = [ "--package sqlx-cli" ];
          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.openssl ];
        };

        # The toolchain that the CI correctness gates (lint / test /
        # sqlx-check) run against. CI enters this shell via `nix develop .#ci`
        # so it uses byte-identical tool versions to local dev. This is what
        # makes the .sqlx offline cache reproducible: `sqlx-cli` bundles its
        # own SQLite, and a version skew between the dev box and CI was the
        # source of nondeterministic `sqlx prepare --check` failures (a bare
        # `MAX(col)` aggregate inferred `Null` under one sqlite and `Text`
        # under another). Keep this list lean: only what compiling the
        # workspace and running the sqlx prepare check requires, so the CI
        # closure stays small.
        ciInputs = with pkgs; [
          rust
          sqlx-cli
          sqlite
          cargo-nextest
          just

          # Native link deps for the rust build.
          openssl
          pkg-config
          lld
          clang
        ];

        # The full local dev shell layers the frontend toolchain, editor
        # servers, infra tooling, and formatters on top of the CI toolchain.
        # `pnpm_10` is pinned to match the repo's pnpm-lock.yaml and the
        # `pnpm/action-setup` version in the frontend_test CI job; nixpkgs
        # otherwise tracks pnpm 11, whose lockfile format differs.
        devInputs =
          ciInputs
          ++ (with pkgs; [
            nodejs-slim_22
            pnpm_10

            python313Packages.sqlfmt
            sqlfluff
            sqls
            postgresql_16
            opentofu
            terraform-ls
            age
            ssh-to-age
            htmx-lsp
            prettier
            djlint
            docker-buildx
            ffmpeg-headless

            typescript-language-server

            lefthook
            cargo-machete
            cargo-watch
            sccache
          ]);
      in
      {
        devShells = {
          default = pkgs.mkShell {
            buildInputs = devInputs;

            # Picked up by cargo for the native target. Docker builds don't see
            # this env var, so the release-musl pipeline is unaffected. Only the
            # dev shell sets it: the `ci` shell has no sccache, so leaving it
            # unset there keeps cargo from looking for a missing wrapper.
            RUSTC_WRAPPER = "sccache";
          };

          # Lean shell for CI correctness gates. See `ciInputs` above.
          ci = pkgs.mkShell {
            buildInputs = ciInputs;
          };
        };

        NIX_LD_LIBRARY_PATH = "${lib.makeLibraryPath devInputs}";
        LD_LIBRARY_PATH = "${lib.makeLibraryPath devInputs}";
        NIX_LD = lib.fileContents "${stdenv.cc}/nix-support/dynamic-linker";

        COMPOSE_BAKE = true;

      }
    );
}
