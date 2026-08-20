"""
统一异常定义 —— 所有业务异常继承 JuneException，
由全局异常处理器统一转换为 {"code": xxx, "message": "...", "data": null} 格式。
"""


class JuneException(Exception):
    """June AI 基础异常"""

    def __init__(self, message: str, code: int = 400, data: dict | None = None):
        self.message = message
        self.code = code
        self.data = data
        super().__init__(message)


class NotFoundException(JuneException):
    """资源不存在 (404)"""

    def __init__(self, message: str = "资源不存在"):
        super().__init__(message=message, code=404)


class UnauthorizedException(JuneException):
    """未授权 (401)"""

    def __init__(self, message: str = "未授权访问，请检查 API Token"):
        super().__init__(message=message, code=401)


class ValidationException(JuneException):
    """参数校验失败 (400)"""

    def __init__(self, message: str = "参数校验失败"):
        super().__init__(message=message, code=400)


class ForbiddenException(JuneException):
    """已登录但无权限 (403)"""

    def __init__(self, message: str = "没有权限执行此操作"):
        super().__init__(message=message, code=403)


class RateLimitException(JuneException):
    """触发限流 (429)"""

    def __init__(self, message: str = "请求过于频繁，请稍后再试"):
        super().__init__(message=message, code=429)


class ServiceException(JuneException):
    """外部服务异常 (502)"""

    def __init__(self, message: str = "外部服务异常"):
        super().__init__(message=message, code=502)
