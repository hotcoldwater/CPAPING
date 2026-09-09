# Supabase 인증 메일 템플릿 (한국어)

Supabase Auth 가 자동으로 보내는 세 통의 문안이다. 코드 배포와 무관하며 **Supabase 대시보드에서
붙여 넣어야 적용된다** — 대시보드 → Authentication → Emails → Templates (예전 화면은 Email Templates).
각 템플릿의 **Subject heading** 에 제목을, **Message body** 의 `<> Source` 탭에 HTML 을 붙이고 Save.

- `{{ .ConfirmationURL }}` `{{ .NewEmail }}` 같은 중괄호 변수는 그대로 두어야 링크와 주소가 들어간다.
- 링크는 코드가 넘긴 주소로 돌아온다: 가입 확인·이메일 변경 → `/auth/callback/`,
  비밀번호 재설정 → `/auth/callback/?next=recovery` → `/account/?recovery=1`.
- Magic Link · Invite user · Reauthentication 템플릿은 쓰지 않으므로 손대지 않는다.
- 발신자 이름·주소는 Authentication → SMTP Settings 의 Sender 값을 따른다 (`CPAPING` / `noreply@cpaping.com`).

---

## 1. Confirm signup — 이메일 가입 직후

**Subject heading**

```
[CPAPING] 이메일 주소를 확인해 주세요
```

**Message body**

```html
<div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:15px;line-height:1.7;color:#1F2933">
  <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.04em;color:#6B7280">CPAPING</p>
  <h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;color:#111827">이메일 주소를 확인해 주세요</h1>
  <p style="margin:0 0 14px">CPAPING 에 가입해 주셔서 고맙습니다. 아래 버튼을 누르면 이메일 확인이 끝나고, 닉네임을 정하는 화면으로 이어집니다.</p>
  <p style="margin:24px 0">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 22px;background:#1B2A4A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-weight:600">이메일 확인하기</a>
  </p>
  <p style="margin:0 0 14px;font-size:13px;color:#4B5563">버튼이 눌리지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.<br>
    <a href="{{ .ConfirmationURL }}" style="color:#1B2A4A;word-break:break-all">{{ .ConfirmationURL }}</a></p>
  <p style="margin:0 0 14px;font-size:13px;color:#4B5563">링크는 일정 시간이 지나면 만료됩니다. 만료되면 로그인 화면에서 확인 메일을 다시 요청할 수 있습니다.</p>
  <p style="margin:0 0 14px;font-size:13px;color:#4B5563">직접 가입한 것이 아니라면 이 메일은 무시해 주세요. 확인하지 않으면 계정이 만들어지지 않습니다.</p>
  <hr style="border:0;border-top:1px solid #E5E7EB;margin:24px 0">
  <p style="margin:0;font-size:12px;color:#6B7280">CPAPING · 수습 공인회계사 채용 공고 알림 · <a href="https://cpaping.com" style="color:#6B7280">cpaping.com</a><br>
    문의 <a href="mailto:contact@cpaping.com" style="color:#6B7280">contact@cpaping.com</a></p>
</div>
```

---

## 2. Change Email Address — 계정에 이메일을 새로 넣거나 바꿀 때

**Subject heading**

```
[CPAPING] 계정 이메일 변경을 확인해 주세요
```

**Message body**

```html
<div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:15px;line-height:1.7;color:#1F2933">
  <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.04em;color:#6B7280">CPAPING</p>
  <h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;color:#111827">계정 이메일 변경을 확인해 주세요</h1>
  <p style="margin:0 0 14px">CPAPING 계정의 이메일을 <b>{{ .NewEmail }}</b> 로 설정하려는 요청입니다. 아래 버튼을 누르면 변경이 완료됩니다.</p>
  <p style="margin:24px 0">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 22px;background:#1B2A4A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-weight:600">이메일 변경 확인</a>
  </p>
  <p style="margin:0 0 14px;font-size:13px;color:#4B5563">버튼이 눌리지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.<br>
    <a href="{{ .ConfirmationURL }}" style="color:#1B2A4A;word-break:break-all">{{ .ConfirmationURL }}</a></p>
  <p style="margin:0 0 14px;font-size:13px;color:#4B5563">본인이 요청한 것이 아니라면 이 메일을 무시해 주세요. 확인하지 않으면 아무것도 바뀌지 않습니다. 이상하다고 느껴지면 <a href="mailto:contact@cpaping.com" style="color:#1B2A4A">contact@cpaping.com</a> 으로 알려 주세요.</p>
  <hr style="border:0;border-top:1px solid #E5E7EB;margin:24px 0">
  <p style="margin:0;font-size:12px;color:#6B7280">CPAPING · <a href="https://cpaping.com" style="color:#6B7280">cpaping.com</a> · 문의 <a href="mailto:contact@cpaping.com" style="color:#6B7280">contact@cpaping.com</a></p>
</div>
```

---

## 3. Reset Password — "비밀번호를 잊었어요"

**Subject heading**

```
[CPAPING] 비밀번호 재설정 링크입니다
```

**Message body**

```html
<div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:15px;line-height:1.7;color:#1F2933">
  <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.04em;color:#6B7280">CPAPING</p>
  <h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;color:#111827">비밀번호를 다시 설정해 주세요</h1>
  <p style="margin:0 0 14px">CPAPING 계정의 비밀번호 재설정 요청을 받았습니다. 아래 버튼을 누르면 새 비밀번호를 정하는 화면으로 이동합니다.</p>
  <p style="margin:24px 0">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 22px;background:#1B2A4A;color:#FFFFFF;text-decoration:none;border-radius:8px;font-weight:600">새 비밀번호 정하기</a>
  </p>
  <p style="margin:0 0 14px;font-size:13px;color:#4B5563">버튼이 눌리지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.<br>
    <a href="{{ .ConfirmationURL }}" style="color:#1B2A4A;word-break:break-all">{{ .ConfirmationURL }}</a></p>
  <p style="margin:0 0 14px;font-size:13px;color:#4B5563">링크는 일정 시간이 지나면 만료됩니다. 만료되면 로그인 화면에서 다시 요청해 주세요.</p>
  <p style="margin:0 0 14px;font-size:13px;color:#4B5563">요청한 적이 없다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않습니다.</p>
  <hr style="border:0;border-top:1px solid #E5E7EB;margin:24px 0">
  <p style="margin:0;font-size:12px;color:#6B7280">CPAPING · <a href="https://cpaping.com" style="color:#6B7280">cpaping.com</a> · 문의 <a href="mailto:contact@cpaping.com" style="color:#6B7280">contact@cpaping.com</a></p>
</div>
```

---

## 적용 뒤 확인

1. `/login/` → 가입 탭 → 본인이 받아볼 수 있는 다른 메일 주소로 가입 → 한국어 확인 메일 → 버튼 → 닉네임 화면.
   시험 계정은 `/account/` 의 탈퇴로 지운다.
2. `/login/` → 비밀번호를 잊었어요 → 재설정 메일 → 버튼 → `/account/?recovery=1` 에서 새 비밀번호.
3. 메일이 안 오면 Supabase → Authentication → Rate Limits 의 "sending emails" 값을 본다.
   커스텀 SMTP 기본값은 시간당 수십 통으로 낮게 잡혀 있어 홍보 시기에는 올려 둘 필요가 있다.
4. 재설정 링크가 콜백에서 튕기면 Authentication → URL Configuration → Redirect URLs 에
   `https://cpaping.com/auth/callback/**` 가 있는지 본다 (`?next=recovery` 처럼 쿼리가 붙은 주소를 허용).
