"""ui.suggest_replies: quick-reply chips appended to the model's answer; nothing is executed."""
from agent_runtime.agent.catalog import SuggestRepliesArguments
from agent_runtime.tools.kit import Tool

SUGGEST_REPLIES = Tool("ui.suggest_replies", 1, "reply", label="Gợi ý trả lời nhanh",
                       summary="Hiện tối đa 4 nút gợi ý.",
                       description="Hiển thị tối đa 4 gợi ý trả lời nhanh, nhãn không trùng nhau.",
                       arguments=SuggestRepliesArguments)

TOOLS = (SUGGEST_REPLIES,)
