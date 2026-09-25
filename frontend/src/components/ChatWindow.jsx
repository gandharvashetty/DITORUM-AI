import { useEffect, useRef, useState } from "react";
import "../styles/chat.css";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function ChatWindow({ conversationId }) {
  const [messages, setMessages] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const loadConversation = async () => {
      if (!conversationId) {
        setMessages([]);
        return;
      }

      try {
        const res = await fetch(`${API}/conversations/${conversationId}`);
        const data = await res.json();
        setMessages(data.messages || []);
      } catch (err) {
        console.error(err);
      }
    };

    loadConversation();
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <main className="chat-window">
      {messages.length === 0 ? (
        <div className="hero">
          <div className="hero-logo">D</div>
          <h1>DITORUM AI</h1>
          <p>Built by B K Gandharva</p>
        </div>
      ) : (
        <div className="messages">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`message-row ${
                msg.role === "user" ? "user" : "assistant"
              }`}
            >
              <div className={`message ${msg.role}`}>
                {msg.role === "assistant" && (
                  <div className="assistant-label">DITORUM AI</div>
                )}

                {msg.file && (
                  <div className="attachment-chip">📎 {msg.file}</div>
                )}

                <div className="message-text">{msg.text}</div>
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>
      )}
    </main>
  );
}

export default ChatWindow;
