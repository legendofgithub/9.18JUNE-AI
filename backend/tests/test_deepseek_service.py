"""
DeepSeekService（LLM 服务）单元测试
"""
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from app.services.deepseek import DeepSeekService
from app.core.config import settings


class TestDeepSeekService:
    def test_env_key(self, monkeypatch):
        svc = DeepSeekService(); svc._api_key = None
        monkeypatch.setenv('DEEPSEEK_API_KEY', 'sk-env')
        monkeypatch.setattr(settings, 'DEEPSEEK_API_KEY', '')
        monkeypatch.setattr(settings, 'LLM_API_KEY', '')
        assert svc.get_api_key() == 'sk-env'

    def test_memory_over_env(self, monkeypatch):
        svc = DeepSeekService(); svc._api_key = 'sk-mem'
        monkeypatch.setenv('DEEPSEEK_API_KEY', 'sk-env')
        assert svc.get_api_key() == 'sk-mem'

    def test_empty_key(self, monkeypatch):
        svc = DeepSeekService(); svc._api_key = None
        monkeypatch.delenv('DEEPSEEK_API_KEY', raising=False)
        monkeypatch.delenv('LLM_API_KEY', raising=False)
        monkeypatch.setattr(settings, 'DEEPSEEK_API_KEY', '')
        monkeypatch.setattr(settings, 'LLM_API_KEY', '')
        assert svc.get_api_key() == ''

    def test_set_key(self):
        svc = DeepSeekService(); svc.set_api_key('sk-new')
        assert svc._api_key == 'sk-new'

    def test_runtime_model_override(self):
        svc = DeepSeekService()
        svc.set_model('glm-4-flash', 'https://open.bigmodel.cn/api/paas/v4')
        assert svc.DEFAULT_MODEL == 'glm-4-flash'
        assert svc.BASE_URL == 'https://open.bigmodel.cn/api/paas/v4'

    def test_default_model(self):
        assert DeepSeekService().DEFAULT_MODEL == settings.llm_default_model

    def test_base_url(self):
        assert DeepSeekService().BASE_URL == settings.llm_base_url

    @pytest.mark.asyncio
    async def test_mock_reply(self, monkeypatch):
        svc = DeepSeekService(); svc._api_key = None
        monkeypatch.delenv('DEEPSEEK_API_KEY', raising=False)
        monkeypatch.delenv('LLM_API_KEY', raising=False)
        monkeypatch.setattr(settings, 'DEEPSEEK_API_KEY', '')
        monkeypatch.setattr(settings, 'LLM_API_KEY', '')
        with patch.object(type(settings), 'is_production', new_callable=lambda: property(lambda self: False)):
            chunks = [c async for c in svc.chat(messages=[{"role": "user", "content": "?"}], api_key="")]
            assert len(''.join(chunks)) > 10

    @pytest.mark.asyncio
    async def test_real_api(self):
        svc = DeepSeekService()

        class FakeResponse:
            status_code = 200
            async def aiter_lines(self):
                for l in ['data: {"choices":[{"delta":{"content":"A"}}]}',
                           'data: {"choices":[{"delta":{"content":"B"}}]}',
                           'data: [DONE]']:
                    yield l
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        class FakeClient:
            def stream(self, method, url, headers, json):
                return FakeResponse()
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        with patch('app.services.deepseek.model_async_client', return_value=FakeClient()):
            result = ''.join([c async for c in svc.chat(
                messages=[{"role": "user", "content": "?"}], api_key="sk-fake")])
            assert result == 'AB'

    @pytest.mark.asyncio
    async def test_api_error(self):
        svc = DeepSeekService()

        class FakeResponse:
            status_code = 500
            async def aread(self): return b'Error'
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        class FakeClient:
            def stream(self, method, url, headers, json):
                return FakeResponse()
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        with patch('app.services.deepseek.model_async_client', return_value=FakeClient()):
            with pytest.raises(Exception, match='LLM API error'):
                async for _ in svc.chat(messages=[{"role": "user", "content": "?"}], api_key="sk-fake"):
                    pass

    @pytest.mark.asyncio
    async def test_msg_format(self):
        svc = DeepSeekService()
        captured = {}

        class FakeResponse:
            status_code = 200
            async def aiter_lines(self):
                yield 'data: [DONE]'
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        class FakeClient:
            def stream(self, method, url, headers, json):
                captured.update(json)
                return FakeResponse()
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        with patch('app.services.deepseek.model_async_client', return_value=FakeClient()):
            async for _ in svc.chat(messages=[{"role": "system", "content": "sys"},
                                              {"role": "user", "content": "q"}], api_key="sk-fake"):
                pass
        assert captured.get('stream') is True
        assert len(captured.get('messages', [])) == 2

    @pytest.mark.asyncio
    async def test_payload_uses_runtime_model(self):
        svc = DeepSeekService()
        svc.set_model('glm-4-flash')
        captured = {}

        class FakeResponse:
            status_code = 200
            async def aiter_lines(self):
                yield 'data: [DONE]'
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        class FakeClient:
            def stream(self, method, url, headers, json):
                captured.update({'method': method, 'url': url, 'payload': json})
                return FakeResponse()
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        with patch('app.services.deepseek.model_async_client', return_value=FakeClient()):
            async for _ in svc.chat(messages=[{"role": "user", "content": "?"}], api_key='sk-fake'):
                pass
        assert captured['payload']['model'] == 'glm-4-flash'

    @pytest.mark.asyncio
    async def test_connection_success(self):
        svc = DeepSeekService()
        svc.set_model('glm-5.2', 'https://open.bigmodel.cn/api/paas/v4')

        class FakeResponse:
            status_code = 200
            text = '{}'
            def json(self):
                return {'model': 'glm-5.2'}

        class FakeClient:
            async def post(self, url, headers, json):
                assert url == '/chat/completions'
                assert json['model'] == 'glm-5.2'
                assert json['stream'] is False
                return FakeResponse()
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        with patch('app.services.deepseek.model_async_client', return_value=FakeClient()):
            result = await svc.test_connection()
        assert result['ok'] is True
        assert result['model'] == 'glm-5.2'

    @pytest.mark.asyncio
    async def test_connection_http_error(self):
        svc = DeepSeekService()

        class FakeResponse:
            status_code = 401
            text = 'unauthorized'

        class FakeClient:
            async def post(self, url, headers, json):
                return FakeResponse()
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass

        with patch('app.services.deepseek.model_async_client', return_value=FakeClient()):
            result = await svc.test_connection()
        assert result['ok'] is False
        assert '访问密钥未被 AI 工具接受' in result['error']
        assert result['http_status'] == 401
        assert 'sk-' not in result['error']
