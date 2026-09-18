import time

from ..core.exceptions import ForbiddenException, NotFoundException, ValidationException
from ..models.database import UserModel
from ..repositories.commerce_repo import CommerceRepository


class AdminService:
    def __init__(self, repo: CommerceRepository, auth_service):
        self.repo = repo
        self.auth_service = auth_service

    def overview(self) -> dict:
        return self.repo.overview_stats()

    def list_users(self, search: str = "") -> list[dict]:
        users = self.repo.list_users(search)
        result = []
        for user in users:
            orders = self.repo.list_orders(user.id)
            result.append({
                "id": user.id,
                "email": user.email,
                "account": user.identity or user.email,
                "displayName": user.display_name,
                "isAdmin": bool(user.is_admin),
                "isDisabled": bool(user.is_disabled),
                "disabledReason": user.disabled_reason,
                "createdAt": int(user.created_at * 1000),
                "orderCount": len(orders),
                "paidCount": sum(1 for order in orders if order.status == "paid"),
            })
        return result

    def list_orders(self, limit: int = 100) -> list[dict]:
        orders = self.repo.list_all_orders(limit)
        users = {user.id: user for user in self.repo.list_users()}
        return [{
            "id": order.id,
            "ownerAccount": (users.get(order.owner_id).email if users.get(order.owner_id) else ""),
            "productName": order.product.name if order.product else order.product_id,
            "amountCents": order.amount_cents,
            "status": order.status,
            "provider": order.provider,
            "providerOrderId": order.provider_order_id,
            "createdAt": int(order.created_at * 1000),
            "paidAt": int(order.paid_at * 1000) if order.paid_at else None,
        } for order in orders]

    def set_user_disabled(self, actor_id: str, target_user_id: str, disabled: bool, reason: str, ip: str, user_agent: str) -> dict:
        actor = self.repo.get_user_by_id(actor_id)
        target = self.repo.get_user_by_id(target_user_id)
        if actor is None:
            raise ForbiddenException("管理员状态无效")
        if target is None:
            raise NotFoundException("用户不存在")
        if target.is_admin:
            raise ValidationException("不能禁用管理员账号")
        if disabled and not reason.strip():
            raise ValidationException("请填写禁用原因")

        target = self.repo.set_user_disabled(target_user_id, disabled, reason)
        self.repo.add_audit(
            actor.id,
            actor.identity or actor.email,
            "admin.user_disabled" if disabled else "admin.user_enabled",
            target_type="user",
            target_id=target.id,
            ip=ip,
            user_agent=user_agent,
            detail={"reason": reason.strip() if disabled else ""},
        )
        return self._user_to_dict(target)

    def unlock_user(self, actor_id: str, target_user_id: str, ip: str, user_agent: str) -> dict:
        actor = self.repo.get_user_by_id(actor_id)
        target = self.repo.get_user_by_id(target_user_id)
        if actor is None:
            raise ForbiddenException("管理员状态无效")
        if target is None:
            raise NotFoundException("用户不存在")
        account = target.identity or target.email
        removed = self.repo.clear_login_throttles(account)
        self.repo.add_audit(
            actor.id,
            actor.identity or actor.email,
            "admin.user_unlocked",
            target_type="user",
            target_id=target.id,
            ip=ip,
            user_agent=user_agent,
            detail={"removedThrottles": removed},
        )
        return {"unlocked": True, "removedThrottles": removed}

    def list_audit_logs(self, limit: int = 100) -> list[dict]:
        import json

        return [{
            "id": item.id,
            "actorId": item.actor_id,
            "actorAccount": item.actor_account,
            "action": item.action,
            "targetType": item.target_type,
            "targetId": item.target_id,
            "ip": item.ip,
            "userAgent": item.user_agent,
            "detail": json.loads(item.detail_json or "{}"),
            "createdAt": int(item.created_at * 1000),
        } for item in self.repo.list_audit_logs(limit)]

    def _user_to_dict(self, user: UserModel) -> dict:
        return {
            "id": user.id,
            "email": user.email,
            "account": user.identity or user.email,
            "displayName": user.display_name,
            "isAdmin": bool(user.is_admin),
            "isDisabled": bool(user.is_disabled),
            "disabledReason": user.disabled_reason,
            "createdAt": int(user.created_at * 1000),
        }
