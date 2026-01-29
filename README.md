# BigQuery Chat Analytics

자연어로 Google BigQuery 데이터를 분석하는 채팅 웹 애플리케이션입니다.

## 기능

- 자연어 질문을 SQL로 자동 변환
- BigQuery 쿼리 실행 및 결과 테이블 표시
- AI 기반 결과 요약 및 설명

## 기술 스택

- **백엔드**: Python, FastAPI, Google Cloud BigQuery
- **프론트엔드**: Next.js 14, React, Tailwind CSS, TanStack Table
- **AI**: Anthropic Claude API

## 시작하기

### 사전 요구사항

- Python 3.11+
- Node.js 18+
- Google Cloud 프로젝트 및 BigQuery 데이터셋
- Anthropic API 키

### 백엔드 설정

```bash
cd backend

# 가상환경 생성
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt

# 환경 변수 설정
cp .env.example .env
# .env 파일을 편집하여 실제 값 입력

# 서버 실행
uvicorn app.main:app --reload
```

### 프론트엔드 설정

```bash
cd frontend

# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

### 환경 변수

**backend/.env**
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GCP_PROJECT_ID=your-project-id
BIGQUERY_DATASET_ID=your-dataset-id
ANTHROPIC_API_KEY=sk-ant-xxxxx
ALLOWED_ORIGINS=http://localhost:3000
```

## 사용 방법

1. http://localhost:3000 접속
2. 왼쪽에서 분석할 테이블 선택
3. 채팅창에 자연어로 질문 입력
4. AI가 SQL을 생성하고 결과를 테이블로 표시

### 질문 예시

- "지난달 매출 상위 10개 제품은?"
- "카테고리별 평균 가격을 알려줘"
- "일별 주문 건수 추이를 보여줘"
- "가장 많이 팔린 제품 5개와 수량"

## API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/tables | 테이블 목록 조회 |
| GET | /api/tables/{id}/schema | 테이블 스키마 조회 |
| POST | /api/chat | 자연어 질문으로 데이터 분석 |
| POST | /api/query | SQL 직접 실행 |

## 보안 주의사항

- 서비스 계정 JSON 파일을 절대 커밋하지 마세요
- `.env` 파일을 절대 커밋하지 마세요
- SELECT 쿼리만 허용되며 INSERT/UPDATE/DELETE는 차단됩니다

## 라이선스

MIT
