import json

from ..models.database import HarnessProjectModel, InstalledSkillModel, MessageModel, SessionModel
from ..repositories.harness_repo import HarnessRepository, estimate_tokens


class ContextBuilder:
    def __init__(self, repo: HarnessRepository):
        self.repo = repo

    def build(
        self,
        project: HarnessProjectModel,
        session: SessionModel,
        skill: InstalledSkillModel,
        tools: list[dict],
        context_tokens: int = 32768,
        max_output_tokens: int = 4096,
    ) -> dict:
        max_context = max(4096, context_tokens)
        output_reserve = min(max_output_tokens, max_context // 2)
        memories = self.repo.list_memories(project.id)
        files = self.repo.list_files(project.id)
        messages = self.repo.list_messages(session.id)

        system_prompt = (
            "你是 June AI Harness，服务已付费解锁的超级个体训练师用户。"
            "你必须围绕当前商业 MVP 节点推进，不讲解代码实现，不承诺收入。"
            "需要项目事实时优先调用只读工具；用户要求保存内容时先说明将调用写入工具。"
            "工具失败时根据错误调整参数或给出人工下一步，不要虚构执行结果。"
        )
        project_block = (
            f"项目：{project.title}\n商业路径：{project.mvp_run_id}\n"
            f"权限：{session.permission}\n"
            "用户目标是用自然语言做出可试用、可售卖、可交付的最小商业 MVP。"
        )
        memory_block = "\n".join(
            f"- [{memory.memory_type}] {memory.content[:600]}" for memory in memories[:30]
        ) or "暂无长期记忆。"
        file_block = "\n".join(
            f"- {item.path} ({item.size} bytes)" for item in files[:200]
        ) or "项目沙箱暂无文件。"
        summary_block = session.summary or "暂无会话摘要。"

        fixed_messages = [
            {"role": "system", "content": system_prompt},
            {"role": "system", "content": f"项目信息\n{project_block}"},
            {"role": "system", "content": f"项目长期记忆\n{memory_block}"},
            {"role": "system", "content": f"项目文件索引\n{file_block}"},
            {"role": "system", "content": f"早期会话摘要\n{summary_block}"},
        ]
        fixed_tokens = sum(estimate_tokens(item["content"]) for item in fixed_messages)
        tool_tokens = sum(estimate_tokens(json.dumps(tool, ensure_ascii=False)) for tool in tools)
        history_budget = max(0, max_context - output_reserve - fixed_tokens - tool_tokens - 256)

        selected: list[MessageModel] = []
        used = 0
        for message in reversed(messages):
            tokens = max(1, message.tokens or estimate_tokens(message.content))
            if selected and used + tokens > history_budget:
                continue
            if not selected and tokens > history_budget:
                message_content = message.content[-min(len(message.content), history_budget * 3):]
                tokens = estimate_tokens(message_content)
                selected.append(message)
                used += tokens
                continue
            selected.append(message)
            used += tokens
            if used >= history_budget:
                break
        selected.reverse()

        history = [self._message_payload(message) for message in selected]
        all_messages = fixed_messages + history
        components = [
            {"name": "system", "tokens": estimate_tokens(system_prompt), "truncated": False},
            {"name": "project", "tokens": estimate_tokens(project_block), "truncated": False},
            {"name": "memories", "tokens": estimate_tokens(memory_block), "truncated": len(memories) > 30},
            {"name": "files", "tokens": estimate_tokens(file_block), "truncated": len(files) > 200},
            {"name": "summary", "tokens": estimate_tokens(summary_block), "truncated": False},
            {"name": "tools", "tokens": tool_tokens, "truncated": False},
            {"name": "history", "tokens": used, "truncated": len(selected) < len(messages)},
        ]
        total = fixed_tokens + tool_tokens + used
        return {
            "messages": all_messages,
            "model": skill.model_name,
            "maxContextTokens": max_context,
            "maxOutputTokens": output_reserve,
            "totalTokens": total,
            "budgetTokens": max_context - output_reserve,
            "components": components,
            "historyMessageCount": len(selected),
            "totalMessageCount": len(messages),
        }

    def _message_payload(self, message: MessageModel) -> dict:
        payload = {"role": message.role, "content": message.content}
        try:
            meta = json.loads(message.meta_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if message.role == "assistant" and meta.get("toolCalls"):
            payload["tool_calls"] = meta["toolCalls"]
            payload["content"] = message.content or ""
        if message.role == "tool" and meta.get("toolCallId"):
            payload["tool_call_id"] = meta["toolCallId"]
            payload["name"] = meta.get("toolName", "tool")
        return payload

    @staticmethod
    def summarize(messages: list[MessageModel], keep_recent: int = 6) -> str:
        if not messages:
            return ""
        old_messages = messages[:-keep_recent] if len(messages) > keep_recent else []
        recent = messages[-keep_recent:] if len(messages) > keep_recent else messages
        lines = []
        if old_messages:
            lines.append("早期对话要点：")
            for message in old_messages[-30:]:
                content = " ".join(message.content.split())[:500]
                lines.append(f"- {message.role}: {content}")
        if recent:
            lines.append("必须连续保留的近期对话：")
            for message in recent:
                content = " ".join(message.content.split())[:350]
                lines.append(f"- {message.role}: {content}")
        return "\n".join(lines)[:16000]
