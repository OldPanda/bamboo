"""Verify source pinning and the bounded extraction used for the native patch."""

import importlib.util
import io
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "prepare_parquet.py"
SPEC = importlib.util.spec_from_file_location("prepare_parquet", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ParquetBuildTests(unittest.TestCase):
    """Never compile mismatched inputs or extract unexpected links and paths."""

    def test_cmake_distribution_selection(self):
        """Use the installed pinned distribution and reject a different version."""
        with mock.patch.object(Path, "is_file", return_value=True):
            for system, suffix in (("Darwin", "cmake"), ("Windows", "cmake.exe")):
                with (
                    self.subTest(system=system),
                    mock.patch.object(
                        MODULE.subprocess,
                        "check_output",
                        side_effect=["/pinned/bin\n", b"cmake version 3.31.6\n"],
                    ) as run,
                ):
                    executable, _ = MODULE.cmake_tool(system)
                    self.assertEqual(executable, str(Path("/pinned/bin") / suffix))
                    self.assertIn("import cmake", run.call_args_list[0].args[0][-1])
            with mock.patch.object(
                MODULE.subprocess,
                "check_output",
                side_effect=["/pinned/bin\n", b"cmake version 4.0.0\n"],
            ):
                with self.assertRaisesRegex(ValueError, "hash-pinned CMake"):
                    MODULE.cmake_tool("Darwin")
            with mock.patch.object(
                MODULE.subprocess,
                "check_output",
                side_effect=subprocess.CalledProcessError(1, "python"),
            ):
                with self.assertRaisesRegex(RuntimeError, "requirements-build.txt"):
                    MODULE.cmake_tool("Darwin")

    def test_exact_patch_and_drift(self):
        """Apply only the intended source hunk, failing on changed native code."""
        patch = MODULE.PATCH.read_text()
        original = "".join(
            line[1:] for line in patch.splitlines(True)[3:] if line[0] in " -"
        )
        result = MODULE.apply_patch("prefix\n" + original + "suffix\n", patch)
        self.assertIn("s_ele.__isset.scale ? s_ele.scale : 0", result)
        self.assertNotIn("return LogicalType::DOUBLE", result)
        self.assertTrue(result.startswith("prefix\n"))
        self.assertTrue(result.endswith("suffix\n"))
        for source, edit in (
            ("different upstream", patch),
            (original * 2, patch),
            (original, "invalid"),
            (original, patch + "unexpected\n"),
        ):
            with self.subTest(source=source[:30]), self.assertRaises(ValueError):
                MODULE.apply_patch(source, edit)

    def test_cached_source_hash(self):
        """A corrupted download cache fails without invoking curl or a compiler."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            downloads = root / "build/downloads"
            downloads.mkdir(parents=True)
            archive = downloads / ("duckdb-" + MODULE.SOURCE + ".tar.gz")
            archive.write_bytes(b"corrupt")
            with (
                mock.patch.object(MODULE, "ROOT", root),
                mock.patch.object(MODULE.subprocess, "run") as run,
            ):
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    MODULE.source_archive()
                run.assert_not_called()

    def test_archive_entries(self):
        """Exclude upstream test symlinks and reject unsafe build-source entries."""
        prefix = "duckdb-" + MODULE.SOURCE
        for name, kind, allowed in (
            (prefix + "/src/include/reader.hpp", tarfile.REGTYPE, True),
            (prefix + "/data/csv/test-link", tarfile.SYMTYPE, True),
            (prefix + "/src/escape", tarfile.SYMTYPE, False),
            (prefix + "/src/hardlink", tarfile.LNKTYPE, False),
            (prefix + "/../escape", tarfile.REGTYPE, False),
            ("/absolute/escape", tarfile.REGTYPE, False),
            ("other/source", tarfile.REGTYPE, False),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "source.tar.gz"
                with tarfile.open(archive, "w:gz") as tar:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "../../outside"
                    if kind == tarfile.REGTYPE:
                        member.size = 4
                    tar.addfile(member, io.BytesIO(b"data"))
                if allowed:
                    source = MODULE.unpack(archive, root / "out")
                    self.assertEqual(
                        (source / "src/include/reader.hpp").exists(),
                        kind == tarfile.REGTYPE,
                    )
                    self.assertFalse((source / "data").exists())
                else:
                    with self.assertRaises(ValueError):
                        MODULE.unpack(archive, root / "out")


if __name__ == "__main__":
    unittest.main()
