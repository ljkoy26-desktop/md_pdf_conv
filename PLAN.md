# MD → PDF 변환 프로그램 기획

## 언어 선택지 비교

| 언어 | 주요 라이브러리 | 장점 | 단점 |
|------|----------------|------|------|
| **Python** | `weasyprint`, `markdown2`, `pdfkit` (wkhtmltopdf) | 라이브러리 풍부, 빠른 개발 | 배포 시 런타임 필요 |
| **Node.js** | `puppeteer`, `marked`, `md-to-pdf` | CSS/HTML 스타일링 자유로움, 생태계 큼 | puppeteer는 Chromium 번들로 무거움 |
| **Rust** | `pulldown-cmark`, `printpdf` | 빠른 속도, 단일 바이너리 배포 | 라이브러리 성숙도 낮음, 개발 복잡 |
| **Go** | `goldmark`, `go-pdf` | 단일 바이너리 배포, 빠른 빌드 | PDF 렌더링 라이브러리 제한적 |

### 추천: **Python** 또는 **Node.js**

- **빠른 개발 & 스타일링 중요** → Node.js (`md-to-pdf` or `puppeteer`)
- **간단한 CLI 도구** → Python (`pdfkit` + `wkhtmltopdf` or `weasyprint`)

---

## 기능 요구사항

### 필수 기능
- [V] `.md` 파일을 입력받아 `.pdf`로 변환
- [V] 코드 블록 문법 하이라이팅 지원
- [V] 표(Table) 렌더링 지원
- [V] 이미지 임베딩 지원 (로컬 파일)
- [V] 수학 수식 지원 (선택: KaTeX / MathJax)
- [V] 한국어(CJK) 폰트 지원

### 추가 기능 (선택)
- [V] CSS 테마 커스터마이징 (light / dark / github 스타일)
- [V] 페이지 여백, 용지 크기 설정 (A4, Letter 등)
- [V] 헤더 / 푸터 설정 (파일명, 페이지 번호 등)
- [ ] 목차(TOC) 자동 생성
- [V] 여러 `.md` 파일을 하나의 PDF로 병합
- [ ] 감시 모드 (`--watch`): 파일 변경 시 자동 재변환
- [V] GUI (선택: Electron, Tkinter, Tauri)

---

## 구현 체크리스트

### 프로젝트 초기 설정
- [ ] 언어 / 런타임 확정
- [ ] 패키지 매니저 선택 (pip / npm / cargo 등)
- [ ] 프로젝트 구조 설계
- [ ] `README.md` 작성

### 핵심 파이프라인
- [ ] Markdown 파싱 (AST 또는 HTML 변환)
- [ ] HTML + CSS 렌더링 레이어 구현
- [ ] PDF 출력 엔진 연동
- [ ] CJK(한국어) 폰트 로딩 처리

### CLI 인터페이스
- [ ] 입력 파일 경로 인수 처리
- [ ] 출력 파일 경로 옵션 (`-o`)
- [ ] 테마 선택 옵션 (`--theme`)
- [ ] 용지 크기 옵션 (`--paper`)
- [ ] 오류 메시지 및 도움말 (`--help`)

### 스타일링
- [ ] 기본 CSS 테마 작성 (GitHub 스타일 권장)
- [ ] 코드 블록 하이라이팅 CSS (Prism.js / highlight.js)
- [ ] 인쇄용 CSS (`@media print`, 페이지 나누기)

### 테스트
- [ ] 단순 텍스트 + 헤딩 변환 테스트
- [ ] 표 / 코드블록 / 이미지 렌더링 테스트
- [ ] 한국어 텍스트 포함 PDF 테스트
- [ ] 엣지 케이스: 빈 파일, 깨진 이미지 경로

### 배포 / 패키징
- [ ] 실행 파일 빌드 (PyInstaller / pkg / cargo build --release)
- [ ] `README.md` 사용법 문서화
- [ ] 라이선스 파일 추가

---

## 권장 구현 스택 (Node.js 기준)

```
md_pdf_conv/
├── src/
│   ├── index.js        # CLI 진입점
│   ├── converter.js    # MD → HTML → PDF 파이프라인
│   └── themes/
│       └── github.css  # 기본 테마
├── package.json
└── README.md
```

### 핵심 패키지
```bash
npm install marked        # MD → HTML 파싱
npm install puppeteer     # HTML → PDF (Chromium 기반)
npm install highlight.js  # 코드 하이라이팅
npm install commander     # CLI 인수 파싱
```

---

## 권장 구현 스택 (Python 기준)

```
md_pdf_conv/
├── main.py             # CLI 진입점
├── converter.py        # MD → HTML → PDF 파이프라인
├── themes/
│   └── github.css      # 기본 테마
├── requirements.txt
└── README.md
```

### 핵심 패키지
```bash
pip install markdown         # MD → HTML 파싱
pip install weasyprint       # HTML → PDF (순수 Python)
pip install pygments         # 코드 하이라이팅
pip install click            # CLI 인수 파싱
```

---

## 결정 필요 사항

1. **언어**: Python / Node.js / 기타?
2. **PDF 엔진**: weasyprint(순수 Python) vs pdfkit(wkhtmltopdf) vs puppeteer(Chromium)?
3. **배포 형태**: CLI 전용 / GUI 포함 / 웹 앱?
4. **수식 지원 필요 여부**
5. **감시 모드(`--watch`) 필요 여부**
