"""Feature-flagged OpenCode sandbox foundation.

The package deliberately contains no FastAPI routes or ORM registration yet.
It defines the security boundary, queue contracts and worker orchestration that
the app-scope 0099 integration can depend on without importing HUB services
inside a sandbox process.
"""

from .config import SandboxSettings
from .policy import OpenCodePermissionPolicy

__all__ = ["OpenCodePermissionPolicy", "SandboxSettings"]
