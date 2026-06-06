{
  pkgs,
  lib,
  ...
}:

let
  domain = "syllabustracker.matthewtapps.com";
  acmeEmail = "mail@matthewtapps.com";

  adminUser = "syllabusadmin";

  # SSH keys with explicit roles. Public halves only; private halves live in:
  # - laptopAdminKey:   ~/.ssh/id_ed25519 on matt's daily-driver laptop.
  # - ciDeployKey:      SOPS-encrypted infra/tofu/secrets.enc.yaml, pushed
  #                     by tofu to the GHA SSH_PRIVATE_KEY secret.
  # - rootRecoveryKey:  matt's password manager only. Never in CI; never in
  #                     SOPS. Break-glass for when sudo is unrecoverable.
  laptopAdminKey  = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIH6L78sNDUwYIeeubGuD5bSYStc3Z/Tt4d4wvfNxRp0 matt@Matt-THINKPAD-NIXOS";
  ciDeployKey     = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBmNW5Q6uU+XoWIzcZrRpl2ClFbMjLoZQ4tkk5xb59D4 ci-deploy@syllabus-tracker";
  rootRecoveryKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXmD+68A7qlUOaDXUEF0AbOL3ZMJzqgGZIXw+jNxtCJ root-recovery@syllabus-tracker";

  # Pre-existing keys, kept temporarily so the in-flight CI key rotation can
  # land before they're removed. Drop in a follow-up commit once the new
  # ciDeployKey is confirmed working from a real CI run.
  legacyAdminSshKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEQG/SNksegRf+4EUWzyInTY09rKR3xOwrX91ZjqIbKe matt@Matt-DESKTOP-NIXOS";
  legacyDevSshKey   = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPh++awEjCHnVU2eGPSADBgrBzr1h4lGqbSG0ZRotT/W matt@Matt-DESKTOP-NIXOS";

  publicIPv4 = "170.64.159.153";
  publicIPv4Prefix = 19;
  gatewayIPv4 = "170.64.128.1";

  privateIPv4_eth0 = "10.49.0.6";
  privateIPv4Prefix_eth0 = 16;

  privateIPv4_eth1 = "10.126.0.3";
  privateIPv4Prefix_eth1 = 20;

  serverTempConfigPath = "/home/${adminUser}/nixos_config_staging";
  serverTargetConfigPath = "/etc/nixos";
in
{
  imports = [
    ./hardware-configuration.nix
  ];

  boot.loader.grub.enable = true;

  # Clean /tmp on boot and enable zramSwap (good defaults)
  boot.tmp.cleanOnBoot = true;
  zramSwap.enable = true;

  swapDevices = [{ device = "/swapfile"; size = 2048; }];

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
    openssh.authorizedKeys.keys = [
      laptopAdminKey
      ciDeployKey
      legacyAdminSshKey
      legacyDevSshKey
    ];
  };

  users.users.root.openssh.authorizedKeys.keys = [
    rootRecoveryKey
  ];

  # No passwordless sudo for the admin user for better security on a server. They'll need to type their password.
  security.sudo.wheelNeedsPassword = true;

  security.sudo.extraRules = [
    {
      users = [ adminUser ];
      commands = [
        {
          # Allow running nixos-rebuild with any arguments (switch, boot, --fast, --upgrade, etc.)
          command = "/run/current-system/sw/bin/nixos-rebuild *";
          options = [ "NOPASSWD" ]; # Allow this specific command pattern without a password
        }
        {
          command = "/run/current-system/sw/bin/cp ${serverTempConfigPath}/configuration.nix ${serverTargetConfigPath}/configuration.nix";
          options = [ "NOPASSWD" ];
        }
        {
          command = "/run/current-system/sw/bin/cp ${serverTempConfigPath}/hardware-configuration.nix ${serverTargetConfigPath}/hardware-configuration.nix";
          options = [ "NOPASSWD" ];
        }
        {
          command = "/run/current-system/sw/bin/cp ${serverTempConfigPath}/flake.nix ${serverTargetConfigPath}/flake.nix";
          options = [ "NOPASSWD" ];
        }
        {
          command = "/run/current-system/sw/bin/cp ${serverTempConfigPath}/flake.lock ${serverTargetConfigPath}/flake.lock";
          options = [ "NOPASSWD" ];
        }
      ];
    }
  ];

  security.sudo.extraConfig = ''
    Defaults:${adminUser} !requiretty
  '';

  # Key-only root SSH. Used as a break-glass path via rootRecoveryKey when
  # syllabusadmin's sudo is unrecoverable (e.g. no password set).
  services.openssh.settings.PermitRootLogin = "prohibit-password";

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

  # Allow the docker bridge subnet (RFC1918 172.16.0.0/12 covers docker0
  # and all docker-compose-created bridges) to reach the nginx stub_status
  # endpoint on tcp/8082. nginx-level allow rules above provide a second
  # layer of defence.
  networking.firewall.extraCommands = ''
    iptables -A nixos-fw -p tcp -s 172.16.0.0/12 --dport 8082 -j nixos-fw-accept
  '';

  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # Docker
  virtualisation.docker = {
    enable = true;
    # `pkgs.docker` in nixos-25.11 currently points at docker_28, which was
    # marked insecure (unmaintained since Nov 2025). Pin the next stable major.
    package = pkgs.docker_29;
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
      # Headroom for video uploads. Set on the vhost so it applies to every
      # location. The app's VIDEO_MAX_BYTES is the authoritative limit.
      extraConfig = ''
        client_max_body_size 1G;
      '';
      locations."/" = {
        proxyPass = "http://127.0.0.1:8080/";
        extraConfig = ''
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
        '';
      };
    };

    # stub_status for the docker otel-collector's nginx receiver. Bound
    # on all interfaces; the host firewall + the allow rules below restrict
    # access to docker bridges only (172.16.0.0/12).
    virtualHosts."_stub_status" = {
      listen = [{ addr = "0.0.0.0"; port = 8082; ssl = false; }];
      locations."/status" = {
        extraConfig = ''
          stub_status on;
          access_log off;
          allow 172.16.0.0/12;
          allow 127.0.0.1;
          deny all;
        '';
      };
    };
  };

  # OpenTelemetry tracing on the host nginx. Spans are exported via OTLP/gRPC
  # to the docker otel-collector, which routes by service.name to the
  # nginx-do-host Honeycomb dataset. The module options come from the
  # nginx-otel flake (imported in flake.nix).
  services.nginx.otel = {
    enable = true;
    serviceName = "nginx-do-host";
    endpoint = "127.0.0.1:4317";
    traceContext = "propagate";
  };

  security.acme = {
    acceptTerms = true;
    defaults.email = acmeEmail;
  };

  # Persistent storage directories for application
  systemd.tmpfiles.rules = [
    # For Docker persistent data
    "d /var/lib/syllabus-tracker/app-data 0755 ${adminUser} users -"

    # For Application Deployment Path (Docker Compose files, scripts, configs)
    "d /srv/syllabus-tracker 0755 ${adminUser} users -"
    "d /srv/syllabus-tracker/config 0755 ${adminUser} users -"
    "d /srv/syllabus-tracker/scripts 0755 ${adminUser} users -"

    # Nginx placeholder
    "d /var/www/${domain}/placeholder 0755 root root -" # Nginx usually runs as its own user, but root can create
    "f /var/www/${domain}/placeholder/index.html 0644 root root - \"ACME Initial Setup - OK\""
  ];

  # System state version
  system.stateVersion = "23.11";
}
