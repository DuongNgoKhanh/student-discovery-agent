"""ui.suggest_replies: quick-reply chips appended to the model's answer; nothing is executed."""
from typing import Annotated

from pydantic import Field, StringConstraints

from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.tools.kit import Tool


class SuggestedReply(ContractModel):
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]
    message_text: Annotated[str, StringConstraints(min_length=1, max_length=500, pattern=r"\S")]


class SuggestRepliesArguments(ContractModel):
    items: Annotated[tuple[SuggestedReply, ...], Field(min_length=1, max_length=4)]


SUGGEST_REPLIES = Tool("ui.suggest_replies", 1, "reply", label="Gợi ý trả lời nhanh",
                       summary="Hiện tối đa 4 nút gợi ý.",
                       description="Hiển thị tối đa 4 gợi ý trả lời nhanh, nhãn không trùng nhau.",
                       arguments=SuggestRepliesArguments)

TOOLS = (SUGGEST_REPLIES,)
