import json
import time
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from ..core.exceptions import JuneException, NotFoundException, ValidationException
from ..models.database import (
    AnalyticsEventModel,
    InstalledSkillModel,
    MvpRunModel,
    ModelEntryModel,
    ModelServiceModel,
    RunArtifactModel,
    RunEventModel,
    RunStepModel,
    SessionModel,
)


MVP_STEPS = [
    ("buyer_pain", "明确想解决的问题和目标", "想清楚要解决什么问题、为谁解决、做到什么程度算达成。", "问题与目标画布"),
    ("sellable_result", "定义一个最小可完成成果", "把目标压缩成一件能做出、能展示、能检验的小成果。", "最小成果与验收标准"),
    ("vibe_brief", "写出成果需求简报", "用自然语言说明做给谁用、解决什么问题、做出来是什么样子、怎么算完成。", "成果需求简报"),
    ("product_shape", "选择最简成果形态", "在单页工具、表单、模板或清单中选一个最容易上手的形态。", "最简成果形态选择说明"),
    ("first_build", "用自然语言让 AI 做出第一版成果", "把想做成的东西转成清晰描述，让 AI 产出可以试用的第一版。", "第一版成果与试用记录"),
    ("five_minute_iteration", "用 5 分钟迭代法改到好用", "每轮只改一个影响使用的问题，直到自己能完整走通。", "5 分钟迭代记录"),
    ("price_payment", "整理方法、练习和使用说明", "把成果的使用方法、练习步骤和注意事项整理成说明，方便反复使用。", "方法与练习说明"),
    ("growth_assets", "准备分享材料和首批试用伙伴", "准备一份成果介绍，并列出第一批愿意试用的伙伴。", "分享材料与试用名单"),
    ("first_sale_delivery", "完成第一次完整使用并收集反馈", "记录真实的完整使用过程，完成一次最小交付并收集使用反馈。", "首次完整使用与反馈记录"),
    ("retrospective", "复盘学习收获和下一步", "整理有效方法、遗留问题和改进点，决定下一步的练习方向。", "学习复盘报告"),
]

class CommerceRepository:
    def __init__(self, db: Session):
        self.db = db

    def add_analytics_event(
        self,
        event_name: str,
        owner_id: str,
        route: str,
        session_id: str,
        properties: dict,
    ) -> None:
        self.db.add(AnalyticsEventModel(
            event_name=event_name,
            owner_id=owner_id,
            route=route[:120],
            session_id=session_id[:80],
            properties_json=json.dumps(properties, ensure_ascii=False, separators=(",", ":")),
        ))
        self.db.commit()

    def count_analytics_events(self, name: str | None = None) -> int:
        query = self.db.query(AnalyticsEventModel)
        if name:
            query = query.filter(AnalyticsEventModel.event_name == name)
        return query.count()

    def overview_stats(self) -> dict:
        """管理后台指标卡的全部聚合统计（只读，单次调用）"""
        return {
            "totalUsers": self.db.query(UserModel).count(),
            "disabledUsers": self.db.query(UserModel).filter(UserModel.is_disabled.is_(True)).count(),
            "activeRuns": self.db.query(MvpRunModel).filter(MvpRunModel.status == "active").count(),
            "analyticsEvents": self.db.query(AnalyticsEventModel).count(),
        }

    def install_skill(
        self,
        owner_id: str,
        model_name: str,
        base_url: str,
        api_key_ready: bool,
        encrypted_api_key: str,
    ) -> InstalledSkillModel:
        skill = self.db.query(InstalledSkillModel).filter(InstalledSkillModel.owner_id == owner_id).first()
        if skill is None:
            skill = InstalledSkillModel(owner_id=owner_id)
            self.db.add(skill)
        skill.skill_key = "super-solo-coach"
        skill.version = "2.0.0"
        skill.model_name = model_name
        skill.base_url = base_url
        skill.api_key_ready = api_key_ready
        skill.encrypted_api_key = encrypted_api_key
        self.db.commit()
        self.db.refresh(skill)
        return skill

    def find_installed_skill(self, owner_id: str) -> Optional[InstalledSkillModel]:
        return self.db.query(InstalledSkillModel).filter(InstalledSkillModel.owner_id == owner_id).first()

    def list_model_services(self, owner_id: str) -> list[ModelServiceModel]:
        return (
            self.db.query(ModelServiceModel)
            .filter(ModelServiceModel.owner_id == owner_id)
            .order_by(ModelServiceModel.created_at)
            .all()
        )

    def get_model_service(self, owner_id: str, service_id: str) -> ModelServiceModel:
        service = self.db.get(ModelServiceModel, {"id": service_id, "owner_id": owner_id})
        if service is None:
            raise NotFoundException("模型服务不存在")
        return service

    def find_model_service_by_route(self, owner_id: str, service_id: str) -> Optional[ModelServiceModel]:
        return (
            self.db.query(ModelServiceModel)
            .filter(ModelServiceModel.owner_id == owner_id, ModelServiceModel.id == service_id)
            .first()
        )

    def new_model_service(self, service_id: str, owner_id: str) -> ModelServiceModel:
        return ModelServiceModel(id=service_id, owner_id=owner_id)

    def seed_model_services(self, owner_id: str, items: list[dict]) -> None:
        """写入默认模型服务种子数据（调用方需先确认该 owner 尚无服务）"""
        for item in items:
            service = ModelServiceModel(
                id=item["id"],
                owner_id=owner_id,
                display_name=item["display_name"],
                vendor=item["vendor"],
                base_url=item["base_url"],
                protocol=item["protocol"],
            )
            for model in item["models"]:
                service.models.append(ModelEntryModel(**model))
            self.db.add(service)
        self.db.commit()

    def replace_model_service_entries(self, service: ModelServiceModel, entries: list[dict]) -> ModelServiceModel:
        """整体替换模型清单并落库：flush 保证旧条目先删，commit 后回读供乐观锁比对 version"""
        service.models.clear()
        self.db.flush()
        for item in entries:
            service.models.append(ModelEntryModel(**item))
        self.db.add(service)
        self.db.commit()
        self.db.refresh(service)
        return service

    def delete_model_service(self, service: ModelServiceModel) -> None:
        self.db.delete(service)
        self.db.commit()

    def create_run(self, owner_id: str, skill: InstalledSkillModel, title: str, vertical: str) -> MvpRunModel:
        run = MvpRunModel(
            owner_id=owner_id,
            installed_skill_id=skill.id,
            title=title.strip() or "未命名学习路径",
            vertical=vertical.strip(),
            blocker="尚未明确学习目标",
            next_action="告诉伴学助手你想学什么",
        )
        self.db.add(run)
        self.db.flush()
        for index, (key, step_title, objective, artifact) in enumerate(MVP_STEPS, start=1):
            self.db.add(RunStepModel(
                run_id=run.id,
                step_key=key,
                step_order=index,
                title=step_title,
                objective=objective,
                required_artifact=artifact,
            ))
        self.db.add(SessionModel(id=run.id, title=run.title, model=skill.model_name))
        self.db.commit()
        self.db.refresh(run)
        return run

    def list_runs(self, owner_id: str) -> list[MvpRunModel]:
        return (
            self.db.query(MvpRunModel)
            .filter(MvpRunModel.owner_id == owner_id)
            .order_by(MvpRunModel.created_at.desc())
            .all()
        )

    def get_run(self, owner_id: str, run_id: str) -> MvpRunModel:
        run = self.db.get(MvpRunModel, run_id)
        if run is None or run.owner_id != owner_id:
            raise NotFoundException("学习路径不存在")
        return run

    def get_run_by_session(self, session_id: str) -> Optional[MvpRunModel]:
        return self.db.get(MvpRunModel, session_id)

    def get_step(self, run_id: str, step_id: str) -> RunStepModel:
        step = self.db.get(RunStepModel, step_id)
        if step is None or step.run_id != run_id:
            raise NotFoundException("流程节点不存在")
        return step

    def upsert_artifact(self, step: RunStepModel, title: str, content: str) -> RunArtifactModel:
        artifact = self.db.query(RunArtifactModel).filter(RunArtifactModel.step_id == step.id).first()
        if artifact is None:
            artifact = RunArtifactModel(
                run_id=step.run_id,
                step_id=step.id,
                title=title or step.required_artifact,
                content=content,
            )
            self.db.add(artifact)
        else:
            artifact.title = title or artifact.title or step.required_artifact
            artifact.content = content
        self.db.commit()
        return artifact

    def refresh_run_progress(self, run: MvpRunModel) -> None:
        next_step = next((step for step in run.steps if not step.is_completed), None)
        run.current_step_order = next_step.step_order if next_step else len(run.steps)
        if next_step is None:
            if run.status != "completed":
                run.status = "completed"
                run.completed_at = time.time()
                run.blocker = ""
                run.next_action = "路径已完成并归档，只能查看报告，不能重新启用。"
        else:
            run.blocker = run.blocker or "等待完成当前节点交付物"
            run.next_action = next_step.title
        self.db.commit()

    def add_event(
        self, run: MvpRunModel, step: RunStepModel, event_type: str, content: str, metadata: dict
    ) -> None:
        self.db.add(RunEventModel(
            run_id=run.id,
            step_id=step.id,
            event_type=event_type,
            content=content,
            metadata_json=json.dumps(metadata, ensure_ascii=False),
        ))
        self.db.commit()

    def apply_tracking(
        self, run: MvpRunModel, blocker: str, next_action: str, vertical: str, artifacts: list[dict]
    ) -> None:
        if blocker is not None:
            run.blocker = blocker
        if next_action is not None:
            run.next_action = next_action
        if vertical:
            run.vertical = vertical
        step_by_key = {step.step_key: step for step in run.steps}
        for item in artifacts:
            step = step_by_key.get(item.get("step_key", ""))
            if step is None:
                continue
            self.upsert_artifact(
                step,
                str(item.get("title") or ""),
                str(item.get("content") or ""),
            )
        self.db.commit()
