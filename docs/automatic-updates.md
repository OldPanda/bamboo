# Automatic updates

Bamboo uses Sparkle 2.10.1 for signed macOS updates. **Settings → General** shows
the installed version, a **Check for updates** button and an automatic-check
switch. The switch uses Sparkle's persisted preferences. Background checks are
enabled by default and scheduled hourly (`SUScheduledCheckInterval=3600`, the
[minimum supported by Sparkle](https://sparkle-project.org/documentation/customization/)).
Disabling automatic checks remains effective after an upgrade; installing and restarting require the user's confirmation.
Scheduled checks display a quiet **Update to …** button above Settings in the
lower-left sidebar. Clicking it opens Sparkle's update confirmation; it does not
grant permission to install or restart on its own. Dismissing or postponing the
update leaves the current session running. Bamboo never silently installs updates
or restarts while a user is working.

The app reads the signed `appcast.xml` attached to the latest stable GitHub
Release. Sparkle verifies the feed and the DMG's Ed25519 signature before
extracting or installing anything. Checks use HTTPS and send no query contents,
file paths, cloud credentials or Sparkle system profile. GitHub still receives
normal HTTP request metadata. An offline or failed background check leaves the
installed application usable.

## One-time signing setup

The public key is versioned in `assets/update-public-key.txt`. The corresponding
private key is stored in the macOS login Keychain under the Sparkle account
`Bamboo-OldPanda`. Keep a secure Keychain backup: losing this key can prevent
existing ad-hoc-signed installations from accepting future updates. Do not
replace the public key as a routine setup step.

Configure the repository Actions secret named **`SPARKLE_PRIVATE_KEY`**. With an
authenticated GitHub CLI, run:

```sh
bash scripts/configure-update-signing.sh
```

Without GitHub CLI, run this explicitly to copy the existing private key:

```sh
bash scripts/configure-update-signing.sh --copy
```

Paste it into **Secret** at
[New repository secret](https://github.com/OldPanda/bamboo/settings/secrets/actions/new),
name it `SPARKLE_PRIVATE_KEY`, save, then clear the clipboard. The script uses a
private temporary file and removes it on exit; it never prints the secret. Never
paste the key into an issue, commit, build log or chat.

Release builds fail before publication if the secret is missing, malformed or
does not match the bundled public key. PR CI never receives this secret. Release
signing passes the private seed through stdin, not command-line arguments.

## Publishing and testing

The existing version-tag workflow packages the app, signs the DMG, generates and
signs `appcast.xml`, verifies both signatures, then publishes both assets with the
checksum. The updater follows the latest **stable** release; prereleases are not
automatically offered. A prerelease with the same numeric version as a stable
release may need manual installation to move to that stable release.

For a local package using the Keychain signing identity:

```sh
BAMBOO_VERSION=v0.1.0 npm run build
BAMBOO_VERSION=v0.1.0 npm run package:dmg
BAMBOO_VERSION=v0.1.0 python3 scripts/sign-appcast.py
python3 scripts/native-updater-smoke.py
```

The smoke check uses a temporary app, isolated preferences and disabled network
checks; it opens no windows. Unit tests cover feed metadata, signing identity,
error handling and settings. A full install/relaunch acceptance test needs two
published versions and a disposable installed copy of the app. The first
updater-enabled version must be installed manually on older Bamboo versions.

Sparkle signatures authenticate updates; they do not replace Apple Developer ID
signing or notarization. The current application is still ad-hoc signed.
