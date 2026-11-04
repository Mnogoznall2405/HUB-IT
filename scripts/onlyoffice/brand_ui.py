"""Apply the HUB-IT UI changes to the verified ONLYOFFICE 10.0.0-169 assets.

The editor engine, license checks, JWT configuration and document data are untouched.
Use ``stage`` on a local asset copy before ``apply`` on the named container.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile


PACKAGE_VERSION = "10.0.0-169"
DOCUMENT_ROOT = "/var/www/onlyoffice/documentserver"
NOTICE_PATH = "web-apps/apps/common/main/resources/hubit-branding"
CACHE_TAG = hashlib.sha256(b"HUB-IT branding 2026-11-03 v2").hexdigest()[:32]
ORIGINAL_TAG = "92ce7466a49981a3223168de7cb6d264"
MODIFICATION_NOTICE = "HUB-IT: branding modified on 2026-11-03; based on ONLYOFFICE by Ascensio System SIA."


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def replace_once(content: bytes, before: str, after: str, path: str) -> bytes:
    needle = before.encode("utf-8")
    if content.count(needle) != 1:
        raise ValueError(f"Unexpected source structure: {path}")
    return content.replace(needle, after.encode("utf-8"), 1)


def make_assets(source: Path, license_content: bytes, manifest: dict) -> dict[str, bytes]:
    assets = {}
    wordmark = json.loads(Path(__file__).with_name("wordmark.json").read_text())
    for path, expected_hash in manifest.items():
        content = (source / path).read_bytes()
        if digest(content) != expected_hash:
            raise ValueError(f"Original asset checksum mismatch: {path}")
        if path.endswith(".svg"):
            about = "/about/" in path
            width, height, cap_height = (245, 45, 25) if about else (85, 20, 11)
            color = "#444444" if path.endswith("dark-logo_s.svg") else "#333333" if path.endswith("/logo_s.svg") else "#ffffff"
            left, bottom, right, top = wordmark["bounds"]
            scale = cap_height / (top - bottom)
            x = (width - (right - left) * scale) / 2 - left * scale
            y = (height - cap_height) / 2 + top * scale
            content = (
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
                f'viewBox="0 0 {width} {height}" role="img" aria-label="HUB-IT">'
                f'<!-- {MODIFICATION_NOTICE} -->'
                f'<title>HUB-IT</title><path fill="{color}" '
                f'transform="translate({x:.6f} {y:.6f}) scale({scale:.9f} {-scale:.9f})" '
                f'd="{wordmark["path"]}"/></svg>\n'
            ).encode("utf-8")
        elif path.endswith("/index.html"):
            content = replace_once(content, "<title>ONLYOFFICE ", "<title>HUB-IT ", path)
            content = b"<!-- " + MODIFICATION_NOTICE.encode() + b" -->\n" + content
        elif path.endswith("/Main.js"):
            content = replace_once(content, "me.defaultTitleText = 'ONLYOFFICE';", "me.defaultTitleText = 'HUB-IT';", path)
            content = ("// " + MODIFICATION_NOTICE + "\n").encode() + content
        elif path.endswith("/About.js"):
            needle = "                '<table id=\"id-about-licensor-info\""
            addition = (
                "                '<p id=\"hubit-modification-notice\" style=\"text-align:center;margin:16px 24px;line-height:1.6\">',\n"
                "                    'HUB-IT — изменённая версия ONLYOFFICE от Ascensio System SIA. Изменено 03.11.2026.<br>',\n"
                "                    '<a href=\"../../common/main/resources/hubit-branding/index.html\" target=\"_blank\" rel=\"noopener\">Исходный код изменений и лицензия</a><br>',\n"
                "                    'ONLYOFFICE is a trademark of Ascensio System SIA.',\n"
                "                '</p>',\n"
            )
            content = replace_once(content, needle, addition + needle, path)
            content = ("// " + MODIFICATION_NOTICE + "\n").encode() + content
        elif path.endswith("/api.js"):
            content = replace_once(content, "const ver = '/10.0.0-" + ORIGINAL_TAG + "';", "const ver = '/10.0.0-" + CACHE_TAG + "';", path)
            content = ("// " + MODIFICATION_NOTICE + "\n").encode() + content
        else:
            raise ValueError(f"Asset is outside the branding allowlist: {path}")
        assets[path] = content

    notice = """<!doctype html><html lang="ru"><meta charset="utf-8"><title>HUB-IT — сведения и исходный код</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.65 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#222}a{color:#145abe}li{margin:.5em 0}@media(prefers-color-scheme:dark){body{background:#181a1d;color:#eee}a{color:#8eb8ff}}</style>
<h1>HUB-IT</h1><p>Изменённая версия ONLYOFFICE Docs Community 10.0.0-169. Изменения оформления: 3 ноября 2026 года.</p>
<p>Основано на ONLYOFFICE, разработанном Ascensio System SIA. Авторские права и исходные лицензионные уведомления сохранены. Изменены только название в интерфейсе, логотипы и идентификатор кэша. Код редактирования и проверки лицензии не изменён.</p>
<p>Copyright © 2009–2026 Ascensio System SIA. ONLYOFFICE is a trademark of Ascensio System SIA. Этот вариант не является оригинальным продуктом ONLYOFFICE и не подразумевает одобрения разработчика.</p>
<p>Программа предоставляется по GNU AGPL v3 с дополнительными условиями, без гарантий. <a href="LICENSE.txt">Полный текст поставляемой лицензии</a>.</p>
<h2>Исходный код</h2><p><a href="hubit-branding-sources.zip" download>Исходные файлы изменений, сценарий применения и контрольные суммы</a>. В архиве находятся редактируемые файлы JS/HTML/SVG, сценарий воспроизведения и лицензия.</p>
<p>Исходный код оригинального проекта: <a href="https://github.com/ONLYOFFICE/DocumentServer">DocumentServer</a>, <a href="https://github.com/ONLYOFFICE/web-apps">web-apps</a>, <a href="https://github.com/ONLYOFFICE/sdkjs">sdkjs</a>, <a href="https://github.com/ONLYOFFICE/server">server</a>.</p>
<p><a href="https://www.onlyoffice.com/blog/2026/05/onlyoffice-license-and-trademark-policy">Условия модификации и сведения о товарном знаке</a>.</p></html>
"""
    assets[f"{NOTICE_PATH}/index.html"] = notice.encode("utf-8")
    assets[f"{NOTICE_PATH}/LICENSE.txt"] = license_content
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        def add_source(name: str, content: bytes) -> None:
            entry = zipfile.ZipInfo(name, date_time=(2026, 11, 3, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(entry, content)

        for path, content in assets.items():
            add_source(path, content)
        add_source("brand_ui.py", Path(__file__).read_bytes())
        add_source("wordmark.json", Path(__file__).with_name("wordmark.json").read_bytes())
        add_source("original-sha256.json", json.dumps(manifest, indent=2).encode())
    assets[f"{NOTICE_PATH}/hubit-branding-sources.zip"] = archive.getvalue()
    return assets


def write_assets(destination: Path, assets: dict[str, bytes]) -> None:
    for relative, content in assets.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        target.with_name(target.name + ".gz").write_bytes(gzip.compress(content, mtime=0))


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def copy_from(container: str, relative: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    run("podman", "cp", f"{container}:{DOCUMENT_ROOT}/{relative}", str(destination))


def install_file(container: str, relative: str, source: Path) -> None:
    target = f"{DOCUMENT_ROOT}/{relative}"
    run("podman", "exec", container, "mkdir", "-p", str(Path(target).parent))
    run("podman", "cp", str(source), f"{container}:{target}.hubit-tmp")
    run("podman", "exec", container, "chmod", "0644", target + ".hubit-tmp")
    run("podman", "exec", container, "mv", "--", target + ".hubit-tmp", target)


def apply(container: str, state: Path, manifest: dict, restore: bool) -> None:
    import fcntl

    state.mkdir(parents=True, exist_ok=True)
    with (state / "apply.lock").open("w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        package = run("podman", "exec", container, "dpkg-query", "-W", "-f=${Version}", "onlyoffice-documentserver")
        if package != PACKAGE_VERSION:
            raise ValueError(f"Unsupported ONLYOFFICE version: {package}; no changes made")
        backup = state / "backup" / PACKAGE_VERSION
        if restore:
            receipt = json.loads((backup / "receipt.json").read_text())
            for relative, expected in receipt.items():
                if digest((backup / relative).read_bytes()) != expected:
                    raise ValueError(f"Backup checksum mismatch: {relative}")
            # api.js is restored last: the previous cache namespace becomes active last.
            for relative in sorted(receipt, key=lambda path: ("/api/documents/api.js" in path, path)):
                install_file(container, relative, backup / relative)
            print(f"Restored {len(receipt)} original assets; added attribution files retained")
            return
        with tempfile.TemporaryDirectory(prefix="hubit-onlyoffice-") as work:
            source = Path(work) / "source"
            for relative in manifest:
                copy_from(container, relative, source / relative)
            source_hashes = {relative: digest((source / relative).read_bytes()) for relative in manifest}
            api_path = "web-apps/apps/api/documents/api.js"
            rollback_root = backup
            rollback_receipt = None
            if source_hashes != manifest:
                expected = json.loads((state / "deployed-sha256.json").read_text())
                for relative in expected:
                    copy_from(container, relative, source / relative)
                if any(digest((source / relative).read_bytes()) != checksum for relative, checksum in expected.items()):
                    raise ValueError("Previously branded assets changed; manual review required")
                if CACHE_TAG.encode() in (source / api_path).read_bytes():
                    print("HUB-IT branding already applied; asset checksums verified")
                    return
                previous_tag = re.search(rb"const ver = '/10\.0\.0-([0-9a-f]{32})';", (source / api_path).read_bytes())
                if previous_tag is None:
                    raise ValueError("Unknown previously branded API; no changes made")
                rollback_root = state / "releases" / previous_tag.group(1).decode()
                for relative, checksum in expected.items():
                    saved = rollback_root / relative
                    if saved.exists() and digest(saved.read_bytes()) != checksum:
                        raise ValueError(f"Previous release backup differs: {relative}")
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    if not saved.exists():
                        shutil.copy2(source / relative, saved)
                rollback_receipt = expected
                (rollback_root / "deployed-sha256.json").write_text(json.dumps(expected, indent=2))
                original_receipt = json.loads((backup / "receipt.json").read_text())
                original_paths = set(manifest) | {relative + ".gz" for relative in manifest}
                if set(original_receipt) != original_paths:
                    raise ValueError("Original backup file list differs; no changes made")
                for relative, checksum in original_receipt.items():
                    original = backup / relative
                    if digest(original.read_bytes()) != checksum:
                        raise ValueError(f"Original backup checksum mismatch: {relative}")
                    (source / relative).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(original, source / relative)
            license_file = source / "LICENSE.txt"
            copy_from(container, "LICENSE.txt", license_file)
            assets = make_assets(source, license_file.read_bytes(), manifest)
            staged = Path(work) / "staged"
            write_assets(staged, assets)
            original_files = list(manifest) + [relative + ".gz" for relative in manifest]
            receipt = {}
            for relative in original_files:
                original = source / relative
                if not original.exists():
                    copy_from(container, relative, original)
                if relative.endswith(".gz") and gzip.decompress(original.read_bytes()) != (source / relative[:-3]).read_bytes():
                    raise ValueError(f"Original gzip differs from source: {relative}; no changes made")
                saved = backup / relative
                if saved.exists() and saved.read_bytes() != original.read_bytes():
                    raise ValueError(f"Existing backup differs: {relative}; no changes made")
                saved.parent.mkdir(parents=True, exist_ok=True)
                if not saved.exists():
                    shutil.copy2(original, saved)
                receipt[relative] = digest(saved.read_bytes())
            (backup / "receipt.json").write_text(json.dumps(receipt, indent=2))
            deployed = {relative: digest(content) for relative, content in assets.items()}
            deployed.update({relative + ".gz": digest(gzip.compress(content, mtime=0)) for relative, content in assets.items()})
            try:
                # Change the uncached API's cache namespace after its dependencies.
                for relative in sorted(assets, key=lambda path: ("/api/documents/api.js" in path, path)):
                    for suffix in (".gz", ""):
                        install_file(container, relative + suffix, staged / (relative + suffix))
                hashes = run("podman", "exec", container, "sha256sum", *[f"{DOCUMENT_ROOT}/{relative}" for relative in deployed])
                observed = {line.split(None, 1)[1][len(DOCUMENT_ROOT) + 1:]: line.split(None, 1)[0] for line in hashes.splitlines()}
                if observed != deployed:
                    raise ValueError("Installed asset checksum mismatch")
            except Exception:
                for relative in sorted(rollback_receipt or receipt, key=lambda path: ("/api/documents/api.js" in path, path)):
                    install_file(container, relative, rollback_root / relative)
                raise
            (state / "deployed-sha256.json").write_text(json.dumps(deployed, indent=2))
            print(f"Applied HUB-IT branding: {len(assets)} assets and gzip variants; backup={backup}; cache={CACHE_TAG}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("stage", "apply", "restore"))
    parser.add_argument("--source", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--license-file", type=Path)
    parser.add_argument("--container", default="onlyoffice")
    parser.add_argument("--state", type=Path, default=Path("/srv/onlyoffice/branding"))
    args = parser.parse_args()
    manifest_path = Path(__file__).with_name("original-sha256.json")
    manifest = json.loads(manifest_path.read_text())
    if args.action == "stage":
        if not args.source or not args.destination or not args.license_file:
            parser.error("stage requires --source, --destination and --license-file")
        assets = make_assets(args.source, args.license_file.read_bytes(), manifest)
        write_assets(args.destination, assets)
        print(f"Staged {len(assets)} assets and gzip variants; cache={CACHE_TAG}")
    else:
        apply(args.container, args.state, manifest, args.action == "restore")


if __name__ == "__main__":
    main()
