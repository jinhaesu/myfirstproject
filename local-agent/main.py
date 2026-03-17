"""
조인앤조인 로컬 RPA 에이전트
사무실 PC에서 실행하여 각 채널 셀러 어드민에서 결산 데이터를 자동 수집합니다.
"""
import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from playwright.async_api import async_playwright

from config import load_config
from api_client import BackendClient
from rpa_engine import LocalRpaEngine

console = Console()

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(
            os.path.join(os.path.dirname(__file__), "agent.log"),
            encoding="utf-8",
        ),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)


async def main():
    parser = argparse.ArgumentParser(description="조인앤조인 로컬 RPA 에이전트")
    parser.add_argument("--year", type=int, default=datetime.now().year)
    parser.add_argument("--month", type=int, default=datetime.now().month)
    parser.add_argument("--channel", type=str, help="특정 채널만 수집")
    parser.add_argument(
        "--headless", action="store_true", help="헤드리스 모드 (브라우저 숨김)"
    )
    parser.add_argument(
        "--list", action="store_true", help="설정된 채널 목록만 표시"
    )
    args = parser.parse_args()

    # ─── 배너 ───
    console.print(
        Panel.fit(
            "[bold blue]조인앤조인 로컬 RPA 에이전트[/bold blue]\n"
            f"[dim]{args.year}년 {args.month}월 결산 데이터 수집[/dim]",
            border_style="blue",
        )
    )

    # ─── 설정 로드 ───
    cfg = load_config()
    client = BackendClient(cfg["backend_url"], cfg["api_key"])

    # ─── 서버 연결 확인 ───
    console.print("\n[cyan]서버 연결 확인 중...[/cyan]")
    hb = client.heartbeat("idle")
    if not hb:
        console.print(
            "[red]서버 연결 실패. BACKEND_URL과 AGENT_API_KEY를 확인하세요.[/red]"
        )
        return
    console.print("[green]서버 연결 성공[/green]\n")

    # ─── 채널 설정 가져오기 ───
    configs = client.get_configs()
    if not configs:
        console.print("[red]채널 설정을 불러올 수 없습니다.[/red]")
        return

    # 활성 채널만 필터 (로그인 정보가 있는 것)
    enabled = [
        c
        for c in configs
        if c.get("login_id")
        and c.get("login_password")
        and c.get("is_enabled", True)
    ]

    if args.channel:
        enabled = [c for c in enabled if c["channel_name"] == args.channel]
        if not enabled:
            console.print(
                f"[red]'{args.channel}' 채널을 찾을 수 없거나 설정이 없습니다.[/red]"
            )
            return

    # ─── 목록 모드 ───
    if args.list:
        table = Table(title="설정된 채널 목록")
        table.add_column("채널명", style="bold")
        table.add_column("로그인 URL")
        table.add_column("정산 URL")
        table.add_column("ID")
        for c in enabled:
            table.add_row(
                c["channel_name"],
                c.get("login_url", "")[:50],
                c.get("settlement_url", "")[:50],
                c.get("login_id", ""),
            )
        console.print(table)
        return

    console.print(f"[bold]수집 대상: {len(enabled)}개 채널[/bold]\n")

    # ─── 수집 실행 ───
    headless = args.headless or cfg.get("headless", False)
    captcha_wait = cfg.get("captcha_wait", 120)
    engine = LocalRpaEngine(headless=headless, captcha_wait=captcha_wait)

    results = []
    async with async_playwright() as p:
        ctx = await engine.launch(p)

        client.heartbeat("collecting", channels_total=len(enabled))

        for i, config in enumerate(enabled):
            ch_name = config["channel_name"]
            console.rule(f"[bold]{i + 1}/{len(enabled)} -- {ch_name}[/bold]")

            client.heartbeat(
                "collecting",
                current_channel=ch_name,
                channels_completed=i,
                channels_total=len(enabled),
            )
            client.report_log(ch_name, args.year, args.month, "running")

            page = await ctx.new_page()
            try:
                result = await engine.collect_channel(
                    page, config, args.year, args.month
                )
                results.append({"channel": ch_name, **result})

                if result.get("success") and result.get("data"):
                    # 서버에 업로드
                    client.submit_data(
                        ch_name, args.year, args.month, result["data"]
                    )
                    client.report_log(
                        ch_name,
                        args.year,
                        args.month,
                        "success",
                        settlement_amount=result["data"].get("settlement_amount"),
                    )
                    console.print(f"[green]  {ch_name}: 수집 성공[/green]")
                    amt = result["data"].get("settlement_amount")
                    if amt:
                        console.print(f"  정산금액: {amt:,.0f}원")
                else:
                    client.report_log(
                        ch_name,
                        args.year,
                        args.month,
                        "failed",
                        error_message=result.get("message"),
                    )
                    console.print(
                        f"[red]  {ch_name}: {result.get('message', '실패')}[/red]"
                    )
            except Exception as e:
                logger.exception(f"{ch_name} 수집 중 예외 발생")
                client.report_log(
                    ch_name,
                    args.year,
                    args.month,
                    "failed",
                    error_message=str(e),
                )
                console.print(f"[red]  {ch_name}: 오류 -- {e}[/red]")
                results.append(
                    {"channel": ch_name, "success": False, "message": str(e)}
                )
            finally:
                await page.close()

        await engine.close()

    # ─── 최종 하트비트 ───
    client.heartbeat(
        "idle",
        channels_completed=len(enabled),
        channels_total=len(enabled),
    )

    # ─── 결과 요약 ───
    console.print("\n")
    summary = Table(title=f"{args.year}년 {args.month}월 수집 결과")
    summary.add_column("채널", style="bold")
    summary.add_column("결과")
    summary.add_column("정산금액", justify="right")
    summary.add_column("메시지")

    success_count = 0
    for r in results:
        if r.get("success"):
            success_count += 1
            amt = r.get("data", {}).get("settlement_amount")
            summary.add_row(
                r["channel"],
                "[green]성공[/green]",
                f"{amt:,.0f}" if amt else "-",
                "",
            )
        else:
            summary.add_row(
                r["channel"],
                "[red]실패[/red]",
                "-",
                r.get("message", "")[:60],
            )

    console.print(summary)
    console.print(f"\n[bold]완료: {success_count}/{len(results)} 성공[/bold]\n")


if __name__ == "__main__":
    asyncio.run(main())
