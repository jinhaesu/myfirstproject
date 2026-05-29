"""로컬 RPA 엔진 — Playwright 기반 브라우저 자동화

사무실 PC에서 실행되어 각 판매채널 셀러 어드민 사이트에 로그인하고
정산 데이터를 스크래핑하거나 엑셀 다운로드로 수집합니다.

클라우드 버전(settlement_rpa_service.py)과의 핵심 차이점:
  - Persistent browser context (쿠키/세션 유지)
  - CAPTCHA/2FA 발생 시 사용자 수동 개입 대기
  - Visible 브라우저 모드 기본
"""
import asyncio
import logging
import os
import re
import tempfile
import time
import uuid
from calendar import monthrange
from typing import Optional

import pandas as pd
from rich.console import Console

logger = logging.getLogger(__name__)
console = Console()

# ─────────────────────────────────────────────
# 범용 셀렉터 상수 (backend 동일)
# ─────────────────────────────────────────────

LOGIN_STRATEGIES = [
    {
        "name": "ID기반",
        "username": 'input#username, input#userId, input#loginId',
        "password": 'input#password, input#loginPassword',
        "submit": 'button[type="submit"], .btn-login, button:has-text("로그인")',
    },
    {
        "name": "name기반",
        "username": 'input[name="username"], input[name="userId"], input[name="id"]',
        "password": 'input[name="password"], input[name="pw"]',
        "submit": 'button[type="submit"], input[type="submit"]',
    },
    {
        "name": "email기반",
        "username": 'input[name="email"], input[type="email"]',
        "password": 'input[name="password"], input[type="password"]',
        "submit": 'button[type="submit"]',
    },
    {
        "name": "placeholder기반",
        "username": 'input[placeholder*="아이디"], input[placeholder*="ID"], input[placeholder*="이메일"]',
        "password": 'input[placeholder*="비밀번호"], input[placeholder*="Password"]',
        "submit": 'button[type="submit"], button:has-text("로그인"), .login-btn',
    },
    {
        "name": "type기반",
        "username": 'input[type="text"]',
        "password": 'input[type="password"]',
        "submit": 'button[type="submit"], input[type="submit"], button:has-text("로그인")',
    },
]

SETTLEMENT_TABLE_SELECTORS = [
    "table.settlement-table tbody tr",
    "table.data-table tbody tr",
    "table.tbl-data tbody tr",
    "#settlementTable tbody tr",
    ".table-wrap table tbody tr",
    "table tbody tr",
    ".grid-body .grid-row",
]

POPUP_SELECTORS = [
    'button:has-text("닫기")',
    'button:has-text("확인")',
    'button:has-text("Close")',
    "button.close",
    "button.btn-close",
    ".modal button.close",
]

EXCEL_DOWNLOAD_SELECTORS = [
    'button:has-text("엑셀")',
    'button:has-text("Excel")',
    'button:has-text("다운로드")',
    'a:has-text("엑셀")',
    'a:has-text("Excel")',
    'a:has-text("다운로드")',
    ".btn-excel",
    ".btn-download",
    "#excelDownloadBtn",
    "#btnExcel",
    'button[class*="excel"]',
    'a[class*="excel"]',
]


class LocalRpaEngine:
    """로컬 PC에서 실행되는 RPA 엔진.

    - Persistent context로 쿠키/세션을 유지합니다.
    - CAPTCHA/2FA 발생 시 사용자에게 안내 후 수동 개입을 대기합니다.
    """

    def __init__(
        self,
        headless: bool = False,
        captcha_wait: int = 120,
        browser_data_dir: Optional[str] = None,
    ):
        self.headless = headless
        self.captcha_wait = captcha_wait
        self.browser_data_dir = browser_data_dir or os.path.join(
            os.path.dirname(__file__), ".browser-data"
        )
        self.context = None

    # ─────────────────────────────────────────
    # 브라우저 수명주기
    # ─────────────────────────────────────────

    async def launch(self, playwright):
        """Persistent browser context를 실행합니다 (쿠키 유지)."""
        os.makedirs(self.browser_data_dir, exist_ok=True)
        self.context = await playwright.chromium.launch_persistent_context(
            self.browser_data_dir,
            headless=self.headless,
            viewport={"width": 1920, "height": 1080},
            locale="ko-KR",
        )
        return self.context

    async def close(self):
        """브라우저 컨텍스트를 종료합니다."""
        if self.context:
            await self.context.close()
            self.context = None

    # ─────────────────────────────────────────
    # 팝업 처리
    # ─────────────────────────────────────────

    async def _dismiss_popups(self, page):
        """공통 팝업(모달, 공지 등)을 자동으로 닫습니다."""
        for selector in POPUP_SELECTORS:
            try:
                btn = page.locator(selector).first
                if await btn.is_visible(timeout=500):
                    await btn.click()
                    await asyncio.sleep(0.5)
            except Exception:
                continue

    # ─────────────────────────────────────────
    # 로그인
    # ─────────────────────────────────────────

    async def _login(
        self,
        page,
        login_url: str,
        login_id: str,
        login_pw: str,
        custom_selectors: Optional[dict] = None,
        channel_name: str = "",
    ) -> dict:
        """범용 로그인 — CAPTCHA/2FA 발생 시 사용자 수동 개입을 대기합니다.

        Returns:
            dict with keys: success (bool), reason (str), detail (str)
        """
        # 1단계: 페이지 접근
        try:
            await page.goto(login_url, wait_until="networkidle", timeout=30000)
        except Exception as e:
            logger.warning(f"로그인 페이지 접근 실패: {e}")
            return {
                "success": False,
                "reason": "page_load_fail",
                "detail": f"로그인 페이지 접근 실패: {str(e)[:200]}",
            }

        await asyncio.sleep(1)
        await self._dismiss_popups(page)

        initial_url = page.url

        # 2단계: 로그인 전략 시도
        strategies = []
        if custom_selectors:
            strategies.append(
                {
                    "name": "커스텀",
                    "username": custom_selectors.get("login_id_sel", ""),
                    "password": custom_selectors.get("login_pw_sel", ""),
                    "submit": custom_selectors.get("submit_sel", ""),
                }
            )
        strategies.extend(LOGIN_STRATEGIES)

        tried_strategies = []
        filled = False

        for strategy in strategies:
            if not strategy.get("username"):
                continue
            try:
                username_el = page.locator(strategy["username"]).first
                if not await username_el.is_visible(timeout=2000):
                    tried_strategies.append(f"{strategy['name']}: ID필드 없음")
                    continue
                password_el = page.locator(strategy["password"]).first
                if not await password_el.is_visible(timeout=1000):
                    tried_strategies.append(f"{strategy['name']}: PW필드 없음")
                    continue

                tried_strategies.append(f"{strategy['name']}: 필드 발견")

                await username_el.clear()
                await username_el.fill(login_id)
                await password_el.clear()
                await password_el.fill(login_pw)
                filled = True

                submit_el = page.locator(strategy["submit"]).first
                if await submit_el.is_visible(timeout=1000):
                    await submit_el.click()
                else:
                    await password_el.press("Enter")

                try:
                    await page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    await asyncio.sleep(3)

                current_url = page.url
                url_changed = current_url != initial_url
                no_login_in_url = (
                    "/login" not in current_url.lower()
                    and "/signin" not in current_url.lower()
                    and "/log-in" not in current_url.lower()
                )

                if url_changed or no_login_in_url:
                    await self._dismiss_popups(page)
                    return {
                        "success": True,
                        "reason": "ok",
                        "detail": f"로그인 성공 (전략: {strategy['name']}, URL: {current_url[:100]})",
                    }

                # 에러 메시지 감지
                error_texts = []
                for err_sel in [
                    ".error",
                    ".alert-danger",
                    ".login-error",
                    ".err-msg",
                    '[class*="error"]',
                    '[class*="alert"]',
                ]:
                    try:
                        err_el = page.locator(err_sel).first
                        if await err_el.is_visible(timeout=500):
                            error_texts.append(await err_el.inner_text())
                    except Exception:
                        pass

                if error_texts:
                    return {
                        "success": False,
                        "reason": "login_rejected",
                        "detail": f"사이트 에러 메시지: {'; '.join(error_texts)[:200]}",
                    }

            except Exception as e:
                tried_strategies.append(f"{strategy['name']}: 오류 {str(e)[:50]}")
                continue

        # 3단계: 자동 로그인 실패 — CAPTCHA/2FA 수동 개입 대기
        if filled:
            label = channel_name or login_url
            console.print(
                f"\n[bold yellow]  {label} -- CAPTCHA 또는 2단계 인증이 필요합니다.[/bold yellow]"
            )
            console.print(
                f"[cyan]  브라우저에서 직접 로그인을 완료해주세요. ({self.captcha_wait}초 대기)[/cyan]\n"
            )

            start_time = time.time()
            while time.time() - start_time < self.captcha_wait:
                await asyncio.sleep(3)
                current_url = page.url
                if (
                    current_url != initial_url
                    and "/login" not in current_url.lower()
                    and "/signin" not in current_url.lower()
                ):
                    console.print(f"[green]  수동 로그인 감지됨[/green]")
                    return {
                        "success": True,
                        "reason": "manual_login",
                        "detail": f"수동 로그인 성공 (URL: {current_url[:80]})",
                    }

            return {
                "success": False,
                "reason": "captcha_timeout",
                "detail": f"대기 시간 초과 ({self.captcha_wait}초)",
            }

        # 로그인 필드를 아예 찾지 못한 경우
        return {
            "success": False,
            "reason": "no_fields_found",
            "detail": (
                f"로그인 필드를 찾을 수 없음. "
                f"시도: {', '.join(tried_strategies)}. "
                f"페이지 URL: {page.url[:100]}"
            ),
        }

    # ─────────────────────────────────────────
    # 정산 데이터 스크래핑
    # ─────────────────────────────────────────

    async def _scrape_settlement(
        self, page, settlement_url: str, year: int, month: int
    ) -> Optional[dict]:
        """정산 페이지에서 테이블 데이터를 스크래핑합니다."""
        try:
            await page.goto(settlement_url, wait_until="networkidle", timeout=30000)
        except Exception:
            await asyncio.sleep(3)

        await asyncio.sleep(2)
        await self._dismiss_popups(page)

        # 날짜/기간 설정
        await self._set_period(page, year, month)

        # 검색 버튼 클릭
        for sel in [
            'button:has-text("검색")',
            'button:has-text("조회")',
            ".btn-search",
            'button[type="submit"]',
        ]:
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

    # ─────────────────────────────────────────
    # 엑셀 다운로드 방식
    # ─────────────────────────────────────────

    async def _download_excel_settlement(
        self, page, settlement_url: str, year: int, month: int
    ) -> Optional[dict]:
        """정산 페이지에서 엑셀을 다운로드하여 파싱합니다."""
        try:
            await page.goto(settlement_url, wait_until="networkidle", timeout=30000)
        except Exception:
            await asyncio.sleep(3)

        await asyncio.sleep(2)
        await self._dismiss_popups(page)
        await self._set_period(page, year, month)

        # 검색 실행
        for sel in [
            'button:has-text("검색")',
            'button:has-text("조회")',
            ".btn-search",
        ]:
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

        # 엑셀 다운로드 버튼 탐색 및 클릭
        for sel in EXCEL_DOWNLOAD_SELECTORS:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1000):
                    async with page.expect_download(timeout=30000) as download_info:
                        await btn.click()
                    download = await download_info.value
                    tmp_path = os.path.join(
                        tempfile.gettempdir(),
                        f"settlement_{uuid.uuid4().hex[:8]}.xlsx",
                    )
                    await download.save_as(tmp_path)
                    return self._parse_excel_file(tmp_path)
            except Exception:
                continue

        return None

    # ─────────────────────────────────────────
    # 기간 설정
    # ─────────────────────────────────────────

    async def _set_period(self, page, year: int, month: int):
        """정산 페이지에서 연도/월 또는 시작일/종료일을 설정합니다."""
        days = monthrange(year, month)[1]
        start = f"{year}-{month:02d}-01"
        end = f"{year}-{month:02d}-{days:02d}"

        # 월 선택 드롭다운
        for sel in [
            'select[name*="month"], select[name*="Month"], select#month'
        ]:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=1000):
                    await el.select_option(str(month))
                    break
            except Exception:
                continue

        # 연도 선택
        for sel in [
            'select[name*="year"], select[name*="Year"], select#year'
        ]:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=1000):
                    await el.select_option(str(year))
                    break
            except Exception:
                continue

        # 날짜 입력 — 시작일
        start_sels = [
            'input[name*="start"], input[name*="Start"], input.start-date, input#startDate'
        ]
        for sel in start_sels:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=500):
                    await el.clear()
                    await el.fill(start)
                    break
            except Exception:
                continue

        # 날짜 입력 — 종료일
        end_sels = [
            'input[name*="end"], input[name*="End"], input.end-date, input#endDate'
        ]
        for sel in end_sels:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=500):
                    await el.clear()
                    await el.fill(end)
                    break
            except Exception:
                continue

    # ─────────────────────────────────────────
    # 테이블 파싱
    # ─────────────────────────────────────────

    async def _parse_settlement_table(self, rows) -> dict:
        """테이블 행에서 정산 데이터를 추출합니다."""
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

                # 금액 파싱 (숫자가 포함된 컬럼 추출)
                amounts = []
                for t in texts:
                    cleaned = t.replace(",", "").replace("원", "").replace(" ", "")
                    try:
                        amounts.append(float(cleaned))
                    except ValueError:
                        amounts.append(None)

                # 첫 번째 금액 -> 매출, 두 번째 -> 수수료, 세 번째(마지막) -> 정산금
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

    # ─────────────────────────────────────────
    # 페이지 텍스트에서 금액 추출
    # ─────────────────────────────────────────

    async def _extract_amounts_from_text(self, page) -> Optional[dict]:
        """페이지 본문 텍스트에서 정규식으로 금액을 추출합니다 (테이블이 없는 경우)."""
        try:
            body = await page.locator("body").inner_text()

            patterns = {
                "settlement_amount": [
                    r"정산[금액\s:]+([0-9,]+)",
                    r"입금[예정금액\s:]+([0-9,]+)",
                ],
                "gross_sales": [
                    r"총[매출금액\s:]+([0-9,]+)",
                    r"매출[합계금액\s:]+([0-9,]+)",
                ],
                "commission": [
                    r"수수료[금액\s:]+([0-9,]+)",
                    r"판매수수료[:\s]+([0-9,]+)",
                ],
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

    # ─────────────────────────────────────────
    # 엑셀 파일 파싱
    # ─────────────────────────────────────────

    def _parse_excel_file(
        self,
        file_path: str,
        column_mapping: Optional[dict] = None,
        skip_rows: int = 0,
        sheet_name: Optional[str] = None,
    ) -> Optional[dict]:
        """다운로드된 엑셀 파일을 파싱하여 정산 데이터를 추출합니다."""
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
                ("정산금액", "settlement_amount"),
                ("정산예정금액", "settlement_amount"),
                ("총매출", "gross_sales"),
                ("매출금액", "gross_sales"),
                ("판매금액", "gross_sales"),
                ("수수료", "commission"),
                ("판매수수료", "commission"),
                ("환불금액", "refund_amount"),
                ("반품금액", "refund_amount"),
                ("주문건수", "order_count"),
                ("주문수", "order_count"),
                ("판매수량", "quantity"),
                ("수량", "quantity"),
                ("배송비", "shipping_cost"),
            ]:
                if col in df.columns:
                    try:
                        result[key] = float(df[col].sum())
                    except Exception:
                        pass

            # 정산금이 없으면 매출 - 수수료로 계산
            if "settlement_amount" not in result and "gross_sales" in result:
                result["settlement_amount"] = result["gross_sales"] - result.get(
                    "commission", 0
                )

            return result
        except Exception as e:
            logger.error(f"엑셀 파싱 실패: {e}")
            return None
        finally:
            try:
                os.remove(file_path)
            except Exception:
                pass

    # ─────────────────────────────────────────
    # 채널 수집 (메인 메서드)
    # ─────────────────────────────────────────

    async def collect_channel(
        self, page, config: dict, year: int, month: int
    ) -> dict:
        """단일 채널의 정산 데이터를 수집합니다.

        Args:
            page: Playwright Page 객체
            config: 채널 RPA 설정 dict
            year: 대상 연도
            month: 대상 월

        Returns:
            dict: success, message, data 등을 포함하는 결과
        """
        channel_name = config["channel_name"]
        login_url = config.get("login_url", "")
        settlement_url = config.get("settlement_url", "")
        login_id = config.get("login_id", "")
        login_pw = config.get("login_password", "")
        download_type = config.get("download_type", "scrape")
        custom_selectors = config.get("selectors")

        if not login_id or not login_pw:
            return {
                "success": False,
                "message": f"{channel_name}: 로그인 정보 미설정",
            }
        if not login_url:
            return {
                "success": False,
                "message": f"{channel_name}: 로그인 URL 미설정",
            }

        # 1) 로그인
        console.print(f"  [dim]로그인 시도: {login_url[:60]}...[/dim]")
        login_result = await self._login(
            page, login_url, login_id, login_pw, custom_selectors, channel_name
        )
        if not login_result.get("success"):
            return {
                "success": False,
                "message": f"{channel_name} 로그인 실패: {login_result.get('detail', '')}",
                "login_debug": login_result,
            }
        console.print(f"  [green]로그인 성공[/green]: {login_result.get('detail', '')[:80]}")

        # 2) 정산 데이터 수집
        if not settlement_url:
            return {
                "success": False,
                "message": f"{channel_name}: 정산 URL 미설정",
            }

        console.print(f"  [dim]정산 데이터 수집: {settlement_url[:60]}...[/dim]")
        data = None
        if download_type == "excel_download":
            data = await self._download_excel_settlement(
                page, settlement_url, year, month
            )
        else:
            data = await self._scrape_settlement(page, settlement_url, year, month)

        if data:
            return {
                "success": True,
                "message": f"{channel_name} 수집 완료",
                "data": data,
            }
        else:
            return {
                "success": False,
                "message": f"{channel_name}: 데이터를 찾을 수 없습니다",
            }
