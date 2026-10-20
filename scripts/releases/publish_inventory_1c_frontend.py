import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import uuid
from pathlib import Path

ROOT = Path(r"C:\Project\Image_scan")
BUILD = ROOT / "output" / "inventory-1c-verification"
TARGET = ROOT / "WEB-itinvent" / "frontend" / "dist"
BACKUP = ROOT / "deploy_backups" / "inventory-1c-20261006-132655"
PLAN_FILE = BACKUP / "frontend-publish-plan.json"
RECEIPT = BACKUP / "frontend-publish-receipt.json"
BACKEND_SOURCES = {
    "WEB-itinvent/backend/api/v1/warehouse_1c.py": "c999963617eb440483de1e460090fa5e5afefce8467a1bda9218ced73bace3f7",
    "WEB-itinvent/backend/services/warehouse_1c_service.py": "e24f8ee7f4f435dfc1fc56342cca817de165fe1b6d67ffdca273930def2bbfee",
}
FIXED_FILES = ["index.html", "sw.js", ".vite/manifest.json"]
ATOMIC_ORDER = [".vite/manifest.json", "index.html", "sw.js"]
SW_VERSION_LINE = re.compile(
    r"^(\s*(?:const\s+|let\s+|var\s+)?(?:SW_VERSION|APP_SHELL_CACHE|APP_ASSET_CACHE)\s*=\s*)'[^']*'\s*;?\s*$"
)


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve_within(base, rel):
    resolved_base = base.resolve()
    resolved = (base / rel).resolve()
    if resolved_base not in resolved.parents:
        raise RuntimeError(f"path escapes base: {rel}")
    return resolved


def normalize_sw(data):
    out = []
    for raw in data.split(b"\n"):
        try:
            line = raw.decode("utf-8")
        except UnicodeDecodeError:
            out.append(raw)
            continue
        m = SW_VERSION_LINE.match(line)
        out.append((m.group(1) + "'__normalized__'").encode("utf-8") if m else raw)
    return b"\n".join(out)


def ensure_backend_sources():
    for rel, expected in BACKEND_SOURCES.items():
        actual = sha256_file(ROOT / rel)
        if actual != expected:
            raise RuntimeError(f"backend source hash mismatch: {rel}")


def load_backup_metadata():
    verification = json.loads(
        (BACKUP / "verification.json").read_text(encoding="utf-8")
    )
    if verification.get("ok") is not True:
        raise RuntimeError("backup verification.json is not ok")
    metadata = json.loads(
        (BACKUP / "metadata.json").read_text(encoding="utf-8")
    )
    if str(Path(metadata["deploy_target_dir"]).resolve()) != str(TARGET.resolve()):
        raise RuntimeError("backup deploy_target_dir differs from TARGET")
    return metadata


def collect_plan():
    metadata = load_backup_metadata()
    entry_hashes = metadata.get("entry_files_sha256") or {}
    for name in ("index.html", "sw.js", "web.config"):
        live = TARGET / name
        if not live.is_file():
            raise RuntimeError(f"live entry file missing: {name}")
        if sha256_file(live) != entry_hashes.get(name):
            raise RuntimeError(f"live {name} hash differs from backup metadata")
    built_manifest = BUILD / "manifest.webmanifest"
    live_manifest = TARGET / "manifest.webmanifest"
    if not built_manifest.is_file() or not live_manifest.is_file():
        raise RuntimeError("manifest.webmanifest missing in build or live")
    if sha256_file(built_manifest) != sha256_file(live_manifest):
        raise RuntimeError("manifest.webmanifest differs between build and live")
    built_sw = BUILD / "sw.js"
    live_sw = TARGET / "sw.js"
    if not built_sw.is_file() or not live_sw.is_file():
        raise RuntimeError("sw.js missing in build or live")
    if normalize_sw(built_sw.read_bytes()) != normalize_sw(live_sw.read_bytes()):
        raise RuntimeError("sw.js differs beyond version declarations")
    ensure_backend_sources()

    assets_root = BUILD / "assets"
    asset_files = sorted(
        (p for p in assets_root.rglob("*") if p.is_file()),
        key=lambda p: p.relative_to(assets_root).as_posix(),
    )
    if not asset_files:
        raise RuntimeError("build assets directory is empty")
    planned = []
    for src in asset_files:
        rel = src.relative_to(BUILD).as_posix()
        resolve_within(BUILD, rel)
        resolve_within(TARGET, rel)
        planned.append({"path": rel, "sha256": sha256_file(src)})
    for name in FIXED_FILES:
        src = BUILD / name
        if not src.is_file():
            raise RuntimeError(f"fixed build file missing: {name}")
        rel = Path(name).as_posix()
        resolve_within(BUILD, rel)
        resolve_within(TARGET, rel)
        planned.append({"path": rel, "sha256": sha256_file(src)})

    index_bytes = (BUILD / "index.html").read_bytes()
    scripts = re.findall(rb'src="(/assets/[^"]+)"', index_bytes)
    if len(scripts) != 1:
        raise RuntimeError("built index.html must reference exactly one /assets/ script")
    entry_script = scripts[0].decode("utf-8")
    if not (BUILD / entry_script.lstrip("/")).is_file():
        raise RuntimeError(f"entry script missing in build: {entry_script}")

    marker_found = False
    for item in planned:
        if item["path"].lower().endswith(".js"):
            if b"part_quantities" in (BUILD / item["path"]).read_bytes():
                marker_found = True
                break
    if not marker_found:
        raise RuntimeError("built JS lacks part_quantities marker")

    for item in planned:
        if not item["path"].startswith("assets/"):
            continue
        dst = TARGET / item["path"]
        if dst.exists() and sha256_file(dst) != item["sha256"]:
            raise RuntimeError(f"immutable asset collision: {item['path']}")

    return {
        "source": str(BUILD),
        "target": str(TARGET),
        "backup": str(BACKUP),
        "entry_script": entry_script,
        "preserved_web_config_sha256": entry_hashes["web.config"],
        "backend_source_sha256": dict(BACKEND_SOURCES),
        "files": planned,
    }


def write_plan(plan):
    PLAN_FILE.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def read_plan():
    if not PLAN_FILE.is_file():
        raise RuntimeError(f"plan file missing: {PLAN_FILE}")
    return json.loads(PLAN_FILE.read_text(encoding="utf-8"))


def atomic_copy(src, dst, expected_sha256):
    tmp = dst.with_name(f"{dst.name}.inventory-1c-{uuid.uuid4().hex}.tmp")
    created = False
    try:
        with open(tmp, "xb") as handle:
            created = True
            handle.write(src.read_bytes())
            handle.flush()
            os.fsync(handle.fileno())
        if sha256_file(tmp) != expected_sha256:
            raise RuntimeError(f"temp copy hash mismatch: {dst.name}")
        os.replace(tmp, dst)
        if sha256_file(dst) != expected_sha256:
            raise RuntimeError(f"post-replace hash mismatch: {dst.name}")
    finally:
        if created and tmp.exists():
            tmp.unlink()


def verify_published(plan):
    problems = []
    for item in plan["files"]:
        dst = TARGET / item["path"]
        if not dst.is_file():
            problems.append(f"missing: {item['path']}")
        elif sha256_file(dst) != item["sha256"]:
            problems.append(f"hash mismatch: {item['path']}")
    if sha256_file(TARGET / "web.config") != plan["preserved_web_config_sha256"]:
        problems.append("web.config hash mismatch")
    for rel, expected in plan["backend_source_sha256"].items():
        if sha256_file(ROOT / rel) != expected:
            problems.append(f"backend source changed: {rel}")
    return problems


def dry_run():
    plan = collect_plan()
    write_plan(plan)
    print(json.dumps({
        "ok": True,
        "mode": "dry-run",
        "plan": str(PLAN_FILE),
        "entry_script": plan["entry_script"],
        "file_count": len(plan["files"]),
    }, indent=2))
    return 0


def apply_mode():
    fresh = collect_plan()
    saved = read_plan()
    if fresh != saved:
        raise RuntimeError("recomputed plan differs from reviewed plan")
    copied = []
    skipped = 0
    for item in saved["files"]:
        rel = item["path"]
        src = resolve_within(BUILD, rel)
        dst = resolve_within(TARGET, rel)
        if rel.startswith("assets/"):
            if dst.exists():
                if sha256_file(dst) != item["sha256"]:
                    raise RuntimeError(f"immutable asset collision: {rel}")
                skipped += 1
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            if sha256_file(dst) != item["sha256"]:
                raise RuntimeError(f"copied asset hash mismatch: {rel}")
            copied.append(rel)
    for name in ATOMIC_ORDER:
        rel = Path(name).as_posix()
        expected = next(i["sha256"] for i in saved["files"] if i["path"] == rel)
        atomic_copy(resolve_within(BUILD, rel), resolve_within(TARGET, rel), expected)
    problems = verify_published(saved)
    if problems:
        raise RuntimeError(f"post-publish verification failed: {problems}")
    RECEIPT.write_text(
        json.dumps({
            "ok": True,
            "entry_script": saved["entry_script"],
            "verified_files": len(saved["files"]),
            "web_config_preserved": True,
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ok": True,
        "mode": "apply",
        "entry_script": saved["entry_script"],
        "copied_assets": len(copied),
        "skipped_identical": skipped,
        "verified_files": len(saved["files"]),
        "receipt": str(RECEIPT),
    }, indent=2))
    return 0


def verify_mode():
    ensure_backend_sources()
    plan = read_plan()
    problems = verify_published(plan)
    if problems:
        raise RuntimeError(f"verification failed: {problems}")
    print(json.dumps({
        "ok": True,
        "mode": "verify",
        "entry_script": plan["entry_script"],
        "verified_files": len(plan["files"]),
    }, indent=2))
    return 0


def rollback_mode():
    ensure_backend_sources()
    plan = read_plan()
    problems = verify_published(plan)
    if problems:
        raise RuntimeError(f"target no longer matches published plan: {problems}")
    restored = []
    for name in ATOMIC_ORDER:
        rel = Path(name).as_posix()
        backup_src = resolve_within(BACKUP / "frontend-dist", rel)
        if not backup_src.is_file():
            raise RuntimeError(f"backup file missing: {rel}")
        atomic_copy(backup_src, resolve_within(TARGET, rel), sha256_file(backup_src))
        restored.append(rel)
    print(json.dumps({
        "ok": True,
        "mode": "rollback",
        "restored": restored,
    }, indent=2))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true")
    group.add_argument("--verify", action="store_true")
    group.add_argument("--rollback", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.apply:
            return apply_mode()
        if args.verify:
            return verify_mode()
        if args.rollback:
            return rollback_mode()
        return dry_run()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
