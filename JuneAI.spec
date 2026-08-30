# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


root = Path(SPECPATH).resolve()
frontend_dist = root / "frontend" / "dist"


a = Analysis(
    ["desktop.py"],
    pathex=[str(root), str(root / "backend")],
    binaries=[],
    datas=[(str(frontend_dist), "frontend/dist")],
    hiddenimports=[
        "uvicorn",
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
        "sse_starlette",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
    optimize=2,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="JuneAI",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="JuneAI",
)
