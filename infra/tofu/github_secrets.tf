# Manages GitHub Actions secrets via SOPS-encrypted source-of-truth.
#
# Edit values:        `just sops`     (opens secrets.enc.yaml in your editor)
# Apply to GitHub:    `just tf apply`
#
# Adding a new secret: add a lowercase key to secrets.enc.yaml. Its uppercased
# form becomes the GHA secret name. No code change needed here.

data "sops_file" "github_secrets" {
  source_file = "${path.module}/secrets.enc.yaml"
}

resource "github_actions_secret" "app" {
  # The whole SOPS data map is sensitive, which makes it illegal as a
  # for_each argument (keys would leak into resource addresses). The keys
  # themselves are just secret *names*, not values, so we strip the
  # sensitivity flag from the key set and look values up at use site.
  for_each = nonsensitive(toset(keys(data.sops_file.github_secrets.data)))

  repository  = var.github_repository
  secret_name = upper(each.key)
  value       = data.sops_file.github_secrets.data[each.key]
}
