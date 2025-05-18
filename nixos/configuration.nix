{
  pkgs,
  lib,
  ...
}:

let
  domain = "syllabustracker-nixos.matthewtapps.com";
  acmeEmail = "mail@matthewtapps.com";

  adminSshKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPh++awEjCHnVU2eGPSADBgrBzr1h4lGqbSG0ZRotT/W matt@Matt-DESKTOP-NIXOS";

  adminUser = "syllabusadmin";

  publicIPv4 = "170.64.159.153";
  publicIPv4Prefix = 19;
  gatewayIPv4 = "170.64.128.1";

  privateIPv4_eth0 = "10.49.0.6";
  privateIPv4Prefix_eth0 = 16;

  privateIPv4_eth1 = "10.126.0.3";
  privateIPv4Prefix_eth1 = 20;
in
{
  imports = [
    ./hardware-configuration.nix
  ];

  boot.loader.grub.enable = true;

  # Clean /tmp on boot and enable zramSwap (good defaults)
  boot.tmp.cleanOnBoot = true;
  zramSwap.enable = true;

  # Networking Configuration
  networking.hostName = "syllabustracker-nixos";
  networking.domain = lib.strings.removePrefix "syllabustracker." domain;

  services.udev.extraRules = ''
    ATTR{address}=="86:e0:d1:78:f1:a7", NAME="eth0"
    ATTR{address}=="02:51:8d:ca:a9:49", NAME="eth1"
  '';
  # Disable kernel's predictable names to rely on udev rules above.
  networking.usePredictableInterfaceNames = lib.mkForce false;
  # Disable DHCP client as we're using static IPs
  networking.dhcpcd.enable = false;

  networking.interfaces.eth0 = {
    useDHCP = false;
    ipv4.addresses = [
      {
        address = publicIPv4;
        prefixLength = publicIPv4Prefix;
      }
      {
        address = privateIPv4_eth0;
        prefixLength = privateIPv4Prefix_eth0;
      }
    ];
  };

  networking.interfaces.eth1 = {
    useDHCP = false;
    ipv4.addresses = [
      {
        address = privateIPv4_eth1;
        prefixLength = privateIPv4Prefix_eth1;
      }
    ];
  };

  networking.defaultGateway = gatewayIPv4;

  networking.nameservers = [
    "67.207.67.2"
    "67.207.67.3"
    "8.8.8.8"
  ];

  time.timeZone = "Australia/Sydney"; # Or your preferred

  i18n.defaultLocale = "en_US.UTF-8";
  console.keyMap = "us";

  users.users.${adminUser} = {
    isNormalUser = true;
    description = "Syllabus Tracker Admin User";
    extraGroups = [
      "wheel"
      "docker"
    ];
    openssh.authorizedKeys.keys = [ adminSshKey ];
  };
  # No passwordless sudo for the admin user for better security on a server. They'll need to type their password.
  security.sudo.wheelNeedsPassword = true;

  # Disable root login via SSH once your admin user is confirmed working
  services.openssh.settings.PermitRootLogin = "no";

  environment.systemPackages = with pkgs; [
    git
    curl
    wget
    htop
    vim
    sqlite
    gnutar
    findutils
    gnugrep
    gnused
    gawk
    bc
    otel-cli
  ];

  # OpenSSH Server
  services.openssh.enable = true;
  services.openssh.settings.PasswordAuthentication = false; # Enforce key-based auth

  # Firewall
  networking.firewall.enable = true;
  networking.firewall.allowedTCPPorts = [
    22
    80
    443
  ]; # SSH, HTTP, HTTPS

  # Docker
  virtualisation.docker = {
    enable = true;
  };

  # Nginx and ACME (Let's Encrypt) for SSL
  services.nginx = {
    enable = true;
    recommendedOptimisation = true;
    recommendedProxySettings = true;
    recommendedTlsSettings = true;
    virtualHosts.${domain} = {
      forceSSL = true;
      enableACME = true;
      # Proxy requests to application containers
      locations."/" = {
        proxyPass = "http://frontend:80"; # Docker Compose DNS will resolve 'frontend'
        extraConfig = ''
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
        '';
      };
      locations."/api/" = {
        proxyPass = "http://app:8000/api/"; # Docker Compose DNS will resolve 'app'
        proxyWebsockets = true;
        extraConfig = ''
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
        '';
      };
    };
  };

  security.acme = {
    acceptTerms = true;
    defaults.email = acmeEmail;
  };

  # Persistent storage directories for application
  systemd.tmpfiles.rules = [
    "d /var/lib/syllabus-tracker/app-data 0755 ${adminUser} users -"
    "d /var/lib/syllabus-tracker/backups 0750 ${adminUser} users -"
    # Nginx related paths like /var/lib/acme and /var/www for challenges are managed by NixOS.
  ];

  # System state version
  system.stateVersion = "23.11"; # Or "24.05" if you used that for nixos-infect
}
