FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 创建非 root 用户
RUN useradd -m -u 1000 june && chown -R june:june /app
USER june

# 创建数据目录并设置权限
RUN mkdir -p /data /backups && chown june:june /data /backups

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

ENV JUNE_ENV=production
ENV JUNE_DB_PATH=/data/june.db

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--timeout-keep-alive", "600"]
