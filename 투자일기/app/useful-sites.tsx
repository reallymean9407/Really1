import {ArrowUpRight,ChartNoAxesCombined,Gauge,Globe2,Landmark,LayoutGrid} from 'lucide-react';

const sites = [
  {
    name: 'CNN Fear & Greed',
    category: '시장 심리',
    description: '시장의 공포와 탐욕을 살펴보며, 오늘 나의 판단과 비교해 보세요.',
    href: 'https://edition.cnn.com/markets/fear-and-greed',
    address: 'edition.cnn.com / fear-and-greed',
    icon: Gauge,
    tone: 'sand',
  },
  {
    name: 'FINVIZ Market Map',
    category: '종목 · 섹터',
    description: 'S&P 500 종목과 섹터의 등락을 한눈에 볼 수 있는 시장 지도예요.',
    href: 'https://finviz.com/map?t=sec',
    address: 'finviz.com / map',
    icon: LayoutGrid,
    tone: 'sage',
  },
  {
    name: 'INDEXerGO',
    category: '경제 · 금융 차트',
    description: '물가·금리 등 경제지표와 주가 흐름을 차트로 살펴보세요.',
    href: 'https://www.indexergo.com',
    address: 'indexergo.com',
    icon: Globe2,
    tone: 'blue',
  },
  {
    name: 'Portfolio Visualizer',
    category: '포트폴리오 분석',
    description: '자산 배분과 리밸런싱 조건에 따른 포트폴리오의 과거 성과를 비교해 보세요.',
    href: 'https://www.portfoliovisualizer.com/backtest-portfolio',
    address: 'portfoliovisualizer.com / backtest-portfolio',
    icon: ChartNoAxesCombined,
    tone: 'sage',
  },
  {
    name: 'FRED Economic Data',
    category: '거시경제 지표',
    description: '세인트루이스 연준의 경제 데이터에서 금리·물가·고용의 흐름을 확인해 보세요.',
    href: 'https://fred.stlouisfed.org',
    address: 'fred.stlouisfed.org',
    icon: Landmark,
    tone: 'sand',
  },
] as const;

export default function UsefulSites() {
  return <section className="useful-sites" aria-label="투자에 유용한 사이트">
    <div className="resources-heading"><h2>생각을 넓혀 주는 도구들 <span>5개의 사이트</span></h2><p>카드를 누르면 새 탭에서 열려요.</p></div>
    <div className="resources-grid">
      {sites.map((site,index) => {
        const Icon = site.icon;
        return <a className={`resource-card resource-${site.tone}`} key={site.href} href={site.href} target="_blank" rel="noopener noreferrer" aria-label={`${site.name} — ${site.category} (새 탭에서 열기)`}>
          <div className="resource-top"><span className="resource-icon"><Icon size={22} strokeWidth={1.5}/></span><span className="resource-category">{site.category}</span><span className="resource-number">{String(index+1).padStart(2,'0')}</span></div>
          <h3>{site.name}</h3>
          <p>{site.description}</p>
          <div className="resource-bottom"><span>{site.address}</span><span className="resource-arrow" aria-hidden="true"><ArrowUpRight size={17}/></span></div>
        </a>;
      })}
    </div>
    <p className="resources-note">발견한 숫자와 떠오른 생각을, 오늘의 일기에 함께 남겨 보세요.</p>
  </section>;
}
