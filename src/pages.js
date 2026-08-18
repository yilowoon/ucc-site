/* 소개/약관 등 정적 콘텐츠 페이지 정의 (슬러그 기반) */
"use strict";

// group: about(본부소개) / policy(약관)
const PAGES = {
  // ===== 본부소개 =====
  greeting: {
    group: "about", title: "인사말", en: "GREETING",
    html: `
      <div class="greet">
        <figure class="greet-photo">
          <img src="/img/greeting-chair.jpg" alt="사단법인 도시공동체본부 이사장 이가희 문학박사" />
          <figcaption class="greet-name">이사장 <strong>이가희</strong> 문학박사</figcaption>
        </figure>
        <div class="greet-body">
          <p class="lead">지역이 스스로 회복하는 힘을 설계하고, 그 체계를 지역에 남기겠습니다.</p>
          <p>사단법인 도시공동체본부는 인구감소와 지방소멸의 위기에 놓인 한계지역의 사회적경제 거버넌스를 혁신하기 위해 설립된 <strong>도시·공동체·회복탄력성 융합 플랫폼</strong>이자 실행조직입니다.</p>
          <p>우리는 진단부터 자립·이양까지 현장에 직접 동반합니다. 리빙랩(Living Lab) 기반의 실증으로 작동하는 해법을 만들고, 주민과 활동가를 정책 생산자와 전문가로 키우며, 컨설팅·플랫폼·네트워크로 지역이 스스로 설 때까지 함께합니다.</p>
          <p>도시공동체본부는 앞으로도 연대와 호혜, 민주적 운영, 지역순환경제의 가치를 바탕으로 건강한 공동체를 조성하고, 2030년 대한민국을 대표하는 도시혁신·공동체 전문 싱크탱크로 성장하겠습니다. 여러분의 관심과 참여를 부탁드립니다.</p>
          <p class="sign">사단법인 도시공동체본부 이사장 이가희</p>
        </div>
      </div>
    `,
  },
  vision: {
    group: "about", title: "비전과 목표", en: "VISION & GOALS",
    html: `
      <div class="page-cards">
        <div class="page-card"><h3>MISSION · 미션</h3><p>한계지역의 사회적경제 거버넌스 혁신을 위해 직접적 솔루션과 교육·서비스를 제공하는 도시·공동체 혁신 플랫폼을 구축합니다.</p></div>
        <div class="page-card"><h3>VISION · 비전</h3><p>2030, 대한민국 대표 도시혁신·공동체 전문 싱크탱크이자 실행조직으로 자리합니다.</p></div>
      </div>
      <h3 class="page-h">핵심 가치</h3>
      <ul class="page-chips">
        <li>지속가능성 SUSTAINABILITY</li><li>혁신 INNOVATION</li><li>연대·협력 SOLIDARITY</li><li>전문성 EXPERTISE</li><li>회복탄력성 RESILIENCE</li>
      </ul>
      <h3 class="page-h">3개년 목표 (2028)</h3>
      <ul class="page-list">
        <li>정회원 130명 → 회원 10,000명</li>
        <li>회원기업 20개사 확대</li>
        <li>교육 참여 50,000명</li>
        <li>유형별 리빙랩 실증 사이트 5~7개, 지역회복혁신가(RRC) 100명 양성</li>
      </ul>
    `,
  },
  esg: {
    group: "about", title: "ESG경영", en: "ESG",
    html: `
      <p class="lead">「사회연대경제기본법」이 지향하는 가치를 운영의 토대로 삼아, 양극화 해소와 지방소멸 대응, 건강한 공동체 조성에 기여합니다.</p>
      <div class="page-cards page-cards--3">
        <div class="page-card"><h3>Environmental</h3><p>지속가능도시 표준·인증체계 개발과 도시 회복력 진단으로 환경적 지속가능성을 높입니다.</p></div>
        <div class="page-card"><h3>Social</h3><p>연대·호혜, 민주적 운영, 지역순환경제로 사회적 가치를 중심에 둔 공동체를 만듭니다.</p></div>
        <div class="page-card"><h3>Governance</h3><p>정부·공공기관으로부터 자율적으로 운영되며 투명한 의사결정과 이해관계자 참여를 보장합니다.</p></div>
      </div>
    `,
  },
  history: {
    group: "about", title: "연혁", en: "HISTORY",
    html: `
      <ul class="page-timeline">
        <li><span>2026.03.25</span><div><strong>제1회 도시공동체포럼</strong> 개최</div></li>
        <li><span>2026.01.01</span><div><strong>이형구 상임대표</strong> 선임</div></li>
        <li><span>2025.03.25</span><div><strong>이가희 이사장</strong> 취임</div></li>
        <li><span>2020.10.01</span><div><strong>사단법인 인가</strong> (행정안전부)</div></li>
        <li><span>2019.06.04</span><div><strong>도시공동체본부</strong> 설립</div></li>
      </ul>
    `,
  },
  org: {
    group: "about", title: "조직도", en: "ORGANIZATION",
    html: `
      <h3 class="page-h">임원 · 거버넌스</h3>
      <ul class="page-list">
        <li><strong>이사장</strong> 이가희 문학박사</li>
        <li><strong>상임대표</strong> 이형구 박사</li>
        <li>임원 13명, 이사회·자문위원회(학계·산업·공공·법률) 운영</li>
      </ul>
      <h3 class="page-h">6대 사업부문</h3>
      <div class="page-cards page-cards--3">
        <div class="page-card"><h3>지속가능도시연구소</h3><p>평가지표·인증체계 개발, 회복력 진단, ESG 진단</p></div>
        <div class="page-card"><h3>교육혁신센터</h3><p>시민 도시대학, 공동체리더·ESG·RRC 양성 등 평생교육</p></div>
        <div class="page-card"><h3>컨설팅센터</h3><p>ESG·지속가능경영, 도시재생, 공동체활성화 솔루션</p></div>
        <div class="page-card"><h3>치유산업센터</h3><p>지역회복 프로그램 운영, 온라인 치유 콘텐츠, 기업 웰빙</p></div>
        <div class="page-card"><h3>미디어협력센터</h3><p>칼럼·뉴스레터·SNS·웨비나로 브랜드 확산</p></div>
        <div class="page-card"><h3>이벤트사업부</h3><p>전통문화 기반 인지도·교류 행사 운영</p></div>
      </div>
    `,
  },
  ci: {
    group: "about", title: "기관CI/소개자료", en: "CI & RESOURCES",
    html: `
      <div class="page-ci">
        <img src="/img/ucc-symbol.png?v=2" alt="도시공동체본부 심볼" />
        <div>
          <h3>Urban Community Center</h3>
          <p>세 개의 잎은 <strong>지역·시민·생태계</strong>의 조화로운 성장을 상징합니다. 녹색은 지속가능성, 파랑은 신뢰와 혁신, 주황은 연대와 활력을 담습니다.</p>
        </div>
      </div>
      <h3 class="page-h">소개자료 다운로드</h3>
      <ul class="page-list">
        <li><a href="/assets/ucc-intro.pdf" target="_blank" rel="noopener">도시공동체본부 소개서 (PDF)</a></li>
      </ul>
    `,
  },
  location: {
    group: "about", title: "오시는길", en: "LOCATION",
    html: `
      <ul class="page-list">
        <li><strong>기관명</strong> 사단법인 도시공동체본부 (행정안전부 소관 비영리법인)</li>
        <li><strong>주소</strong> 세종특별자치시 연청로 1161, 2F</li>
        <li><strong>전화</strong> 1670-9678</li>
        <li><strong>이메일</strong> contact@ucc.or.kr</li>
        <li><strong>웹사이트</strong> <a href="https://ucc.or.kr" target="_blank" rel="noopener">ucc.or.kr</a></li>
      </ul>
      <div id="naverMap" class="naver-map"></div>
      <div class="map-actions">
        <a class="btn btn-primary btn-sm" href="https://map.naver.com/p/search/%EC%84%B8%EC%A2%85%ED%8A%B9%EB%B3%84%EC%9E%90%EC%B9%98%EC%8B%9C%20%EC%97%B0%EC%B2%AD%EB%A1%9C%201161" target="_blank" rel="noopener">네이버 지도에서 보기</a>
        <a class="btn btn-neutral btn-sm" href="https://map.naver.com/p/directions/-/-/-/transit?c=15.00,0,0,0,dh&destination=%EC%84%B8%EC%A2%85%ED%8A%B9%EB%B3%84%EC%9E%90%EC%B9%98%EC%8B%9C%20%EC%97%B0%EC%B2%AD%EB%A1%9C%201161" target="_blank" rel="noopener">길찾기</a>
      </div>
      <script>
        (function () {
          var NAVER_MAP_CLIENT_ID = "YOUR_NCP_CLIENT_ID"; /* 네이버 클라우드 플랫폼 > Maps > 인증정보의 Client ID 를 입력 */
          var ADDRESS = "세종특별자치시 연청로 1161";
          var el = document.getElementById("naverMap");
          if (!el) return;
          if (!NAVER_MAP_CLIENT_ID || NAVER_MAP_CLIENT_ID === "YOUR_NCP_CLIENT_ID") {
            el.classList.add("naver-map--ph");
            el.innerHTML = '<div class="map-ph"><strong>세종특별자치시 연청로 1161, 2F</strong><span>네이버 지도 표시를 위해 Client ID 설정이 필요합니다. 위 “네이버 지도에서 보기”로 확인하세요.</span></div>';
            return;
          }
          var s = document.createElement("script");
          s.src = "https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=" + NAVER_MAP_CLIENT_ID + "&submodules=geocoder";
          s.onload = function () {
            var map = new naver.maps.Map(el, { zoom: 16, center: new naver.maps.LatLng(36.4808, 127.2890) });
            if (naver.maps.Service && naver.maps.Service.geocode) {
              naver.maps.Service.geocode({ query: ADDRESS }, function (status, response) {
                if (status === naver.maps.Service.Status.OK && response.v2.addresses && response.v2.addresses.length) {
                  var item = response.v2.addresses[0];
                  var ll = new naver.maps.LatLng(item.y, item.x);
                  map.setCenter(ll);
                  new naver.maps.Marker({ position: ll, map: map });
                }
              });
            }
          };
          document.head.appendChild(s);
        })();
      </script>
    `,
  },

  // ===== 약관/정책 =====
  terms: {
    group: "policy", title: "이용약관", en: "TERMS OF USE",
    html: `
      <p class="page-note">본 약관은 사단법인 도시공동체본부(이하 "본부")가 제공하는 웹사이트 및 서비스의 이용조건을 규정합니다. 실제 시행 전 법률 검토가 필요합니다.</p>
      <h3 class="page-h">제1조 (목적)</h3>
      <p>이 약관은 본부가 제공하는 서비스의 이용과 관련하여 본부와 이용자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>
      <h3 class="page-h">제2조 (약관의 효력 및 변경)</h3>
      <p>본 약관은 서비스 화면에 게시함으로써 효력이 발생하며, 관련 법령을 위배하지 않는 범위에서 개정될 수 있습니다. 개정 시 적용일자와 사유를 명시하여 사전 공지합니다.</p>
      <h3 class="page-h">제3조 (이용자의 의무)</h3>
      <p>이용자는 관계 법령, 본 약관의 규정, 이용안내 및 서비스상에 공지한 주의사항을 준수하여야 하며, 본부의 업무에 방해되는 행위를 하여서는 안 됩니다.</p>
      <h3 class="page-h">제4조 (게시물의 관리)</h3>
      <p>이용자가 게시한 게시물이 관련 법령에 위반되거나 타인의 권리를 침해하는 경우 본부는 사전 통지 없이 삭제하거나 이용을 제한할 수 있습니다.</p>
      <h3 class="page-h">제5조 (책임의 제한)</h3>
      <p>본부는 천재지변, 이용자의 귀책사유 등 불가항력으로 인하여 서비스를 제공할 수 없는 경우 책임이 면제됩니다.</p>
    `,
  },
  privacy: {
    group: "policy", title: "개인정보보호정책", en: "PRIVACY POLICY",
    html: `
      <p class="page-note">사단법인 도시공동체본부는 「개인정보 보호법」을 준수하며, 이용자의 개인정보를 보호합니다. 아래는 표준 템플릿이며 실제 시행 전 법률 검토가 필요합니다.</p>
      <h3 class="page-h">1. 수집하는 개인정보 항목</h3>
      <p>회원가입·문의 시 이름, 이메일, 연락처 등을 수집할 수 있으며, 서비스 이용 과정에서 접속기록 등이 자동 생성·수집될 수 있습니다.</p>
      <h3 class="page-h">2. 개인정보의 수집·이용 목적</h3>
      <p>회원 관리, 문의 응대, 서비스 제공 및 개선, 법령상 의무 이행을 위해 이용합니다.</p>
      <h3 class="page-h">3. 개인정보의 보유 및 이용 기간</h3>
      <p>원칙적으로 수집·이용 목적이 달성되면 지체 없이 파기하며, 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.</p>
      <h3 class="page-h">4. 개인정보의 제3자 제공</h3>
      <p>본부는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않으며, 법령에 근거가 있는 경우에 한하여 제공합니다.</p>
      <h3 class="page-h">5. 이용자의 권리</h3>
      <p>이용자는 언제든지 자신의 개인정보에 대한 열람·정정·삭제·처리정지를 요청할 수 있습니다.</p>
      <h3 class="page-h">6. 개인정보 보호책임자</h3>
      <p>개인정보 보호책임자: 담당자 미정 / 문의: contact@ucc.or.kr</p>
    `,
  },
  "no-email": {
    group: "policy", title: "이메일무단수집거부", en: "NO EMAIL COLLECTION",
    html: `
      <p class="lead">본 웹사이트에 게시된 이메일 주소가 전자우편 수집 프로그램이나 그 밖의 기술적 장치를 이용하여 무단으로 수집되는 것을 거부합니다.</p>
      <p>이를 위반 시 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」에 의해 형사처벌됨을 유념하시기 바랍니다.</p>
      <p class="page-note">게시일: 2026년</p>
    `,
  },

  // ===== 배움터 =====
  courses: {
    group: "learn", title: "주요과정소개", en: "KEY COURSES",
    html: `
      <p class="lead">도시공동체본부는 전 생애 평생교육 관점에서 도시·공동체 혁신을 이끄는 전문 인재를 양성합니다.</p>
      <div class="page-cards">
        <div class="page-card">
          <h3>ESG 교육</h3>
          <p>ESG·지속가능경영의 이해부터 도시·공동체 적용까지. 지속가능도시 표준·인증체계, ESG 진단·컨설팅 실무를 다루는 전문가 과정입니다.</p>
          <ul class="page-list">
            <li>대상: 기업·기관 실무자, 활동가, 시민</li>
            <li>내용: ESG 개념·지표, 도시 지속가능성 진단, 사례 실습</li>
          </ul>
        </div>
        <div class="page-card">
          <h3>지역발전혁신가 (Regional Development Catalyst)</h3>
          <p>지역회복을 진단부터 자립까지 설계·실행하는 현장 전문가(RDC)를 양성합니다. 리빙랩 기반 실습과 단계별 학습 체계로 운영됩니다.</p>
          <ul class="page-list">
            <li>대상: 주민 리더, 정책 생산자, 지역 활동가</li>
            <li>내용: 회복력 진단, 표준 프로그램, 현장 실증, 자립·이양</li>
          </ul>
        </div>
      </div>
      <p class="page-note">각 과정의 세부 일정은 <a href="/learn/calendar">연간교육일정</a>에서, 신청은 <a href="/learn/apply">교육신청하기</a>에서 확인하세요.</p>
    `,
  },
  esg: {
    group: "learn", title: "ESG전문가과정", en: "ESG PROFESSIONAL",
    html: `
      <p class="lead">ESG·지속가능경영의 개념부터 <strong>평가·인증·보고서 공시 실무</strong>까지, 도시와 공동체에 적용하는 전문가를 양성합니다.</p>

      <h3 class="page-h">과정 개요</h3>
      <p>국내외 ESG 동향과 공시 규제를 이해하고, ESG 평가·지표 체계와 진단 방법론을 익혀 기업·기관·지역의 지속가능성 과제를 직접 설계·수행할 수 있는 역량을 기릅니다.</p>

      <h3 class="page-h">교육 대상</h3>
      <ul class="page-list">
        <li>기업·기관 ESG·지속가능경영 담당자</li>
        <li>도시재생·사회적경제·공동체 분야 실무자</li>
        <li>ESG 진단·컨설팅·보고서 공시에 관심 있는 시민</li>
      </ul>

      <h3 class="page-h">주요 커리큘럼</h3>
      <div class="page-cards page-cards--3">
        <div class="page-card"><h3>1. ESG 기초·동향</h3><p>E·S·G 개념, 국내외 규제·공시 의무화 흐름, 이해관계자 자본주의</p></div>
        <div class="page-card"><h3>2. 평가·지표 체계</h3><p>K-ESG·GRI 등 주요 프레임워크와 평가기관·등급 이해</p></div>
        <div class="page-card"><h3>3. 도시·공동체 진단</h3><p>지역 지속가능성 지표, 회복력 진단, 데이터 기반 분석</p></div>
        <div class="page-card"><h3>4. 보고서 공시 실무</h3><p>ESG 보고서 기획·작성, 중대성 평가, 공시 프로세스</p></div>
        <div class="page-card"><h3>5. 컨설팅 실습</h3><p>사례 분석과 팀 프로젝트로 실제 진단·개선안 도출</p></div>
        <div class="page-card"><h3>6. 인증·수료</h3><p>과정 평가 및 수료, 전문가 네트워크 연계</p></div>
      </div>

      <h3 class="page-h">수료 후 활용</h3>
      <ul class="page-list">
        <li>기업·기관 ESG 담당, ESG 진단·컨설팅 실무</li>
        <li>ESG 보고서 작성·공시 지원</li>
        <li>지역·공동체 지속가능성 프로젝트 참여</li>
      </ul>

      <p class="page-note">세부 일정은 <a href="/learn/calendar">연간교육일정</a>에서, 신청은 <a href="/learn/apply">교육신청하기</a>에서 확인하세요. ※ 커리큘럼은 운영 상황에 따라 조정될 수 있습니다.</p>
    `,
  },
  rdc: {
    group: "learn", title: "지역개발전문가과정", en: "RDC PROFESSIONAL",
    html: `
      <p class="lead">지역회복을 <strong>진단부터 자립까지</strong> 설계·실행하는 현장 전문가, <strong>지역발전혁신가(RDC)</strong>를 양성합니다.</p>

      <h3 class="page-h">과정 개요</h3>
      <p>리빙랩(Living Lab) 기반의 단계별 학습 체계로, 지역 자원을 조사하고 문제를 정의하여 표준 프로그램을 설계·실증하고, 지역이 스스로 설 수 있도록 자립·이양까지 이끄는 실무 역량을 기릅니다.</p>

      <h3 class="page-h">교육 대상</h3>
      <ul class="page-list">
        <li>주민 리더·마을공동체 활동가</li>
        <li>지자체·공공기관 정책 담당자</li>
        <li>지역혁신·사회적경제 분야 종사자</li>
      </ul>

      <h3 class="page-h">주요 커리큘럼</h3>
      <div class="page-cards page-cards--3">
        <div class="page-card"><h3>1. 지역진단·회복력</h3><p>인구·경제·공동체 진단, 회복탄력성 개념과 지표</p></div>
        <div class="page-card"><h3>2. 리빙랩 방법론</h3><p>주민참여형 문제해결, 현장 실험 설계와 운영</p></div>
        <div class="page-card"><h3>3. 자원조사·문제정의</h3><p>지역자원 매핑, 이해관계자 분석, 과제 도출</p></div>
        <div class="page-card"><h3>4. 표준 프로그램 설계</h3><p>지역회복 표준체계 적용, 실증(파일럿) 운영</p></div>
        <div class="page-card"><h3>5. 자립·이양</h3><p>운영모델·거버넌스 구축, 성과관리와 이양</p></div>
        <div class="page-card"><h3>6. 수료·네트워크</h3><p>프로젝트 발표·수료, RDC 전문가 네트워크 연계</p></div>
      </div>

      <h3 class="page-h">수료 후 활용</h3>
      <ul class="page-list">
        <li>지역혁신전문가(RDC)·마을 코디네이터</li>
        <li>지역재생·공동체 사업 기획·운영</li>
        <li>정책 자문 및 리빙랩 퍼실리테이터</li>
      </ul>

      <p class="page-note">세부 일정은 <a href="/learn/calendar">연간교육일정</a>에서, 신청은 <a href="/learn/apply">교육신청하기</a>에서 확인하세요. ※ 커리큘럼은 운영 상황에 따라 조정될 수 있습니다.</p>
    `,
  },
  open: {
    group: "learn", title: "교육과정개설", en: "COURSE OPENING",
    html: `
      <p class="lead">아래 과정이 개설·운영되고 있습니다. 관심 있는 과정은 신청 페이지에서 접수해 주세요.</p>
      <ul class="page-list">
        <li><strong>ESG 전문가 과정</strong> — 지속가능경영·도시 지속가능성 (연 2~3회)</li>
        <li><strong>지역발전혁신가(RDC) 양성 과정</strong> — 리빙랩 기반 현장 실습 (연 2회)</li>
        <li><strong>시민 도시대학</strong> — 시민 대상 공개 강좌 (상시)</li>
        <li><strong>공동체리더 과정</strong> — 주민·활동가 역량강화 (분기별)</li>
      </ul>
      <p style="margin-top:22px"><a class="btn btn-primary" href="/learn/apply">교육 신청하기</a></p>
      <p class="page-note">신규 과정 개설 문의: contact@ucc.or.kr</p>
    `,
  },

  // ===== 함께하는사람들 =====
  regular: {
    group: "members", title: "정회원", en: "REGULAR MEMBER",
    html: `
      <p class="lead">정회원은 도시공동체본부의 활동에 직접 참여하고 의사결정에 함께하는 핵심 구성원입니다.</p>
      <div class="page-cards">
        <div class="page-card"><h3>개인회원</h3><p>개인 자격으로 가입하여 총회 참여, 교육·행사 우대 등의 권리를 갖습니다.</p><p><a href="/members/individual">자세히 보기 →</a></p></div>
        <div class="page-card"><h3>기업·단체회원</h3><p>기업·기관·단체 자격으로 가입하여 협력사업과 네트워크에 참여합니다.</p><p><a href="/members/corporate">자세히 보기 →</a></p></div>
      </div>
      <p style="margin-top:22px"><a class="btn btn-primary" href="/signup">회원가입</a></p>
    `,
  },
  individual: {
    group: "members", title: "개인회원", en: "INDIVIDUAL MEMBER",
    html: `
      <p class="lead">개인 자격으로 가입하는 정회원입니다.</p>
      <ul class="page-list">
        <li><strong>자격</strong> 본부의 설립 취지에 동의하는 개인</li>
        <li><strong>회비</strong> 입회비 1만원(가입 시 1회) · 연회비 1만원(익년도부터)</li>
        <li><strong>권리</strong> 정기총회 의결권, 교육·행사 우대, 전문가 풀 등록 자격, 소식·자료 우선 제공</li>
        <li><strong>의무</strong> 정관 준수, 연회비 납부(미납 시 준회원 전환)</li>
      </ul>
      <p style="margin-top:22px"><a class="btn btn-primary" href="/signup">개인회원 가입 · 혜택 전체보기</a></p>
    `,
  },
  corporate: {
    group: "members", title: "기업·단체회원", en: "CORPORATE MEMBER",
    html: `
      <p class="lead">기업·기관·단체 자격으로 가입하는 정회원입니다.</p>
      <ul class="page-list">
        <li><strong>자격</strong> 본부의 목적에 공감하는 기업·공공기관·비영리단체·사회적기업·협동조합</li>
        <li><strong>회비</strong> 기업회원 입회비·연회비 각 30만원(익년도부터) · 단체회원 현재 무료(익년도부터 유료, 이사회 결정)</li>
        <li><strong>권리</strong> 대표 1인 의결권, 협력사업 우선 참여, 공동 프로젝트·네트워크, 브랜드 협력</li>
        <li><strong>추가 혜택</strong> ESG 진단 무료(기업), 직원 교육 단체 할인, 파트너 기관 소개 게시 등</li>
      </ul>
      <p style="margin-top:22px"><a class="btn btn-primary" href="/signup">기업·단체회원 가입 · 혜택 전체보기</a></p>
    `,
  },
  associate: {
    group: "members", title: "준회원", en: "ASSOCIATE MEMBER",
    html: `
      <p class="lead">준회원은 본부의 활동에 관심을 갖고 참여하는 회원으로, 의결권을 제외한 대부분의 혜택을 누립니다.</p>
      <ul class="page-list">
        <li><strong>자격</strong> 본부 활동에 참여를 희망하는 개인·단체</li>
        <li><strong>권리</strong> 교육·행사 참가, 소식·자료 제공</li>
        <li><strong>전환</strong> 일정 요건 충족 시 정회원 전환 가능</li>
      </ul>
      <p style="margin-top:22px"><a class="btn btn-primary" href="/signup">준회원 가입</a></p>
    `,
  },
};

module.exports = { PAGES };
