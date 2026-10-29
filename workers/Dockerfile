FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY leadmaker_workers ./leadmaker_workers
COPY scripts ./scripts

ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "leadmaker_workers.main"]
