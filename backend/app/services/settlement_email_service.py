"""결산 리포트 이메일 발송 서비스"""
import logging
from datetime import datetime
from typing import Optional
from io import BytesIO

import resend
import pandas as pd

from app.config import get_settings

logger = logging.getLogger(__name__)


class SettlementEmailService:
    def __init__(self):
        self.settings = get_settings()
        resend.api_key = self.settings.RESEND_API_KEY

    def send_settlement_report(
        self,
        recipients: list[str],
        year: int,
        month: int,
        settlements: list[dict],
        comparison: Optional[dict] = None,
    ) -> dict:
        """결산 리포트 이메일 발송"""
        try:
            # 엑셀 첨부파일 생성
            excel_buffer = self._create_excel_attachment(year, month, settlements)

            # HTML 본문 생성
            html_body = self._build_report_html(year, month, settlements, comparison)

            params = {
                "from": self.settings.RESEND_FROM_EMAIL,
                "to": recipients,
                "subject": f"[Nuldam] {year}년 {month}월 월별 결산 매출 리포트",
                "html": html_body,
                "attachments": [
                    {
                        "filename": f"결산매출_{year}_{month:02d}.xlsx",
                        "content": list(excel_buffer.getvalue()),
                    }
                ],
            }

            result = resend.Emails.send(params)
            logger.info(f"결산 리포트 발송 완료: {recipients}")
            return {"success": True, "message": "발송 완료", "email_id": str(result)}

        except Exception as e:
            logger.error(f"결산 리포트 발송 실패: {e}")
            return {"success": False, "message": str(e)}

    def _create_excel_attachment(self, year: int, month: int, settlements: list[dict]) -> BytesIO:
        """엑셀 첨부파일 생성"""
        rows = []
        for s in settlements:
            rows.append({
                "카테고리": s.get("category", ""),
                "채널명": s.get("channel_name", ""),
                "총매출": s.get("gross_sales", 0),
                "순매출": s.get("net_sales", 0),
                "정산금액": s.get("settlement_amount", 0),
                "수수료": s.get("commission", 0),
                "환불금액": s.get("refund_amount", 0),
                "주문건수": s.get("order_count", 0),
                "판매수량": s.get("quantity", 0),
                "상태": s.get("status", ""),
            })

        df = pd.DataFrame(rows)

        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name=f"{year}년 {month}월 결산", index=False)

            # 합계 행 추가
            summary = df.select_dtypes(include=["number"]).sum()
            summary_df = pd.DataFrame([summary])
            summary_df.insert(0, "카테고리", "합계")
            summary_df.insert(1, "채널명", "")
            summary_df["상태"] = ""
            summary_df.to_excel(writer, sheet_name=f"{year}년 {month}월 결산", startrow=len(df) + 2, index=False, header=False)

        buffer.seek(0)
        return buffer

    def _build_report_html(self, year: int, month: int, settlements: list[dict], comparison: Optional[dict] = None) -> str:
        """HTML 이메일 본문 생성"""
        total_gross = sum(s.get("gross_sales", 0) for s in settlements)
        total_net = sum(s.get("net_sales", 0) for s in settlements)
        total_settlement = sum(s.get("settlement_amount", 0) for s in settlements)
        total_commission = sum(s.get("commission", 0) for s in settlements)
        channel_count = len(settlements)

        # 카테고리별 집계
        categories = {}
        for s in settlements:
            cat = s.get("category", "기타")
            if cat not in categories:
                categories[cat] = {"gross": 0, "settlement": 0, "count": 0}
            categories[cat]["gross"] += s.get("gross_sales", 0)
            categories[cat]["settlement"] += s.get("settlement_amount", 0)
            categories[cat]["count"] += 1

        cat_rows = ""
        for cat, data in sorted(categories.items()):
            cat_rows += f"""
            <tr>
                <td style="padding:8px;border-bottom:1px solid #eee;">{cat}</td>
                <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{data['count']}개</td>
                <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{data['gross']:,.0f}원</td>
                <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{data['settlement']:,.0f}원</td>
            </tr>"""

        html = f"""
        <div style="font-family:'Apple SD Gothic Neo',Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;">
            <div style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:30px;border-radius:12px;color:white;margin-bottom:20px;">
                <h1 style="margin:0;font-size:24px;">월별 결산 매출 리포트</h1>
                <p style="margin:8px 0 0;opacity:0.9;">{year}년 {month}월 | Nuldam Analytics</p>
            </div>

            <div style="display:flex;gap:12px;margin-bottom:20px;">
                <div style="flex:1;background:#F0F9FF;padding:16px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:#64748B;">총 매출</div>
                    <div style="font-size:20px;font-weight:bold;color:#0369A1;">{total_gross:,.0f}원</div>
                </div>
                <div style="flex:1;background:#F0FDF4;padding:16px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:#64748B;">정산 금액</div>
                    <div style="font-size:20px;font-weight:bold;color:#15803D;">{total_settlement:,.0f}원</div>
                </div>
                <div style="flex:1;background:#FFF7ED;padding:16px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:#64748B;">수수료</div>
                    <div style="font-size:20px;font-weight:bold;color:#C2410C;">{total_commission:,.0f}원</div>
                </div>
                <div style="flex:1;background:#FAF5FF;padding:16px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:#64748B;">채널 수</div>
                    <div style="font-size:20px;font-weight:bold;color:#7E22CE;">{channel_count}개</div>
                </div>
            </div>

            <h3 style="color:#1E293B;">카테고리별 요약</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <thead>
                    <tr style="background:#F8FAFC;">
                        <th style="padding:10px;text-align:left;border-bottom:2px solid #E2E8F0;">카테고리</th>
                        <th style="padding:10px;text-align:right;border-bottom:2px solid #E2E8F0;">채널 수</th>
                        <th style="padding:10px;text-align:right;border-bottom:2px solid #E2E8F0;">총 매출</th>
                        <th style="padding:10px;text-align:right;border-bottom:2px solid #E2E8F0;">정산 금액</th>
                    </tr>
                </thead>
                <tbody>{cat_rows}</tbody>
            </table>

            <p style="color:#64748B;font-size:12px;text-align:center;margin-top:30px;">
                이 리포트는 Nuldam Analytics에서 자동 생성되었습니다.<br>
                상세 데이터는 첨부된 엑셀 파일을 확인해주세요.
            </p>
        </div>
        """
        return html
