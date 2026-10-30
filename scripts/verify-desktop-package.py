#!/usr/bin/env python3
"""Install and launch the actual packages only in a disposable native Actions session."""

import ctypes
import hashlib
import json
import os
import platform
import struct
import subprocess
import tarfile
import time
import zipfile
from pathlib import Path

from release_version import parse_version

ROOT = Path(__file__).resolve().parents[1]


def window_for(pid):
    """Return a visible native window for this process, without affecting other apps."""
    if platform.system() == "Windows":
        from ctypes import wintypes

        found = []
        user32 = ctypes.windll.user32
        callback_type = ctypes.WINFUNCTYPE(
            wintypes.BOOL, wintypes.HWND, wintypes.LPARAM
        )
        user32.IsWindowVisible.argtypes = [wintypes.HWND]
        user32.GetWindowThreadProcessId.argtypes = [
            wintypes.HWND,
            ctypes.POINTER(wintypes.DWORD),
        ]

        @callback_type
        def check(hwnd, _):
            owner = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            if owner.value == pid and user32.IsWindowVisible(hwnd):
                found.append(hwnd)
            return True

        user32.EnumWindows(check, 0)
        return found[0] if found else None
    result = subprocess.run(
        ["xdotool", "search", "--onlyvisible", "--pid", str(pid)],
        capture_output=True,
        text=True,
    )
    return result.stdout.splitlines()[0] if result.returncode == 0 else None


def close_x11(window):
    """Send WM_DELETE_WINDOW so GTK follows its normal close/quit lifecycle."""
    x11 = ctypes.CDLL("libX11.so.6")

    class Message(ctypes.Structure):
        _fields_ = [
            ("type", ctypes.c_int),
            ("serial", ctypes.c_ulong),
            ("send_event", ctypes.c_int),
            ("display", ctypes.c_void_p),
            ("window", ctypes.c_ulong),
            ("message_type", ctypes.c_ulong),
            ("format", ctypes.c_int),
            ("data", ctypes.c_long * 5),
        ]

    class Event(ctypes.Union):
        _fields_ = [("message", Message), ("padding", ctypes.c_long * 24)]

    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x11.XInternAtom.restype = ctypes.c_ulong
    x11.XSendEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_long,
        ctypes.POINTER(Event),
    ]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError("Cannot connect to the disposable X display")
    try:
        event = Event()
        event.message.type = 33
        event.message.display = display
        event.message.window = int(window)
        event.message.message_type = x11.XInternAtom(display, b"WM_PROTOCOLS", 0)
        event.message.format = 32
        event.message.data[0] = x11.XInternAtom(display, b"WM_DELETE_WINDOW", 0)
        if not x11.XSendEvent(display, int(window), 0, 0, ctypes.byref(event)):
            raise RuntimeError("Native window close request failed")
        x11.XFlush(display)
    finally:
        x11.XCloseDisplay(display)


def launch(binary, output, label):
    """Require a visible window from the packaged production binary, then close it."""
    env = {**os.environ, "BAMBOO_CONFIG_DIR": str(output / (label + "-config"))}
    env.pop("BAMBOO_SMOKE", None)
    if platform.system() == "Windows":
        system = Path(os.environ["SystemRoot"])
        env["PATH"] = str(system / "System32") + os.pathsep + str(system)
    with (output / (label + ".log")).open("w") as log:
        process = subprocess.Popen(
            [str(binary)], env=env, stdout=log, stderr=subprocess.STDOUT
        )
        try:
            window = None
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(
                        f"Packaged {label} exited before opening a window: {process.returncode}"
                    )
                window = window_for(process.pid)
                if window:
                    break
                time.sleep(0.25)
            if not window:
                raise RuntimeError(f"Packaged {label} did not open a window")
            if platform.system() == "Windows":
                from ctypes import wintypes

                ctypes.windll.user32.PostMessageW.argtypes = [
                    wintypes.HWND,
                    wintypes.UINT,
                    wintypes.WPARAM,
                    wintypes.LPARAM,
                ]
                ctypes.windll.user32.PostMessageW(window, 0x0010, 0, 0)
            else:
                close_x11(window)
            code = process.wait(timeout=20)
            if code != 0:
                raise RuntimeError(f"Packaged {label} close returned {code}")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def main():
    """Verify archive integrity, x64 machine type, licenses, installer and startup."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit(
            "Package launch/install checks require a disposable Actions runner"
        )
    output = ROOT / "artifacts/package-smoke"
    output.mkdir(parents=True, exist_ok=True)
    releases = ROOT / "build/releases"
    windows = platform.system() == "Windows"
    archives = list(releases.glob("*.zip" if windows else "*.tar.gz"))
    if len(archives) != 1:
        raise SystemExit("Expected one native archive")
    for checksum in releases.glob("*.sha256"):
        digest, name = checksum.read_text().strip().split("  ", 1)
        if hashlib.sha256((releases / name).read_bytes()).hexdigest() != digest:
            raise SystemExit("Package checksum mismatch")
    archive = archives[0]
    if windows:
        with zipfile.ZipFile(archive) as source:
            source.extractall(output / "portable")
    else:
        with tarfile.open(archive) as source:
            source.extractall(output / "portable", filter="data")
    app = output / "portable/Bamboo"
    binary = app / ("bamboo.exe" if windows else "bamboo")
    data = binary.read_bytes()
    if windows:
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        valid = (
            data[pe : pe + 4] == b"PE\0\0"
            and struct.unpack_from("<H", data, pe + 4)[0] == 0x8664
        )
    else:
        valid = (
            data[:5] == b"\x7fELF\x02" and struct.unpack_from("<H", data, 18)[0] == 62
        )
    if str(ROOT).encode() in data or ROOT.as_posix().encode() in data:
        raise SystemExit("Production executable contains the build checkout path")
    if not valid:
        raise SystemExit("Packaged binary is not native x64")
    for name in (
        "LICENSE",
        "THIRD_PARTY.md",
        "licenses/manifest.json",
        "extensions/httpfs.duckdb_extension",
        "build-info.json",
    ):
        if not (app / name).is_file():
            raise SystemExit("Missing packaged resource: " + name)
    version = parse_version(os.environ["BAMBOO_VERSION"])[0]
    metadata = json.loads((app / "build-info.json").read_text())
    expected = {
        "version": version,
        "platform": platform.system().lower(),
        "architecture": "amd64",
        "commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True
        ).strip(),
    }
    if metadata != expected:
        raise SystemExit("Package metadata does not match the checked-out release")
    build = subprocess.check_output(["go", "version", "-m", str(binary)], text=True)
    if f"vcs.revision={expected['commit']}\n" not in build:
        raise SystemExit("Executable source commit does not match the release")
    if windows:
        resource_version = subprocess.check_output(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-Item -LiteralPath $env:BAMBOO_VERIFY_EXE).VersionInfo.ProductVersion",
            ],
            env={**os.environ, "BAMBOO_VERIFY_EXE": str(binary)},
            text=True,
        ).strip()
        if resource_version != version:
            raise SystemExit("Windows executable resource version mismatch")
    if not windows:
        for native in (binary, app / "extensions/httpfs.duckdb_extension"):
            dependencies = subprocess.check_output(["ldd", str(native)], text=True)
            if "not found" in dependencies:
                raise SystemExit("Missing packaged runtime dependency")
            print(dependencies)
    launch(binary, output, "portable")
    if windows:
        installer = next(releases.glob("*-setup.exe"))
        install = output / "installed"
        subprocess.run([str(installer), "/S", f"/D={install}"], check=True, timeout=60)
        installed = install / "bamboo.exe"
    else:
        installer = next(releases.glob("*.deb"))
        subprocess.run(
            ["sudo", "apt-get", "install", "-y", str(installer)],
            check=True,
            timeout=120,
        )
        installed = Path("/opt/bamboo/bamboo")
    if hashlib.sha256(installed.read_bytes()).digest() != hashlib.sha256(data).digest():
        raise SystemExit("Installed executable differs from the portable executable")
    launch(installed, output, "installed")
    report = {
        "platform": platform.system(),
        "architecture": "amd64",
        "checksums": "passed",
        "portableLaunchAndClose": "passed",
        "installerLaunchAndClose": "passed",
        "metadata": metadata,
    }
    (output / "package-smoke.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
