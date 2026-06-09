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

# Staging sibling for inspecting WIP roadmap work. Backed by the
# `staging.yml` workflow which builds images from a named branch and
# deploys a parallel stack to sugar-glider with HTTPS via Let's Encrypt.
resource "aws_route53_record" "sillybus_staging" {
  zone_id = data.terraform_remote_state.platform.outputs.zone_ids["sillybus.app"]
  name    = "staging.sillybus.app"
  type    = "A"
  ttl     = 300
  records = [local.vm_ip]
}
