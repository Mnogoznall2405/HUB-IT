from __future__ import annotations

import argparse
import csv
import getpass
import locale
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PureWindowsPath


DEFAULT_COMPUTER_NAME = "TMN-LAW-0033"
SCRIPT_DIR = Path(__file__).resolve().parent


@dataclass
class LogRow:
    line_number: int
    original_line: str
    source_path: str
    remote_path: str
    destination_path: str
    status: str
    message: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Move files from a remote Windows C$ admin share into a local folder, "
            "using a semicolon-separated path list."
        )
    )
    parser.add_argument("--computer-name", default=DEFAULT_COMPUTER_NAME)
    parser.add_argument("--list-path", default=str(SCRIPT_DIR / "Py.txt"))
    parser.add_argument("--destination-root", default=str(SCRIPT_DIR / "moved_files"))
    parser.add_argument(
        "--username",
        help=(
            "Optional admin username for net use, for example DOMAIN\\user. "
            "If omitted, current Windows credentials are used."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Check the list and log planned moves without moving files.",
    )
    parser.add_argument(
        "--no-existence-check",
        action="store_true",
        help="Do not check whether source files exist. Useful with --dry-run offline.",
    )
    return parser.parse_args()


def read_lines(path: Path) -> list[str]:
    last_error: UnicodeDecodeError | None = None
    for encoding in ("utf-8-sig", "cp1251", "utf-16"):
        try:
            return path.read_text(encoding=encoding).splitlines()
        except UnicodeDecodeError as error:
            last_error = error

    if last_error is not None:
        raise last_error
    return []


def ensure_unique_destination(path: Path) -> Path:
    if not path.exists():
        return path

    for index in range(1, sys.maxsize):
        candidate = path.with_name(f"{path.stem} ({index}){path.suffix}")
        if not candidate.exists():
            return candidate

    raise RuntimeError(f"Could not create a unique destination path for {path}")


def source_to_paths(source_path: str, admin_share: str, destination_root: Path) -> tuple[Path, str, Path]:
    windows_path = PureWindowsPath(source_path)
    if windows_path.drive.lower() != "c:":
        raise ValueError("Only C:\\ paths are supported.")

    relative_parts = windows_path.parts[1:]
    if not relative_parts:
        raise ValueError("Path points to the root of C:.")

    remote_path = Path(admin_share, *relative_parts)
    remote_log_path = str(PureWindowsPath(admin_share, *relative_parts))
    destination_path = destination_root.joinpath(*relative_parts)
    return remote_path, remote_log_path, destination_path


def connect_admin_share(admin_share: str, username: str | None) -> bool:
    if not username:
        return False

    password = getpass.getpass(f"Password for {username}: ")
    command = ["net", "use", admin_share, password, f"/user:{username}", "/persistent:no"]
    result = subprocess.run(command, capture_output=True, timeout=45)
    if result.returncode != 0:
        message = decode_command_output(result.stderr or result.stdout)
        raise RuntimeError(f"Failed to connect {admin_share}: {message}")
    return True


def disconnect_admin_share(admin_share: str) -> None:
    subprocess.run(["net", "use", admin_share, "/delete", "/y"], capture_output=True)


def decode_command_output(output: bytes) -> str:
    for encoding in ("cp866", locale.getpreferredencoding(False), "utf-8", "cp1251"):
        try:
            message = output.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
        if message:
            return message
    return output.decode(errors="replace").strip()


def write_log(log_path: Path, rows: list[LogRow]) -> None:
    with log_path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "LineNumber",
                "OriginalLine",
                "SourcePath",
                "RemotePath",
                "DestinationPath",
                "Status",
                "Message",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "LineNumber": row.line_number,
                    "OriginalLine": row.original_line,
                    "SourcePath": row.source_path,
                    "RemotePath": row.remote_path,
                    "DestinationPath": str(row.destination_path),
                    "Status": row.status,
                    "Message": row.message,
                }
            )


def main() -> int:
    args = parse_args()
    list_path = Path(args.list_path).expanduser().resolve()
    destination_root = Path(args.destination_root).expanduser().resolve()
    admin_share = rf"\\{args.computer_name}\C$"
    log_path = SCRIPT_DIR / f"move_log_{datetime.now():%Y%m%d_%H%M%S}.csv"
    rows: list[LogRow] = []

    if not list_path.is_file():
        raise FileNotFoundError(f"List file was not found: {list_path}")

    connected = connect_admin_share(admin_share, args.username)
    try:
        lines = read_lines(list_path)
        if not args.dry_run:
            destination_root.mkdir(parents=True, exist_ok=True)

        for line_number, line in enumerate(lines, start=1):
            original_line = line
            source_path = line.split(";", 1)[0].strip()
            remote_log_path = ""
            destination_path = Path()

            if not source_path:
                rows.append(LogRow(line_number, original_line, source_path, "", "", "SkippedInvalidPath", "Empty path."))
                continue

            try:
                remote_path, remote_log_path, destination_path = source_to_paths(
                    source_path,
                    admin_share,
                    destination_root,
                )
            except ValueError as error:
                rows.append(
                    LogRow(line_number, original_line, source_path, "", "", "SkippedInvalidPath", str(error))
                )
                continue

            try:
                if not args.no_existence_check and not remote_path.is_file():
                    rows.append(
                        LogRow(
                            line_number,
                            original_line,
                            source_path,
                            remote_log_path,
                            str(destination_path),
                            "Missing",
                            "Source file was not found.",
                        )
                    )
                    continue

                final_destination_path = ensure_unique_destination(destination_path)
                if args.dry_run:
                    rows.append(
                        LogRow(
                            line_number,
                            original_line,
                            source_path,
                            remote_log_path,
                            str(final_destination_path),
                            "DryRun",
                            "Move was not executed.",
                        )
                    )
                    continue

                final_destination_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(remote_path), str(final_destination_path))
                rows.append(
                    LogRow(
                        line_number,
                        original_line,
                        source_path,
                        remote_log_path,
                        str(final_destination_path),
                        "Moved",
                        "File moved.",
                    )
                )
            except Exception as error:
                rows.append(
                    LogRow(
                        line_number,
                        original_line,
                        source_path,
                        remote_log_path,
                        str(destination_path),
                        "Failed",
                        str(error),
                    )
                )
    finally:
        if connected:
            disconnect_admin_share(admin_share)
        write_log(log_path, rows)
        print(f"Log written to: {log_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
