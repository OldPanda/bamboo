#!/usr/bin/env python3
"""Package already-tested native desktop binaries; never publish or overwrite releases."""

import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

from release_version import parse_version

ROOT = Path(__file__).resolve().parents[1]


def main():
    """Produce an installer, portable archive, metadata and checksums for this host."""
    system = platform.system()
    if (system, platform.machine().lower()) not in (
        ("Windows", "amd64"),
        ("Linux", "x86_64"),
    ):
        raise SystemExit("Packaging requires a native Windows/Linux x64 runner")
    version = parse_version(
        os.environ.get(
            "BAMBOO_VERSION", json.loads((ROOT / "package.json").read_text())["version"]
        )
    )[0]
    name = f"Bamboo-{version}-{system.lower()}-x64"
    releases = ROOT / "build/releases"
    releases.mkdir(parents=True, exist_ok=True)
    if list(releases.glob(name + "*")):
        raise SystemExit("Refusing to overwrite existing release files")
    with tempfile.TemporaryDirectory(dir=ROOT / "build") as temp:
        stage = Path(temp) / "Bamboo"
        stage.mkdir()
        binary = "bamboo.exe" if system == "Windows" else "bamboo"
        shutil.copy2(ROOT / "build" / binary, stage / binary)
        shutil.copytree(ROOT / "build/extensions", stage / "extensions")
        shutil.copytree(ROOT / "licenses", stage / "licenses")
        for source in ("LICENSE", "THIRD_PARTY.md", "docs/windows-linux.md"):
            shutil.copy2(ROOT / source, stage / Path(source).name)
        metadata = {
            "version": version,
            "platform": system.lower(),
            "architecture": "amd64",
            "commit": subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
            ).strip(),
        }
        (stage / "build-info.json").write_text(json.dumps(metadata, indent=2) + "\n")
        if system == "Windows":
            shutil.copy2(ROOT / "build/bamboo.ico", stage / "bamboo.ico")
            shutil.make_archive(str(releases / name), "zip", temp, "Bamboo")
            makensis = (
                shutil.which("makensis") or r"C:\Program Files (x86)\NSIS\makensis.exe"
            )
            subprocess.run(
                [
                    makensis,
                    f"/DAPPDIR={stage}",
                    f"/DOUTFILE={releases / (name + '-setup.exe')}",
                    f"/DVERSION={version}",
                    str(ROOT / "scripts/windows-installer.nsi"),
                ],
                check=True,
            )
        else:
            with tarfile.open(releases / (name + ".tar.gz"), "w:gz") as archive:
                archive.add(stage, arcname="Bamboo")
            deb = Path(temp) / "deb"
            app = deb / "opt/bamboo"
            app.parent.mkdir(parents=True)
            shutil.copytree(stage, app)
            control = deb / "DEBIAN"
            control.mkdir()
            (control / "control").write_text(
                f"Package: bamboo\nVersion: {version}\nArchitecture: amd64\nMaintainer: Bamboo contributors\nDepends: libgtk-3-0, libwebkit2gtk-4.1-0, libsecret-1-0, libstdc++6, libc6 (>= 2.35), xdg-utils\nRecommends: gnome-keyring\nDescription: Local and cloud Parquet desktop workbench\n"
            )
            applications = deb / "usr/share/applications"
            applications.mkdir(parents=True)
            (applications / "bamboo.desktop").write_text(
                "[Desktop Entry]\nType=Application\nName=Bamboo\nComment=Parquet workbench\nExec=/opt/bamboo/bamboo\nIcon=bamboo\nTerminal=false\nCategories=Development;Utility;\n"
            )
            icons = deb / "usr/share/icons/hicolor/512x512/apps"
            icons.mkdir(parents=True)
            shutil.copy2(ROOT / "frontend/src/assets/bamboo.png", icons / "bamboo.png")
            commands = deb / "usr/bin"
            commands.mkdir(parents=True)
            (commands / "bamboo").symlink_to("/opt/bamboo/bamboo")
            subprocess.run(
                [
                    "dpkg-deb",
                    "--root-owner-group",
                    "--build",
                    str(deb),
                    str(releases / (name + ".deb")),
                ],
                check=True,
            )
    for output in sorted(releases.glob(name + "*")):
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        output.with_name(output.name + ".sha256").write_text(
            f"{digest}  {output.name}\n"
        )
        print(output)


if __name__ == "__main__":
    main()
