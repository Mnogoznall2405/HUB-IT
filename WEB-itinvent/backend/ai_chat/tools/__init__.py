from backend.ai_chat.tools.registry import ai_tool_registry

# Import side effects register the built-in tool set.
from backend.ai_chat.tools import itinvent  # noqa: F401
from backend.ai_chat.tools import itinvent_works  # noqa: F401
from backend.ai_chat.tools import files  # noqa: F401
from backend.ai_chat.tools import office  # noqa: F401
from backend.ai_chat.tools import mfu  # noqa: F401
from backend.ai_chat.tools import network  # noqa: F401
from backend.ai_chat.tools import ad  # noqa: F401
from backend.ai_chat.tools import kb  # noqa: F401
from backend.ai_chat.tools import chat  # noqa: F401
from backend.ai_chat.tools import voice  # noqa: F401
from backend.ai_chat.tools import tool_group_request  # noqa: F401

__all__ = ["ai_tool_registry"]
