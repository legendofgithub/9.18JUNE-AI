import json
import re
import time
from datetime import datetime

from ..core.exceptions import JuneException, ValidationException
from ..core.security import decrypt_api_key
from ..models.database import MvpRunModel, RunStepModel
from ..models.schemas import FollowUpRequest
from ..repositories.commerce_repo import MVP_STEPS
from ..repositories.commerce_repo import CommerceRepository
from ..repositories.session_repo import SessionRepository


STEP_TOOLS = {
    "buyer_pain": {
        "tool": "问题与目标梳理器",
        "instructions": "列出 3 个你想解决的问题，按急迫程度、可实现性和你的兴趣打分，选择一个主问题。",
        "template": "想解决的问题：\n使用场景：\n急迫程度：\n现有解决办法：\n涉及的人：\n选择理由：",
    },
    "sellable_result": {
        "tool": "最小成果画布",
        "instructions": "把成果写成一个可验收句子：谁、在什么场景、得到什么改变、如何确认完成。",
        "template": "成果名称：\n给谁用：\n成果内容：\n不包含：\n验收标准：\n完成周期：",
    },
    "vibe_brief": {
        "tool": "成果需求简报",
        "instructions": "用自然语言写清给谁解决什么问题、打开后看到什么、下一步做什么、怎么算完成。",
        "template": "要解决的问题：\n给谁用：\n打开后看到的页面：\n点击或填写的按钮与表单：\n得到的结果：\n完成与验收方式：",
    },
    "product_shape": {
        "tool": "最简形态选择器",
        "instructions": "在单页工具、表单、模板或流程工具中选择一个，并说明怎么使用和怎么验收。",
        "template": "成果形态：\n使用步骤：\n必须有的页面和按钮：\n必须有的表单或上传：\n结果如何保存、下载或分享：\n选择理由：",
    },
    "first_build": {
        "tool": "第一版成果描述生成器",
        "instructions": "把想达成的目标转成一段自然语言描述，让 AI 产出一个可试用的第一版，并记录试用入口。",
        "template": "想达成的目标：\n给 AI 的完整描述：\n打开后看到什么：\n下一步做什么：\n试用链接或保存方式：\n验收记录：",
    },
    "five_minute_iteration": {
        "tool": "5 分钟迭代清单",
        "instructions": "每轮只改一个影响使用的问题，记录改前、改后和能否完整走通。",
        "template": "本轮问题：\n期望看到的效果：\n给 AI 的修改描述：\n修改后结果：\n可用性判断：\n下一轮问题：",
    },
    "price_payment": {
        "tool": "方法与练习整理器",
        "instructions": "整理使用方法、练习步骤、注意事项和完成标准，让这套成果可以反复使用和分享。",
        "template": "使用方法：\n练习步骤：\n不包含：\n注意事项：\n使用说明：\n完成标准：",
    },
    "growth_assets": {
        "tool": "分享材料生成器",
        "instructions": "写一条介绍成果的分享内容、一段成果说明，并列出首批 20 个可以邀请试用的伙伴。",
        "template": "分享内容：\n成果介绍：\n适合谁：\n亮点：\n邀请方式：\n首批 20 个试用伙伴：",
    },
    "first_sale_delivery": {
        "tool": "首次完整使用与反馈记录",
        "instructions": "记录真实的完整使用过程、一次最小交付和使用反馈，不虚构没有发生的结果。",
        "template": "使用者：\n使用方式：\n交付内容：\n使用过程：\n完成确认：\n使用反馈：",
    },
    "retrospective": {
        "tool": "学习复盘报告",
        "instructions": "复盘方法、使用情况、反馈和改进点，形成下一轮小练习。",
        "template": "有效方法：\n无效尝试：\n时间与收获：\n可复用成果：\n使用反馈：\n下一步练习：",
    },
}


class MvpService:
    PERMISSION_MODES = ("read-only", "workspace-write", "full-access")

    TRACKING_START = "<tracking>"
    TRACKING_END = "</tracking>"

    # 追问链上下文预算：层级无限，靠「逐层压缩 + 总量封顶」守住单次请求体积，
    # 而不是靠限制追问次数或层级深度。
    FOLLOW_UP_BUDGET = 6000
    FOLLOW_UP_MAIN_BUDGET = 2000

    def __init__(self, repo: CommerceRepository, session_repo: SessionRepository, llm_service, thread_manager):
        self.repo = repo
        self.session_repo = session_repo
        self.llm = llm_service
        self.thread_manager = thread_manager

    def list_runs(self, owner_id: str) -> list[dict]:
        return [self._run_summary(run) for run in self.repo.list_runs(owner_id)]

    def create_run(self, owner_id: str, title: str, vertical: str) -> dict:
        run = self.repo.create_run(owner_id, self._require_skill(owner_id), title, vertical)
        return self.get_run_detail(owner_id, run.id)

    def get_run_detail(self, owner_id: str, run_id: str) -> dict:
        run = self._get_owned_run(owner_id, run_id)
        self._ensure_intro(run)
        current = self._current_step(run)
        messages = self.session_repo.get_all_messages(run.id)
        threads = self.session_repo.list_thread_states(run.id)
        # 追问可无限延伸，这里对单条追问链做取数上限，避免详情接口随追问次数无限膨胀
        thread_messages = {
            state["threadId"]: self.session_repo.get_recent_messages(run.id, state["threadId"], limit=100)
            for state in threads
        }
        artifact_by_step = {artifact.step_id: artifact for artifact in run.artifacts}
        current_artifact = artifact_by_step.get(current.id)

        return {
            **self._run_summary(run),
            "blocker": run.blocker,
            "nextAction": run.next_action,
            "steps": [
                {
                    "id": step.id,
                    "key": step.step_key,
                    "order": step.step_order,
                    "title": step.title,
                    "requiredArtifact": step.required_artifact,
                    "isCompleted": step.is_completed,
                    "artifactTitle": artifact_by_step[step.id].title if step.id in artifact_by_step else "",
                }
                for step in run.steps
            ],
            "currentStep": {
                **self._step_detail(current),
                "artifactContent": current_artifact.content if current_artifact else STEP_TOOLS[current.step_key]["template"],
            },
            "messages": messages,
            "threads": threads,
            "threadMessages": thread_messages,
        }

    def patch_step(self, owner_id: str, run_id: str, step_id: str, body) -> dict:
        run = self._get_owned_run(owner_id, run_id)
        self._reject_completed(run)
        step = self.repo.get_step(run_id, step_id)
        if step.id != self._current_step(run).id:
            raise ValidationException("请按顺序完成当前节点，不能跳过前置流程")
        if step.is_completed:
            raise ValidationException("该节点已完成并锁定，不能重复提交")
        if body.completed and len(body.artifact_content.strip()) < 20:
            raise ValidationException("完成节点前至少填写 20 个字符的交付物")

        self.repo.upsert_artifact(step, body.artifact_title, body.artifact_content)
        if body.completed:
            step.is_completed = True
            step.completed_at = time.time()
        self.repo.add_event(
            run,
            step,
            "artifact_saved" if not body.completed else "step_completed",
            body.artifact_title or step.required_artifact,
            {"completed": body.completed},
        )
        self.repo.refresh_run_progress(run)
        return self.get_run_detail(owner_id, run_id)

    async def stream_chat(
        self,
        owner_id: str,
        run_id: str,
        message: str,
        temperature: float | None = None,
        file_context: str | None = None,
        permission: str = "read-only",
    ):
        run = self._get_owned_run(owner_id, run_id)
        self._reject_completed(run)
        if permission not in self.PERMISSION_MODES:
            permission = "read-only"
        current = self._current_step(run)
        self.session_repo.add_message(run.id, "user", message, thread_id="main")
        messages = self.session_repo.get_all_messages(run.id, "main")[-12:]

        full_content = ""
        tracking_mode = False
        buffer = ""
        try:
            llm_options = self._llm_options(owner_id)
            async for delta in self.llm.chat(
                messages=self._build_messages(run, current, messages, file_context, permission),
                api_key=llm_options["api_key"],
                model=llm_options["model"],
                base_url=llm_options["base_url"],
                temperature=temperature if temperature is not None else 0.55,
            ):
                if isinstance(delta, dict):
                    if delta.get("type") == "reasoning":
                        yield {"type": "reasoning"}
                    continue
                full_content += delta
                if tracking_mode:
                    continue
                buffer += delta
                marker_at = buffer.find(self.TRACKING_START)
                if marker_at >= 0:
                    yield {"delta": buffer[:marker_at], "type": "text"}
                    tracking_mode = True
                    continue
                safe_end = self._safe_stream_end(buffer)
                if safe_end:
                    yield {"delta": buffer[:safe_end], "type": "text"}
                    buffer = buffer[safe_end:]
            if not tracking_mode and buffer:
                yield {"delta": buffer, "type": "text"}
        finally:
            visible, tracking = self._split_tracking(full_content)
            if visible.strip():
                self.session_repo.add_message(run.id, "assistant", visible.strip(), thread_id="main")
            if tracking:
                self._apply_tracking(run, current, tracking, permission)
            else:
                self.repo.add_event(run, current, "chat", visible[:500], {})
            yield {
                "done": True,
                "run": self._run_summary(run),
                "currentStepOrder": run.current_step_order,
            }

    async def stream_follow_up(self, owner_id: str, session_id: str, body: FollowUpRequest):
        run = self._get_owned_run(owner_id, session_id)
        self._reject_completed(run)
        parent_storage_id = session_id if body.parent_thread_id == "main" else body.parent_thread_id
        self.session_repo.upsert_thread(session_id, body.thread_id, parent_storage_id, body.level)
        state = self.session_repo.find_thread_state(body.thread_id)
        if state is None:
            self.session_repo.upsert_thread_state(
                session_id=session_id,
                thread_id=body.thread_id,
                source_type="text",
                selected_text=body.source.selected_text or "",
                source_message_id=body.source.source_message_id,
                source_message_role=body.source.source_message_role,
            )

        user_message_id = body.user_message_id or f"{body.thread_id}-user"
        assistant_message_id = body.assistant_message_id or f"{body.thread_id}-assistant"
        self.session_repo.add_message_once(
            user_message_id, session_id, "user", body.query, thread_id=body.thread_id
        )
        visible_content = ""
        tracking_mode = False
        buffer = ""
        try:
            llm_options = self._llm_options(owner_id)
            async for delta in self.llm.chat(
                messages=self._build_follow_up_messages(run, body),
                api_key=llm_options["api_key"],
                model=llm_options["model"],
                base_url=llm_options["base_url"],
                temperature=body.temperature if body.temperature is not None else 0.5,
            ):
                if isinstance(delta, dict):
                    if delta.get("type") == "reasoning":
                        yield {"type": "reasoning"}
                else:
                    if tracking_mode:
                        continue
                    buffer += delta
                    marker_at = buffer.find(self.TRACKING_START)
                    if marker_at >= 0:
                        yield {"delta": buffer[:marker_at], "type": "text"}
                        visible_content += buffer[:marker_at]
                        tracking_mode = True
                        continue
                    safe_end = self._safe_stream_end(buffer)
                    if safe_end:
                        yield {"delta": buffer[:safe_end], "type": "text"}
                        visible_content += buffer[:safe_end]
                        buffer = buffer[safe_end:]
            if not tracking_mode and buffer:
                yield {"delta": buffer, "type": "text"}
                visible_content += buffer
        finally:
            if visible_content.strip():
                self.session_repo.add_message_once(
                    assistant_message_id, session_id, "assistant", visible_content.strip(), thread_id=body.thread_id
                )
                self.session_repo.update_thread_summary(
                    body.thread_id, self._summarize_thread(session_id, body.thread_id)
                )
            yield {
                "done": True,
                "thread_id": body.thread_id,
                "usage": {},
                "userMessageId": user_message_id,
                "assistantMessageId": assistant_message_id,
            }

    def adopt_follow_up(self, owner_id: str, run_id: str, thread_id: str, title: str | None = None) -> dict:
        """把追问链的结论落到当前节点的交付物草稿，让无限追问能真正推进节点完成"""
        run = self._get_owned_run(owner_id, run_id)
        self._reject_completed(run)
        messages = self.session_repo.get_recent_messages(run_id, thread_id, limit=200)
        if not messages:
            raise ValidationException("这条追问链还没有内容可以采纳")

        current = self._current_step(run)
        block = self._format_adopted_thread(thread_id, messages)
        artifact_title = (title or "").strip() or f"追问结论 · {current.title}"

        existing = next((artifact for artifact in run.artifacts if artifact.step_id == current.id), None)
        base = (existing.content if existing else "").strip()
        if base == STEP_TOOLS[current.step_key]["template"].strip():
            base = ""
        content = f"{base}\n\n---\n\n{block}".strip() if base else block

        self.repo.upsert_artifact(current, artifact_title, content)
        self.repo.add_event(run, current, "follow_up_adopted", artifact_title, {"threadId": thread_id})
        return self.get_run_detail(owner_id, run_id)

    @staticmethod
    def _format_adopted_thread(thread_id: str, messages: list[dict]) -> str:
        lines = [f"【追问结论 · {thread_id}】"]
        for message in messages:
            lines.append(f"{'问' if message['role'] == 'user' else '答'}：{message['content'].strip()}")
        return "\n".join(lines)[:6000]

    def build_report(self, owner_id: str, run_id: str) -> str:
        run = self._get_owned_run(owner_id, run_id)
        self._ensure_intro(run)
        completed = [step for step in run.steps if step.is_completed]
        remaining = [step for step in run.steps if not step.is_completed]
        lines = [
            "# AI 伴学助手 · 学习推进报告",
            "",
            f"- 主题：{run.title}",
            f"- 学习方向：{run.vertical or '待明确'}",
            f"- 状态：{'已完成并归档' if run.status == 'completed' else '进行中'}",
            f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
            "",
            "## 当前状态",
            "",
            f"- 进度：{len(completed)}/{len(run.steps)}",
            f"- 阻塞点：{run.blocker or '无'}",
            f"- 下一个最小动作：{run.next_action or '无'}",
            "",
            "## 已完成交付物",
            "",
        ]
        artifacts = {artifact.step_id: artifact for artifact in run.artifacts}
        if not completed:
            lines.append("尚未完成节点。")
        for step in completed:
            artifact = artifacts.get(step.id)
            lines.append(f"### {step.step_order}. {step.title}")
            lines.append("")
            lines.append(artifact.content if artifact else "交付物缺失")
            lines.append("")
        lines.extend(["## 剩余节点", ""])
        if not remaining:
            lines.append("全部节点已完成，本路径已锁定。")
        else:
            lines.extend(f"- {step.step_order}. {step.title}：{step.required_artifact}" for step in remaining)

        lines.extend(["", "## 追问探索记录", ""])
        threads = sorted(
            self.session_repo.list_thread_states(run.id),
            key=lambda item: (item["level"], item["updatedAt"]),
        )
        if not threads:
            lines.append("本次流程没有产生追问。")
        for thread in threads:
            source = (thread["source"]["selectedText"] or "主对话").strip()[:40] or "主对话"
            lines.append(f"- L{thread['level']} 追问链 · 来源：{source}")
            summary = (thread.get("summary") or "").strip()
            if summary:
                lines.extend(f"  {line}" for line in summary.splitlines())
        return "\n".join(lines)

    def ensure_run_available(self, owner_id: str, run_id: str) -> None:
        self._reject_completed(self._get_owned_run(owner_id, run_id))

    def _llm_options(self, owner_id: str) -> dict[str, str]:
        skill = self._require_skill(owner_id)
        return {
            "api_key": decrypt_api_key(skill.encrypted_api_key) or self.llm.get_api_key(),
            "model": skill.model_name,
            "base_url": skill.base_url,
        }

    def _require_skill(self, owner_id: str):
        skill = self.repo.find_installed_skill(owner_id)
        if skill is None:
            raise ValidationException("请先连接 AI 工具，再开始学习")
        return skill

    def _get_owned_run(self, owner_id: str, run_id: str) -> MvpRunModel:
        return self.repo.get_run(owner_id, run_id)

    def _reject_completed(self, run: MvpRunModel) -> None:
        if run.status == "completed":
            raise JuneException("该学习路径已完成并归档，不能重新启用或继续提问", code=403)

    def _current_step(self, run: MvpRunModel) -> RunStepModel:
        return next((step for step in run.steps if not step.is_completed), run.steps[-1])

    def _ensure_intro(self, run: MvpRunModel) -> None:
        if self.session_repo.get_all_messages(run.id, "main"):
            return
        self.session_repo.add_message(
            run.id,
            "assistant",
            (
                "你好，我是你的 AI 伴学助手。我会陪你把想解决的问题一步步做成拿得出手的成果，边学边做。\n\n"
                "过程中有任何疑问，随时追问：追问的层级和次数都不限，我会一层层陪你把问题聊透，"
                "聊出来的结论还可以采纳为交付物草稿。\n\n"
                "今天想学点什么，或者做出什么？可以从你最近想解决的问题说起。"
            ),
            thread_id="main",
        )

    def _build_messages(
        self,
        run: MvpRunModel,
        step: RunStepModel,
        messages: list[dict],
        file_context: str | None = None,
        permission: str = "read-only",
    ) -> list[dict]:
        tool = STEP_TOOLS[step.step_key]
        system = (
            "你是「AI 伴学助手」，陪伴零基础用户学习和构建。你的任务不是泛聊，而是用自然语言引导用户，"
            "一步一步把当前目标推进成可检验的小成果。每次回答都要推进当前目标，语言直接、可执行；"
            "遇到较大的问题时，先拆成小步，再陪用户逐个完成。鼓励用户随时追问，追问层级和次数不限。"
            "用户不需要理解实现原理，也不需要查看或修改实现细节；遇到问题时，把它转译成用户想要的效果和下一步动作。"
            "允许使用页面、按钮、表单、上传、生成结果、复制、下载、链接等应用概念。"
            "禁止主动讲解编程语言、实现框架、数据存储、接口、部署架构或实现结构。"
            "回答末尾必须输出 <tracking>{json}</tracking>，json 字段为 blocker、next_action、vertical、artifacts。"
            "artifacts 是数组，每项包含 step_key、title、content；只能记录用户确认或本轮明确生成的交付物草稿。"
            "不改变客观完成状态。"
        )
        system += "\n\n" + self._permission_policy(permission)
        context = (
            f"主题：{run.title}\n学习方向：{run.vertical or '待明确'}\n"
            f"当前节点：{step.step_order}/{len(run.steps)} {step.title}\n"
            f"节点目标：{step.objective}\n当前工具：{tool['tool']}\n"
            f"阻塞点：{run.blocker or '无'}\n下一动作：{run.next_action or '无'}\n\n"
            f"近对话：\n" + "\n".join(f"{m['role']}: {m['content'][:800]}" for m in messages[-10:])
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": context},
        ]
        if file_context:
            messages.insert(1, {
                "role": "system",
                "content": f"以下是用户临时文档库中的文件内容，供你阅读参考：\n{file_context}",
            })
        return messages

    def _permission_policy(self, permission: str) -> str:
        if permission not in self.PERMISSION_MODES:
            permission = "read-only"
        policies = {
            "read-only": (
                "当前权限为 read-only：你可以阅读用户提供的资料并给出分析、判断和下一步建议，"
                "但不得声称已经修改文件、执行命令或代替用户完成写入。交付物只能作为建议草稿说明。"
            ),
            "workspace-write": (
                "当前权限为 workspace-write：你可以生成当前学习流程内的交付物草稿，并由系统保存为节点草稿；"
                "不要声称已修改流程外的文件或执行系统命令。"
            ),
            "full-access": (
                "当前权限为 full-access：你可以给出更主动的执行步骤和外部操作建议，"
                "但必须明确风险和验收方式；没有用户确认时仍不得声称已经执行。"
            ),
        }
        return policies[permission]

    def _build_follow_up_messages(self, run: MvpRunModel, body: FollowUpRequest) -> list[dict]:
        current = self._current_step(run)
        # 批量预载线程节点 / 状态 / 消息，避免深链逐层查询（N+1）；语义与逐层查询完全一致
        thread_map = self.session_repo.load_session_threads(run.id)
        chain = self.session_repo.walk_ancestry(body.thread_id, thread_map)
        depth = len(chain)
        state_map = self.session_repo.load_thread_states(run.id)
        messages_map = self.session_repo.load_recent_messages_bulk(run.id, [thread.id for thread in chain], limit=12)
        sections: list[str] = []
        for index, thread in enumerate(chain):
            blocks = self._ancestry_blocks(run.id, thread, depth - 1 - index, state_map, messages_map)
            if blocks:
                sections.append(f"[L{thread.level} 追问链]\n{blocks}")
        ancestry = "\n\n".join(sections)
        if len(ancestry) > self.FOLLOW_UP_BUDGET:
            ancestry = "…（更早的追问已压缩）\n" + ancestry[-self.FOLLOW_UP_BUDGET:]
        main_messages = self.session_repo.get_recent_messages(run.id, "main", limit=8)
        return [
            {
                "role": "system",
                "content": (
                    "你是 AI 伴学助手的追问助手。只解释当前学习动作、使用反馈、可用性、成果整理和分享，"
                    "以及如何用自然语言向 AI 描述期望效果。遇到实现类问题，转成用户想看到什么、点什么、得到什么。"
                    "不做技术扫盲，不讲解实现原理，把泛聊拉回目标推进，不改变客观完成状态。"
                    "追问链上下文记录了从主对话派生出的追问层级，越靠后的层级越接近用户当前疑问，回答以前面的结论为基础，不要重复已讲过的内容。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"项目：{run.title}\n当前节点：{current.title}\n节点目标：{current.objective}\n"
                    f"选中文本：{body.source.selected_text or '无'}\n"
                    f"主对话最近进展：{self._clip_messages(main_messages, limit=self.FOLLOW_UP_MAIN_BUDGET)}\n\n"
                    f"追问链上下文（由浅入深，最后一段是当前追问链）：\n{ancestry or '无'}\n\n"
                    f"当前追问：{body.query}"
                ),
            },
        ]

    def _ancestry_blocks(
        self,
        session_id: str,
        thread,
        distance: int,
        state_map: dict | None = None,
        messages_map: dict | None = None,
    ) -> str:
        """
        按「距当前层的距离」决定该层保留多少内容：近层全量、中层精简、远层只留结论。
        distance=0 是当前追问链，1 是直接父链，2 及以上属于远层。
        传入 state_map / messages_map 时使用批量预载数据，否则回退逐条查询。
        """
        if distance <= 0:
            max_messages, per_message = 12, 1200
        elif distance == 1:
            max_messages, per_message = 6, 600
        elif distance == 2:
            max_messages, per_message = 4, 400
        else:
            max_messages, per_message = 2, 300

        if state_map is not None:
            state = state_map.get(thread.id)
        else:
            state = self.session_repo.find_thread_state(thread.id)
        if distance >= 2 and state is not None and state.summary.strip():
            return f"历史结论：{state.summary.strip()[: per_message * 2]}"

        if messages_map is not None:
            messages = (messages_map.get(thread.id) or [])[-max_messages:]
        else:
            messages = self.session_repo.get_recent_messages(session_id, thread.id, limit=max_messages)
        if not messages:
            return ""
        body = "\n".join(f"{m['role']}: {m['content'][:per_message]}" for m in messages)
        # 该层消息已超配额时，更早的部分以摘要形式兜底，保证追问链再长也不会整段失忆
        if state is not None and state.summary.strip() and len(messages) >= max_messages:
            body = f"本链更早的追问（已压缩）：{state.summary.strip()[:600]}\n{body}"
        return body

    @staticmethod
    def _clip_messages(messages: list[dict], limit: int = 4000, per_message: int = 600) -> str:
        """最近优先的预算裁剪：不再固定只留 8 条，保证最新一轮内容完整"""
        picked: list[str] = []
        used = 0
        for message in reversed(messages):
            text = message["content"]
            if len(text) > per_message:
                text = text[:per_message] + "…"
            line = f"{message['role']}: {text}"
            if used + len(line) > limit and picked:
                break
            picked.append(line)
            used += len(line) + 1
        if not picked and messages:
            last = messages[-1]
            picked.append(f"{last['role']}: {last['content'][:limit]}")
        return "\n".join(reversed(picked))

    def _summarize_thread(self, session_id: str, thread_id: str) -> str:
        """
        沉淀追问链摘要，供更深层追问与最终报告使用。
        纯规则提取，不额外调用模型，避免追问本身烧掉用户额度。
        """
        messages = self.session_repo.get_recent_messages(session_id, thread_id, limit=40)
        if not messages:
            return ""
        questions = [item["content"].strip() for item in messages if item["role"] == "user"]
        answer = next((item["content"].strip() for item in reversed(messages) if item["role"] == "assistant"), "")
        parts: list[str] = []
        if questions:
            parts.append("追问：" + "；".join(question[:80] for question in questions[-5:]))
        if answer:
            parts.append("结论：" + answer[:300])
        return "\n".join(parts)[:800]

    def _safe_stream_end(self, buffer: str) -> int:
        for index, char in enumerate(buffer):
            if char == "<" and self.TRACKING_START.startswith(buffer[index:]):
                return index
        if self.TRACKING_START.startswith(buffer):
            return 0
        return len(buffer)

    def _split_tracking(self, content: str) -> tuple[str, dict | None]:
        match = re.search(rf"{self.TRACKING_START}\s*(.*?)\s*{self.TRACKING_END}", content, re.DOTALL)
        if match is None:
            return content, None
        visible = (content[:match.start()] + content[match.end():]).strip()
        try:
            tracking = json.loads(match.group(1))
        except json.JSONDecodeError:
            return visible, None
        return visible, tracking if isinstance(tracking, dict) else None

    def _apply_tracking(self, run: MvpRunModel, current: RunStepModel, tracking: dict, permission: str = "read-only") -> None:
        artifacts = tracking.get("artifacts") or []
        if not isinstance(artifacts, list):
            artifacts = []
        safe_artifacts = [item for item in artifacts if isinstance(item, dict)]
        suppressed_artifacts = 0
        if permission == "read-only":
            suppressed_artifacts = len(safe_artifacts)
            safe_artifacts = []
        self.repo.apply_tracking(
            run,
            str(tracking.get("blocker", run.blocker)),
            str(tracking.get("next_action", run.next_action)),
            str(tracking.get("vertical", run.vertical) or ""),
            safe_artifacts,
        )
        event_tracking = dict(tracking)
        permission_effect = {
            "permission": permission,
            "suppressed_artifact_count": suppressed_artifacts,
        }
        if suppressed_artifacts:
            permission_effect["reason"] = "read-only mode does not auto-save artifact drafts"
        event_tracking["permission_effect"] = permission_effect
        self.repo.add_event(run, current, "tracking", json.dumps(event_tracking, ensure_ascii=False)[:4000], event_tracking)

    def _step_detail(self, step: RunStepModel) -> dict:
        tool = STEP_TOOLS[step.step_key]
        return {
            "id": step.id,
            "key": step.step_key,
            "order": step.step_order,
            "title": step.title,
            "objective": step.objective,
            "requiredArtifact": step.required_artifact,
            "isCompleted": step.is_completed,
            "tool": tool["tool"],
            "instructions": tool["instructions"],
            "template": tool["template"],
        }

    @staticmethod
    def _run_summary(run: MvpRunModel) -> dict:
        return {
            "id": run.id,
            "title": run.title,
            "vertical": run.vertical,
            "status": run.status,
            "currentStepOrder": run.current_step_order,
            "totalSteps": len(run.steps),
            "createdAt": int(run.created_at * 1000),
            "completedAt": int(run.completed_at * 1000) if run.completed_at else None,
        }
