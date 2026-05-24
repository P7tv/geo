import React from 'react';

export default function AIChatPanel({
  chatMessages,
  chatInput,
  setChatInput,
  sendChat,
  isTyping
}) {
  return (
    <div className="sidebar-section xai-chat glass-panel" style={{ border: '1px solid var(--line-glass)' }}>
      
      {/* Sci-Fi AI Header with pulsing neural core */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <div className="neural-core" style={{
          width: '36px',
          height: '36px',
          border: '1.5px dashed var(--cyber-blue)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'neural-spin 10s infinite linear'
        }}></div>
        <div>
          <h3 style={{ fontSize: '12px', fontWeight: 'bold', fontFamily: 'Outfit', color: '#fff', letterSpacing: '0.5px' }}>
            SPHERE AI BRAIN v2.0
          </h3>
          <span style={{ fontSize: '8px', color: 'var(--cyber-blue)', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
            ● ONLINE · DYNAMIC CONTEXT ACTIVE
          </span>
        </div>
      </div>

      {/* Cyber chat message thread */}
      <div className="chat-thread-container" style={{
        height: '190px',
        overflowY: 'auto',
        background: 'rgba(2, 5, 11, 0.6)',
        border: '1px solid var(--line-glass)',
        borderRadius: '8px',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        {chatMessages.map((msg, idx) => (
          <div key={idx} className={`chat-bubble-new ${msg.role === 'ai' ? 'ai' : 'user'}`}>
            {msg.html ? (
              <div dangerouslySetInnerHTML={{ __html: msg.html }}></div>
            ) : (
              <div>{msg.text}</div>
            )}
            
            {msg.toolCall && (
              <div className="ai-action-run">
                <span>⚙️</span> Executed Tool: {msg.toolCall.name}()
              </div>
            )}

            <span className="chat-time">{msg.time}</span>
          </div>
        ))}

        {isTyping && (
          <div className="chat-bubble-new ai" style={{ display: 'flex', gap: '4px', padding: '10px' }}>
            <span className="typing-dot"></span>
            <span className="typing-dot"></span>
            <span className="typing-dot"></span>
          </div>
        )}
      </div>

      {/* Action Chips */}
      <div className="chat-actions">
        <button onClick={() => sendChat("รายงานน้ำป่าหลากที่สันทราย น้ำลึก 1.5 เมตร")}>🚨 รายงานสันทราย</button>
        <button onClick={() => sendChat("ถ้าฝนตก 20mm ควรไปทางไหน?")}>⛈️ ไปทางไหนดี?</button>
        <button onClick={() => sendChat("วิเคราะห์จราจร CCTV บนเส้น B หน่อย")}>🚘 วิเคราะห์ ทล.118</button>
      </div>

      {/* Chat input */}
      <div className="chat-input" style={{ marginTop: '12px' }}>
        <input 
          type="text" 
          placeholder="ถามทาง / วิเคราะห์กล้อง / รายงานภัย..." 
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && sendChat()}
        />
        <button onClick={() => sendChat()}>ส่ง</button>
      </div>
    </div>
  );
}
