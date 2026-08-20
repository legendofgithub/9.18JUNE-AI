import base64
import hashlib
import hmac

import httpx

from ..core.config import settings
from ..core.exceptions import ValidationException
from ..core.security import decrypt_api_key, encrypt_api_key
from ..core.url_security import validate_model_base_url
from ..models.database import EntitlementModel, InstalledSkillModel, MvpRunModel, OrderModel, ProductModel
from ..models.database import ModelEntryModel, ModelServiceModel
from ..repositories.commerce_repo import CommerceRepository
from .payment_service import PaymentService


class CommerceService:
    def __init__(self, repo: CommerceRepository, llm_service, payment_service: PaymentService | None = None):
        self.repo = repo
        self.llm = llm_service
        self.payment = payment_service or PaymentService()

    def list_products(self) -> list[dict]:
        return [self._product_to_dict(product) for product in self.repo.list_products()]

    def list_orders(self, owner_id: str) -> list[dict]:
        return [self._order_to_dict(order, order.product) for order in self.repo.list_orders(owner_id)]

    async def create_order(self, owner_id: str, product_id: str) -> dict:
        product = self.repo.get_product(product_id)
        order = self.repo.create_order(owner_id, product, settings.JUNE_PAYMENT_PROVIDER)
        user = self.repo.get_user_by_id(owner_id)
        if user is not None and user.is_admin:
            self.repo.mark_order_paid(order, f"ADMIN-{order.id}")
        elif self.payment.enabled:
            session = await self.payment.create_checkout(order, product)
            order = self.repo.attach_payment_session(order, session["id"], session["url"])
        return self._order_to_dict(order, product)

    async def confirm_order(
        self,
        owner_id: str,
        order_id: str,
        transaction_id: str,
        signature: str | None,
    ) -> dict:
        if not transaction_id.strip():
            raise ValidationException("支付流水号不能为空")
        order = self.repo.get_order(owner_id, order_id)

        if settings.JUNE_PAYMENT_PROVIDER == "stripe":
            raise ValidationException("真实支付订单由支付渠道回调自动确认")

        if settings.is_production:
            expected = self.payment_signature(order.id, transaction_id)
            if not signature or not hmac.compare_digest(signature, expected):
                raise ValidationException("支付回调签名无效")
        elif signature is not None:
            expected = self.payment_signature(order.id, transaction_id)
            if not hmac.compare_digest(signature, expected):
                raise ValidationException("支付回调签名无效")

        granted = self.repo.mark_order_paid(order, transaction_id.strip())
        if not granted:
            raise ValidationException("订单无法确认，请检查支付状态和流水号")
        return self._order_to_dict(order, order.product)

    async def handle_stripe_webhook(self, payload: bytes, signature_header: str) -> dict:
        event = self.payment.verify_webhook(payload, signature_header)
        event_id = str(event.get("id", ""))
        event_type = str(event.get("type", ""))
        event_object = event.get("data", {}).get("object", {})
        order_id = str(
            event_object.get("client_reference_id")
            or event_object.get("metadata", {}).get("order_id")
            or ""
        )
        order = self.repo.get_order_unscoped(order_id)
        if order is not None and order.provider_order_id and order.provider_order_id != str(event_object.get("id", "")):
            order = None
        transaction_id = str(event_object.get("payment_intent") or event_object.get("id") or "")

        result = {
            "received": True,
            "type": event_type,
            "orderId": order.id if order else "",
        }
        if event_type != "checkout.session.completed":
            self.repo.add_payment_event("stripe", event_type, event_id, order.id if order else "", event)
            return result
        if order is None or order.status != "pending" or not transaction_id:
            self.repo.add_payment_event("stripe", event_type, event_id, order_id, event)
            return result

        granted = self.repo.mark_order_paid(order, transaction_id)
        self.repo.add_payment_event("stripe", event_type, event_id, order.id, event)
        result["granted"] = granted
        return result

    @staticmethod
    def payment_signature(order_id: str, transaction_id: str) -> str:
        secret = settings.JUNE_PAYMENT_CALLBACK_SECRET or "june-sandbox-callback-secret"
        payload = f"{order_id}|{transaction_id}|paid"
        digest = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    def get_entitlement(self, owner_id: str) -> dict:
        entitlement = self.repo.get_entitlement(owner_id)
        return self._entitlement_to_dict(entitlement)

    def get_skill(self, owner_id: str) -> dict | None:
        skill = self.repo.find_installed_skill(owner_id)
        return self._skill_to_dict(skill) if skill else None

    DEFAULT_MODEL_SERVICES = [
        {
            "id": "zhipu",
            "display_name": "智谱清言 GLM",
            "vendor": "Zhipu",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "protocol": "openai-compatible",
            "models": [
                {"model_id": "glm-5.2", "display_name": "GLM-5.2", "context_tokens": 128000, "max_output_tokens": 8192},
                {"model_id": "glm-4-flash", "display_name": "GLM-4 Flash", "context_tokens": 128000, "max_output_tokens": 4096},
            ],
        },
        {
            "id": "deepseek",
            "display_name": "DeepSeek",
            "vendor": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "protocol": "openai-compatible",
            "models": [{"model_id": "deepseek-chat", "display_name": "DeepSeek Chat", "context_tokens": 128000, "max_output_tokens": 8192}],
        },
        {
            "id": "openai",
            "display_name": "OpenAI",
            "vendor": "OpenAI",
            "base_url": "https://api.openai.com/v1",
            "protocol": "openai-compatible",
            "models": [{"model_id": "gpt-4o", "display_name": "GPT-4o", "context_tokens": 128000, "max_output_tokens": 16384}],
        },
        {
            "id": "moonshot",
            "display_name": "Kimi",
            "vendor": "Moonshot",
            "base_url": "https://api.moonshot.cn/v1",
            "protocol": "openai-compatible",
            "models": [{"model_id": "moonshot-v1-128k", "display_name": "Kimi 128K", "context_tokens": 128000, "max_output_tokens": 8192}],
        },
        {
            "id": "qwen",
            "display_name": "通义千问",
            "vendor": "Alibaba",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "protocol": "openai-compatible",
            "models": [{"model_id": "qwen-plus", "display_name": "Qwen Plus", "context_tokens": 128000, "max_output_tokens": 8192}],
        },
    ]

    def _seed_model_services(self, owner_id: str) -> None:
        if self.repo.list_model_services(owner_id):
            return
        for item in self.DEFAULT_MODEL_SERVICES:
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
            self.repo.db.add(service)
        self.repo.db.commit()

    def list_model_services(self, owner_id: str) -> list[dict]:
        self._seed_model_services(owner_id)
        return [self._model_service_to_dict(service) for service in self.repo.list_model_services(owner_id)]

    def save_model_service(self, owner_id: str, payload, service_id: str | None = None) -> dict:
        route_id = payload.id or service_id
        if not route_id:
            raise ValidationException("请填写服务路由 ID")
        existing = self.repo.find_model_service_by_route(owner_id, route_id)
        if service_id is None and existing is not None:
            raise ValidationException("服务路由 ID 已存在，请更换后重试")
        service = existing if service_id else ModelServiceModel(id=route_id, owner_id=owner_id)
        if service_id:
            service = self.repo.get_model_service(owner_id, service_id)
            if service.id != route_id and self.repo.find_model_service_by_route(owner_id, route_id):
                raise ValidationException("服务路由 ID 已存在，请更换后重试")
            if payload.version != service.version:
                raise ValidationException("配置已被其他窗口更新，请刷新后重试")

        service.display_name = payload.display_name
        service.vendor = payload.vendor or payload.display_name
        service.base_url = validate_model_base_url(payload.base_url)
        service.protocol = payload.protocol
        if payload.api_key.strip():
            service.encrypted_api_key = encrypt_api_key(payload.api_key.strip())
            service.api_key_ready = True
        service.version = (service.version or 0) + 1
        service.models.clear()
        self.repo.db.flush()
        for item in payload.models:
            service.models.append(ModelEntryModel(
                model_id=item.model_id,
                display_name=item.display_name or item.model_id,
                context_tokens=item.context_tokens,
                max_output_tokens=item.max_output_tokens,
                reasoning=item.reasoning,
            ))
        self.repo.db.add(service)
        self.repo.db.commit()
        self.repo.db.refresh(service)
        return self._model_service_to_dict(service)

    def delete_model_service(self, owner_id: str, service_id: str) -> None:
        service = self.repo.get_model_service(owner_id, service_id)
        self.repo.db.delete(service)
        self.repo.db.commit()

    async def discover_models(self, owner_id: str, service_id: str, base_url: str, api_key: str) -> list[dict]:
        service = self.repo.get_model_service(owner_id, service_id)
        safe_base_url = validate_model_base_url(base_url)
        key = api_key.strip() or decrypt_api_key(service.encrypted_api_key)
        if not key:
            raise ValidationException("请先填写访问密钥再探测模型")
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(
                    f"{safe_base_url}/models",
                    headers={"Authorization": f"Bearer {key}"},
                    follow_redirects=False,
                )
            if response.status_code != 200:
                raise ValidationException(f"模型探测失败：HTTP {response.status_code}")
            data = response.json().get("data", [])
            return [
                {
                    "model_id": str(item.get("id", "")).strip(),
                    "display_name": str(item.get("display_name") or item.get("id") or "").strip(),
                }
                for item in data
                if item.get("id")
            ]
        except httpx.HTTPError as exc:
            raise ValidationException(f"模型探测失败：{type(exc).__name__}")

    async def activate_model(self, owner_id: str, service_id: str, model_id: str) -> dict:
        service = self.repo.get_model_service(owner_id, service_id)
        if not any(model.model_id == model_id for model in service.models):
            raise ValidationException("所选模型不存在")
        if not service.encrypted_api_key:
            raise ValidationException("请先为该服务配置访问密钥")
        result = await self.start_coach(
            owner_id,
            model_id,
            service.base_url,
            decrypt_api_key(service.encrypted_api_key),
        )
        return result

    def _model_service_to_dict(self, service: ModelServiceModel) -> dict:
        return {
            "id": service.id,
            "displayName": service.display_name,
            "vendor": service.vendor,
            "baseUrl": service.base_url,
            "protocol": service.protocol,
            "apiKeyReady": service.api_key_ready,
            "version": service.version,
            "models": [{
                "id": model.id,
                "modelId": model.model_id,
                "displayName": model.display_name,
                "contextTokens": model.context_tokens,
                "maxOutputTokens": model.max_output_tokens,
                "reasoning": model.reasoning,
            } for model in service.models],
        }

    def get_coach_status(self, owner_id: str) -> dict:
        skill = self.repo.find_installed_skill(owner_id)
        active_run = next((run for run in self.repo.list_runs(owner_id) if run.status == "active"), None)
        preferred_run = active_run or next(iter(self.repo.list_runs(owner_id)), None)
        return {
            "paid": self.repo.has_paid_order(owner_id),
            "skillInstalled": skill is not None,
            "apiKeyReady": bool(skill and skill.api_key_ready and skill.encrypted_api_key),
            "modelName": skill.model_name if skill else "",
            "activeRunId": preferred_run.id if preferred_run else None,
        }

    async def start_coach(
        self,
        owner_id: str,
        model_name: str = "",
        base_url: str = "",
        api_key: str = "",
    ) -> dict:
        if not self.repo.has_paid_order(owner_id):
            raise ValidationException("请先完成购买，再启动超级个体训练师人格")

        existing_skill = self.repo.find_installed_skill(owner_id)
        resolved_model = model_name.strip() or (existing_skill.model_name if existing_skill else "glm-5.2")
        resolved_base_url = base_url.strip() or (existing_skill.base_url if existing_skill else "")
        supplied_key = api_key.strip()
        resolved_key = supplied_key or (
            decrypt_api_key(existing_skill.encrypted_api_key)
            if existing_skill and existing_skill.encrypted_api_key
            else ""
        )
        if not resolved_key:
            raise ValidationException("请填写访问密钥后再启动")
        if not resolved_base_url:
            raise ValidationException("请选择 AI 工具后再启动")
        resolved_base_url = validate_model_base_url(resolved_base_url)

        self.llm.set_model(resolved_model, resolved_base_url)
        self.llm.set_api_key(resolved_key)
        connection = await self.llm.test_connection()
        if not connection.get("ok"):
            reason = str(connection.get("error") or "请确认工具和访问密钥").strip()
            raise ValidationException(f"连接 AI 工具失败：{reason}")

        skill = self.repo.install_skill(
            owner_id,
            resolved_model,
            resolved_base_url,
            True,
            encrypt_api_key(resolved_key),
        )
        runs = self.repo.list_runs(owner_id)
        active_run = next((run for run in runs if run.status == "active"), None)
        run = active_run or runs[0] if runs else self.repo.create_run(
            owner_id,
            skill,
            "商业 MVP 项目",
            "",
        )
        return {
            "status": self.get_coach_status(owner_id),
            "skill": self._skill_to_dict(skill),
            "run": self._run_summary(run) if run else None,
        }

    async def install_skill(self, owner_id: str, model_name: str, base_url: str, api_key: str) -> dict:
        return await self.start_coach(owner_id, model_name, base_url, api_key)

    def create_run(self, owner_id: str, title: str, vertical: str) -> dict:
        skill = self.repo.find_installed_skill(owner_id)
        if skill is None:
            raise ValidationException("请先连接 AI 工具并启动训练官")
        run = self.repo.create_run(owner_id, skill, title, vertical)
        return self._run_summary(run)

    def _product_to_dict(self, product: ProductModel) -> dict:
        return {
            "id": product.id,
            "name": product.name,
            "description": product.description,
            "priceCents": product.price_cents,
            "priceYuan": product.price_cents / 100,
            "pathCount": product.path_count,
        }

    def _order_to_dict(self, order: OrderModel, product: ProductModel) -> dict:
        return {
            "id": order.id,
            "productId": order.product_id,
            "productName": product.name,
            "amountCents": order.amount_cents,
            "pathCount": order.path_count,
            "status": order.status,
            "provider": order.provider,
            "providerOrderId": order.provider_order_id,
            "paymentUrl": order.payment_url,
            "providerTransactionId": order.provider_transaction_id,
            "createdAt": int(order.created_at * 1000),
            "paidAt": int(order.paid_at * 1000) if order.paid_at else None,
            "sandbox": settings.JUNE_PAYMENT_PROVIDER == "sandbox" and not settings.is_production,
        }

    @staticmethod
    def _entitlement_to_dict(entitlement: EntitlementModel) -> dict:
        return {
            "totalPaths": entitlement.total_paths,
            "usedPaths": entitlement.used_paths,
            "availablePaths": entitlement.total_paths - entitlement.used_paths,
            "installed": entitlement.installed,
        }

    @staticmethod
    def _skill_to_dict(skill: InstalledSkillModel) -> dict:
        return {
            "id": skill.id,
            "skillKey": skill.skill_key,
            "name": "Vibe Coding 变现训练官",
            "version": skill.version,
            "modelName": skill.model_name,
            "baseUrl": skill.base_url,
            "apiKeyReady": skill.api_key_ready,
            "installedAt": int(skill.installed_at * 1000),
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
