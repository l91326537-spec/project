'use strict';
/*
 * 소리길 광고 자리: 홈 화면에만 둔다. 학습 지도와 문제를 듣고 푸는 화면에는 넣지 않는다.
 * - 휴대폰: 홈 첫 화면을 다 내려야 보이는 맨 끝의 카드 한 장
 * - 데스크톱(가로 900px 이상): 탭 바로 위에 붙는 띠 배너(728×90 자리)
 * - X를 누르면 오늘 하루 숨긴다. 기록(data)과 따로 저장해 선생님에게 보내는 기록에 섞이지 않게 한다.
 * - 청각 관련 광고만 받는다(인공와우, 보청기, 생활 보조기기). 사용자 유형에 맞는 것을 기기 안에서 고르고, 밖으로 보내는 정보는 없다.
 * - 소리 나는 광고·움직이는 광고·전면 광고는 받지 않는다. 듣기 연습을 방해하기 때문이다.
 * 지금은 광고 네트워크 없이 시연용 예시 광고를 보여 준다.
 */
const AD_OFF_KEY = 'sorigil.adOff'; // 광고를 숨긴 날짜
const CI_USERS = ['ci', 'kid', 'ear2'];
const ADS = [
  { id: 'ci-check', for: CI_USERS, cat: '인공와우', ico: '👂', t: '어음처리기 점검·교체 상담', b: '소리가 예전 같지 않다면 외부 기기 점검부터 받아 보세요', cta: '상담 알아보기' },
  { id: 'ci-cover', for: CI_USERS, cat: '인공와우', ico: '💧', t: '인공와우 방수 커버·충전지', b: '물놀이나 운동할 때도 기기를 지켜요', cta: '보러 가기' },
  { id: 'ha-fit', for: ['ha'], cat: '보청기', ico: '🦻', t: '보청기 다시 맞추기 상담', b: '잘 안 들리면 기기 조절만으로 나아질 수 있어요', cta: '가까운 센터 찾기' },
  { id: 'ha-batt', for: ['ha'], cat: '보청기', ico: '🔋', t: '보청기 건전지 정기 배송', b: '떨어질 때쯤 집으로 보내 드려요', cta: '보러 가기' },
  { id: 'tv', cat: '생활 보조기기', ico: '📺', t: 'TV 소리를 내 귀로 바로', b: '보청기·인공와우에 블루투스로 이어 주는 TV 연결기', cta: '보러 가기' },
  { id: 'signal', cat: '생활 보조기기', ico: '🔔', t: '초인종·알람을 빛과 진동으로', b: '소리를 못 들어도 손님과 아침을 놓치지 않아요', cta: '보러 가기' },
  { id: 'caption', cat: '생활 보조기기', ico: '💬', t: '전화를 글자로 보는 자막 서비스', b: '상대가 하는 말이 화면에 글자로 떠요', cta: '알아보기' },
];

const adOffToday = () => { try { return localStorage.getItem(AD_OFF_KEY) === today(); } catch { return false; } };
let adTurn = Math.floor(Math.random() * ADS.length); // 화면을 열 때마다 다음 광고로 돌린다

function adSlot() {
  if (adOffToday()) return '';
  const pool = ADS.filter((a) => !a.for || a.for.includes(data.who));
  const a = pool[adTurn++ % pool.length];
  return `
    <aside class="ad-slot" aria-label="광고" data-ad="${a.id}">
      <span class="ad-tag">예시 광고</span>
      <button class="ad-body" type="button">
        <span class="ad-ico" aria-hidden="true">${a.ico}</span>
        <span class="ad-text"><small class="ad-cat">${a.cat}</small><b>${a.t}</b><small>${a.b}</small></span>
        <span class="ad-cta">${a.cta}</span>
      </button>
      <p class="ad-why">청각에 도움 되는 광고만 보여 드려요</p>
      <button class="ad-close" type="button" aria-label="오늘은 광고 숨기기">${ICON.close}</button>
    </aside>`;
}

function bindAd() {
  const el = view.querySelector('.ad-slot');
  if (!el) return;
  el.querySelector('.ad-body').onclick = () => toast('시연용 예시 광고예요. 실제 광고가 들어오면 광고주 페이지로 이어져요.');
  el.querySelector('.ad-close').onclick = () => {
    try { localStorage.setItem(AD_OFF_KEY, today()); } catch {}
    el.remove();
    toast('오늘은 광고를 숨겼어요. 내일 다시 보여요.');
  };
}
