# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['agent.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['win32timezone'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# Keep the helper in onedir mode so a timeout can terminate the PDF process
# directly, without leaving a onefile bootloader child running.
pdf = Analysis(
    ['scan_agent/pdf_worker.py'],
    pathex=[],
    hiddenimports=['win32job'],
)
pdf_exe = EXE(
    PYZ(pdf.pure),
    pdf.scripts,
    [],
    exclude_binaries=True,
    name='ITInventPdfWorker',
    console=True,
)
pdf_dist = COLLECT(pdf_exe, pdf.binaries, pdf.datas, name='ITInventPdfWorker')
