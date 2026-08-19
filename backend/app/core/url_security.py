"""Validation for user-supplied OpenAI-compatible API base URLs."""

import ipaddress
import socket
from urllib.parse import urlparse

from .config import settings
from .exceptions import ValidationException


_TRUSTED_MODEL_HOSTS = {
    "open.bigmodel.cn",
    "api.deepseek.com",
    "api.openai.com",
    "api.moonshot.cn",
    "dashscope.aliyuncs.com",
}


def validate_model_base_url(raw_url: str) -> str:
    """Return a normalized base URL and reject local/private network targets."""
    value = (raw_url or "").strip().rstrip("/")
    if not value:
        raise ValidationException("请填写 AI 工具服务地址")
    if len(value) > 500:
        raise ValidationException("AI 工具服务地址过长")

    try:
        parsed = urlparse(value)
    except ValueError as exc:
        raise ValidationException("AI 工具服务地址格式无效") from exc

    if parsed.scheme not in ("http", "https"):
        raise ValidationException("AI 工具服务地址必须以 http:// 或 https:// 开头")
    if not parsed.hostname:
        raise ValidationException("AI 工具服务地址缺少主机名")
    if parsed.username or parsed.password:
        raise ValidationException("AI 工具服务地址不能包含账号密码")
    if parsed.query or parsed.fragment:
        raise ValidationException("AI 工具服务地址不能包含查询参数或锚点")
    if settings.is_production and parsed.scheme != "https":
        raise ValidationException("生产环境 AI 工具服务地址必须使用 HTTPS")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in _TRUSTED_MODEL_HOSTS:
        return value

    addresses = _resolve_hostname(hostname)
    for address in addresses:
        local_target = (
            address.is_loopback
            or address.is_private
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        )
        local_dev_loopback = not settings.is_production and (
            hostname in ("localhost", "localhost.localdomain") or address.is_loopback
        )
        if local_target and not local_dev_loopback:
            raise ValidationException("不能使用内网、本机或保留地址作为 AI 工具服务")
    return value


def _resolve_hostname(hostname: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        return [ipaddress.ip_address(hostname)]
    except ValueError:
        pass
    try:
        responses = socket.getaddrinfo(hostname, None)
        return [ipaddress.ip_address(item[4][0]) for item in responses]
    except (socket.gaierror, ValueError) as exc:
        raise ValidationException("AI 工具服务域名无法解析") from exc
