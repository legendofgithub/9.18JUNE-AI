"""
LLM 流式对话服务

兼容任何 OpenAI Chat Completions 格式的 API 服务商：
DeepSeek、OpenAI (GPT)、Moonshot (Kimi)、Zhipu (GLM)、Qwen (通义千问)、
本地模型 (Ollama / LM Studio / vLLM) 等——只需在 .env 中配置对应的
LLM_BASE_URL / LLM_API_KEY / LLM_DEFAULT_MODEL 即可切换。

为保持向后兼容，类名仍为 DeepSeekService。
"""
import os
import asyncio
import json
from typing import AsyncGenerator, Dict, List

from ..core.config import settings


class DeepSeekService:
    """LLM 流式对话服务（OpenAI 兼容格式）"""

    def __init__(self):
        self._api_key: str | None = None
        self._model_override: str | None = None
        self._base_url_override: str | None = None

    @property
    def BASE_URL(self) -> str:
        return self._base_url_override or settings.llm_base_url

    @property
    def DEFAULT_MODEL(self) -> str:
        return self._model_override or settings.llm_default_model

    def get_api_key(self) -> str:
        """获取 API Key（环境变量 > 内存设置 > 配置文件）"""
        return self._api_key or os.getenv("LLM_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or settings.llm_api_key

    def set_api_key(self, key: str):
        self._api_key = key

    def set_model(self, model: str, base_url: str = ""):
        """运行时切换模型；base_url 为空时沿用当前服务商地址"""
        self._model_override = model
        self._base_url_override = base_url or self._base_url_override or settings.llm_base_url

    @staticmethod
    def _connection_error(status_code: int, body: str) -> dict:
        provider_code = ""
        try:
            error = json.loads(body).get("error", {})
            provider_code = str(error.get("code") or "")
        except Exception:
            provider_code = ""

        if status_code == 401:
            message = "访问密钥未被 AI 工具接受，请重新复制完整密钥。"
        elif status_code == 402:
            message = "AI 工具账户余额不足，请先充值后再连接。"
        elif status_code == 403:
            message = "当前密钥没有使用权限，请在 AI 工具账户中检查授权。"
        elif status_code == 404:
            message = "所选 AI 工具暂时无法访问，请稍后再试。"
        elif status_code == 408:
            message = "连接 AI 工具超时，请稍后再试。"
        elif status_code == 429:
            message = "连接尝试过于频繁，请稍后再试。"
        elif status_code >= 500:
            message = "AI 工具服务暂时不稳定，请稍后再试。"
        else:
            message = "AI 工具拒绝了本次连接，请检查账户状态后重试。"

        return {
            "ok": False,
            "error": message,
            "http_status": status_code,
            "provider_code": provider_code,
        }

    async def test_connection(self) -> dict:
        """用一次最小非流式请求验证模型、Base URL 和 API Key。"""
        import httpx

        key = self.get_api_key()
        if not key:
            return {"ok": False, "error": "未配置 API Key"}

        payload = {
            "model": self.DEFAULT_MODEL,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    f"{self.BASE_URL}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            if response.status_code != 200:
                return self._connection_error(response.status_code, response.text[:500])
            data = response.json()
            return {
                "ok": True,
                "model": data.get("model", self.DEFAULT_MODEL),
                "response_model": self.DEFAULT_MODEL,
            }
        except httpx.TimeoutException:
            return {"ok": False, "error": "连接 AI 工具超时，请稍后再试。"}
        except httpx.ConnectError:
            return {"ok": False, "error": "无法连接到 AI 工具，请检查网络后重试。"}
        except Exception:
            return {"ok": False, "error": "连接 AI 工具时出现未知问题，请稍后再试。"}

    async def chat(
        self,
        messages: List[Dict],
        api_key: str = "",
        model: str = "",
        base_url: str = "",
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """流式对话 —— 生成 delta 文本片段"""
        import httpx

        key = api_key or self.get_api_key()
        used_model = model or self.DEFAULT_MODEL
        request_base_url = base_url or self.BASE_URL

        # 无 API Key 时的处理
        if not key:
            if settings.is_production:
                raise RuntimeError("未配置 LLM API Key，请在 .env 中设置 LLM_API_KEY")
            # 开发模式：返回模拟回复以便测试 UI
            mock_text = "这是一个模拟回复。请在设置中配置 API Key（支持任何 OpenAI 兼容格式的服务商：DeepSeek、OpenAI、Kimi、GLM、Qwen 等）以获得真实的 AI 回复。"
            for i in range(0, len(mock_text), 2):
                yield mock_text[i:i + 2]
                await asyncio.sleep(0.03)
            return

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        # 格式化消息 —— content 支持字符串或数组（OpenAI 多模态格式）
        formatted_messages = []
        for msg in messages:
            entry = {"role": msg.get("role", "user"), "content": msg.get("content", "")}
            formatted_messages.append(entry)

        payload = {
            "model": used_model,
            "messages": formatted_messages,
            "stream": True,
            "temperature": temperature,
        }

        # 推理模型（如 glm-5.2）响应较慢，用更长超时
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{request_base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise Exception(f"LLM API error {response.status_code}: {error_text.decode()}")

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            import json
                            chunk = json.loads(data)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            # 推理模型（如 glm-5.2）先输出 reasoning_content，再输出 content
                            if delta.get("reasoning_content"):
                                yield {"type": "reasoning"}
                            content = delta.get("content", "")
                            if content:
                                yield content
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
