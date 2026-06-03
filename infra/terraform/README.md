# Cloudflare R2 (videos + database backups)

Provisions the two production R2 buckets:

- **Videos** (`syllabus-tracker-videos-prod`): native video uploads.
- **Database backups** (`syllabus-tracker-db-backups-prod`): Litestream replica target.

Resources used: `cloudflare_r2_bucket` and `cloudflare_r2_bucket_cors`.

**Runtime S3 API tokens are not Terraform-managed.** They are click-minted in the R2 dashboard and pasted into GitHub Actions secrets. See [Click-mint the runtime tokens](#click-mint-the-runtime-tokens) and [Why the tokens aren't Terraform-managed](#why-the-tokens-arent-terraform-managed) below.

## One-time setup

### 1. Bootstrap token for Terraform itself

Generate a Cloudflare API token at https://dash.cloudflare.com/profile/api-tokens with **Account > Workers R2 Storage > Edit** scoped to this account. No zone permissions needed.

Put it in `.secrets.env` as `CLOUDFLARE_API_TOKEN=...`. `just tf` sources `.secrets.env` and exports it for the provider.

### 2. Apply

```sh
just tf init
just tf plan
just tf apply
```

Outputs:

| Output | Used as |
| --- | --- |
| `bucket_name` | `S3_BUCKET` for the videos bucket in `config/prod.env`. |
| `s3_endpoint` | `S3_ENDPOINT` for videos. |
| `db_backups_bucket_name` | `LITESTREAM_BUCKET` in `config/prod.env`. |
| `litestream_endpoint` | `LITESTREAM_ENDPOINT` in `config/prod.env`. |

State is local. Move to a remote backend once you have credentials parked somewhere durable.

### 3. Enable versioning on the backups bucket

The Cloudflare Terraform provider doesn't expose a bucket-versioning resource yet. Toggle versioning once, by hand:

Cloudflare dashboard > R2 Object Storage > `syllabus-tracker-db-backups-prod` > Settings > **Object Versioning** > Enable.

This protects the Litestream replica against accidental deletes (and against retention sweeps misbehaving) for the bucket's versioning retention window.

## Click-mint the runtime tokens

The app and Litestream each authenticate to R2 with an S3-compatible token that we mint by hand. Two tokens, one per bucket. Repeat the flow for each.

**For the videos bucket:**

1. Cloudflare dashboard > R2 Object Storage > **Manage R2 API Tokens** > **Create API Token**.
2. Permissions: **Object Read & Write**.
3. Specify bucket: `syllabus-tracker-videos-prod`.
4. Optional TTL or IP allow-list (skip for now).
5. Create. **Copy the Access Key ID and Secret Access Key.** The secret is shown exactly once.
6. In the repo, set the GitHub Actions secrets:
   ```sh
   gh secret set CLOUDFLARE_R2_ACCESS_KEY_ID         # paste Access Key ID
   gh secret set CLOUDFLARE_R2_SECRET_ACCESS_KEY     # paste Secret Access Key
   ```

**For the backups bucket:** same flow, but step 3 specifies `syllabus-tracker-db-backups-prod`, and step 6 uses:

```sh
gh secret set CLOUDFLARE_R2_BACKUPS_ACCESS_KEY_ID
gh secret set CLOUDFLARE_R2_BACKUPS_SECRET_ACCESS_KEY
```

Do not reuse the videos token for backups, or vice versa. The whole point of separate tokens is blast-radius separation.

The deploy workflow (`.github/workflows/deploy.yaml`) reads these four secrets and writes them into `.secrets.env` on the prod host on every deploy.

## Why the tokens aren't Terraform-managed

Future Matt, listen up.

You will be tempted to Terraform the R2 tokens too. The `cloudflare_api_token` resource exists. The Cyb3r-Jak3 module does it. It looks clean: same `just tf apply`, no manual dashboard step, full audit trail, easy rotation. Past Matt tried this. It cost an hour and we backed out. Here's why:

1. **Permission group IDs.** R2-scoped tokens need two permission groups: `Workers R2 Storage Bucket Item Read` and `Workers R2 Storage Bucket Item Write`. These are referenced by UUID. The IDs are stable but Cloudflare does not publish them in static docs (only "Bucket Item Read" appears in the R2 token docs as a one-off example; "Bucket Item Write" is nowhere).

2. **The data source needs auth your bootstrap token can't grant.** The recommended path is `cloudflare_api_token_permission_groups_list`, which calls `/user/tokens/permission_groups`. That endpoint requires **user-level** auth. Your bootstrap token only has account-scope permissions. The user-scope permissions you would need to add are not exposed in the "Edit token" UI for an existing account-scoped token; you'd have to either create a new bootstrap token with mixed scopes, or fall back to the legacy global API key, neither of which is worth it for a one-time setup.

3. **Hardcoding the IDs is the workaround**, but you would still need to discover the Write ID once via some user-level call, and now the Terraform config carries opaque magic numbers that future-future-Matt will treat with suspicion.

The click-mint flow takes maybe two minutes per token, leaves no opaque IDs in code, and matches what the videos token has always been. The "one token, one dashboard visit, one paste" friction is genuinely lower than the Terraform path here. Cloudflare just didn't pave this corner well.

If Cloudflare ever exposes the permission group IDs in static docs, or makes the data source work with R2-scoped tokens, revisit. Until then, click-mint.

The buckets themselves are Terraform-managed because *that* path is paved.
