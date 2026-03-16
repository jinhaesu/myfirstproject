"""결산 매출 RPA 수집 서비스

모든 채널의 결산/정산 데이터를 Playwright 기반 RPA로 수집합니다.
채널별로 로그인 -> 정산 페이지 이동 -> 데이터 스크래핑 또는 엑셀 다운로드를 수행합니다.
"""
import asyncio
import logging
import os
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Optional
from io import BytesIO

import pandas as pd

logger = logging.getLogger(__name__)


# 채널별 기본 RPA 설정 (login URL, settlement URL 등)
CHANNEL_RPA_DEFAULTS = {
    # === 오픈마켓 (API 우선, RPA 백업) ===
    "카페24": {
        "login_url": "https://eclogin.cafe24.com/Shop/",
        "settlement_url": None,  # API 사용
        "method": "api",
    },
    "스마트스토어": {
        "login_url": "https://sell.smartstore.naver.com/",
        "settlement_url": "https://sell.smartstore.naver.com/#/settlement/list",
        "method": "rpa",
    },
    "쿠팡 WING": {
        "login_url": "https://wing.coupang.com/login",
        "settlement_url": "https://wing.coupang.com/settlement/list",
        "method": "rpa",
    },
    "쿠팡 로켓": {
        "login_url": "https://supplier.coupang.com/login",
        "settlement_url": "https://supplier.coupang.com/ecp/settlement/salelist",
        "method": "rpa",
    },
    "11번가": {
        "login_url": "https://soffice.11st.co.kr/login",
        "settlement_url": "https://soffice.11st.co.kr/escrow/SettlementAction.tmall",
        "method": "rpa",
    },
    "지마켓": {
        "login_url": "https://www.esmplus.com/Member/SignIn/LogOn",
        "settlement_url": "https://www.esmplus.com/Escrow/Settle/SettleList",
        "method": "rpa",
    },
    "옥션": {
        "login_url": "https://www.esmplus.com/Member/SignIn/LogOn",
        "settlement_url": "https://www.esmplus.com/Escrow/Settle/SettleList",
        "method": "rpa",
    },
    "에이블리": {
        "login_url": "https://partners.a-bly.com/login",
        "settlement_url": "https://partners.a-bly.com/settlement",
        "method": "rpa",
    },
    "알리익스프레스": {
        "login_url": "https://seller.aliexpress.com/",
        "settlement_url": "https://seller.aliexpress.com/settlement",
        "method": "rpa",
    },
    # === 소셜커머스 ===
    "카카오선물하기": {
        "login_url": "https://gift-biz.kakao.com/login",
        "settlement_url": "https://gift-biz.kakao.com/settlement",
        "method": "rpa",
    },
    "카카오톡스토어": {
        "login_url": "https://store-sell.kakao.com/login",
        "settlement_url": "https://store-sell.kakao.com/settlement",
        "method": "rpa",
    },
    "카카오스타일": {
        "login_url": "https://partner.kakaostyle.com/login",
        "settlement_url": "https://partner.kakaostyle.com/settlement",
        "method": "rpa",
    },
    "토스": {
        "login_url": "https://seller.toss.im/login",
        "settlement_url": "https://seller.toss.im/settlement",
        "method": "rpa",
    },
    # === 버티컬 ===
    "올리브영": {
        "login_url": "https://partner.oliveyoung.co.kr/login",
        "settlement_url": "https://partner.oliveyoung.co.kr/settlement",
        "method": "rpa",
    },
    "올웨이즈": {
        "login_url": "https://partner.alwayz.co/login",
        "settlement_url": "https://partner.alwayz.co/settlement",
        "method": "rpa",
    },
    "마켓컬리": {
        "login_url": "https://partners.kurly.com/login",
        "settlement_url": "https://partners.kurly.com/settlement",
        "method": "rpa",
    },
    "비마트": {
        "login_url": "https://self.baemin.com/login",
        "settlement_url": "https://self.baemin.com/settlement",
        "method": "rpa",
    },
    # === 홈쇼핑 ===
    "롯데 홈쇼핑": {
        "login_url": "https://partner.lotteimall.com/login",
        "settlement_url": "https://partner.lotteimall.com/settlement",
        "method": "rpa",
    },
    "GS 샵": {
        "login_url": "https://partner.gsshop.com/login",
        "settlement_url": "https://partner.gsshop.com/settlement",
        "method": "rpa",
    },
    "NS MALL": {
        "login_url": "https://partner.nsmall.com/login",
        "settlement_url": "https://partner.nsmall.com/settlement",
        "method": "rpa",
    },
    "신세계 TV 쇼핑": {
        "login_url": "https://partner.shinsegaetv.com/login",
        "settlement_url": "https://partner.shinsegaetv.com/settlement",
        "method": "rpa",
    },
    "CJ온스타일": {
        "login_url": "https://partner.cjonstyle.com/login",
        "settlement_url": "https://partner.cjonstyle.com/settlement",
        "method": "rpa",
    },
    # === 백화점 ===
    "롯데온": {
        "login_url": "https://partner.lotteon.com/login",
        "settlement_url": "https://partner.lotteon.com/settlement",
        "method": "rpa",
    },
    # === 복지몰 ===
    "이지웰": {
        "login_url": "https://partner.ezwel.com/login",
        "settlement_url": "https://partner.ezwel.com/settlement",
        "method": "rpa",
    },
    "삼성카드쇼핑": {
        "login_url": "https://partner.samsungcard.com/login",
        "settlement_url": "https://partner.samsungcard.com/settlement",
        "method": "rpa",
    },
    "농협몰": {
        "login_url": "https://partner.nonghyupmall.com/login",
        "settlement_url": "https://partner.nonghyupmall.com/settlement",
        "method": "rpa",
    },
    "베네피아": {
        "login_url": "https://partner.benepia.co.kr/login",
        "settlement_url": "https://partner.benepia.co.kr/settlement",
        "method": "rpa",
    },
    # === 대형마트/편의점 ===
    "홈플러스": {
        "login_url": "https://partner.homeplus.co.kr/login",
        "settlement_url": "https://partner.homeplus.co.kr/settlement",
        "method": "rpa",
    },
    "메가마트": {
        "login_url": "https://partner.megamart.com/login",
        "settlement_url": "https://partner.megamart.com/settlement",
        "method": "rpa",
    },
    "이마트": {
        "login_url": "https://partner.emart.com/login",
        "settlement_url": "https://partner.emart.com/settlement",
        "method": "rpa",
    },
    "GS25": {
        "login_url": "https://partner.gs25.com/login",
        "settlement_url": "https://partner.gs25.com/settlement",
        "method": "rpa",
    },
    "CU": {
        "login_url": "https://partner.cu.co.kr/login",
        "settlement_url": "https://partner.cu.co.kr/settlement",
        "method": "rpa",
    },
    # === B2B ===
    "삼성웰스토리": {
        "login_url": "https://partner.welstory.com/login",
        "settlement_url": "https://partner.welstory.com/settlement",
        "method": "rpa",
    },
    "CJ프레시웨이": {
        "login_url": "https://partner.cjfreshway.com/login",
        "settlement_url": "https://partner.cjfreshway.com/settlement",
        "method": "rpa",
    },
    "아워홈": {
        "login_url": "https://partner.ourhome.co.kr/login",
        "settlement_url": "https://partner.ourhome.co.kr/settlement",
        "method": "rpa",
    },
}

# 범용 로그인 셀렉터 전략
LOGIN_STRATEGIES = [
    {"name": "ID기반", "username": 'input#username, input#userId, input#loginId', "password": 'input#password, input#loginPassword', "submit": 'button[type="submit"], .btn-login, button:has-text("로그인")'},
    {"name": "name기반", "username": 'input[name="username"], input[name="userId"], input[name="id"]', "password": 'input[name="password"], input[name="pw"]', "submit": 'button[type="submit"], input[type="submit"]'},
    {"name": "email기반", "username": 'input[name="email"], input[type="email"]', "password": 'input[name="password"], input[type="password"]', "submit": 'button[type="submit"]'},
    {"name": "placeholder기반", "username": 'input[placeholder*="아이디"], input[placeholder*="ID"], input[placeholder*="이메일"]', "password": 'input[placeholder*="비밀번호"], input[placeholder*="Password"]', "submit": 'button[type="submit"], button:has-text("로그인"), .login-btn'},
    {"name": "type기반", "username": 'input[type="text"]', "password": 'input[type="password"]', "submit": 'button[type="submit"], input[type="submit"], button:has-text("로그인")'},
]

# 정산 금액 셀렉터
SETTLEMENT_TABLE_SELECTORS = [
    "table.settlement-table tbody tr",
    "table.data-table tbody tr",
    "table.tbl-data tbody tr",
    "#settlementTable tbody tr",
    ".table-wrap table tbody tr",
    "table tbody tr",
    ".grid-body .grid-row",
]

# 팝업 닫기
POPUP_SELECTORS = [
    'button:has-text("닫기")', 'button:has-text("확인")', 'button:has-text("Close")',
    'button.close', 'button.btn-close', '.modal button.close',
]

# 엑셀 다운로드 버튼 셀렉터
EXCEL_DOWNLOAD_SELECTORS = [
    'button:has-text("엑셀")', 'button:has-text("Excel")', 'button:has-text("다운로드")',
    'a:has-text("엑셀")', 'a:has-text("Excel")', 'a:has-text("다운로드")',
    '.btn-excel', '.btn-download', '#excelDownloadBtn', '#btnExcel',
    'button[class*="excel"]', 'a[class*="excel"]',
]


class SettlementRpaService:
    """범용 결산 매출 RPA 수집 서비스"""

    @staticmethod
    def is_playwright_available() -> bool:
        try:
            from playwright.async_api import async_playwright
            return True
        except ImportError:
            return False

    async def _launch_browser(self, playwright):
        launch_args = ["--no-sandbox", "--disable-dev-shm-usage"]
        try:
            return await playwright.chromium.launch(headless=True, args=launch_args)
        except Exception:
            subprocess.run(["python", "-m", "playwright", "install", "chromium"], capture_output=True, timeout=120)
            return await playwright.chromium.launch(headless=True, args=launch_args)

    async def _take_screenshot(self, page, name: str) -> str:
        try:
            path = os.path.join(tempfile.gettempdir(), f"settlement_rpa_{name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png")
            await page.screenshot(path=path)
            return path
        except Exception:
            return ""

    async def _dismiss_popups(self, page):
        for selector in POPUP_SELECTORS:
            try:
                btn = page.locator(selector).first
                if await btn.is_visible(timeout=500):
                    await btn.click()
                    await asyncio.sleep(0.5)
            except Exception:
                continue

    async def _login(self, page, login_url: str, login_id: str, login_pw: str, custom_selectors: Optional[dict] = None) -> bool:
        """범용 로그인"""
        try:
            await page.goto(login_url, wait_until="networkidle", timeout=30000)
        except Exception as e:
            logger.warning(f"로그인 페이지 접근 실패: {e}")
            return False

        await asyncio.sleep(1)
        await self._dismiss_popups(page)

        # 커스텀 셀렉터가 있으면 우선 시도
        strategies = []
        if custom_selectors:
            strategies.append({
                "name": "커스텀",
                "username": custom_selectors.get("login_id_sel", ""),
                "password": custom_selectors.get("login_pw_sel", ""),
                "submit": custom_selectors.get("submit_sel", ""),
            })
        strategies.extend(LOGIN_STRATEGIES)

        for strategy in strategies:
            if not strategy.get("username"):
                continue
            try:
                username_el = page.locator(strategy["username"]).first
                if not await username_el.is_visible(timeout=2000):
                    continue
                password_el = page.locator(strategy["password"]).first
                if not await password_el.is_visible(timeout=1000):
                    continue

                await username_el.clear()
                await username_el.fill(login_id)
                await password_el.clear()
                await password_el.fill(login_pw)

                submit_el = page.locator(strategy["submit"]).first
                if await submit_el.is_visible(timeout=1000):
                    await submit_el.click()
                else:
                    await password_el.press("Enter")

                try:
                    await page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    await asyncio.sleep(3)

                # 로그인 성공 확인
                if "/login" not in page.url.lower():
                    await self._dismiss_popups(page)
                    return True

            except Exception:
                continue

        return False

    async def _scrape_settlement(self, page, settlement_url: str, year: int, month: int) -> Optional[dict]:
        """정산 페이지에서 데이터 스크래핑"""
        try:
            await page.goto(settlement_url, wait_until="networkidle", timeout=30000)
        except Exception:
            await asyncio.sleep(3)

        await asyncio.sleep(2)
        await self._dismiss_popups(page)

        # 날짜/기간 설정 시도
        await self._set_period(page, year, month)

        # 검색 버튼 클릭
        for sel in ['button:has-text("검색")', 'button:has-text("조회")', '.btn-search', 'button[type="submit"]']:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1000):
                    await btn.click()
                    break
            except Exception:
                continue

        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            await asyncio.sleep(3)

        # 테이블에서 정산 데이터 추출
        for selector in SETTLEMENT_TABLE_SELECTORS:
            try:
                rows = await page.locator(selector).all()
                if rows:
                    return await self._parse_settlement_table(rows)
            except Exception:
                continue

        # 테이블을 못 찾으면 페이지 텍스트에서 금액 추출 시도
        return await self._extract_amounts_from_text(page)

    async def _download_excel_settlement(self, page, settlement_url: str, year: int, month: int) -> Optional[dict]:
        """정산 페이지에서 엑셀 다운로드 후 파싱"""
        try:
            await page.goto(settlement_url, wait_until="networkidle", timeout=30000)
        except Exception:
            await asyncio.sleep(3)

        await asyncio.sleep(2)
        await self._set_period(page, year, month)

        # 검색 실행
        for sel in ['button:has-text("검색")', 'button:has-text("조회")', '.btn-search']:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1000):
                    await btn.click()
                    break
            except Exception:
                continue

        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            await asyncio.sleep(3)

        # 엑셀 다운로드
        for sel in EXCEL_DOWNLOAD_SELECTORS:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1000):
                    async with page.expect_download(timeout=30000) as download_info:
                        await btn.click()
                    download = await download_info.value
                    # 임시 파일로 저장
                    tmp_path = os.path.join(tempfile.gettempdir(), f"settlement_{uuid.uuid4().hex[:8]}.xlsx")
                    await download.save_as(tmp_path)
                    return self._parse_excel_file(tmp_path)
            except Exception:
                continue

        return None

    async def _set_period(self, page, year: int, month: int):
        """기간 설정 (연도/월 또는 시작일/종료일)"""
        from calendar import monthrange
        days = monthrange(year, month)[1]
        start = f"{year}-{month:02d}-01"
        end = f"{year}-{month:02d}-{days:02d}"

        # 월 선택 드롭다운 시도
        for sel in ['select[name*="month"], select[name*="Month"], select#month']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=1000):
                    await el.select_option(str(month))
                    break
            except Exception:
                continue

        # 연도 선택
        for sel in ['select[name*="year"], select[name*="Year"], select#year']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=1000):
                    await el.select_option(str(year))
                    break
            except Exception:
                continue

        # 날짜 입력 (시작일/종료일)
        start_sels = ['input[name*="start"], input[name*="Start"], input.start-date, input#startDate']
        for sel in start_sels:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=500):
                    await el.clear()
                    await el.fill(start)
                    break
            except Exception:
                continue

        end_sels = ['input[name*="end"], input[name*="End"], input.end-date, input#endDate']
        for sel in end_sels:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=500):
                    await el.clear()
                    await el.fill(end)
                    break
            except Exception:
                continue

    async def _parse_settlement_table(self, rows) -> dict:
        """테이블 행에서 정산 데이터 추출"""
        total_gross = 0
        total_commission = 0
        total_settlement = 0
        total_orders = 0
        total_refund = 0
        raw_rows = []

        for row in rows:
            try:
                cells = await row.locator("td").all()
                if len(cells) < 2:
                    continue
                texts = [await c.inner_text() for c in cells]
                texts = [t.strip() for t in texts]
                raw_rows.append(texts)

                # 금액 파싱 (여러 컬럼 중 숫자가 포함된 것들)
                amounts = []
                for t in texts:
                    cleaned = t.replace(",", "").replace("원", "").replace(" ", "")
                    try:
                        amounts.append(float(cleaned))
                    except ValueError:
                        amounts.append(None)

                # 첫 번째 금액 -> 매출, 두 번째 -> 수수료, 세 번째 -> 정산금
                valid_amounts = [a for a in amounts if a is not None and a != 0]
                if len(valid_amounts) >= 1:
                    total_gross += valid_amounts[0]
                if len(valid_amounts) >= 2:
                    total_commission += abs(valid_amounts[1])
                if len(valid_amounts) >= 3:
                    total_settlement += valid_amounts[-1]  # 마지막이 보통 정산금

            except Exception:
                continue

        if not total_settlement:
            total_settlement = total_gross - total_commission

        return {
            "gross_sales": total_gross,
            "commission": total_commission,
            "settlement_amount": total_settlement,
            "refund_amount": total_refund,
            "order_count": total_orders,
            "raw_data": raw_rows[:20],  # 원본 데이터 일부 저장
        }

    async def _extract_amounts_from_text(self, page) -> Optional[dict]:
        """페이지 텍스트에서 금액 추출 (테이블이 없는 경우)"""
        try:
            import re
            body = await page.locator("body").inner_text()

            # 금액 패턴: "정산금액: 1,234,567원" 등
            patterns = {
                "settlement_amount": [r"정산[금액\s:]+([0-9,]+)", r"입금[예정금액\s:]+([0-9,]+)"],
                "gross_sales": [r"총[매출금액\s:]+([0-9,]+)", r"매출[합계금액\s:]+([0-9,]+)"],
                "commission": [r"수수료[금액\s:]+([0-9,]+)", r"판매수수료[:\s]+([0-9,]+)"],
            }

            result = {}
            for key, pats in patterns.items():
                for pat in pats:
                    match = re.search(pat, body)
                    if match:
                        result[key] = float(match.group(1).replace(",", ""))
                        break

            return result if result else None
        except Exception:
            return None

    def _parse_excel_file(self, file_path: str, column_mapping: Optional[dict] = None, skip_rows: int = 0, sheet_name: Optional[str] = None) -> Optional[dict]:
        """엑셀 파일 파싱"""
        try:
            kwargs = {}
            if sheet_name:
                kwargs["sheet_name"] = sheet_name
            if skip_rows:
                kwargs["skiprows"] = skip_rows

            df = pd.read_excel(file_path, **kwargs)

            if column_mapping:
                df = df.rename(columns=column_mapping)

            # 합계 계산
            result = {"raw_data": df.head(20).to_dict(orient="records")}

            for col, key in [
                ("정산금액", "settlement_amount"), ("정산예정금액", "settlement_amount"),
                ("총매출", "gross_sales"), ("매출금액", "gross_sales"), ("판매금액", "gross_sales"),
                ("수수료", "commission"), ("판매수수료", "commission"),
                ("환불금액", "refund_amount"), ("반품금액", "refund_amount"),
                ("주문건수", "order_count"), ("주문수", "order_count"),
                ("판매수량", "quantity"), ("수량", "quantity"),
                ("배송비", "shipping_cost"),
            ]:
                if col in df.columns:
                    try:
                        result[key] = float(df[col].sum())
                    except Exception:
                        pass

            # 정산금이 없으면 매출 - 수수료로 계산
            if "settlement_amount" not in result and "gross_sales" in result:
                result["settlement_amount"] = result["gross_sales"] - result.get("commission", 0)

            return result
        except Exception as e:
            logger.error(f"엑셀 파싱 실패: {e}")
            return None
        finally:
            try:
                os.remove(file_path)
            except Exception:
                pass

    async def collect_settlement(self, channel_name: str, year: int, month: int, rpa_config: Optional[dict] = None) -> dict:
        """채널의 결산 데이터 수집 (메인 메서드)"""
        defaults = CHANNEL_RPA_DEFAULTS.get(channel_name, {})
        method = defaults.get("method", "manual")

        if method == "manual":
            return {
                "success": False,
                "message": f"{channel_name}은 수동 입력 채널입니다. 엑셀 업로드 또는 직접 입력을 사용하세요.",
                "method": "manual",
            }

        if not self.is_playwright_available():
            return {"success": False, "message": "Playwright가 설치되어 있지 않습니다."}

        login_url = (rpa_config or {}).get("login_url") or defaults.get("login_url", "")
        settlement_url = (rpa_config or {}).get("settlement_url") or defaults.get("settlement_url", "")
        login_id = (rpa_config or {}).get("login_id", "")
        login_pw = (rpa_config or {}).get("login_password", "")
        download_type = (rpa_config or {}).get("download_type", "scrape")
        custom_selectors = (rpa_config or {}).get("selectors")
        excel_mapping = (rpa_config or {}).get("excel_column_mapping")
        excel_skip = (rpa_config or {}).get("excel_skip_rows", 0)
        excel_sheet = (rpa_config or {}).get("excel_sheet_name")

        if not login_id or not login_pw:
            return {
                "success": False,
                "message": f"{channel_name}의 로그인 정보가 설정되지 않았습니다. RPA 설정에서 입력해주세요.",
            }

        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await self._launch_browser(p)
            context = await browser.new_context(viewport={"width": 1920, "height": 1080}, locale="ko-KR")
            page = await context.new_page()

            try:
                # 1) 로그인
                logged_in = await self._login(page, login_url, login_id, login_pw, custom_selectors)
                if not logged_in:
                    screenshot = await self._take_screenshot(page, f"{channel_name}_login_fail")
                    return {
                        "success": False,
                        "message": f"{channel_name} 로그인 실패",
                        "screenshot": screenshot,
                    }

                # 2) 정산 데이터 수집
                data = None
                if download_type == "excel_download" and settlement_url:
                    data = await self._download_excel_settlement(page, settlement_url, year, month)
                elif settlement_url:
                    data = await self._scrape_settlement(page, settlement_url, year, month)

                if data:
                    screenshot = await self._take_screenshot(page, f"{channel_name}_success")
                    return {
                        "success": True,
                        "message": f"{channel_name} {year}년 {month}월 결산 데이터 수집 완료",
                        "data": data,
                        "screenshot": screenshot,
                    }
                else:
                    screenshot = await self._take_screenshot(page, f"{channel_name}_no_data")
                    return {
                        "success": False,
                        "message": f"{channel_name} 결산 데이터를 찾을 수 없습니다",
                        "screenshot": screenshot,
                    }

            except Exception as e:
                screenshot = await self._take_screenshot(page, f"{channel_name}_error")
                return {
                    "success": False,
                    "message": f"{channel_name} RPA 오류: {str(e)}",
                    "screenshot": screenshot,
                }
            finally:
                await browser.close()

    async def collect_all_rpa_channels(self, year: int, month: int, rpa_configs: dict) -> list[dict]:
        """RPA 가능한 모든 채널의 결산 데이터를 순차 수집"""
        results = []
        for channel_name, defaults in CHANNEL_RPA_DEFAULTS.items():
            if defaults.get("method") == "manual":
                continue
            config = rpa_configs.get(channel_name, {})
            if not config.get("is_enabled", True):
                continue
            result = await self.collect_settlement(channel_name, year, month, config)
            result["channel_name"] = channel_name
            results.append(result)
        return results

    async def test_channel_connection(self, channel_name: str, rpa_config: dict) -> dict:
        """채널 로그인 테스트"""
        defaults = CHANNEL_RPA_DEFAULTS.get(channel_name, {})
        login_url = rpa_config.get("login_url") or defaults.get("login_url", "")
        login_id = rpa_config.get("login_id", "")
        login_pw = rpa_config.get("login_password", "")

        if not login_url or not login_id or not login_pw:
            return {"success": False, "message": "로그인 정보가 불완전합니다"}

        if not self.is_playwright_available():
            return {"success": False, "message": "Playwright 미설치"}

        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await self._launch_browser(p)
            context = await browser.new_context(viewport={"width": 1920, "height": 1080}, locale="ko-KR")
            page = await context.new_page()
            try:
                logged_in = await self._login(page, login_url, login_id, login_pw, rpa_config.get("selectors"))
                screenshot = await self._take_screenshot(page, f"{channel_name}_test")
                return {
                    "success": logged_in,
                    "message": f"{'로그인 성공' if logged_in else '로그인 실패'}",
                    "screenshot": screenshot,
                    "url": page.url,
                }
            except Exception as e:
                return {"success": False, "message": str(e)}
            finally:
                await browser.close()


# 싱글톤
_settlement_rpa_service: Optional[SettlementRpaService] = None

def get_settlement_rpa_service() -> SettlementRpaService:
    global _settlement_rpa_service
    if _settlement_rpa_service is None:
        _settlement_rpa_service = SettlementRpaService()
    return _settlement_rpa_service
