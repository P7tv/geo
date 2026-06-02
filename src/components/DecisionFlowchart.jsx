import React from 'react';
import './ModelBenchmark.css'; // Re-use some styling

export default function DecisionFlowchart({ route }) {
  const isSafe = route?.safety > 50;
  
  return (
    <div className="flowchart-container" style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '12px',
      marginTop: '12px',
      fontFamily: 'var(--font-th)'
    }}>
      <div style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--text-2)', marginBottom: '8px', textTransform: 'uppercase' }}>
        ⚙️ AI Decision Pathway
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Step 1 */}
        <div className="flow-step">
          <div className="flow-icon">📡</div>
          <div className="flow-text">
            <span className="flow-title">Check Sensors & API</span>
            <span className="flow-desc">TMD Weather, GISTDA Water Levels, CCTV</span>
          </div>
        </div>
        
        <div className="flow-arrow">↓</div>
        
        {/* Step 2 */}
        <div className="flow-step">
          <div className="flow-icon">🧠</div>
          <div className="flow-text">
            <span className="flow-title">XGBoost ML Inference</span>
            <span className="flow-desc">Evaluating 4 dynamic risk features</span>
          </div>
        </div>

        <div className="flow-arrow">↓</div>

        {/* Step 3 */}
        <div className="flow-step">
          <div className="flow-icon">{isSafe ? '✅' : '🚨'}</div>
          <div className="flow-text">
            <span className="flow-title">AI Recommendation</span>
            <span className="flow-desc">{isSafe ? `Route safe (Risk ${Math.round(route?.risk || 0)}%)` : `High risk detected (${Math.round(route?.risk || 0)}%)`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
