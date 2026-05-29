"""쿠팡 로켓(Supplier Hub) RPA 서비스

supplier.coupang.com에 공개 API가 없으므로
Playwright를 이용한 브라우저 자동화로 매출 데이터를 수집합니다.
"""
import asyncio
import logging
import os
import subprocess
import tempfile
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class CoupangRocketConfig:
    """쿠팡 로켓 RPA 설정"""
    login_id: str       # 공급업체 로그인 ID
    login_password: str # 비밀번호
    base_url: str = "https://supplier.coupang.com"


# 로그인 폼 셀렉터 전략 (우선순위 순)
LOGIN_SELECTOR_STRATEGIES = [
    {
        "name": "ID 기반",
        "username": 'input#username',
        "password": 'input#password',
        "submit": 'button[type="submit"]',
    },
    {
        "name": "name 기반",
        "username": 'input[name="username"]',
        "password": 'input[name="password"]',
        "submit": 'button[type="submit"], input[type="submit"]',
    },
    {
        "name": "name(email) 기반",
        "username": 'input[name="email"]',
        "password": 'input[name="password"]',
        "submit": 'button[type="submit"], input[type="submit"]',
    },
    {
        "name": "placeholder 기반",
        "username": 'input[placeholder*="아이디"], input[placeholder*="ID"], input[placeholder*="이메일"]',
        "password": 'input[placeholder*="비밀번호"], input[placeholder*="Password"]',
        "submit": 'button[type="submit"], .login-btn, .btn-login, button:has-text("로그인")',
    },
    {
        "name": "type 기반 (최후 수단)",
        "username": 'input[type="text"]',
        "password": 'input[type="password"]',
        "submit": 'button[type="submit"], input[type="submit"], button:has-text("로그인"), .login-btn',
    },
]

# 매출현황 페이지 URL 패턴들 (우선순위 순)
SALES_PAGE_URLS = [
    "/ecp/vendorSaleManager/salesList",
    "/ecp/vendorSaleManager/salesDailyList",
    "/ecp/settlement/salelist",
    "/ecp/settlement/sales",
]

# 테이블 셀렉터 패턴들 (우선순위 순)
TABLE_SELECTORS = [
    "table.data-table tbody tr",
    "table.sales-table tbody tr",
    "table.tbl-data tbody tr",
    "#salesTable tbody tr",
    ".table-wrap table tbody tr",
    "table tbody tr",
    ".grid-body .grid-row",
]

# 팝업/모달 닫기 셀렉터들
POPUP_DISMISS_SELECTORS = [
    'button:has-text("닫기")',
    'button:has-text("확인")',
    'button:has-text("Close")',
    'button.close',
    'button.btn-close',
    '.modal button.close',
    '.popup button.close',
    '[class*="modal"] button[class*="close"]',
    '[class*="popup"] button[class*="close"]',
    '.layer-popup .btn-close',
    'a.close',
]

# 로그인 성공 확인 셀렉터들 (대시보드 요소)
LOGIN_SUCCESS_INDICATORS = [
    '.gnb', '.lnb', '.dashboard',
    '#header', '.header-menu',
    'nav', '.nav-menu',
    '.user-info', '.user-name',
    'a:has-text("로그아웃")', 'a:has-text("Logout")',
    '.main-content', '#content',
]

# 로그인 실패 셀렉터들
LOGIN_FAILURE_INDICATORS = [
    '.error-msg', '.login-error',
    '.alert-danger', '.alert-error',
    'p:has-text("비밀번호")', 'p:has-text("아이디")',
    '.error', '[class*="error"]',
]

# 데이터 없음 메시지 셀렉터들
NO_DATA_SELECTORS = [
    ':has-text("데이터가 없습니다")',
    ':has-text("조회 결과가 없습니다")',
    ':has-text("검색 결과가 없습니다")',
    ':has-text("No data")',
    '.no-data', '.empty-data', '.nodata',
]

# 최대 로그인 재시도 횟수
MAX_LOGIN_RETRIES = 2


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

    async def _launch_browser(self, playwright):
        """Launch browser with fallback - reinstall if binary missing"""
        launch_args = ["--no-sandbox", "--disable-dev-shm-usage"]
        try:
            return await playwright.chromium.launch(headless=True, args=launch_args)
        except Exception as e:
            logger.warning(f"Browser launch failed, reinstalling chromium: {e}")
            subprocess.run(
                ["python", "-m", "playwright", "install", "chromium"],
                capture_output=True,
                timeout=120,
            )
            return await playwright.chromium.launch(headless=True, args=launch_args)

    async def _take_screenshot(self, page, name: str) -> str:
        """디버그용 스크린샷 저장

        Args:
            page: Playwright 페이지 객체
            name: 스크린샷 이름 (파일명에 포함)

        Returns:
            저장된 스크린샷 파일 경로
        """
        try:
            path = os.path.join(
                tempfile.gettempdir(),
                f"coupang_rpa_{name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png",
            )
            await page.screenshot(path=path)
            logger.info(f"스크린샷 저장됨: {path}")
            return path
        except Exception as e:
            logger.warning(f"스크린샷 저장 실패: {e}")
            return ""

    async def _dismiss_popups(self, page):
        """팝업/모달 자동 닫기 (로그인 후 공지사항 등)"""
        for selector in POPUP_DISMISS_SELECTORS:
            try:
                popup_btn = page.locator(selector).first
                if await popup_btn.is_visible(timeout=500):
                    await popup_btn.click()
                    logger.info(f"팝업 닫기 성공: {selector}")
                    await asyncio.sleep(0.5)
            except Exception:
                # 해당 셀렉터의 팝업이 없으면 무시
                continue

    async def _check_login_success(self, page) -> bool:
        """로그인 성공 여부를 페이지 요소로 확인"""
        current_url = page.url.lower()

        # URL에 login이 여전히 포함되어 있으면 실패 가능성
        if "/login" in current_url:
            # 에러 메시지 확인
            for selector in LOGIN_FAILURE_INDICATORS:
                try:
                    err = page.locator(selector).first
                    if await err.is_visible(timeout=500):
                        logger.warning(f"로그인 실패 표시 발견: {selector}")
                        return False
                except Exception:
                    continue
            # login 페이지에 있지만 에러 메시지가 없으면 아직 처리 중일 수 있음
            return False

        # 대시보드 요소 확인
        for selector in LOGIN_SUCCESS_INDICATORS:
            try:
                el = page.locator(selector).first
                if await el.is_visible(timeout=1000):
                    logger.info(f"로그인 성공 확인: {selector}")
                    return True
            except Exception:
                continue

        # URL이 login이 아니면 성공으로 간주
        if "/login" not in current_url:
            logger.info(f"로그인 후 URL 변경 확인: {current_url}")
            return True

        return False

    async def _try_login_with_strategy(self, page, strategy: dict) -> bool:
        """특정 셀렉터 전략으로 로그인 시도

        Args:
            page: Playwright 페이지 객체
            strategy: 셀렉터 전략 딕셔너리

        Returns:
            로그인 성공 여부
        """
        strategy_name = strategy["name"]
        logger.info(f"로그인 전략 시도: {strategy_name}")

        try:
            # 사용자명 입력 필드 확인
            username_el = page.locator(strategy["username"]).first
            if not await username_el.is_visible(timeout=2000):
                logger.debug(f"전략 '{strategy_name}': 사용자명 필드 미발견")
                return False

            # 비밀번호 입력 필드 확인
            password_el = page.locator(strategy["password"]).first
            if not await password_el.is_visible(timeout=1000):
                logger.debug(f"전략 '{strategy_name}': 비밀번호 필드 미발견")
                return False

            # 입력 필드 초기화 후 값 입력
            await username_el.clear()
            await username_el.fill(self.config.login_id)

            await password_el.clear()
            await password_el.fill(self.config.login_password)

            # 제출 버튼 클릭
            submit_el = page.locator(strategy["submit"]).first
            if await submit_el.is_visible(timeout=1000):
                await submit_el.click()
            else:
                # 버튼을 못 찾으면 Enter 키로 대체
                logger.debug(f"전략 '{strategy_name}': 제출 버튼 미발견, Enter 키 사용")
                await password_el.press("Enter")

            # 페이지 로딩 대기
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                # networkidle 타임아웃이 나도 계속 진행
                await asyncio.sleep(2)

            # 로그인 성공 확인
            return await self._check_login_success(page)

        except Exception as e:
            logger.debug(f"전략 '{strategy_name}' 실패: {e}")
            return False

    async def _login(self, page) -> bool:
        """supplier.coupang.com 로그인 (다중 전략 + 재시도)

        여러 셀렉터 전략으로 로그인을 시도하며,
        실패 시 최대 MAX_LOGIN_RETRIES 번 재시도합니다.
        로그인 후 팝업/모달을 자동으로 닫습니다.
        실패 시 디버그용 스크린샷을 저장합니다.
        """
        login_urls = [
            f"{self.config.base_url}/login",
            f"{self.config.base_url}/login/",
            self.config.base_url,  # 메인 페이지가 로그인으로 리다이렉트 될 수 있음
        ]

        for attempt in range(MAX_LOGIN_RETRIES + 1):
            logger.info(f"로그인 시도 {attempt + 1}/{MAX_LOGIN_RETRIES + 1}")

            for login_url in login_urls:
                try:
                    # 로그인 페이지 이동 (리다이렉트 허용)
                    response = await page.goto(
                        login_url,
                        wait_until="networkidle",
                        timeout=30000,
                    )
                    logger.info(f"로그인 페이지 응답: URL={page.url}, status={response.status if response else 'N/A'}")

                    # 이미 로그인된 상태인지 확인
                    if await self._check_login_success(page):
                        logger.info("이미 로그인된 상태입니다")
                        await self._dismiss_popups(page)
                        return True

                    break  # 페이지 로딩 성공 시 URL 루프 탈출
                except Exception as e:
                    logger.warning(f"로그인 페이지 접근 실패 ({login_url}): {e}")
                    continue
            else:
                # 모든 URL 시도 실패
                logger.error("모든 로그인 URL 접근 실패")
                await self._take_screenshot(page, f"login_url_fail_attempt{attempt + 1}")
                continue

            # 각 셀렉터 전략으로 로그인 시도
            for strategy in LOGIN_SELECTOR_STRATEGIES:
                success = await self._try_login_with_strategy(page, strategy)
                if success:
                    logger.info(f"로그인 성공 (전략: {strategy['name']}, 시도: {attempt + 1})")
                    # 로그인 후 팝업/모달 닫기
                    await self._dismiss_popups(page)
                    return True

            # 이 시도에서 모든 전략 실패 -> 스크린샷 저장 후 재시도
            screenshot_path = await self._take_screenshot(page, f"login_fail_attempt{attempt + 1}")
            logger.warning(f"로그인 시도 {attempt + 1} 실패. 스크린샷: {screenshot_path}")

            if attempt < MAX_LOGIN_RETRIES:
                # 재시도 전 잠시 대기
                await asyncio.sleep(2)

        # 모든 재시도 실패
        logger.error("모든 로그인 시도 실패")
        return False

    async def _navigate_to_sales(self, page, start_date: str, end_date: str):
        """매출현황 페이지로 이동 및 날짜 설정

        여러 URL 패턴을 시도하고, 날짜 설정은 직접 입력과
        JavaScript 주입 두 가지 방식을 시도합니다.
        """
        # 매출현황 페이지 이동 (여러 URL 패턴 시도)
        page_loaded = False
        for url_path in SALES_PAGE_URLS:
            sales_url = f"{self.config.base_url}{url_path}"
            try:
                response = await page.goto(sales_url, wait_until="networkidle", timeout=30000)
                if response and response.status == 200:
                    logger.info(f"매출현황 페이지 로드 성공: {sales_url}")
                    page_loaded = True
                    break
                elif response and response.status in (301, 302):
                    # 리다이렉트된 경우 최종 URL 확인
                    logger.info(f"매출현황 페이지 리다이렉트: {page.url}")
                    page_loaded = True
                    break
                else:
                    logger.debug(f"매출현황 페이지 실패 ({response.status if response else 'N/A'}): {sales_url}")
            except Exception as e:
                logger.debug(f"매출현황 페이지 접근 실패 ({sales_url}): {e}")
                continue

        if not page_loaded:
            screenshot_path = await self._take_screenshot(page, "sales_page_fail")
            logger.error(f"매출현황 페이지 로드 실패. 스크린샷: {screenshot_path}")
            raise Exception(f"매출현황 페이지 접근 실패. 스크린샷: {screenshot_path}")

        # 날짜 입력 (방법 1: 직접 입력)
        date_set = False
        try:
            date_set = await self._set_dates_by_input(page, start_date, end_date)
        except Exception as e:
            logger.debug(f"날짜 직접 입력 실패: {e}")

        # 날짜 입력 (방법 2: JavaScript로 날짜 설정)
        if not date_set:
            try:
                date_set = await self._set_dates_by_js(page, start_date, end_date)
            except Exception as e:
                logger.debug(f"JavaScript 날짜 설정 실패: {e}")

        if not date_set:
            logger.warning("날짜 설정 실패. 기본 날짜 범위로 진행합니다.")
            await self._take_screenshot(page, "date_set_fail")

        # 검색 버튼 클릭
        search_clicked = False
        search_selectors = [
            'button.btn-search',
            'button:has-text("검색")',
            'button:has-text("조회")',
            'a:has-text("검색")',
            'a:has-text("조회")',
            'input[type="button"][value*="검색"]',
            'input[type="button"][value*="조회"]',
            '.btn-search',
        ]
        for selector in search_selectors:
            try:
                btn = page.locator(selector).first
                if await btn.is_visible(timeout=1000):
                    await btn.click()
                    search_clicked = True
                    logger.info(f"검색 버튼 클릭 성공: {selector}")
                    break
            except Exception:
                continue

        if not search_clicked:
            logger.warning("검색 버튼을 찾지 못했습니다. 페이지에 이미 데이터가 있을 수 있습니다.")

        # 검색 결과 로딩 대기
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            await asyncio.sleep(3)

    async def _set_dates_by_input(self, page, start_date: str, end_date: str) -> bool:
        """날짜를 입력 필드에 직접 입력"""
        start_selectors = [
            'input[name="startDate"]',
            'input[name="searchStartDate"]',
            'input.start-date',
            'input[placeholder*="시작"]',
            'input[placeholder*="시작일"]',
            'input#startDate',
        ]
        end_selectors = [
            'input[name="endDate"]',
            'input[name="searchEndDate"]',
            'input.end-date',
            'input[placeholder*="종료"]',
            'input[placeholder*="종료일"]',
            'input#endDate',
        ]

        start_filled = False
        for selector in start_selectors:
            try:
                el = page.locator(selector).first
                if await el.is_visible(timeout=1000):
                    await el.clear()
                    await el.fill(start_date)
                    start_filled = True
                    logger.debug(f"시작일 입력 성공: {selector}")
                    break
            except Exception:
                continue

        end_filled = False
        for selector in end_selectors:
            try:
                el = page.locator(selector).first
                if await el.is_visible(timeout=1000):
                    await el.clear()
                    await el.fill(end_date)
                    end_filled = True
                    logger.debug(f"종료일 입력 성공: {selector}")
                    break
            except Exception:
                continue

        return start_filled and end_filled

    async def _set_dates_by_js(self, page, start_date: str, end_date: str) -> bool:
        """JavaScript를 이용하여 날짜 값 설정 (date picker 우회)"""
        js_code = """
        (args) => {
            const [startDate, endDate] = args;
            let success = false;

            // 시작일 설정
            const startInputs = document.querySelectorAll(
                'input[name="startDate"], input[name="searchStartDate"], input.start-date, input#startDate'
            );
            for (const input of startInputs) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                ).set;
                nativeInputValueSetter.call(input, startDate);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                success = true;
            }

            // 종료일 설정
            const endInputs = document.querySelectorAll(
                'input[name="endDate"], input[name="searchEndDate"], input.end-date, input#endDate'
            );
            for (const input of endInputs) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                ).set;
                nativeInputValueSetter.call(input, endDate);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                success = true;
            }

            return success;
        }
        """
        result = await page.evaluate(js_code, [start_date, end_date])
        if result:
            logger.info("JavaScript로 날짜 설정 성공")
        return bool(result)

    async def _parse_sales_table(self, page) -> list[dict]:
        """매출 테이블 데이터 파싱

        여러 테이블 셀렉터를 시도하고,
        '데이터 없음' 메시지를 감지합니다.
        """
        rows = []

        # 데이터 없음 메시지 확인
        for selector in NO_DATA_SELECTORS:
            try:
                no_data = page.locator(selector).first
                if await no_data.is_visible(timeout=500):
                    logger.info(f"데이터 없음 메시지 발견: {selector}")
                    return []
            except Exception:
                continue

        # 여러 테이블 셀렉터 시도
        table_rows = []
        used_selector = ""
        for selector in TABLE_SELECTORS:
            try:
                found_rows = await page.locator(selector).all()
                if found_rows:
                    table_rows = found_rows
                    used_selector = selector
                    logger.info(f"테이블 발견: {selector} ({len(found_rows)}행)")
                    break
            except Exception:
                continue

        if not table_rows:
            logger.warning("매출 테이블을 찾지 못했습니다")
            await self._take_screenshot(page, "table_not_found")
            return []

        logger.info(f"테이블 파싱 시작: {len(table_rows)}행 (셀렉터: {used_selector})")

        for row_idx, row in enumerate(table_rows):
            try:
                cells = await row.locator("td").all()
                if len(cells) < 2:
                    # 헤더 행이거나 빈 행일 수 있음
                    continue

                cell_texts = []
                for cell in cells:
                    text = await cell.inner_text()
                    cell_texts.append(text.strip())

                # 빈 행 건너뛰기
                if all(not t for t in cell_texts):
                    continue

                rows.append(cell_texts)
            except Exception as e:
                logger.debug(f"행 {row_idx} 파싱 실패: {e}")
                continue

        logger.info(f"테이블 파싱 완료: {len(rows)}개 데이터 행")
        return rows

    def _parse_amount(self, text: str) -> float:
        """금액 문자열 파싱 (콤마, 원 등 제거)"""
        cleaned = text.replace(",", "").replace("원", "").replace(" ", "").strip()
        try:
            return float(cleaned)
        except (ValueError, TypeError):
            return 0

    async def get_page_info(self, page) -> dict:
        """현재 페이지 정보 반환 (디버깅용)

        Args:
            page: Playwright 페이지 객체

        Returns:
            URL, 타이틀, 스크린샷 경로, 가시 텍스트 요약 포함 딕셔너리
        """
        try:
            url = page.url
            title = await page.title()
            screenshot_path = await self._take_screenshot(page, "debug_page_info")

            # 페이지 본문 텍스트 일부 추출 (최대 500자)
            body_text = ""
            try:
                body_text = await page.locator("body").inner_text()
                body_text = body_text[:500].strip()
            except Exception:
                pass

            return {
                "url": url,
                "title": title,
                "screenshot_path": screenshot_path,
                "body_text_preview": body_text,
            }
        except Exception as e:
            return {
                "url": "알 수 없음",
                "title": "알 수 없음",
                "screenshot_path": "",
                "body_text_preview": "",
                "error": str(e),
            }

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
            browser = await self._launch_browser(p)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                locale="ko-KR",
            )
            page = await context.new_page()

            try:
                # 로그인
                logged_in = await self._login(page)
                if not logged_in:
                    page_info = await self.get_page_info(page)
                    raise Exception(
                        f"쿠팡 Supplier Hub 로그인 실패. ID/비밀번호를 확인해주세요. "
                        f"(URL: {page_info['url']}, 스크린샷: {page_info['screenshot_path']})"
                    )

                # 매출현황 페이지 이동
                await self._navigate_to_sales(page, start_date, end_date)

                # 테이블 데이터 파싱
                raw_rows = await self._parse_sales_table(page)

                if not raw_rows:
                    logger.warning(f"매출 데이터가 없습니다 ({start_date} ~ {end_date})")

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
        """로그인 테스트 (상세한 오류 정보 포함)"""
        if not self.is_playwright_available():
            return {
                "success": False,
                "message": "Playwright가 설치되어 있지 않습니다",
                "details": {
                    "error_type": "playwright_not_installed",
                    "hint": "pip install playwright && playwright install chromium",
                },
            }

        if not self.is_configured():
            return {
                "success": False,
                "message": "로그인 정보가 설정되지 않았습니다",
                "details": {
                    "error_type": "not_configured",
                },
            }

        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                browser = await self._launch_browser(p)
                context = await browser.new_context(
                    viewport={"width": 1920, "height": 1080},
                    locale="ko-KR",
                )
                page = await context.new_page()

                try:
                    logged_in = await self._login(page)
                    page_info = await self.get_page_info(page)

                    if logged_in:
                        return {
                            "success": True,
                            "message": "쿠팡 Supplier Hub 로그인 성공",
                            "details": {
                                "url": page_info["url"],
                                "title": page_info["title"],
                            },
                        }
                    else:
                        return {
                            "success": False,
                            "message": "로그인 실패. ID/비밀번호를 확인해주세요.",
                            "details": {
                                "error_type": "login_failed",
                                "url": page_info["url"],
                                "title": page_info["title"],
                                "screenshot_path": page_info["screenshot_path"],
                                "body_text_preview": page_info.get("body_text_preview", ""),
                            },
                        }
                finally:
                    await browser.close()

        except Exception as e:
            return {
                "success": False,
                "message": f"연결 실패: {str(e)}",
                "details": {
                    "error_type": "connection_error",
                    "exception": str(e),
                },
            }


# 싱글톤 인스턴스
_coupang_rocket_service: Optional[CoupangRocketService] = None


def get_coupang_rocket_service() -> CoupangRocketService:
    """쿠팡 로켓 서비스 인스턴스 반환"""
    global _coupang_rocket_service
    if _coupang_rocket_service is None:
        _coupang_rocket_service = CoupangRocketService()
    return _coupang_rocket_service
