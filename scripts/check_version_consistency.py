#!/usr/bin/env python3
"""Check visible dashboard version consistency."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


VERSION_FILE = Path("src/lib/version.ts")
VISIBLE_SOURCE_PATHS = [
    Path("src/app"),
    Path("src/lib/version.ts"),
    Path("src/lib/appVersion.ts"),
]
STALE_VISIBLE_PATTERN = re.compile(r"AlphaScout Capital Flow System V\d+\.\d+(?:\.\d+)*(?:\.\d+)?|V1\.9\.\d+(?:\.\d+)?")


def read_app_version() -> str | None:
    if not VERSION_FILE.exists():
        return None
    text = VERSION_FILE.read_text()
    match = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', text)
    return match.group(1) if match else None


def source_files() -> list[Path]:
    files: list[Path] = []
    for path in VISIBLE_SOURCE_PATHS:
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(
                file
                for file in path.rglob("*")
                if file.suffix in {".ts", ".tsx", ".js", ".jsx"}
            )
    return sorted(set(files))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected", required=True)
    args = parser.parse_args()

    app_version = read_app_version()
    failures: list[str] = []
    if app_version != args.expected:
        failures.append(f"APP_VERSION mismatch: expected {args.expected}, found {app_version}")

    for file in source_files():
        text = file.read_text()
        for line_number, line in enumerate(text.splitlines(), start=1):
            if file == VERSION_FILE and args.expected in line:
                continue
            if "ESTIMATED_FLOW_PROXY_VERSION" in line:
                continue
            matches = [
                match.group(0)
                for match in STALE_VISIBLE_PATTERN.finditer(line)
                if args.expected not in match.group(0)
            ]
            if matches:
                failures.append(f"{file}:{line_number}: stale visible version {matches}")

    print(f"current APP_VERSION = {app_version}")
    print(f"expected APP_VERSION = {args.expected}")
    if failures:
        print("version consistency = FAIL")
        for failure in failures:
            print(failure)
        return 1
    print("version consistency = PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
