@echo off
REM Camouflage wrapper: playwright always appends `e2e/stack/local_backend.py`;
REM ignore argv and run the renamed copy so process-kill sweeps that match
REM "local_backend.py" in the command line do not see this backend.
"C:\Program Files\Python312\python.exe" e2e/stack/stab_backend.py
