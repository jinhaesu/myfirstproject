import logging
import anthropic

logger = logging.getLogger(__name__)


class LLMService:
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = "claude-opus-4-6"

    def generate(self, prompt: str, system: str = "", max_tokens: int = 4096) -> str:
        """Claude API로 텍스트 생성"""
        try:
            kwargs = {
                "model": self.model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}],
            }
            if system:
                kwargs["system"] = system

            response = self.client.messages.create(**kwargs)
            text = response.content[0].text

            # max_tokens에서 잘렸으면 자동 이어쓰기
            if response.stop_reason == "max_tokens":
                text = self._continue_generation(
                    system=system,
                    original_prompt=prompt,
                    partial_text=text,
                    max_tokens=max_tokens,
                )

            return text

        except anthropic.AuthenticationError:
            logger.error("Anthropic API 인증 실패")
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

    def _continue_generation(
        self,
        system: str,
        original_prompt: str,
        partial_text: str,
        max_tokens: int,
        max_rounds: int = 3,
    ) -> str:
        """응답이 max_tokens에서 잘렸을 때 자동으로 이어서 생성"""
        full_text = partial_text

        for round_num in range(max_rounds):
            logger.info(f"응답이 잘려서 이어쓰기 진행 (라운드 {round_num + 1})")

            kwargs = {
                "model": self.model,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "user", "content": original_prompt},
                    {"role": "assistant", "content": full_text},
                    {"role": "user", "content": "끊긴 부분부터 바로 이어서 작성하세요. 인사말이나 중복 없이 끊긴 곳에서 바로 이어가세요."},
                ],
            }
            if system:
                kwargs["system"] = system

            response = self.client.messages.create(**kwargs)
            chunk = response.content[0].text
            full_text += chunk

            if response.stop_reason != "max_tokens":
                break

        return full_text
