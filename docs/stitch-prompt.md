# Stitch 프롬프트

CPAPING 웹사이트(Phase 2) 디자인을 Stitch로 뽑기 위한 프롬프트.
확정된 톤은 **툴형** — 산세리프, 촘촘한 밀도, 마감일 강조, 라이트 온리.

프롬프트를 영어로 쓰는 이유는 Stitch가 영어 지시에 더 안정적으로 반응하기
때문이다. **화면에 들어갈 문구는 한국어 그대로** 넣어야 서체와 줄바꿈이
실제와 맞게 나온다.

---

## 1. 메인 프롬프트 (랜딩 페이지)

```
Design a single-page landing page for "CPAPING", a Korean service that emails
accounting-firm job alerts to CPA exam graduates. Light mode only. Mobile-first,
but design the desktop layout too (max content width 720px, centered).

TONE
Utility tool, not a marketing site. Dense, scannable, quiet. Think of an internal
dashboard rather than a startup landing page. No hero image, no illustration,
no gradient, no rounded card stacks, no emoji. Hairline borders and generous
type hierarchy do all the work.

DESIGN TOKENS — use these exact values
  text primary      #101317
  text secondary    #5B6472
  text tertiary     #868D99
  border            #E4E6EA
  border light      #EDEFF2
  surface           #FFFFFF
  surface subtle    #FBFBFC
  row hover         #F7F9FC
  accent (buttons)  #123A8A
  urgent (deadline) #B4341F
  status dot        #17A05F
  chip default      background #EEF1F6, text #4A5462
  chip part-time    background #FBF0E4, text #8A5A19
  border radius     4px maximum, never more
  font              IBM Plex Sans KR (fallback: Pretendard, system sans)

LAYOUT — four stacked sections, full width, separated by 1px #E4E6EA lines

1. TOP BAR (compact, 44px tall, background #FBFBFC)
   Left: wordmark "CPAPING", 13.5px, weight 600, letter-spacing -0.01em
   Right: a 6px green dot (#17A05F) followed by "10분마다 확인 중" in 11px #5B6472

2. HERO (padding 24px 18px 20px)
   Headline "회계법인 수습 공고를 놓치지 마세요" — 19px, weight 600,
     letter-spacing -0.02em, line-height 1.45
   Subline "한국공인회계사회에 새 공고가 올라오면 메일로 알려드립니다." —
     13px, #5B6472
   Email form directly below: a single joined control — text input
     (placeholder "이메일 주소") flush against a solid #123A8A button labeled
     "구독". Input has 1px #CFD3DA border, radius 4px on the left only;
     button has radius 4px on the right only. They share one line, no gap.
   Below the form: "언제든 한 번의 클릭으로 해지" in 11.5px #868D99

3. LIST HEADER (padding 14px 18px 9px)
   Left: "지원 가능한 공고" in 13px weight 600
   Right: "14건 · 마감 임박순" in 12px #5B6472

4. POSTING ROWS — a vertical list, NOT cards. Rows are separated by 1px
   #EDEFF2 top borders and have no shadow, no background, no rounded corners.
   Each row is a two-column grid: content on the left, deadline on the right.
   Row padding 12px 18px. On hover the whole row background becomes #F7F9FC.

   Left column, three stacked lines:
     - company name, 11.5px, #5B6472
     - posting title, 13.5px, weight 500, line-height 1.45
     - a row of small chips (region, employment type), 10.5px, radius 3px,
       padding 1.5px 7px

   Right column, right-aligned, tabular numerals:
     - D-day, 12px weight 500 (example "D-7")
     - below it the date in 10.5px #868D99 (example "09.06")
     - when the deadline is within 7 days, D-day turns #B4341F and the date
       turns #C4705F

   Use these five real postings in this order:
     1) 세영회계법인 / 수습회계사 모집 / 대구 · 파트타임 / D-1 · 08.31
     2) 성현회계법인 / BDO성현회계법인 2026 신입 공인회계사 공채 /
        지역무관 · 정규직 / D-5 · 09.04
     3) 새빛회계법인 / Forvis Mazars 새빛회계법인 2026년 신입 공인회계사 모집 /
        서울 용산구 · 정규직 / D-7 · 09.06
     4) 동현회계법인 / 수습회계사 채용 — 국제조세부문 / 서울 · 정규직 /
        D-8 · 09.07
     5) 동성회계법인 / 동성회계법인 수습 회계사 채용 / 지역무관 · 정규직 /
        D-31 · 09.30

   The "파트타임" chip uses the part-time chip colors; all other chips use
   the default chip colors.

5. FOOTER
   A last row reading "외 9건 더 보기" in 12.5px #5B6472, then a thin footer
   with "CPAPING · 한국공인회계사회 공고를 수집합니다" in 11.5px #868D99.

RULES
- Every posting links out; no detail page in this design.
- Do not add search, login, navigation menu, hero image, testimonials,
  feature grid, pricing, or a second call-to-action block.
- Keep all Korean text exactly as written above.
```

---

## 2. 후속 프롬프트

메인이 나온 뒤 같은 대화에서 이어서 요청한다. 톤 유지가 목적이므로
"same design system, same tokens" 를 반복해서 붙인다.

### 구독 완료 상태

```
Same design system and tokens. Show the state right after someone subscribes:
the email form is replaced in place by a single line — a small check mark
followed by "구독되었습니다. 새 공고가 올라오면 메일로 알려드립니다." in 13px
#101317, and below it "ohshsh00@gmail.com" in 11.5px #868D99 with a text link
"변경" beside it. Everything else on the page is unchanged.
```

### 공고 없는 상태

```
Same design system and tokens. Show the empty state for the posting list:
the list header reads "지원 가능한 공고" with "0건" on the right, and in place
of the rows there is a single centered block with "지금은 열린 공고가 없습니다"
in 13.5px #101317 and "새 공고가 올라오면 바로 알려드릴게요" in 12px #5B6472.
Keep the vertical space modest — about 120px tall. No illustration.
```

### 알림 메일 템플릿

```
Same design system and tokens, but as an HTML email, 600px wide, centered on a
#F4F5F7 background with a white content card. Subject line shown at top:
"[CPAPING] 신규 수습회계사 공고 3건". Content: a small "새로 올라온 공고 3건"
label, then the same posting rows as the website (company name, title, chips,
D-day), each with a "공고 보기 →" text link in #123A8A. Footer with
"CPAPING" and an unsubscribe link "수신 거부" in 11px #868D99.
Use table-based layout and inline styles so it renders in Gmail.
```

---

## 3. Stitch 결과를 받은 뒤

Stitch는 HTML + Tailwind를 뱉는다. Phase 2에서 Next.js로 옮길 때:

- 색은 하드코딩된 hex 대신 `tailwind.config` 의 토큰으로 옮긴다
- 공고 행은 `PostingRow` 컴포넌트로 분리하고 Supabase 데이터를 매핑한다
- D-day는 정적 텍스트로 나오므로 `deadline` 에서 계산하도록 바꾼다
- `IBM Plex Sans KR` 은 `next/font/google` 로 로드한다

---

## 참고 — 시안 비교

세 가지 톤(문서형/툴형/뉴스레터형)을 실제 공고 데이터로 비교한 시안:
https://claude.ai/code/artifact/824fd997-161e-4e87-a104-a0e356e67423
