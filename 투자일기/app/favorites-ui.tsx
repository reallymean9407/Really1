import {ArrowLeft,Star} from 'lucide-react';

export function FavoritesIntro({count}:{count:number}) {
  return <div className="favorites-intro">
    <span className="favorites-intro-icon"><Star size={21} strokeWidth={1.5}/></span>
    <div><h2>다시 꺼내 보고 싶은 순간들</h2><p>마음이 크게 흔들렸던 날의 기록을 모아 두고, 시간이 지난 뒤 나의 판단을 돌아보세요.</p></div>
    <span className="favorites-count">{count}<small>개의 기록</small></span>
  </div>;
}

export function FavoritesEmpty({hasFilters,onReset,onBrowse}:{hasFilters:boolean;onReset:()=>void;onBrowse:()=>void}) {
  return <div className="empty favorites-empty">
    <Star size={32} strokeWidth={1.3}/>
    <h3>{hasFilters?'이 조건에 맞는 즐겨찾기가 없어요':'다시 읽고 싶은 날에, 별을 남겨 보세요'}</h3>
    <p>{hasFilters?'감정이나 날짜 조건을 바꾸면 다른 기록을 볼 수 있어요.':'일기 날짜 옆의 별표를 누르면 이곳에 모입니다. 당시의 마음과 판단을 언제든 다시 꺼내 보세요.'}</p>
    <button className="secondary" onClick={hasFilters?onReset:onBrowse}><ArrowLeft size={13}/>{hasFilters?'조건 초기화':'투자 일기에서 골라보기'}</button>
  </div>;
}
