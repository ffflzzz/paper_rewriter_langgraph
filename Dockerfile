FROM python:3.11-slim

WORKDIR /app

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ \
    && rm -rf /var/lib/apt/lists/*

# Python依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# jieba词典预下载
RUN python -c "import jieba; jieba.initialize()"

# 应用代码
COPY agent/ ./agent/

# 运行目录（挂载卷）
RUN mkdir -p /app/runs /app/data

EXPOSE 8765

CMD ["python", "-m", "agent"]
