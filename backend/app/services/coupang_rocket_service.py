"""쿠팡 로켓(Supplier Hub) RPA 서비스

supplier.coupang.com에 공개 API가 없으므로
Playwright를 이용한 브라우저 자동화로 매출 데이터를 수집합니다.
"""
import asyncio
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass


@dataclass
class CoupangRocketConfig:
    """쿠팡 로켓 RPA 설정"""
    login_id: str       # 공급업체 로그인 ID
    login_password: str # 비밀번호
    base_url: str = "https://supplier.coupang.com"


class CoupangRocketService:
    """쿠팡 로켓 RPA 서비스"""

    def __init__(self, config: Optional[CoupangRocketConfig] = None):
        if config:
            self.config = config
        else:
            self.config = CoupangRocketConfig(
                login_id="",
                login_password="",
            )

    def update_config(self, login_id: str, login_password: str):
        """인증 정보 동적 업데이트"""
        self.config = CoupangRocketConfig(
            login_id=login_id,
            login_password=login_password,
        )

    def is_configured(self) -> bool:
        """인증 정보 설정 여부"""
        return bool(self.config.login_id and self.config.login_password)

    @staticmethod
    def is_playwright_available() -> bool:
        """Playwright 설치 여부 확인"""
        try:
            from playwright.async_api import async_playwright
            return True
        except ImportError:
            return False

    async def _login(self, page) -> bool:
        """supplier.coupang.com 로그인"""
        await page.goto(f"{self.config.base_url}/login", wait_until="networkidle", timeout=30000)

        # 로그인 폼 입력
        await page.fill('input[name="username"], input[id="username"], input[type="text"]', self.config.login_id)
        await page.fill('input[name="password"], input[id="password"], input[type="password"]', self.config.login_password)

        # 로그인 버튼 클릭
        await page.click('button[type="submit"], input[type="submit"], .login-btn, .btn-login')

        # 로그인 완료 대기
        try:
            await page.wait_for_url(f"{self.config.base_url}/**", timeout=15000)
            return True
        except Exception:
            return False

    async def _navigate_to_sales(self, page, start_date: str, end_date: str):
        """매출현황 페이지로 이동 및 날짜 설정"""
        # 정산관리 > 매출현황
        sales_url = f"{self.config.base_url}/ecp/vendorSaleManager/salesList"
        await page.goto(sales_url, wait_until="networkidle", timeout=30000)

        # 날짜 입력
        try:
            # 시작일
            start_input = page.locator('input[name="startDate"], input.start-date, input[placeholder*="시작"]').first
            await start_input.clear()
            await start_input.fill(start_date)

            # 종료일
            end_input = page.locator('input[name="endDate"], input.end-date, input[placeholder*="종료"]').first
            await end_input.clear()
            await end_input.fill(end_date)

            # 검색 버튼 클릭
            await page.click('button.btn-search, button:has-text("검색"), button:has-text("조회")')
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

    async def _parse_sales_table(self, page) -> list[dict]:
        """매출 테이블 데이터 파싱"""
        rows = []

        try:
            # 테이블 행 찾기
            table_rows = await page.locator("table tbody tr").all()

            for row in table_rows:
                cells = await row.locator("td").all()
                if len(cells) < 4:
                    continue

                cell_texts = []
                for cell in cells:
                    text = await cell.inner_text()
                    cell_texts.append(text.strip())

                rows.append(cell_texts)
        except Exception:
            pass

        return rows

    def _parse_amount(self, text: str) -> float:
        """금액 문자열 파싱 (콤마, 원 등 제거)"""
        cleaned = text.replace(",", "").replace("원", "").replace(" ", "").strip()
        try:
            return float(cleaned)
        except (ValueError, TypeError):
            return 0

    async def get_daily_sales_by_range(
        self,
        start_date: str,
        end_date: str,
    ) -> dict[str, list[dict]]:
        """날짜 범위 기반 일별 매출 데이터 조회 (RPA)

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)

        Returns:
            월별로 그룹핑된 일별 매출 데이터
        """
        if not self.is_playwright_available():
            raise Exception("Playwright가 설치되어 있지 않습니다. pip install playwright && playwright install chromium")

        from playwright.async_api import async_playwright

        monthly_sales: dict[str, dict[int, dict]] = {}

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                locale="ko-KR",
            )
            page = await context.new_page()

            try:
                # 로그인
                logged_in = await self._login(page)
                if not logged_in:
                    raise Exception("쿠팡 Supplier Hub 로그인 실패. ID/비밀번호를 확인해주세요.")

                # 매출현황 페이지 이동
                await self._navigate_to_sales(page, start_date, end_date)

                # 테이블 데이터 파싱
                raw_rows = await self._parse_sales_table(page)

                # 데이터 가공
                for row in raw_rows:
                    try:
                        # 첫 번째 열: 날짜 (YYYY-MM-DD 또는 YYYY.MM.DD)
                        date_str = row[0].replace(".", "-").strip()
                        parsed_date = datetime.strptime(date_str, "%Y-%m-%d")
                        year_month = f"{parsed_date.year}-{parsed_date.month:02d}"
                        day = parsed_date.day

                        if year_month not in monthly_sales:
                            monthly_sales[year_month] = {}

                        if day not in monthly_sales[year_month]:
                            monthly_sales[year_month][day] = {
                                "year": parsed_date.year,
                                "month": parsed_date.month,
                                "day": day,
                                "gross_sales": 0,
                                "net_sales": 0,
                                "order_count": 0,
                                "quantity": 0,
                                "commission": 0,
                            }

                        entry = monthly_sales[year_month][day]

                        # 테이블 컬럼 파싱 (매출금액, 주문건수 등)
                        if len(row) >= 2:
                            entry["gross_sales"] += self._parse_amount(row[1])
                        if len(row) >= 3:
                            entry["order_count"] += int(self._parse_amount(row[2]))
                        if len(row) >= 4:
                            entry["quantity"] += int(self._parse_amount(row[3]))
                        if len(row) >= 5:
                            entry["net_sales"] += self._parse_amount(row[4])

                    except (ValueError, IndexError):
                        continue

            finally:
                await browser.close()

        # 정렬하여 반환
        result = {}
        for ym, days in monthly_sales.items():
            result[ym] = sorted(days.values(), key=lambda x: x["day"])

        return result

    async def test_connection(self) -> dict:
        """로그인 테스트"""
        if not self.is_playwright_available():
            return {
                "success": False,
                "message": "Playwright가 설치되어 있지 않습니다",
            }

        if not self.is_configured():
            return {
                "success": False,
                "message": "로그인 정보가 설정되지 않았습니다",
            }

        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context(locale="ko-KR")
                page = await context.new_page()

                try:
                    logged_in = await self._login(page)
                    if logged_in:
                        return {
                            "success": True,
                            "message": "쿠팡 Supplier Hub 로그인 성공",
                        }
                    else:
                        return {
                            "success": False,
                            "message": "로그인 실패. ID/비밀번호를 확인해주세요.",
                        }
                finally:
                    await browser.close()

        except Exception as e:
            return {
                "success": False,
                "message": f"연결 실패: {str(e)}",
            }


# 싱글톤 인스턴스
_coupang_rocket_service: Optional[CoupangRocketService] = None


def get_coupang_rocket_service() -> CoupangRocketService:
    """쿠팡 로켓 서비스 인스턴스 반환"""
    global _coupang_rocket_service
    if _coupang_rocket_service is None:
        _coupang_rocket_service = CoupangRocketService()
    return _coupang_rocket_service
