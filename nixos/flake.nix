{
  description = "Syllabus Tracker NixOS configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

    # Community flake that packages ngx_otel_module as a NixOS module.
    # Until nixpkgs ships an upstream module, this is the cleanest way to
    # get OpenTelemetry tracing on the host nginx.
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
