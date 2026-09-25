import { useEffect, useState } from "react";
import "../styles/sidebar.css";

const API = "http://127.0.0.1:8000";

function Sidebar({ activeId, onSelect }) {
  const [conversations, setConversations] = useState([]);

  const loadConversations = async () => {
    try {
      const res = await fetch(`${API}/conversations`);
      const data = await res.json();
      setConversations(data);

      // Open the newest conversation only if none is selected
      if (!activeId && data.length > 0) {
        onSelect(data[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const createNewChat = async () => {
    try {
      const res = await fetch(`${API}/conversations`, {
        method: "POST",
      });

      const data = await res.json();

      await loadConversations();

      onSelect(data.id);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">D</div>
        <div>
          <h2>DITORUM AI</h2>
          <p>Neural Operating System</p>
        </div>
      </div>

      <button className="new-chat" onClick={createNewChat}>
        + New Chat
      </button>

      <div className="history">
        {conversations.map((chat) => (
          <div
            key={chat.id}
            className={`history-item ${activeId === chat.id ? "active" : ""}`}
            onClick={() => onSelect(chat.id)}
          >
            {chat.title || "New Chat"}
          </div>
        ))}
      </div>
    </aside>
  );
}

export default Sidebar;