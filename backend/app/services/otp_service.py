import random
import string
from datetime import datetime, timedelta
from typing import Optional
import resend

from app.config import get_settings


class OTPService:
    # 메모리 기반 OTP 저장소 (프로덕션에서는 Redis 권장)
    _otp_store: dict[str, dict] = {}

    def __init__(self):
        self.settings = get_settings()
        resend.api_key = self.settings.RESEND_API_KEY

    def generate_otp(self) -> str:
        """6자리 랜덤 숫자 OTP 생성"""
        return ''.join(random.choices(string.digits, k=6))

    def store_otp(self, email: str, otp: str) -> None:
        """OTP를 이메일과 함께 저장 (만료 시간 포함)"""
        expiration = datetime.utcnow() + timedelta(minutes=self.settings.OTP_EXPIRATION_MINUTES)
        OTPService._otp_store[email] = {
            "otp": otp,
            "expires_at": expiration,
            "attempts": 0
        }

    def verify_otp(self, email: str, otp: str) -> bool:
        """OTP 검증"""
        stored = OTPService._otp_store.get(email)

        if not stored:
            return False

        # 만료 확인
        if datetime.utcnow() > stored["expires_at"]:
            del OTPService._otp_store[email]
            return False

        # 시도 횟수 제한 (5회)
        if stored["attempts"] >= 5:
            del OTPService._otp_store[email]
            return False

        stored["attempts"] += 1

        # OTP 일치 확인
        if stored["otp"] == otp:
            del OTPService._otp_store[email]  # 사용 후 삭제
            return True

        return False

    def send_otp_email(self, email: str, otp: str) -> bool:
        """Resend를 통해 OTP 이메일 발송"""
        try:
            params = {
                "from": self.settings.RESEND_FROM_EMAIL,
                "to": [email],
                "subject": "[Nuldam] 로그인 인증 코드",
                "html": f"""
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #4F46E5;">Nuldam BigQuery Chat Analytics</h2>
                    <p>로그인 인증 코드입니다:</p>
                    <div style="background-color: #F3F4F6; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1F2937;">{otp}</span>
                    </div>
                    <p style="color: #6B7280; font-size: 14px;">
                        이 코드는 {self.settings.OTP_EXPIRATION_MINUTES}분간 유효합니다.<br>
                        본인이 요청하지 않았다면 이 이메일을 무시하세요.
                    </p>
                </div>
                """
            }

            resend.Emails.send(params)
            return True
        except Exception as e:
            print(f"Failed to send OTP email: {e}")
            return False

    def create_and_send_otp(self, email: str) -> bool:
        """OTP 생성, 저장, 발송을 한 번에 처리"""
        otp = self.generate_otp()
        self.store_otp(email, otp)
        return self.send_otp_email(email, otp)
