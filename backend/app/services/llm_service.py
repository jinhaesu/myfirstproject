import logging
import anthropic

logger = logging.getLogger(__name__)


class LLMService:
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = "claude-opus-4-6"

    def generate(self, prompt: str, system: str = "", max_tokens: int = 4096) -> str:
        """Claude API로 텍스트 생성 (Opus 4.6)"""
        try:
            kwargs = {
                "model": self.model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}],
            }
            if system:
                kwargs["system"] = system

            response = self.client.messages.create(**kwargs)
            return response.content[0].text

        except anthropic.AuthenticationError:
            logger.error("Anthropic API 인증 실패 - API 키를 확인하세요")
            raise ValueError("AI 서비스 인증에 실패했습니다. 관리자에게 문의하세요.")
        except anthropic.RateLimitError:
            logger.warning("Anthropic API 요청 한도 초과")
            raise ValueError("AI 서비스 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.")
        except anthropic.BadRequestError as e:
            logger.error(f"Anthropic API 잘못된 요청: {e}")
            raise ValueError(f"AI 요청 오류: {str(e)}")
        except anthropic.APIError as e:
            logger.error(f"Anthropic API 오류: {e}")
            raise ValueError("AI 서비스에 일시적인 문제가 발생했습니다. 다시 시도해주세요.")
        except Exception as e:
            logger.error(f"LLM 생성 중 예기치 않은 오류: {e}")
            raise ValueError(f"AI 응답 생성 중 오류가 발생했습니다: {str(e)}")
