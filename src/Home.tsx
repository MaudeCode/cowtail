import { Link } from 'react-router-dom';
import './home.css';

const designs = [
  { path: '/1', name: 'Swiss/International Typographic', desc: 'Strict grid system, red/black/white, mathematical precision, Müller-Brockmann inspired' },
  { path: '/2', name: 'Cyberpunk Data-Viz', desc: 'Dark with neon data visualizations, glitch effects, HUD-style overlays, matrix rain' },
  { path: '/3', name: 'Warm Analog', desc: 'Paper-like textures, warm browns and oranges, hand-drawn feel, letterpress aesthetic' },
  { path: '/4', name: 'Arctic / Frost', desc: 'Icy blues and whites, frosted glass panels, crystalline geometry, crisp and cold' },
  { path: '/5', name: 'Memphis Design', desc: 'Bold geometric shapes, clashing colors, squiggly lines, playful 80s Italian chaos' },
  { path: '/6', name: 'Swiss Dark Mode', desc: 'Dark background, subdued red accents, faintly glowing grid lines, high-end dark dashboard' },
  { path: '/7', name: 'Swiss Expanded', desc: 'Generous whitespace, larger type scale, ultra-clean luxury feel, Inter light weights' },
  { path: '/8', name: 'Swiss Brutalist Hybrid', desc: 'Thick rules, bold mono type, raw contrast, electric blue accent on black/white' },
  { path: '/9', name: 'Swiss Data-Dense', desc: 'Maximum information density, compact layout, JetBrains Mono, Bloomberg terminal meets Swiss grid' },
  { path: '/10', name: 'Swiss Warm', desc: 'Cream background, deep brown text, terracotta accents, 60s Swiss poster on aged paper' },
];

export default function Home() {
  return (
    <div className="home-root">
      <h1 className="home-title">K8s Alerts Dashboard</h1>
      <p className="home-subtitle">10 Design Mockups</p>
      <div className="home-grid">
        {designs.map((d, i) => (
          <Link key={d.path} to={d.path} className="home-card" style={{ animationDelay: `${i * 100}ms` }}>
            <span className="home-num">{i + 1}</span>
            <h2>{d.name}</h2>
            <p>{d.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
