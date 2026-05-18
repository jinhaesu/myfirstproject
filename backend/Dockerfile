FROM python:3.12-slim

# Install system dependencies for Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 || true \
    && apt-get install -y --no-install-recommends \
    libwayland-client0 \
    libdbus-1-3 \
    libglib2.0-0 \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright Chromium은 런타임에 백그라운드로 다운로드 (app/main.py 참고).
# 빌드 단계에서 112MB Chromium 다운로드를 수행하면 Railway activity heartbeat
# timeout이 발생할 수 있어 의도적으로 제거.

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Start command
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
