import hashlib
import json
import secrets
import time
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from ..core.exceptions import JuneException, NotFoundException, ValidationException
from ..models.database import (
    EntitlementModel,
    InstalledSkillModel,
    MvpRunModel,
    ModelEntryModel,
    ModelServiceModel,
    OrderModel,
    ProductModel,
    RunArtifactModel,
    RunEventModel,
    RunStepModel,
    SessionModel,
    UserModel,
)


PRODUCTS = [
    {
        "id": "super-solo-coach-unlock",
        "name": "超级个体训练师解锁",
        "description": "一次性解锁超级个体训练师人格，自动装载 skill 并进入 AI 跟踪交付流程。",
        "price_cents": 3900,
        "path_count": 1,
    },
]


MVP_STEPS = [
    ("buyer_pain", "选择愿意付费的人群和痛点", "明确一类具体人群、一个急迫痛点和一个你能触达的渠道。", "付费人群与痛点画布"),
    ("sellable_result", "定义一个最小可售卖结果", "把产品压缩成客户能验收、你能交付、愿意付费的一件小事。", "可售卖结果与验收标准"),
    ("vibe_brief", "写出 Vibe Coding 商业需求简报", "用自然语言说明给谁解决什么问题、用户看到什么、下一步做什么。", "Vibe Coding 商业需求简报"),
    ("product_shape", "选择最小产品形态", "在单页工具、表单服务、模板或流程产品中选一个最小形态。", "最小产品形态选择说明"),
    ("first_build", "用自然语言让 AI 生成第一版 MVP", "把商业目标转成清晰指令，让 AI 产出可试用的第一版。", "第一版 MVP 指令与试用说明"),
    ("five_minute_iteration", "用 5 分钟迭代法改到可试用", "每轮只改一个影响试用和购买的问题，直到客户能完整走通。", "5 分钟迭代记录"),
    ("price_payment", "制作报价、收款方式和交付说明", "确定价格、收款方式、交付范围和客户确认标准。", "报价与收款说明"),
    ("growth_assets", "准备获客素材和首批 20 个潜在客户", "准备获客内容、产品介绍和首批潜在客户名单。", "获客素材与潜在客户名单"),
    ("first_sale_delivery", "发起首次销售并完成一次最小交付", "记录真实销售沟通，并完成一次最小交付和客户验收。", "首次销售与交付记录"),
    ("retrospective", "复盘转化、交付和下一轮迭代", "整理转化、交付、收款和改进点，决定下一轮最小实验。", "变现复盘报告"),
]


class CommerceRepository:
    def __init__(self, db: Session):
        self.db = db

    def seed_products(self) -> None:
        active_ids = {item["id"] for item in PRODUCTS}
        for item in PRODUCTS:
            product = self.db.get(ProductModel, item["id"])
            if product is None:
                self.db.add(ProductModel(**item))
            else:
                product.name = item["name"]
                product.description = item["description"]
                product.price_cents = item["price_cents"]
                product.path_count = item["path_count"]
                product.is_active = True
        for product in self.db.query(ProductModel).filter(ProductModel.id.notin_(active_ids)).all():
            product.is_active = False
        self.db.commit()

    def list_products(self) -> list[ProductModel]:
        return self.db.query(ProductModel).filter(ProductModel.is_active.is_(True)).order_by(ProductModel.created_at).all()

    def get_product(self, product_id: str) -> ProductModel:
        product = self.db.get(ProductModel, product_id)
        if product is None or not product.is_active:
            raise NotFoundException("商品不存在或已下架")
        return product

    def create_user(
        self,
        email: str,
        password: str,
        display_name: str,
        identity: str = "",
        is_admin: bool = False,
    ) -> UserModel:
        normalized_email = email.strip().lower()
        normalized_identity = identity.strip().lower()
        if self.find_user_by_email(normalized_email) is not None:
            raise ValidationException("该邮箱已注册")
        if normalized_identity and self.find_user_by_identity(normalized_identity) is not None:
            raise ValidationException("该账号名已注册")
        salt = secrets.token_hex(16)
        password_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 120_000).hex()
        user = UserModel(
            id=str(uuid.uuid4()),
            email=normalized_email,
            identity=normalized_identity,
            display_name=display_name.strip() or normalized_email.split("@")[0],
            password_hash=password_hash,
            password_salt=salt,
            is_admin=is_admin,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def find_user_by_email(self, email: str) -> Optional[UserModel]:
        return self.db.query(UserModel).filter(UserModel.email == email.strip().lower()).first()

    def find_user_by_identity(self, identity: str) -> Optional[UserModel]:
        return self.db.query(UserModel).filter(UserModel.identity == identity.strip().lower()).first()

    def get_user_by_id(self, user_id: str) -> Optional[UserModel]:
        return self.db.get(UserModel, user_id)

    def find_login_user(self, account: str) -> Optional[UserModel]:
        account = account.strip().lower()
        if "@" in account:
            return self.find_user_by_email(account)
        return self.find_user_by_identity(account)

    def seed_admin(self, identity: str, email: str, password: str, display_name: str) -> UserModel:
        normalized_identity = identity.strip().lower()
        user = self.find_user_by_identity(normalized_identity) or self.find_user_by_email(email)
        salt = secrets.token_hex(16)
        password_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 120_000).hex()
        if user is None:
            user = UserModel(
                id=str(uuid.uuid4()),
                email=email.strip().lower(),
                identity=normalized_identity,
                display_name=display_name.strip() or normalized_identity,
                password_hash=password_hash,
                password_salt=salt,
                is_admin=True,
            )
            self.db.add(user)
        else:
            user.email = email.strip().lower()
            user.identity = normalized_identity
            user.display_name = display_name.strip() or normalized_identity
            user.password_hash = password_hash
            user.password_salt = salt
            user.is_admin = True
        self.db.commit()
        self.db.refresh(user)
        return user

    def verify_user(self, account: str, password: str) -> Optional[UserModel]:
        user = self.find_login_user(account)
        if user is None:
            return None
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(user.password_salt), 120_000
        ).hex()
        if not secrets.compare_digest(candidate, user.password_hash):
            return None
        return user

    def create_order(self, owner_id: str, product: ProductModel, provider: str) -> OrderModel:
        order = OrderModel(
            owner_id=owner_id,
            product_id=product.id,
            amount_cents=product.price_cents,
            path_count=product.path_count,
            provider=provider,
            provider_order_id=f"june_{secrets.token_hex(12)}",
        )
        self.db.add(order)
        self.db.commit()
        self.db.refresh(order)
        return order

    def get_order(self, owner_id: str, order_id: str) -> OrderModel:
        order = self.db.get(OrderModel, order_id)
        if order is None or order.owner_id != owner_id:
            raise NotFoundException("订单不存在")
        return order

    def list_orders(self, owner_id: str) -> list[OrderModel]:
        return (
            self.db.query(OrderModel)
            .filter(OrderModel.owner_id == owner_id)
            .order_by(OrderModel.created_at.desc())
            .all()
        )

    def has_paid_order(self, owner_id: str) -> bool:
        return (
            self.db.query(OrderModel.id)
            .filter(OrderModel.owner_id == owner_id, OrderModel.status == "paid")
            .first()
            is not None
        )

    def mark_order_paid(self, order: OrderModel, transaction_id: str) -> bool:
        if order.status == "paid":
            return order.provider_transaction_id == transaction_id
        if order.status != "pending":
            return False
        order.status = "paid"
        order.provider_transaction_id = transaction_id
        order.paid_at = time.time()
        self._grant_paths(order.owner_id, order.path_count)
        self.db.commit()
        return True

    def _grant_paths(self, owner_id: str, path_count: int) -> None:
        entitlement = self.get_entitlement(owner_id, create=False)
        if entitlement is None:
            entitlement = EntitlementModel(owner_id=owner_id, total_paths=0, used_paths=0)
            self.db.add(entitlement)
        entitlement.total_paths += path_count

    def get_entitlement(self, owner_id: str, create: bool = True) -> Optional[EntitlementModel]:
        entitlement = self.db.get(EntitlementModel, owner_id)
        if entitlement is None and create:
            entitlement = EntitlementModel(owner_id=owner_id)
            self.db.add(entitlement)
            self.db.commit()
            self.db.refresh(entitlement)
        return entitlement

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
        entitlement = self.get_entitlement(owner_id)
        entitlement.installed = True
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
        service = self.db.get(ModelServiceModel, service_id)
        if service is None or service.owner_id != owner_id:
            raise NotFoundException("模型服务不存在")
        return service

    def find_model_service_by_route(self, owner_id: str, service_id: str) -> Optional[ModelServiceModel]:
        return (
            self.db.query(ModelServiceModel)
            .filter(ModelServiceModel.owner_id == owner_id, ModelServiceModel.id == service_id)
            .first()
        )

    def create_run(self, owner_id: str, skill: InstalledSkillModel, title: str, vertical: str) -> MvpRunModel:
        run = MvpRunModel(
            owner_id=owner_id,
            installed_skill_id=skill.id,
            title=title.strip() or "未命名商业 MVP",
            vertical=vertical.strip(),
            blocker="尚未完成商业项目问卷",
            next_action="回答训练官的商业目标问题",
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
            raise NotFoundException("MVP 路径不存在")
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
