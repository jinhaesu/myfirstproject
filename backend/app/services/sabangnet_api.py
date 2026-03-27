"""사방넷 쇼핑몰 통합관리 API 서비스

사방넷 API는 XML 기반으로 동작합니다:
1. XML 요청 파일을 웹 서버에 호스팅
2. 사방넷 URL에 xml_url 파라미터로 호스팅 URL 전달
3. 사방넷이 XML을 가져가서 처리 후 XML 응답 반환

Base URL: https://sbadmin{N}.sabangnet.co.kr/RTL_API/
"""
import logging
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Optional, List, Dict, Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

# 임시 XML 저장소 (메모리 기반, TTL 관리는 별도)
_xml_store: Dict[str, str] = {}


def store_xml(xml_content: str) -> str:
    """XML을 임시 저장하고 고유 ID 반환"""
    request_id = str(uuid.uuid4())
    _xml_store[request_id] = xml_content
    # 저장소가 100개 이상이면 오래된 것 정리
    if len(_xml_store) > 100:
        keys = list(_xml_store.keys())
        for k in keys[:50]:
            _xml_store.pop(k, None)
    return request_id


def get_stored_xml(request_id: str) -> Optional[str]:
    """저장된 XML 조회 후 삭제 (일회성)"""
    return _xml_store.pop(request_id, None)


class SabangnetAPI:
    """사방넷 쇼핑몰 통합관리 XML API 클라이언트"""

    def __init__(self):
        settings = get_settings()
        self.auth_key = settings.SABANGNET_API_KEY
        self.login_id = settings.SABANGNET_LOGIN_ID
        self.admin_no = settings.SABANGNET_ADMIN_NO
        self.backend_url = settings.BACKEND_PUBLIC_URL.rstrip("/") if settings.BACKEND_PUBLIC_URL else ""

        self._available = bool(self.auth_key and self.login_id and self.admin_no)

        if self._available:
            self.base_url = f"https://sbadmin{self.admin_no}.sabangnet.co.kr/RTL_API"
        else:
            self.base_url = ""

    @property
    def is_available(self) -> bool:
        return self._available

    @property
    def has_backend_url(self) -> bool:
        return bool(self.backend_url)

    def _build_header_xml(self, extra_header: dict = None) -> str:
        """공통 XML 헤더 생성"""
        today = datetime.now().strftime("%Y%m%d")
        header = f"""    <HEADER>
        <SEND_COMPAYNY_ID>{self.login_id}</SEND_COMPAYNY_ID>
        <SEND_AUTH_KEY>{self.auth_key}</SEND_AUTH_KEY>
        <SEND_DATE>{today}</SEND_DATE>"""
        if extra_header:
            for key, val in extra_header.items():
                header += f"\n        <{key}>{val}</{key}>"
        header += "\n    </HEADER>"
        return header

    def _parse_xml_response(self, xml_text: str) -> List[Dict[str, str]]:
        """XML 응답을 파싱하여 DATA 목록 반환"""
        items = []
        try:
            # encoding="euc-kr" 선언을 제거 (이미 Python str로 디코딩된 상태)
            clean = xml_text
            clean = clean.replace('encoding="euc-kr"', 'encoding="utf-8"')
            clean = clean.replace("encoding='euc-kr'", "encoding='utf-8'")
            clean = clean.replace('encoding="EUC-KR"', 'encoding="utf-8"')

            root = ET.fromstring(clean.encode("utf-8"))

            for data_elem in root.findall("DATA"):
                item = {}
                for child in data_elem:
                    item[child.tag] = (child.text or "").strip()
                if item:
                    items.append(item)

        except ET.ParseError as e:
            logger.error(f"사방넷 XML 파싱 실패: {e}")
            logger.error(f"XML 앞부분: {xml_text[:300]}")
            # fallback: 정규식으로 DATA 추출 시도
            try:
                import re
                data_blocks = re.findall(r'<DATA>(.*?)</DATA>', xml_text, re.DOTALL)
                for block in data_blocks:
                    item = {}
                    tags = re.findall(r'<(\w+)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</\1>', block)
                    for tag_name, tag_value in tags:
                        item[tag_name] = tag_value.strip()
                    if item:
                        items.append(item)
                if items:
                    logger.info(f"정규식 fallback으로 {len(items)}건 파싱 성공")
            except Exception as e2:
                logger.error(f"정규식 fallback도 실패: {e2}")
        except Exception as e:
            logger.error(f"사방넷 응답 처리 실패: {e}")

        return items

    def _parse_text_response(self, text: str) -> Dict[str, Any]:
        """텍스트 형태 응답 파싱 (답변 송신 결과 등)"""
        lines = text.strip().split("\n")
        results = []
        total = 0
        for line in lines:
            line = line.strip()
            if line.startswith("총건수"):
                try:
                    total = int(line.split(":")[1].strip())
                except (IndexError, ValueError):
                    pass
            elif line.startswith("["):
                success = "성공" in line
                results.append({"line": line, "success": success})
        return {"total": total, "results": results}

    async def _call_api(self, endpoint: str, xml_content: str) -> str:
        """사방넷 API 호출

        3가지 방식을 순차 시도:
        1. 직접 POST (가장 빠르고 간단)
        2. xml_url GET 방식 (사방넷 공식 방식)
        3. xml_url을 query param으로 data URI 전달
        """
        if not self._available:
            raise ValueError("사방넷 API가 설정되지 않았습니다")

        api_url = f"{self.base_url}/{endpoint}"
        xml_bytes = xml_content.encode("euc-kr", errors="replace")

        async with httpx.AsyncClient(verify=False) as client:
            # 방법 1: 직접 POST
            try:
                logger.info(f"사방넷 API 호출 (POST): {api_url}")
                resp = await client.post(
                    api_url,
                    content=xml_bytes,
                    headers={"Content-Type": "application/xml; charset=euc-kr"},
                    timeout=30.0,
                    follow_redirects=True,
                )
                # EUC-KR 응답을 제대로 디코딩
                try:
                    text = resp.content.decode("euc-kr", errors="replace")
                except Exception:
                    text = resp.text
                # JSON 에러 응답이 아니고, 유효한 XML이면 성공
                if text.strip().startswith("<?xml") or "<DATA>" in text or "총건수" in text:
                    logger.info(f"사방넷 POST 성공: {len(text)}bytes")
                    return text
                logger.info(f"사방넷 POST 응답이 XML이 아님: {text[:200]}")
            except Exception as e:
                logger.warning(f"사방넷 POST 실패: {e}")

            # 방법 2: xml_url 방식 (BACKEND_PUBLIC_URL 필요)
            if self.has_backend_url:
                try:
                    request_id = store_xml(xml_content)
                    xml_url = f"{self.backend_url}/api/sabangnet/xml-host/{request_id}"
                    full_url = f"{api_url}?xml_url={xml_url}"
                    logger.info(f"사방넷 API 호출 (xml_url): {full_url}")
                    resp = await client.get(full_url, timeout=30.0, follow_redirects=True)
                    text = resp.text
                    if text.strip().startswith("<?xml") or "<DATA>" in text or "총건수" in text:
                        logger.info(f"사방넷 xml_url 성공: {len(text)}bytes")
                        return text
                    logger.info(f"사방넷 xml_url 응답: {text[:300]}")
                except Exception as e:
                    logger.warning(f"사방넷 xml_url 실패: {e}")

            # 방법 3: form data로 POST
            try:
                logger.info(f"사방넷 API 호출 (form): {api_url}")
                resp = await client.post(
                    api_url,
                    data={"xml_data": xml_content},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=30.0,
                    follow_redirects=True,
                )
                text = resp.text
                logger.info(f"사방넷 form 응답: {text[:300]}")
                return text
            except Exception as e:
                logger.warning(f"사방넷 form 실패: {e}")

            # 모든 방법 실패
            raise ValueError("사방넷 API 호출 실패: 모든 방식(POST/xml_url/form) 시도 실패")

    # ── 문의사항 수집 ──

    async def collect_inquiries(self, start_date: str = None, end_date: str = None,
                                 status: str = None) -> Dict[str, Any]:
        """사방넷에 수집된 문의사항 가져오기

        Args:
            start_date: 검색 시작일 YYYYMMDD (기본: 30일 전)
            end_date: 검색 종료일 YYYYMMDD (기본: 오늘)
            status: 001=신규접수, 002=답변저장, 003=답변전송, 004=강제완료, None=전체
        """
        if not start_date:
            from datetime import timedelta
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        if not end_date:
            end_date = datetime.now().strftime("%Y%m%d")

        data_section = f"""    <DATA>
        <CS_ST_DATE>{start_date}</CS_ST_DATE>
        <CS_ED_DATE>{end_date}</CS_ED_DATE>"""
        if status:
            data_section += f"\n        <CS_STATUS>{status}</CS_STATUS>"
        data_section += "\n    </DATA>"

        xml_content = f"""<?xml version="1.0" encoding="EUC-KR"?>
<SABANG_CS_LIST>
{self._build_header_xml()}
{data_section}
</SABANG_CS_LIST>"""

        try:
            response_text = await self._call_api("xml_cs_info.html", xml_content)
            items = self._parse_xml_response(response_text)
            logger.info(f"사방넷 문의사항 수집 완료: {len(items)}건")
            return {"success": True, "items": items, "raw": response_text[:1000]}
        except Exception as e:
            logger.error(f"사방넷 문의사항 수집 실패: {e}")
            return {"success": False, "error": str(e), "items": []}

    # ── 문의사항 답변 ──

    async def send_inquiry_response(self, responses: List[Dict[str, str]]) -> Dict[str, Any]:
        """문의사항 답변 송신

        Args:
            responses: [{"num": "사방넷일련번호", "content": "답변내용"}, ...]
        """
        data_sections = ""
        for r in responses:
            data_sections += f"""    <DATA>
        <NUM><![CDATA[{r['num']}]]></NUM>
        <CS_RE_CONTENT><![CDATA[{r['content']}]]></CS_RE_CONTENT>
    </DATA>
"""

        xml_content = f"""<?xml version="1.0" encoding="EUC-KR"?>
<SABANG_CS_ANS_REGI>
{self._build_header_xml()}
{data_sections}</SABANG_CS_ANS_REGI>"""

        try:
            response_text = await self._call_api("xml_cs_ans.html", xml_content)
            result = self._parse_text_response(response_text)
            return {"success": True, **result, "raw": response_text[:1000]}
        except Exception as e:
            logger.error(f"사방넷 답변 송신 실패: {e}")
            return {"success": False, "error": str(e)}

    # ── 클레임 수집 ──

    async def collect_claims(self, start_date: str = None, end_date: str = None) -> Dict[str, Any]:
        """클레임 데이터 수집

        Args:
            start_date: 검색 시작일 YYYYMMDD
            end_date: 검색 종료일 YYYYMMDD
        """
        if not start_date:
            from datetime import timedelta
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        if not end_date:
            end_date = datetime.now().strftime("%Y%m%d")

        fields = "IDX|ORDER_ID|MALL_ID|MALL_ORDER_ID|MALL_USER_ID|ORDER_STATUS|USER_NAME|USER_CEL|PRODUCT_NAME|SALE_CNT|ORDER_DATE|ORDER_TOTAL_PRICE|DELIVERY_COMPANY_NM|DELIVERY_NO|CLAME_STATUS_GUBUN|CLAME_CONTENT|CLAME_INS_DATE|CLAME_REG_DATE|CL_IDX|COMPAYNY_GOODS_CD"

        xml_content = f"""<?xml version="1.0" encoding="EUC-KR"?>
<SABANG_ORDER_LIST>
{self._build_header_xml()}
    <DATA>
        <CLM_ST_DATE>{start_date}</CLM_ST_DATE>
        <CLM_ED_DATE>{end_date}</CLM_ED_DATE>
        <CLM_FIELD><![CDATA[{fields}]]></CLM_FIELD>
        <LANG>UTF-8</LANG>
    </DATA>
</SABANG_ORDER_LIST>"""

        try:
            response_text = await self._call_api("xml_clm_info.html", xml_content)
            items = self._parse_xml_response(response_text)
            logger.info(f"사방넷 클레임 수집 완료: {len(items)}건")
            return {"success": True, "items": items, "raw": response_text[:1000]}
        except Exception as e:
            logger.error(f"사방넷 클레임 수집 실패: {e}")
            return {"success": False, "error": str(e), "items": []}

    # ── 상품 쇼핑몰별 수정 ──

    async def update_mall_product(self, updates: List[Dict[str, str]]) -> Dict[str, Any]:
        """상품 쇼핑몰별 데이터 수정

        Args:
            updates: [{"mall_code": "shop0121", "product_code": "ABC123", "price": "10000", ...}, ...]
        """
        data_sections = ""
        for u in updates:
            data_sections += "    <DATA>\n"
            data_sections += f"        <MALL_CODE>{u.get('mall_code', '')}</MALL_CODE>\n"
            data_sections += f"        <COMPAYNY_GOODS_CD><![CDATA[{u.get('product_code', '')}]]></COMPAYNY_GOODS_CD>\n"
            if u.get("price"):
                data_sections += f"        <MALL_GOODS_PRICE>{u['price']}</MALL_GOODS_PRICE>\n"
            if u.get("product_name"):
                data_sections += f"        <MALL_PROD_NAME>{u['product_name']}</MALL_PROD_NAME>\n"
            if u.get("description"):
                data_sections += f"        <MALL_PROD_DESC><![CDATA[{u['description']}]]></MALL_PROD_DESC>\n"
            if u.get("stock_rate"):
                data_sections += f"        <MALL_STOCK_RATE>{u['stock_rate']}</MALL_STOCK_RATE>\n"
            data_sections += "    </DATA>\n"

        xml_content = f"""<?xml version="1.0" encoding="EUC-KR"?>
<SABANG_GOODS_REGI>
{self._build_header_xml({"SEND_GOODS_CD_RT": "Y", "RESULT_TYPE": "XML"})}
{data_sections}</SABANG_GOODS_REGI>"""

        try:
            response_text = await self._call_api("xml_goods_info3.html", xml_content)
            # XML 응답 또는 텍스트 응답 파싱
            if "<" in response_text and ">" in response_text:
                items = self._parse_xml_response(response_text)
                return {"success": True, "items": items, "raw": response_text[:1000]}
            else:
                result = self._parse_text_response(response_text)
                return {"success": True, **result, "raw": response_text[:1000]}
        except Exception as e:
            logger.error(f"사방넷 상품 수정 실패: {e}")
            return {"success": False, "error": str(e)}

    # ── 주문/배송 상세 조회 ──

    async def get_order_detail(self, order_id: str, days_back: int = 90) -> Dict[str, Any]:
        """주문번호로 배송 정보 포함 주문 상세 조회

        사방넷 xml_order.html은 404이므로, 클레임 API(xml_clm_info.html)를 활용.
        클레임 API는 실제로 전체 주문/배송 데이터(5000건+)를 반환하며,
        DELIVERY_NO, DELIVERY_COMPANY_NM, ORDER_STATUS 등 배송 필드를 포함.

        CS의 ORDER_ID(쇼핑몰 주문번호)와 주문 시스템의 ORDER_ID(사방넷 내부번호)가
        다르므로, MALL_ORDER_ID 필드로 매칭합니다.
        """
        if not order_id:
            return {"success": False, "error": "주문번호가 없습니다", "items": []}

        from datetime import timedelta
        start_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y%m%d")
        end_date = datetime.now().strftime("%Y%m%d")

        # 방법 1: 클레임/주문 API — 배송 정보 포함 (MALL_ORDER_ID로 매칭)
        try:
            fields = "IDX|ORDER_ID|MALL_ID|MALL_ORDER_ID|ORDER_STATUS|USER_NAME|USER_CEL|PRODUCT_NAME|SALE_CNT|ORDER_DATE|ORDER_TOTAL_PRICE|DELIVERY_COMPANY_NM|DELIVERY_NO|COMPAYNY_GOODS_CD|CLAME_STATUS_GUBUN"
            xml_content = f"""<?xml version="1.0" encoding="EUC-KR"?>
<SABANG_ORDER_LIST>
{self._build_header_xml()}
    <DATA>
        <CLM_ST_DATE>{start_date}</CLM_ST_DATE>
        <CLM_ED_DATE>{end_date}</CLM_ED_DATE>
        <CLM_FIELD><![CDATA[{fields}]]></CLM_FIELD>
        <LANG>UTF-8</LANG>
    </DATA>
</SABANG_ORDER_LIST>"""
            response_text = await self._call_api("xml_clm_info.html", xml_content)
            all_items = self._parse_xml_response(response_text)

            # 매칭 순서: MALL_ORDER_ID → ORDER_ID → 부분매칭
            matched = [it for it in all_items if it.get("MALL_ORDER_ID", "") == order_id]
            if not matched:
                matched = [it for it in all_items if it.get("ORDER_ID", "") == order_id]
            if not matched:
                matched = [it for it in all_items if order_id in it.get("MALL_ORDER_ID", "") or order_id in it.get("ORDER_ID", "")]

            if matched:
                logger.info(f"주문/배송 데이터 발견: {order_id} → {len(matched)}건 (전체 {len(all_items)}건)")
                return {"success": True, "items": matched, "source": "xml_clm_info"}
            logger.info(f"클레임 API: {order_id} → 전체 {len(all_items)}건 중 매칭 0건")
        except Exception as e:
            logger.warning(f"클레임 API 실패: {e}")

        # 방법 2: CS 문의 API — 배송 정보 없지만 문의 상태는 있음
        try:
            cs_result = await self.collect_inquiries(start_date, end_date)
            if cs_result.get("success"):
                cs_items = cs_result.get("items", [])
                matched_cs = [it for it in cs_items if it.get("ORDER_ID", "") == order_id]
                if matched_cs:
                    logger.info(f"CS API에서 문의 데이터 발견: {order_id} → {len(matched_cs)}건")
                    return {"success": True, "items": matched_cs, "source": "xml_cs_info"}
        except Exception as e:
            logger.warning(f"CS API 실패: {e}")

        return {"success": False, "error": "매칭 실패", "items": []}


def get_sabangnet_api() -> SabangnetAPI:
    """SabangnetAPI 인스턴스 반환"""
    return SabangnetAPI()
