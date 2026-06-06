# Database backups

Production replicates `sqlite.db` continuously to a dedicated Cloudflare R2 bucket using [Litestream](https://litestream.io). This document covers what's running, how to restore, and the drill you should run quarterly to prove the backups work.

## What's running

A `litestream` sidecar service in `docker-compose.nixos.yml` shares the `app-data` named volume with the app and ships WAL segments to R2 every 60 seconds. Once a day it takes a fresh snapshot. Snapshots and WAL frames older than 30 days are purged automatically.

This gives us:

- **RPO**: at most 60 seconds of writes lost in a disaster.
- **Restore window**: any point in time within the last 30 days.
- **Restore time**: roughly seconds-to-minutes for our DB size (low MB).

The replica lives in R2 bucket `syllabus-tracker-db-backups-prod` under the `db/` prefix. It is a different bucket and a different API token from the video bucket so a credential leak in one doesn't compromise the other.

SQLite runs in WAL mode (set via `PRAGMA journal_mode=WAL` in both the app and the migrate binary). Three files live on disk: `sqlite.db`, `sqlite.db-wal`, `sqlite.db-shm`. Never copy just one of them with `cp`. Use the restore command below.

## One-time setup

The bucket is Terraform-managed; the S3 API token is click-minted in the R2 dashboard. See [`infra/terraform/README.md`](../infra/terraform/README.md) for why we don't Terraform the token.

### 1. Apply Terraform to create the bucket

```sh
just tf apply
```

This creates the `syllabus-tracker-db-backups-prod` bucket (assuming `CLOUDFLARE_API_TOKEN` is in `.secrets.env` with `Workers R2 Storage > Edit` scope).

### 2. Enable bucket versioning (manual)

The Cloudflare Terraform provider doesn't expose a versioning resource yet. Toggle it once by hand: Cloudflare dashboard > R2 > `syllabus-tracker-db-backups-prod` > Settings > **Object Versioning** > Enable. Cheap insurance against an accidental delete or a buggy retention sweep.

### 3. Click-mint the Litestream token and stash the credentials

1. Cloudflare dashboard > R2 Object Storage > **Manage R2 API Tokens** > **Create API Token**.
2. Permissions: **Object Read & Write**.
3. Specify bucket: `syllabus-tracker-db-backups-prod`. **Do not** reuse the videos token; the whole point is blast-radius separation.
4. Create. **Copy the Access Key ID and Secret Access Key.** The secret is shown exactly once.
5. Add to SOPS via `just sops`:
   ```yaml
   r2_backups_access_key_id: <paste Access Key ID>
   r2_backups_secret_access_key: <paste Secret Access Key>
   ```
   Save. Then `just tf apply` pushes them to GitHub Actions as `R2_BACKUPS_ACCESS_KEY_ID` and `R2_BACKUPS_SECRET_ACCESS_KEY`.

The deploy workflow (`.github/workflows/deploy.yaml`) writes them into `.secrets.env` on the prod host as `LITESTREAM_ACCESS_KEY_ID` and `LITESTREAM_SECRET_ACCESS_KEY` where the Litestream container picks them up via `env_file`.

The non-secret bits (`LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`) live in `config/prod.env` and are also OpenTofu outputs in case they ever need to change.

### 4. Deploy

After the secrets exist, the next deploy will start the Litestream container. Confirm it's working:

```sh
docker logs syllabus-tracker-litestream
```

You should see lines like `wrote snapshot`, then periodic `wrote wal segment`. Check the R2 bucket via the Cloudflare dashboard, you should see objects appearing under `db/`.

## Restoring

You need the Litestream binary locally and the R2 credentials in env. The binary is in the `nix develop` shell or available as a static binary from the Litestream releases page.

### Latest

```sh
export LITESTREAM_BUCKET=syllabus-tracker-db-backups-prod
export LITESTREAM_ENDPOINT=https://ea9e8573831e597fc41f865267b8fd35.r2.cloudflarestorage.com
export LITESTREAM_ACCESS_KEY_ID=<from 1Password / dashboard>
export LITESTREAM_SECRET_ACCESS_KEY=<from 1Password / dashboard>

litestream restore \
  -config ./config/litestream.yml \
  -o /tmp/restored.db \
  /data/sqlite.db
```

Note that the `/data/sqlite.db` argument matches the `dbs.path` in `litestream.yml`, it does not refer to a local file. It tells Litestream which configured DB to restore.

### Point-in-time

```sh
litestream restore \
  -config ./config/litestream.yml \
  -o /tmp/restored.db \
  -timestamp 2026-06-01T12:00:00Z \
  /data/sqlite.db
```

### Verifying a restored copy

```sh
sqlite3 /tmp/restored.db "PRAGMA integrity_check;"
sqlite3 /tmp/restored.db "SELECT COUNT(*) FROM users;"
sqlite3 /tmp/restored.db "SELECT COUNT(*) FROM techniques;"
```

`integrity_check` should print `ok`. Counts should be plausible.

### Actually swapping the prod DB

If you're restoring after a real disaster, **stop the app and Litestream containers first** so nothing is writing to the volume while you swap files.

```sh
docker compose -f docker-compose.nixos.yml stop app litestream

# Inside the app-data volume, remove the old DB and its sidecars, drop the
# restored DB in place, and clear any stale generation marker so Litestream
# starts a fresh generation pointing at the new file.
sudo rm /var/lib/docker/volumes/syllabus-tracker-services_app-data/_data/sqlite.db*
sudo cp /tmp/restored.db /var/lib/docker/volumes/syllabus-tracker-services_app-data/_data/sqlite.db
sudo chown <docker uid>:<docker gid> /var/lib/docker/volumes/syllabus-tracker-services_app-data/_data/sqlite.db

docker compose -f docker-compose.nixos.yml start app litestream
```

Litestream will detect a new database and start a fresh generation on next sync.

## Quarterly drill

Backups not verified are backups not had. Once a quarter (or after any meaningful infra change to this path), do the following from a machine that is **not** the prod server:

1. Set the four `LITESTREAM_*` env vars.
2. `litestream restore -config ./config/litestream.yml -o /tmp/drill.db /data/sqlite.db`.
3. `sqlite3 /tmp/drill.db "PRAGMA integrity_check;"`, expect `ok`.
4. Spot-check a couple of tables: `SELECT COUNT(*) FROM users;`, `SELECT COUNT(*) FROM techniques;`. Compare to live.
5. Delete `/tmp/drill.db`.

If any step fails, that's a real incident. Find out why before you need the backup for real.

## File layout in the R2 bucket

Litestream organizes objects under the configured prefix (`db/` here):

```
db/
  generations/
    <generation-id>/
      snapshots/
        ...
      wal/
        ...
```

Generations are 16-character hex IDs. A new generation is cut whenever Litestream detects a break in WAL continuity (a crash, a restart, a manual restore). Each generation is self-contained: one snapshot plus its tail of WAL frames is enough to restore.

You should never need to poke at these files directly. `litestream restore` and `litestream snapshots` are the tools for inspecting state.

## Cost

Cloudflare R2's free tier (10 GB storage, 1M Class A ops/month, 10M Class B ops/month, zero egress) comfortably covers our usage:

- Storage: well under 100 MB across all snapshots and WAL.
- Class A ops: at `sync-interval: 60s`, worst case is ~43k PUTs/month, well under the 1M cap.
- Class B ops: only used on restore.

If write volume ever grows enough to push Class A ops near the cap, bump `sync-interval` higher in `config/litestream.yml`.
