{
  description = "Syllabus Tracker NixOS configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

    # Community flake that packages ngx_otel_module as a NixOS module.
    # We only consume its package output, not its NixOS module: that
    # module relies on `services.nginx.prependConfig`, which doesn't
    # exist until nixos-unstable. We work around it by injecting
    # `load_module` via the systemd ExecStart `-g` flag instead (see
    # configuration.nix).
    nginx-otel = {
      url = "github:djvcom/nix-nginx-otel";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nginx-otel }: {
    nixosConfigurations.syllabustracker-nixos = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit nginx-otel; };
      modules = [
        ./configuration.nix
        ./hardware-configuration.nix
      ];
    };
  };
}
