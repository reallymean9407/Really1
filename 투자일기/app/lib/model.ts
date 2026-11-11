export type Sentiment = 'very-bullish'|'bullish'|'neutral'|'bearish'|'very-bearish';
export type Trade = {side:'buy'|'sell';symbol:string;note?:string};
export type FearGreed = {value:number;asOf?:string;source:'manual';sourceUrl:string;recordedAt:string};
export type DiaryImage = {id:string;name:string;type:string;size:number};
export type Visibility = 'private'|'sentiment'|'public';
export type SharingVersion = 2 | 3 | 4;
export type Diary = {commentsEnabled?:boolean;commentCount?:number;id?:string;visibility?:Visibility;sharingVersion?:SharingVersion;publishedImageIds?:string[];shareFearGreed?:boolean;shareEmotion?:boolean;shareCash?:boolean;shareTrades?:boolean;publishedAt?:string|null;date:string;title:string;body:string;insight?:string;sentiment:Sentiment|null;emotion:string|null;cashRatio:number|null;trades:Trade[];fearGreed:FearGreed|null;images?:DiaryImage[];version:number;createdAt:string;updatedAt:string;deletedAt?:string|null};
export const SENTIMENTS:{value:Sentiment;ko:string;en:string;color:string;light:string}[] = [
  {value:'very-bullish',ko:'매우낙관',en:'Very Bullish',color:'#ae343c',light:'#f9eded'},
  {value:'bullish',ko:'낙관',en:'Bullish',color:'#d76e64',light:'#fff2ee'},
  {value:'neutral',ko:'중립',en:'Neutral',color:'#8d938f',light:'#f1f3f1'},
  {value:'bearish',ko:'비관',en:'Bearish',color:'#6084bd',light:'#edf3fb'},
  {value:'very-bearish',ko:'매우비관',en:'Very Bearish',color:'#34578a',light:'#e9eff8'},
];
export const EMOTIONS = [{value:'차분함',emoji:'😌'},{value:'기대감',emoji:'🙂'},{value:'망설임',emoji:'🤔'},{value:'불안함',emoji:'😟'},{value:'흥분됨',emoji:'🔥'}];
export const seoulToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const weekday = (date:string) => new Intl.DateTimeFormat('ko-KR',{weekday:'long',timeZone:'Asia/Seoul'}).format(new Date(date+'T12:00:00+09:00'));
export const dateLabel = (date:string) => `${date.replaceAll('-','.')} ${weekday(date)}`;
export function blankDiary(date:string):Diary {return {visibility:'private',shareFearGreed:false,shareEmotion:false,shareCash:false,shareTrades:false,date,title:'',body:'',insight:'',sentiment:null,emotion:null,cashRatio:null,trades:[],fearGreed:null,images:[],version:0,createdAt:'',updatedAt:''};}
export function demoDiaries():Diary[] {
  const base=new Date(seoulToday()+'T12:00:00+09:00');
  const titles=['기다림도 투자의 한 부분이다','흔들리는 시장에서 나의 기준 찾기','가격보다 기업의 변화를 먼저 보기','조급한 마음을 잠시 내려놓고','시장의 소음과 나의 생각 사이'];
  const bodies=[
    '시장의 방향을 예측하기보다, 내가 이해하는 기업에 집중하기로 했다. 단기적인 가격 변동에 마음이 흔들릴 때일수록 처음 투자를 결정했던 이유를 다시 꺼내 본다.\n\n오늘은 차분하게 관심 기업의 실적과 현금 흐름을 살폈다. 다음 실적 발표에서 확인할 항목을 적어 두고, 충분한 확신이 생길 때까지 현금을 유지하려 한다.',
    '며칠간 이어진 변동성이 조금씩 잦아드는 느낌이다. 아직 방향을 단정하기보다는 시장을 관찰하면서 새로운 정보가 나의 판단을 어떻게 바꾸는지 기록해 두려 한다.\n\n분위기에 휩쓸려 매수하지 않고, 미리 정해 둔 가격과 조건을 다시 확인했다. 오늘의 생각이 틀릴 가능성도 함께 남겨 둔다.',
    '주가가 오르고 내리는 것과 기업의 가치가 달라지는 것은 별개의 일이다. 관심 종목의 사업 보고서를 읽으며 숫자 뒤에 있는 변화를 정리했다.\n\n아직 모르는 부분이 많다. 매출의 질과 경쟁 환경을 더 살핀 뒤 판단을 내리기로 했다.',
    '화면을 자주 들여다볼수록 작은 움직임에도 반응하게 된다. 오늘은 시세 확인을 줄이고 투자 원칙을 읽는 데 시간을 썼다.\n\n현금도 하나의 선택이라는 사실을 기억하자. 조급함에서 시작된 거래는 피하고 싶다.',
    '시장이 불안할 때는 다양한 의견이 한꺼번에 쏟아진다. 확인된 사실과 개인의 전망을 나눠 적어 보니 생각이 조금 정리된다.\n\n내가 감당할 수 있는 변동성의 범위부터 점검했다. 시장을 맞히기보다 나의 판단 과정을 남기는 일이 오늘의 목표다.'
  ];
  return titles.map((title,i)=>{const d=new Date(base);d.setDate(d.getDate()-i-(i>2?1:0));const date=d.toISOString().slice(0,10);return {...blankDiary(date),title,body:bodies[i],sentiment:(['bullish','neutral','very-bullish','bearish','very-bearish'] as Sentiment[])[i],emotion:['차분함','망설임','기대감','불안함','차분함'][i],cashRatio:[35,35,30,40,40][i],trades:i===0?[{side:'buy' as const,symbol:'삼성전자'},{side:'sell' as const,symbol:'AAPL'}]:i===2?[{side:'buy' as const,symbol:'NVDA'}]:[],version:1};});
}
