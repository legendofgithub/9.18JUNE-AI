from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.models import router


def test_set_model_updates_runtime_llm_service():
    service = SimpleNamespace(
        set_model=MagicMock(),
        set_api_key=MagicMock(),
        DEFAULT_MODEL='glm-4-flash',
        BASE_URL='https://open.bigmodel.cn/api/paas/v4',
    )
    app = FastAPI()
    @app.middleware('http')
    async def mark_admin(request, call_next):
        request.state.auth_scheme = 'admin'
        return await call_next(request)

    app.include_router(router, prefix='/api')
    app.state.deepseek_service = service

    response = TestClient(app).put('/api/config/model', json={
        'name': 'glm-4-flash',
        'base_url': 'https://open.bigmodel.cn/api/paas/v4',
        'api_key': 'sk-test',
    })

    assert response.status_code == 200
    assert response.json()['data']['model'] == 'glm-4-flash'
    service.set_model.assert_called_once_with('glm-4-flash', 'https://open.bigmodel.cn/api/paas/v4')
    service.set_api_key.assert_called_once_with('sk-test')
