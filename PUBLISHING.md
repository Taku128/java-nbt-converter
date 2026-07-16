# Publishing

How releases of this monorepo reach npm, and the one-time manual setup required
on npmjs.com.

## Release flow (automated)

1. A PR lands on `main` with a changeset (`.changeset/*.md`).
2. `.github/workflows/publish.yml` runs `changesets/action`, which opens/updates
   the **"Version Packages"** PR.
3. Merging that PR triggers the same workflow again, which runs
   `pnpm changeset publish` — this publishes every package whose version is not
   yet on npm, pushes git tags, and creates GitHub Releases.

The publish step authenticates via **npm trusted publishing (OIDC)** — no
long-lived secret in CI. A one-time registration on npmjs.com is required per
package (below). Until it is done, CI publish fails with `ENEEDAUTH`.

## Packages in this repo

| npm package | Directory |
| --- | --- |
| `@taku128/java-schematic` | `packages/js/java-schematic` |

## One-time setup: register the trusted publisher (manual, npmjs.com)

Repeat for **every package** in the table above:

1. Log in to <https://www.npmjs.com/> as the package owner (`taku128`).
2. Open the package page → **Settings** tab
   (e.g. `https://www.npmjs.com/package/@taku128/java-schematic/access`).
3. In the **Trusted Publisher** section, select **GitHub Actions** and enter
   exactly:

   | Field | Value |
   | --- | --- |
   | Organization or user | `Taku128` |
   | Repository | `java-nbt-converter` |
   | Workflow filename | `publish.yml` |
   | Environment name | *(leave empty)* |

4. Save. From the next merge of a "Version Packages" PR, CI publishes without
   any token, and npm attaches **provenance attestations** automatically.

Notes:

- The workflow filename is the base name only (`publish.yml`, not the full
  path). If the workflow file is ever renamed, the trusted publisher entry must
  be updated to match.
- Trusted publishing only works on GitHub-hosted runners (this repo uses
  `ubuntu-latest`, so that is fine).
- Optional hardening once OIDC publishing is confirmed working: in each
  package's Settings → *Publishing access*, choose the option that **disallows
  tokens**. Trusted publishing is not a token, so CI keeps working, while
  stolen tokens become useless. Do this only if you no longer need the token
  fallback below.

## Fallback: token-based publishing (`NPM_TOKEN`)

If OIDC cannot be used for some reason, the workflow also supports classic
token auth. When the `NPM_TOKEN` secret is set, it **takes precedence** over
OIDC (changesets/action writes it to `~/.npmrc`).

1. npmjs.com → avatar → **Access Tokens** → **Generate New Token** →
   **Granular Access Token**:
   - Expiration: pick a finite date (rotation required).
   - Packages and scopes: **Read and write**, scoped to `@taku128` (or select
     only the packages in the table above).
2. Store it as a repository secret:

   ```bash
   gh secret set NPM_TOKEN --repo Taku128/java-nbt-converter
   ```

To go back to OIDC, delete the secret:

```bash
gh secret delete NPM_TOKEN --repo Taku128/java-nbt-converter
```

## Manual publish from a local machine (last resort)

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm changeset publish   # prompts for npm login / OTP as needed
git push --follow-tags
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `ENEEDAUTH` in CI | Trusted publisher not registered for that package, and no `NPM_TOKEN` secret set. |
| OIDC token exchange fails / 404 | Field mismatch in the trusted publisher entry (repo name, workflow filename, or environment). |
| `E422` / provenance error | `repository.url` in the package's `package.json` does not match this GitHub repo. |
| Publish succeeds but no provenance badge | Check `NPM_CONFIG_PROVENANCE` env and `id-token: write` permission in `publish.yml`. |
