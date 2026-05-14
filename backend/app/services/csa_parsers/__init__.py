"""채널별 엑셀 파서 레지스트리."""
from __future__ import annotations

import logging
from typing import Callable, Iterable

from app.services.csa_service import ParsedLine

log = logging.getLogger(__name__)

ParserFn = Callable[[str], Iterable[ParsedLine]]

# 채널 정규화명 → 파서 함수
_REGISTRY: dict[str, ParserFn] = {}


def register(channel_name: str):
    def deco(fn: ParserFn) -> ParserFn:
        _REGISTRY[channel_name] = fn
        return fn
    return deco


def get_parser(channel_name: str) -> ParserFn | None:
    return _REGISTRY.get(channel_name)


def registered_channels() -> list[str]:
    return sorted(_REGISTRY.keys())


# Import all parser modules (각 모듈이 register 데코레이터로 등록됨)
from app.services.csa_parsers import (  # noqa: E402,F401
    cafe24, coupang, smartstore, kurly, talkstore,
    auction, gmarket, oliveyoung,
    nh, samsungcard, ezwel, kream, kakaostyle, always, bmart, cu,
    lotteon, ns, aliexpress, temu, coupang_rocket,
    eleven, gs25, seven, toss,
    gsshop, ssg, cjonstyle, lottehome, shinsegae_live, ably,
    samsung_welstory, ourhome, cj_freshway, emart_nobrand, homeplus,
)
