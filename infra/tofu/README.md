# Infrastructure (OpenTofu)

Manages everything in production that's not the application code itself:

- **Cloudflare R2 buckets**: video uploads (`syllabus-tracker-videos-prod`), Litestream backups (`syllabus-tracker-db-backups-prod`).
- **GitHub Actions secrets**: the values consumed by `.github/workflows/deploy.yaml`. Source of truth lives in `secrets.enc.yaml` (SOPS-encrypted, committed). Editing the file plus `just tf apply` is the rotation flow.

The `tofu` binary comes from the dev shell (`flake.nix`). `terraform` was removed; OpenTofu reads existing Terraform state and `.tf` syntax unchanged.

## One-time bootstrap

### 1. Bootstrap tokens

You need two API tokens before the first `tofu apply`. Both go in `.secrets.env` at the repo root (see `.secrets.template.env`).

**Cloudflare**: at https://dash.cloudflare.com/profile/api-tokens, create a token with `Account > Workers R2 Storage > Edit`. Put in `.secrets.env` as `CLOUDFLARE_API_TOKEN`.

**GitHub PAT**: at https://github.com/settings/personal-access-tokens, create a fine-scoped token:

- Resource owner: `matthewtapps`
- Repository access: `syllabus-tracker` only
- Permissions: `Repository permissions > Secrets > Read and write`, `Repository permissions > Actions > Read and write`

Put in `.secrets.env` as `GITHUB_TOKEN`.

### 2. Age key for SOPS

```sh
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
```

This generates a key pair. The PUBLIC key (a single line starting with `age1...`) is printed to stderr and also lives as the `# public key:` comment in the file. Copy it.

Replace `AGE_KEY_PLACEHOLDER` in `.sops.yaml` (at the repo root) with the public key:

```yaml
creation_rules:
  - path_regex: infra/tofu/secrets\.enc\.yaml$
    age: age1abc...xyz
```

The private key at `~/.config/sops/age/keys.txt` is what decrypts. Back it up (password manager, hardware token, paper). Losing it means re-keying every secret.

### 3. Create the encrypted secrets file

```sh
just sops
```

This invokes `sops infra/tofu/secrets.enc.yaml`. Since the file doesn't exist yet, sops creates it using `.sops.yaml` and opens it in `$EDITOR`. Paste this template, fill in the real values, save:

```yaml
honeycomb_api_key: REPLACE_ME
honeycomb_marker_key: REPLACE_ME
rocket_secret_key: REPLACE_ME
nixos_server_ip: REPLACE_ME
nixos_server_user: REPLACE_ME
ssh_private_key: |
  -----BEGIN OPENSSH PRIVATE KEY-----
  REPLACE_ME
  -----END OPENSSH PRIVATE KEY-----
cloudflare_r2_access_key_id: REPLACE_ME
cloudflare_r2_secret_access_key: REPLACE_ME
cloudflare_r2_backups_access_key_id: REPLACE_ME
cloudflare_r2_backups_secret_access_key: REPLACE_ME
```

The keys are lowercase by convention; OpenTofu uppercases them to produce the GHA secret names (`honeycomb_api_key` becomes `HONEYCOMB_API_KEY`).

R2 token values come from the click-mint flow below. The rest live in your password manager.

On save, sops encrypts the file in place. The encrypted form is safe to commit; anyone without the age private key cannot read it.

### 4. Initialise OpenTofu

```sh
just tf init
```

Pulls the cloudflare, github, and sops providers and writes `.terraform.lock.hcl`.

### 5. Adopt existing GitHub Actions secrets

The secrets already exist in GitHub (set manually with `gh secret set` over the project's lifetime). `tofu import` brings them under management:

```sh
SECRETS=(
  honeycomb_api_key
  honeycomb_marker_key
  rocket_secret_key
  nixos_server_ip
  nixos_server_user
  ssh_private_key
  cloudflare_r2_access_key_id
  cloudflare_r2_secret_access_key
  cloudflare_r2_backups_access_key_id
  cloudflare_r2_backups_secret_access_key
)
for k in "${SECRETS[@]}"; do
  just tf import "github_actions_secret.app[\"$k\"]" "syllabus-tracker/$(echo "$k" | tr a-z A-Z)"
done
```

Important caveat: GitHub's API does NOT return secret values, only their names and timestamps. After import, `tofu plan` will report a diff on `plaintext_value` for every secret, because tofu has no way to learn what's actually stored at GitHub. The first `tofu apply` overwrites each secret with whatever is in `secrets.enc.yaml`. Make sure that file has the correct current values before applying, otherwise you will rotate secrets that the running app depends on.

### 6. First apply

```sh
just tf plan      # sanity-check the diff
just tf apply
```

After this, the R2 buckets and every managed GHA secret are tofu-controlled.

## Day-to-day

**Rotate a secret**: `just sops`, edit, save, `just tf apply`. The new value lands in GitHub Actions within seconds.

**Add a new GHA secret**: `just sops`, add a new key (e.g. `new_thing: ...`), save. Reference `secrets.NEW_THING` in `.github/workflows/deploy.yaml`. `just tf apply`. No `.tf` change required; the `for_each` in `github_secrets.tf` picks it up.

**Remove a GHA secret**: `just sops`, delete the key, save, `just tf apply`. Tofu destroys the GHA secret.

## Click-mint the runtime tokens

The app and Litestream each authenticate to R2 with an S3-compatible token that we mint by hand. Two tokens, one per bucket. Repeat the flow for each.

**For the videos bucket:**

1. Cloudflare dashboard > R2 Object Storage > **Manage R2 API Tokens** > **Create API Token**.
2. Permissions: **Object Read & Write**.
3. Specify bucket: `syllabus-tracker-videos-prod`.
4. Optional TTL or IP allow-list (skip for now).
5. Create. **Copy the Access Key ID and Secret Access Key.** The secret is shown exactly once.
6. `just sops`, paste into `cloudflare_r2_access_key_id` and `cloudflare_r2_secret_access_key`. Save. `just tf apply`.

**For the backups bucket:** same flow, but step 3 specifies `syllabus-tracker-db-backups-prod`, and step 6 uses `cloudflare_r2_backups_access_key_id` and `cloudflare_r2_backups_secret_access_key`.

Do not reuse the videos token for backups, or vice versa. The whole point of separate tokens is blast-radius separation.

The deploy workflow reads these from GitHub Actions secrets and writes them into `.secrets.env` on the prod host on every deploy.

## Bucket-versioning toggle

The Cloudflare Terraform provider doesn't expose a bucket-versioning resource. Toggle versioning on the backups bucket once, by hand:

Cloudflare dashboard > R2 Object Storage > `syllabus-tracker-db-backups-prod` > Settings > **Object Versioning** > Enable.

This protects the Litestream replica against accidental deletes for the bucket's versioning retention window.

## Why the R2 runtime tokens aren't tofu-managed

Future Matt, listen up.

You will be tempted to tofu the R2 tokens too. The `cloudflare_api_token` resource exists. The Cyb3r-Jak3 module does it. It looks clean. Past Matt tried this. It cost an hour and we backed out. Here's why:

1. **Permission group IDs.** R2-scoped tokens need two permission groups: `Workers R2 Storage Bucket Item Read` and `Workers R2 Storage Bucket Item Write`. These are referenced by UUID. The IDs are stable but Cloudflare does not publish them in static docs (only "Bucket Item Read" appears in the R2 token docs as a one-off example; "Bucket Item Write" is nowhere).

2. **The data source needs auth your bootstrap token can't grant.** The recommended path is `cloudflare_api_token_permission_groups_list`, which calls `/user/tokens/permission_groups`. That endpoint requires **user-level** auth. Your bootstrap token only has account-scope permissions. The user-scope permissions you would need to add are not exposed in the "Edit token" UI for an existing account-scoped token; you'd have to either create a new bootstrap token with mixed scopes, or fall back to the legacy global API key, neither of which is worth it for a one-time setup.

3. **Hardcoding the IDs is the workaround**, but you would still need to discover the Write ID once via some user-level call, and now the config carries opaque magic numbers that future-future-Matt will treat with suspicion.

The click-mint flow takes maybe two minutes per token. SOPS+tofu now manages where those tokens go (GitHub Actions), so rotation is `just sops` + apply, not five separate `gh secret set` calls. The remaining manual step is just minting the token at Cloudflare.

If Cloudflare ever exposes the permission group IDs in static docs, or makes the data source work with R2-scoped tokens, revisit.

## State

State is local at `infra/tofu/terraform.tfstate`. Gitignored. With the GHA secrets, and eventually the VM, in state, a remote backend becomes more important: anyone running `tofu apply` from a different machine would otherwise diverge. The cheapest path is a separate Cloudflare R2 bucket with an S3-compatible backend block; bootstrap it manually like the runtime tokens. Defer until there's a second machine that needs to apply.
