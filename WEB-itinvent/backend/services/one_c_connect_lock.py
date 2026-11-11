"""Process-wide serialization of 1C COM ``Connect()`` calls.

``V83.COMConnector.Connect`` (comcntr.dll) is not thread-safe: when two
threads in the same process enter ``Connect`` concurrently the connector
crashes the whole process with an access violation inside msvcp140.dll
(see ``logs/warehouse1c_worker_fault.log``).  Every site that creates a
1C COM connection must hold this lock for the duration of
``Dispatch`` + ``Connect``.
"""
from __future__ import annotations

import threading

ONE_C_CONNECT_LOCK = threading.Lock()
