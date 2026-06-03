import { useState, useEffect } from 'react';
import './ModelBenchmark.css';

const FALLBACKS = {
  xgboost:            { name: 'XGBoost',             type: 'Gradient Boosting',    accuracy: 94.2, f1_score: 0.93, latency_ms: 22,  params: 'learning_rate=0.05, max_depth=6',   pros: ['High accuracy', 'Handles missing data', 'SHAP support'], cons: ['Slightly slower training'],              selected: true  },
  random_forest:      { name: 'Random Forest',        type: 'Tree-based Ensemble',  accuracy: 89.4, f1_score: 0.87, latency_ms: 15,  params: 'n_estimators=100, max_depth=15',     pros: ['Fast inference', 'Interpretable'],        cons: ['Weaker on trends'],                      selected: false },
  logistic_regression:{ name: 'Logistic Regression',  type: 'Linear Classifier',    accuracy: 82.1, f1_score: 0.79, latency_ms: 3,   params: 'C=1.0, solver=lbfgs',               pros: ['Ultra-fast', 'Probabilistic output'],    cons: ['Assumes linearity'],                     selected: false },
  isolation_forest:   { name: 'Isolation Forest',     type: 'Anomaly Detection',    accuracy: null, f1_score: null, latency_ms: 5,   params: 'n_estimators=100, contamination=0.05', pros: ['Detects flash flood spikes', 'Unsupervised'], cons: ['No class accuracy metric'],           selected: false },
};

const ORDER = ['xgboost', 'random_forest', 'logistic_regression', 'isolation_forest'];

export default function ModelBenchmarkDashboard({ onClose }) {
  const [metrics, setMetrics]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [activeModel, setActive] = useState('xgboost');

  useEffect(() => {
    fetch('/api/ml-metrics')
      .then(r => r.json())
      .then(d => { if (!d.error) setMetrics(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const models = ORDER.map(key => {
    const fb  = FALLBACKS[key];
    const live = metrics?.[key];
    return {
      id:       key,
      name:     live?.name     ?? fb.name,
      type:     live?.type     ?? fb.type,
      accuracy: live?.accuracy ?? fb.accuracy,
      f1:       live?.f1_score ?? fb.f1_score,
      latency:  live ? `${live.latency_ms} ms` : `${fb.latency_ms} ms`,
      latencyMs:live?.latency_ms ?? fb.latency_ms,
      params:   live?.params   ?? fb.params,
      pros:     fb.pros,
      cons:     fb.cons,
      selected: fb.selected,
      isLive:   !!live,
      contamination: live?.contamination ?? null,
    };
  });

  const best = models.find(m => m.selected);

  return (
    <div className="benchmark-overlay">
      <div className="benchmark-modal glass-panel">
        <div className="benchmark-header">
          <div className="benchmark-title">
            <span className="icon">🧠</span>
            <div>
              <h2>AI Model Evaluation &amp; Selection</h2>
              <div className="subtitle">
                B200 VM Live Results • Flood Route Risk Prediction
                {loading && <span style={{ marginLeft: 8, color: 'var(--text-3)', fontSize: 10 }}>⏳ loading...</span>}
                {!loading && metrics && <span style={{ marginLeft: 8, color: 'var(--safe)', fontSize: 10 }}>● Live B200</span>}
                {!loading && !metrics && <span style={{ marginLeft: 8, color: 'var(--warn)', fontSize: 10 }}>○ B200 offline — fallback values</span>}
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="benchmark-content">
          <div className="models-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {models.map(m => (
              <div
                key={m.id}
                className={`model-card ${m.selected ? 'selected' : ''} ${activeModel === m.id ? 'active' : ''}`}
                onClick={() => setActive(m.id)}
              >
                {m.selected && <div className="winner-badge">🏆 Best Performance</div>}
                <h3>{m.name}</h3>
                <div className="model-type">{m.type}</div>
                {m.isLive && <div style={{ fontSize: 9, color: 'var(--safe)', marginBottom: 6 }}>● LIVE</div>}

                <div className="metrics">
                  <div className="metric-row">
                    <span>Accuracy</span>
                    {m.accuracy != null
                      ? <strong className={m.accuracy > 90 ? 'text-safe' : 'text-warn'}>{m.accuracy.toFixed(1)}%</strong>
                      : <strong style={{ color: 'var(--text-3)', fontSize: 10 }}>N/A (unsupervised)</strong>}
                  </div>
                  <div className="metric-row">
                    <span>F1-Score</span>
                    {m.f1 != null
                      ? <strong>{m.f1.toFixed(2)}</strong>
                      : <strong style={{ color: 'var(--text-3)', fontSize: 10 }}>—</strong>}
                  </div>
                  <div className="metric-row">
                    <span>Inference</span>
                    <strong className={m.latencyMs < 30 ? 'text-safe' : 'text-warn'}>{m.latency}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="model-details">
            {models.map(m => m.id === activeModel && (
              <div key={`detail-${m.id}`} className="detail-view">
                <h3>{m.name} Analysis</h3>
                <div className="detail-grid">
                  <div className="detail-box">
                    <h4>Hyperparameters</h4>
                    <code>{m.params}</code>
                  </div>
                  <div className="detail-box pros-cons">
                    <div className="pros">
                      <h4>👍 Strengths</h4>
                      <ul>{m.pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                    <div className="cons">
                      <h4>👎 Weaknesses</h4>
                      <ul>{m.cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
                    </div>
                  </div>
                </div>
                {m.id === 'isolation_forest' && (
                  <div className="selection-reason" style={{ borderColor: 'var(--blue-primary)' }}>
                    <strong>Role:</strong> Unsupervised anomaly detector — flags abnormal sensor readings (flash flood spikes, sensor faults) that supervised models miss. Contamination = {m.contamination ?? 0.05}.
                  </div>
                )}
                {m.selected && (
                  <div className="selection-reason">
                    <strong>Decision:</strong> XGBoost selected for production — highest accuracy ({best?.accuracy?.toFixed(1)}%), SHAP explainability, and low latency ({best?.latency}) critical for real-time emergency routing.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
