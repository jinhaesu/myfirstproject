"""설정 로드 — .env 파일에서 환경 변수를 읽어옵니다."""
import os
import sys

from dotenv import load_dotenv


def load_config() -> dict:
    """Load configuration from .env file and environment variables."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    load_dotenv(env_path)

    backend_url = os.getenv("BACKEND_URL", "").rstrip("/")
    api_key = os.getenv("AGENT_API_KEY", "")

    if not backend_url:
        print("[오류] BACKEND_URL이 설정되지 않았습니다. .env 파일을 확인하세요.")
        sys.exit(1)
    if not api_key:
        print("[오류] AGENT_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.")
        sys.exit(1)

    headless_str = os.getenv("HEADLESS", "false").lower()
    headless = headless_str in ("true", "1", "yes")

    captcha_wait = int(os.getenv("CAPTCHA_WAIT_SECONDS", "120"))

    return {
        "backend_url": backend_url,
        "api_key": api_key,
        "headless": headless,
        "captcha_wait": captcha_wait,
    }
