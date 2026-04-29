from backend.ai_chat.tools.registry import ai_tool_registry

# Import side effects register the built-in tool set.
from backend.ai_chat.tools import itinvent  # noqa: F401
from backend.ai_chat.tools import files  # noqa: F401
from backend.ai_chat.tools import office  # noqa: F401

__all__ = ["ai_tool_registry"]
