# DNS records owned by sillybus.
#
# The IAM credentials provider above are scoped (by the platform) to
# only records inside the sillybus.app zone, so tofu apply will succeed
# for these but error if we ever tried to write to another zone.

locals {
  vm_ip = data.terraform_remote_state.platform.outputs.host_ips["sugar_glider"]
}

resource "aws_route53_record" "sillybus_apex" {
  zone_id = data.terraform_remote_state.platform.outputs.zone_ids["sillybus.app"]
  name    = "sillybus.app"
  type    = "A"
  ttl     = 300
  records = [local.vm_ip]
}

resource "aws_route53_record" "sillybus_www" {
  zone_id = data.terraform_remote_state.platform.outputs.zone_ids["sillybus.app"]
  name    = "www.sillybus.app"
  type    = "A"
  ttl     = 300
  records = [local.vm_ip]
}

# Staged-trial sibling for legacy cutover validation. Points at
# sugar-glider; Traefik routes Host(restored.sillybus.app) to the
# sibling stack's port (via /srv/platform/traefik-dynamic/test-sibling.yml
# or similar). Remove after legacy cutover is complete.
resource "aws_route53_record" "sillybus_restored" {
  zone_id = data.terraform_remote_state.platform.outputs.zone_ids["sillybus.app"]
  name    = "restored.sillybus.app"
  type    = "A"
  ttl     = 60
  records = [local.vm_ip]
}
