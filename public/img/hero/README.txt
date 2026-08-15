======================================================================
 메인화면 실사 인물 이미지 넣는 방법  (사단법인 도시공동체본부)
======================================================================

이 폴더(public/img/hero/)에 아래 이름으로 인물 이미지를 넣으면
메인화면 하단에 자동으로 배치됩니다. 파일이 있으면 실사 인물이 뜨고,
없으면 기존 벡터 장면이 유지됩니다.

■ 파일 이름 (넣은 것만 표시됨 — 전부 채우지 않아도 됨)
  person-1.png   ← 한국인 여성 (스마트 캐주얼)
  person-2.png   ← 한국인 남성 (키 큰 편)
  person-3.png   ← 다문화 여성 (예: 히잡/전통복 등 다양성)
  person-4.png   ← 어린이
  person-5.png   ← 외국인 남성 (다양한 인종)
  person-6.png   ← 여성 (밝은 표정)
  person-7.png   ← 어르신 (흰머리)
  * person-8.png, person-9.png 를 추가하면 슬롯도 늘려 드립니다.

■ 이미지 규격 (중요)
  - 형식: PNG, 배경 '투명' (누끼 딴 상태)
  - 구도: 전신 서 있는 모습, 정면~약간 측면, 발끝까지 보이게
  - 크기: 세로 약 1000~1600px (세로가 길수록 선명)
  - 조명: 균일한 스튜디오 조명, 그림자 최소
  - 피사체가 프레임 가운데, 좌우 여백 최소

■ AI 생성 프롬프트 예시 (영문 그대로 넣어 사용)
  "full body studio photo of a Korean woman in her 30s, smart casual
   clothing, standing, natural friendly smile, front view, even soft
   lighting, plain white background, photorealistic, high detail,
   full figure visible head to feet"
  → 인종/나이/복장만 바꿔 7컷 생성:
     1) Korean woman, 30s, smart casual
     2) Korean man, 40s, business casual, tall
     3) Middle Eastern woman with hijab, warm smile
     4) young child, 8 years old, casual, cheerful
     5) Black man, 30s, casual jacket
     6) Southeast Asian woman, 20s, bright dress
     7) elderly Korean man, 70s, grey hair, cardigan

  ※ 배경을 흰색으로 생성한 뒤, 투명 배경(누끼)으로 만들려면:
     - 이미지 생성 도구의 '투명 배경' 옵션 사용, 또는
     - remove.bg, Photoshop, Canva 등으로 배경 제거 후 PNG 저장

■ 넣은 뒤
  브라우저에서 새로고침(Ctrl+F5)하면 바로 반영됩니다.
  위치·크기 미세 조정이 필요하면 담당(개발)에게 요청하세요.
======================================================================
