import hashlib
import hmac
import json
import time

import httpx

from ..core.config import settings
from ..core.exceptions import ServiceException, ValidationException


class PaymentService:
    """Thin Stripe REST integration; keys never appear in responses or logs."""

    api_base = "https://api.stripe.com/v1"

    @property
    def enabled(self) -> bool:
        return settings.JUNE_PAYMENT_PROVIDER == "stripe"

    async def create_checkout(self, order, product) -> dict:
        if not self.enabled:
            return {}
        if not settings.JUNE_STRIPE_SECRET_KEY:
            raise ServiceException("支付通道未完成配置，请稍后再试")
        base = settings.JUNE_PUBLIC_BASE_URL.rstrip("/")
        form = {
            "mode": "payment",
            "client_reference_id": order.id,
            "success_url": f"{base}/#/success",
            "cancel_url": f"{base}/#/payment",
            "metadata[order_id]": order.id,
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": "cny",
            "line_items[0][price_data][unit_amount]": str(product.price_cents),
            "line_items[0][price_data][product_data][name]": product.name,
        }
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    f"{self.api_base}/checkout/sessions",
                    headers={
                        "Authorization": f"Bearer {settings.JUNE_STRIPE_SECRET_KEY}",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    data=form,
                )
        except httpx.HTTPError as exc:
            raise ServiceException(f"支付通道暂时不可用：{type(exc).__name__}") from exc
        if response.status_code >= 400:
            raise ServiceException("支付通道拒绝创建订单，请检查商户配置")
        data = response.json()
        if not data.get("id") or not data.get("url"):
            raise ServiceException("支付通道返回不完整")
        return data

    def verify_webhook(self, payload: bytes, signature_header: str) -> dict:
        if not settings.JUNE_STRIPE_WEBHOOK_SECRET:
            raise ValidationException("支付回调未配置")
        try:
            parts = dict(item.split("=", 1) for item in signature_header.split(","))
            timestamp = int(parts["t"])
            provided = parts["v1"]
        except (ValueError, KeyError, AttributeError):
            raise ValidationException("支付回调签名格式无效")
        if abs(time.time() - timestamp) > 300:
            raise ValidationException("支付回调已过期")
        signed_payload = f"{timestamp}.".encode() + payload
        expected = hmac.new(
            settings.JUNE_STRIPE_WEBHOOK_SECRET.encode(),
            signed_payload,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, provided):
            raise ValidationException("支付回调签名无效")
        try:
            event = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValidationException("支付回调内容无效")
        if not isinstance(event, dict) or not isinstance(event.get("data"), dict):
            raise ValidationException("支付回调结构无效")
        return event
