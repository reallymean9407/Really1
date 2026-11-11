'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Wallet } from 'lucide-react';

async function targetRequest(init?: RequestInit): Promise<number | null> {
  const response = await fetch('/api/preferences', { cache: 'no-store', ...init });
  const data = await response.json() as { targetCashRatio: number | null; error?: string };
  if (!response.ok) throw new Error(data.error ?? '목표 현금 비중을 불러올 수 없어요.');
  return data.targetCashRatio;
}

export default function CashTargetCard({ recent }: { recent: { cashRatio: number; date: string } | undefined }) {
  const [target, setTarget] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    targetRequest({ signal: abort.signal })
      .then(setTarget)
      .catch(() => { if (!abort.signal.aborted) setError('목표 현금 비중을 불러오지 못했어요.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [attempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || draft === null) return;
    setSaving(true);
    setError('');
    try {
      const targetCashRatio = draft === '' ? null : Number(draft);
      const saved = await targetRequest({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCashRatio }),
      });
      setTarget(saved);
      setDraft(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : '목표를 저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stat-card cash-target-card">
      <div className="stat-label">최근 기록의 현금 비중</div>
      <span className="stat-icon"><Wallet size={15}/></span>
      <div className="stat-value">{recent?.cashRatio ?? '—'}<small>{recent ? '%' : '기록 없음'}</small></div>
      {recent && <div className="stat-footer">{recent.date.replaceAll('-', '.')} 기록</div>}
      <div className="cash-target">
        {draft === null ? (
          <div className="cash-target-row">
            <span>목표 현금 비중 <b>{loading ? '…' : target === null ? '미설정' : `${target}%`}</b></span>
            {error ? (
              <button type="button" className="text-btn" onClick={() => setAttempt(value => value + 1)}>다시 시도</button>
            ) : (
              <button type="button" className="text-btn" disabled={loading} onClick={() => setDraft(target === null ? '' : String(target))}>
                <Pencil size={12}/>{target === null ? '설정' : '수정'}
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={save}>
            <label htmlFor="target-cash-ratio">목표 현금 비중</label>
            <div className="cash-target-row">
              <div className="cash-target-input">
                <input autoFocus id="target-cash-ratio" type="number" min={0} max={100} step={1} value={draft}
                  onChange={event => setDraft(event.target.value)} disabled={saving}/>
                <span>%</span>
              </div>
              <button className="text-btn" disabled={saving} type="submit">{saving ? '저장 중' : '저장'}</button>
              <button className="text-btn" disabled={saving} type="button" onClick={() => { setDraft(null); setError(''); }}>취소</button>
            </div>
          </form>
        )}
        {error && <small className="cash-target-error" role="alert">{error}</small>}
      </div>
    </div>
  );
}
