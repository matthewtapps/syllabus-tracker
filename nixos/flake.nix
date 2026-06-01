{
  description = "Syllabus Tracker NixOS configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    # Community flake that packages ngx_otel_module as a NixOS module.
    # Provides services.nginx.otel.*; relies on services.nginx.prependConfig
    # (available from nixos-25.11 onward).
    nginx-otel = {
      url = "github:djvcom/nix-nginx-otel";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nginx-otel }: {
    nixosConfigurations.syllabustracker-nixos = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        ./hardware-configuration.nix
        nginx-otel.nixosModules.default
      ];
    };
  };
}
