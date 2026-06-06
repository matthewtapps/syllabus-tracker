# Declarative disk layout for FRESH droplet bootstrap via nixos-anywhere.
#
# Not imported by the live `syllabustracker-nixos` configuration (the
# existing droplet's quirky cloud-image partitioning (`vda14` before
# `vda1`) can't be expressed cleanly here). Used only by
# `syllabustracker-fresh` in flake.nix when standing up a new VM from
# scratch.
#
# Layout: GPT partition table, 1MB BIOS-boot partition (so legacy GRUB
# can install on a GPT disk), and ext4 root taking the rest. Swap is
# handled via a swapfile in configuration.nix, not a partition, so the
# layout stays trivially resizable on droplet upsize.

{ lib, ... }:

{
  # Disko's gpt+EF02 inference sets BOTH `boot.loader.grub.device` (legacy
  # singular) AND `boot.loader.grub.devices` (modern plural). The NixOS
  # GRUB module then concatenates them into `mirroredBoots`, producing
  # `["/dev/vda", "/dev/vda"]` and failing the "no duplicates" assertion.
  # Forcing a single source of truth disambiguates.
  boot.loader.grub = {
    device = lib.mkForce "nodev";
    devices = lib.mkForce [ "/dev/vda" ];
    efiSupport = false;
  };

  disko.devices = {
    disk.main = {
      device = "/dev/vda";
      type = "disk";
      content = {
        type = "gpt";
        partitions = {
          bios = {
            priority = 1;
            size = "1M";
            type = "EF02"; # BIOS boot partition (GPT GUID for GRUB stage 1.5).
          };
          root = {
            size = "100%";
            content = {
              type = "filesystem";
              format = "ext4";
              mountpoint = "/";
              mountOptions = [ "defaults" ];
            };
          };
        };
      };
    };
  };
}
