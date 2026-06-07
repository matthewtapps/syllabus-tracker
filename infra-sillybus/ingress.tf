# Traefik dynamic routing config for sillybus.
#
# This file is written to ../traefik-dynamic/sillybus.yml on the branch
# (committed). The deploy workflow rsyncs it onto sugar-glider into
# /srv/platform/traefik-dynamic/sillybus.yml. The host's Traefik watches
# that directory and auto-reloads on file change.
#
# Routing model:
#   - Host header sillybus.app or www.sillybus.app → port 8001 on
#     127.0.0.1 (the stack's internal nginx).
#   - Stack's nginx then routes /api/* → app:8000, /* → frontend:80
#     (entirely inside the compose stack, no host involvement).
#
# Traefik's loadBalancer.servers.url addresses must be reachable from
# Traefik's network namespace. services.traefik runs in the host
# namespace, so 127.0.0.1:8001 works directly.

locals {
  traefik_dynamic_yaml = yamlencode({
    http = {
      routers = {
        sillybus = {
          rule        = "Host(`sillybus.app`) || Host(`www.sillybus.app`)"
          service     = "sillybus"
          entryPoints = ["websecure"]
          tls         = { certResolver = "letsencrypt" }
        }
      }
      services = {
        sillybus = {
          loadBalancer = {
            servers = [
              { url = "http://127.0.0.1:8001" }
            ]
          }
        }
      }
    }
  })
}

resource "local_file" "traefik_dynamic" {
  filename        = "${path.module}/../traefik-dynamic/sillybus.yml"
  content         = local.traefik_dynamic_yaml
  file_permission = "0644"
}
