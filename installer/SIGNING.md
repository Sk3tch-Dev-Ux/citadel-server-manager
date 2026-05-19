# Code Signing the Citadel Installer

This runbook explains how to enable Authenticode code signing for the
NSIS installer that ships via GitHub Releases. Closes audit item N4.

## Why sign

Without an Authenticode signature, every user installing Citadel on a
fresh Windows machine hits a SmartScreen warning:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from starting.
> Running this app might put your PC at risk.
> App: CitadelSetup-X.Y.Z.exe   Publisher: Unknown publisher

Most users back out at this point. For a paid tool, that's an immediate
trust hit. Signing the installer with a code-signing certificate:

- Replaces "Unknown publisher" with your organization name
- Builds SmartScreen reputation over time (EV certs get instant reputation)
- Confirms to users — and to electron-updater — that the file they
  downloaded is the one you built and hasn't been tampered with in transit

This is also the second leg of the auto-updater integrity story. The
`sha512` in `latest.yml` proves the file matches what the build pipeline
produced; the signature proves the build pipeline itself is yours.

## What you need

### 1. A code-signing certificate

| Type | Cost (approx) | SmartScreen reputation | Notes |
|------|---------------|------------------------|-------|
| **EV** (Extended Validation) | $300–500/yr | Instant — no warning from the first download | Cert ships on a USB token; requires hardware key on the signing machine OR a cloud HSM (Azure Key Vault, DigiCert ONE) |
| **OV** (Organization Validation) | $150–300/yr | Builds over weeks/months as downloads accumulate | Standard PFX file, easier CI integration |

Reputable issuers: DigiCert, Sectigo (formerly Comodo), GlobalSign, SSL.com.
SSL.com is often the cheapest OV; DigiCert is the most expensive but the
fastest reputation curve for EV.

**For a Citadel-scale audience**: an OV cert is enough. Reputation accrues
within a few hundred downloads. EV makes sense if first-impression friction
matters more than $200/yr.

### 2. The PFX file and password

Once issued, you'll have a `.pfx` (PKCS12) file and a password. Keep
both somewhere safe:

- **Never commit the PFX to git.** It's an authentication credential.
- Store the password in a password manager.
- Back up the PFX to encrypted offline storage. If you lose it before
  the cert expires you'll have to re-issue (cost + reputation loss).

## Setup

### CI (GitHub Actions, recommended)

1. Base64-encode the PFX:

   ```bash
   # macOS / Linux
   base64 -i cert.pfx -o cert.b64.txt

   # Windows (PowerShell)
   certutil -encode cert.pfx cert.b64.txt
   ```

2. Open the repo on GitHub → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**, twice:

   - Name: `CITADEL_SIGN_PFX_BASE64`
     Value: paste the contents of `cert.b64.txt`
   - Name: `CITADEL_SIGN_PASSWORD`
     Value: the PFX password

3. That's it. The next time you push a `v*` tag, the
   `.github/workflows/release.yml` workflow will:
   - Decode the PFX to `$RUNNER_TEMP/citadel-signing.pfx`
   - Set `CITADEL_SIGN_PFX` and `CITADEL_SIGN_PASSWORD` env vars
   - `installer/build.js` detects both, runs
     `signtool sign /tr <timestamp-server> /td sha256 /fd sha256 ...`
     against the NSIS output
   - Re-verifies the signature landed with `signtool verify /pa`
   - Computes the `sha512` of the *signed* file for `latest.yml`

   If a signing step fails the workflow fails — there's no silent
   "release went out unsigned because the cert expired" path.

### Local dev builds

You can sign local builds too:

```bash
export CITADEL_SIGN_PFX=/absolute/path/to/cert.pfx
export CITADEL_SIGN_PASSWORD='your-pfx-password'
node installer/build.js
```

Requires `signtool.exe` on PATH (ships with the Windows 10/11 SDK). Local
signing is mostly useful for testing the workflow end-to-end before
committing CI changes — there's no real reason to sign dev builds.

## Verifying a signed installer

After the release lands, anyone can verify the signature:

```powershell
# Windows
signtool verify /pa /v CitadelSetup-X.Y.Z.exe
```

Or via right-click → Properties → Digital Signatures tab.

The signer name should match the "Subject" on your certificate. The
timestamp counter-signature locks the signature's validity to the time
of signing — so installers built today remain trusted even after the
cert eventually expires.

## EV certs: hardware token caveat

If you went with an EV cert, the private key lives on a YubiKey-style
USB token and `signtool` needs the token plugged into the signing machine.
That's incompatible with a GitHub-hosted runner.

Options if you need EV + CI:

1. **Cloud HSM** (DigiCert KeyLocker, Azure Key Vault, SSL.com eSigner):
   the issuer offers a cloud-hosted signing service; the workflow calls
   their REST API instead of running `signtool` locally. Requires
   different env vars and a different signing helper — file an issue and
   we'll wire it in.
2. **Self-hosted runner** with the token attached: feasible but creates
   a single point of failure (the physical machine).
3. **Use an OV cert for CI, EV for major releases**: the OV cert can
   stamp every CI build; you manually re-sign the v2.X.0 milestones with
   the EV token. Inconsistent but cheaper to set up.

For now, the build pipeline assumes OV (PFX + password). If you adopt EV,
the env-var contract may need to change — see `installer/build.js` →
`signInstallerIfConfigured`.

## Cert expiration

OV / EV certs typically issue with 1–3 year validity.

1. Calendar reminder ~60 days before expiration.
2. Order the renewal cert (same CA usually offers a renewal discount).
3. Replace the GitHub secret with the new PFX base64 + password.
4. Test by pushing a release.

Releases signed with the old cert remain valid forever — the timestamp
counter-signature locks them. Only NEW signatures need a valid cert.

## Open issues / future work

- **Mac signing & notarization** — not needed today (no mac build), but
  if Citadel ships a `.dmg` or `.pkg` in the future, that's a separate
  cert + an Apple Developer account ($99/yr) + a notarization step.
- **Cloud HSM signing** for EV in CI — see the EV section above.
