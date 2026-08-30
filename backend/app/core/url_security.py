"""Validation for user-supplied OpenAI-compatible API base URLs."""

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from .config import settings
from .exceptions import ValidationException


@dataclass(frozen=True)
class ValidatedModelEndpoint:
    url: str
    hostname: str
    address: str


def validate_model_base_url_details(raw_url: str) -> ValidatedModelEndpoint:
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
    addresses = _resolve_hostname(hostname)
    allowed_addresses = []
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
        if not local_target or local_dev_loopback:
            allowed_addresses.append(address)
    if not allowed_addresses:
        raise ValidationException("AI 工具服务地址没有可用解析结果")
    return ValidatedModelEndpoint(value, hostname, str(allowed_addresses[0]))


def validate_model_base_url(raw_url: str) -> str:
    return validate_model_base_url_details(raw_url).url


class PinnedModelTransport(httpx.AsyncBaseTransport):
    """Connect to the DNS answer accepted during SSRF validation.

    The URL host is temporarily replaced with that IP. The original Host header
    and TLS SNI are retained, so DNS cannot return a different answer between
    validation and the actual connection.
    """

    def __init__(self, endpoint: ValidatedModelEndpoint):
        self.endpoint = endpoint
        self._transport = httpx.AsyncHTTPTransport(trust_env=False)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        request_hostname = (request.url.host or "").rstrip(".").lower()
        if request_hostname != self.endpoint.hostname:
            raise ValidationException("AI 工具请求地址与已校验地址不一致")
        original_host = request.url.netloc.decode("ascii")
        request.url = request.url.copy_with(host=self.endpoint.address)
        request.headers["Host"] = original_host
        request.extensions["sni_hostname"] = self.endpoint.hostname
        return await self._transport.handle_async_request(request)

    async def aclose(self) -> None:
        await self._transport.aclose()


def model_async_client(base_url: str, timeout: float) -> httpx.AsyncClient:
    endpoint = validate_model_base_url_details(base_url)
    return httpx.AsyncClient(
        base_url=endpoint.url,
        timeout=timeout,
        transport=PinnedModelTransport(endpoint),
        follow_redirects=False,
    )


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
