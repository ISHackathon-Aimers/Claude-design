# AIMers+ 요금제 설정

월간 2,990원, 연간 29,900원이다. 연간 요금은 월간 12회 대비 5,980원 저렴하다.

## 적용

Supabase SQL Editor에서 기존 001, 002, 003 마이그레이션 적용 후 `supabase/migrations/202611080004_premium_membership.sql`을 실행한다. 이 마이그레이션은 기존 기록이나 그룹을 삭제하지 않는다. 배포 전에 적용해야 한다. 누락되면 무료 기록 기능은 유지되지만 요금제 조회와 AIMers+ 사용은 실패한다.

무료 사용자는 기록 작성, AI 기록 정리, 그룹을 이용한다. 프리미엄 사용자는 면접 질문과 평가, 자소서 경험 검색, 성장 인사이트를 추가로 이용한다. 서버는 각 프리미엄 AI 요청마다 DB의 이용 권한과 종료 시각을 검사한다. 프로필이나 브라우저 저장소를 수정해서 유료 권한을 얻을 수 없다. 이전에 생성한 자신의 AI 활동은 무료 전환 후에도 보관되며, 프로필의 내 데이터 내보내기로 확인할 수 있다.

## 현재 결제 범위

포트원 V2 일반 카드 결제로 1개월 또는 1년 이용권을 구매한다. 설정 전에는 준비 중 안내를 표시하고 결제를 진행하지 않는다. 계약 후 설정은 [포트원 결제 설정](portone-payments.md)을 따른다.

관리자 이용권과 결제 이용권은 종료 시각까지 유효하다. 정기 청구를 생성하지 않으며 프로필에는 이용 기간을 표시한다. 이전 해지 예약 API는 이용권 변경을 수행하지 않는다.

서버가 포트원 API로 결제를 조회하고 주문과 대조한 뒤 이용권을 반영한다. 웹훅은 서명 검증 후 최신 상태를 조회한다. 전액 취소는 이용권에서 제외하며 중복 확인은 기간을 늘리지 않는다.

## 시연용 권한 부여

Supabase Authentication의 Users에서 대상 계정 UUID를 확인한다. 관리 권한이 있는 SQL Editor에서 아래 UUID를 실제 대상 계정으로 바꾸고 실행한다. 사용자에게 서비스 키를 전달하지 않는다. 이미 이용권이 있는 계정에 실행하면 기간을 새로 설정한다.

```sql
insert into public.app_subscriptions (user_id, plan, current_period_start, current_period_end, cancel_at_period_end)
values ('대상-사용자-UUID'::uuid, 'monthly', now(), now() + interval '1 month', false)
on conflict (user_id) do update set
  plan = excluded.plan,
  current_period_start = excluded.current_period_start,
  current_period_end = excluded.current_period_end,
  cancel_at_period_end = false,
  updated_at = now();
```

연간 시연은 `monthly`를 `annual`로, `interval '1 month'`를 `interval '1 year'`로 바꾼다. 프로필의 요금제 새로 확인하기를 누르면 반영된다. 일반 사용자는 테이블에 직접 접근할 수 없고 자신의 요금제 조회 RPC만 사용할 수 있다.

## 이메일로 특정 사용자에게 부여

아래 SQL은 가입한 계정이 있는지 검사하고 해당 계정에만 월간 이용권을 부여한다. 실제 대상 이메일로 교체하고 Supabase SQL Editor에서 실행한다. 이메일이 없으면 오류로 중단된다. 이 쿼리를 다시 실행하면 이용 기간이 실행 시점부터 다시 설정된다.

```sql
do $$
declare target_id uuid;
begin
  select id into strict target_id from auth.users
    where lower(email) = lower('대상자@example.com');
  insert into public.app_subscriptions
    (user_id, plan, current_period_start, current_period_end, cancel_at_period_end)
  values (target_id, 'monthly', now(), now() + interval '1 month', false)
  on conflict (user_id) do update set
    plan = excluded.plan,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = false,
    updated_at = now();
end;
$$;
```

연간 이용권은 위와 같이 `annual`과 `interval '1 year'`로 바꾼다. 관리자 이용권을 회수할 때는 아래 SQL의 이메일을 교체한다. 결제 이용권은 이 SQL로 제거되지 않으며 포트원에서 취소해야 한다. 기존 기록과 AI 활동은 삭제하지 않는다.

```sql
delete from public.app_subscriptions
where user_id = (select id from auth.users where lower(email) = lower('대상자@example.com'));
```
