import os
from typing import AsyncGenerator, Dict, List


class DeepSeekService:
    """DeepSeek API 服务 —— 流式对话"""

    BASE_URL = "https://api.deepseek.com/v1"
    DEFAULT_MODEL = "deepseek-v4-pro"
    _api_key: str | None = None

    def get_api_key(self) -> str:
        """获取 API Key（环境变量 > 内存设置）"""
        return self._api_key or os.getenv("DEEPSEEK_API_KEY", "")

    def set_api_key(self, key: str):
        self._api_key = key

    async def chat(
        self,
        messages: List[Dict],
        api_key: str = "",
        model: str = DEFAULT_MODEL,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """流式对话 —— 生成 delta 文本片段"""
        import httpx

        if not api_key:
            # 无 API Key 时返回模拟回复（开发用）
            mock_text = "这是一个模拟回复。请在设置中配置 DeepSeek API Key 以获得真实的 AI 回复。DeepSeek 提供强大的对话模型，支持多轮对话和上下文理解。"
            words = mock_text
            for i in range(0, len(words), 2):
                yield words[i:i+2]
                import asyncio
                await asyncio.sleep(0.03)
            return

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        # 格式化消息 —— content 支持字符串或数组（OpenAI 多模态格式）
        formatted_messages = []
        for msg in messages:
            entry = {"role": msg.get("role", "user"), "content": msg.get("content", "")}
            formatted_messages.append(entry)

        payload = {
            "model": model,
            "messages": formatted_messages,
            "stream": True,
            "temperature": temperature,
            "max_tokens": 4096,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{self.BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise Exception(f"DeepSeek API error {response.status_code}: {error_text.decode()}")

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            import json
                            chunk = json.loads(data)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
