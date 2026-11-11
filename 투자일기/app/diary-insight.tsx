import {Lightbulb} from 'lucide-react';

export default function DiaryInsight({text}:{text?:string}) {
  if(!text?.trim())return null;
  return <section className="diary-insight" aria-label="이날 얻은 인사이트">
    <h3><Lightbulb size={14} strokeWidth={1.6}/>이날 얻은 인사이트</h3>
    <p>{text}</p>
  </section>;
}
