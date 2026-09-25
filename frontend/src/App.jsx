import { useState, useEffect, useRef } from "react";
import "./styles/app.css";
import { jsPDF } from "jspdf";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function groupConversations(conversations) {
  const pinned = [];
  const today = [];
  const yesterday = [];
  const last7 = [];
  const older = [];

  const now = new Date();

  conversations.forEach((chat) => {
    // If pinned, show it only in PINNED
    if (chat.pinned) {
      pinned.push(chat);
      return;
    }

    const created = new Date(chat.created_at);
    const diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      today.push(chat);
    } else if (diffDays === 1) {
      yesterday.push(chat);
    } else if (diffDays < 7) {
      last7.push(chat);
    } else {
      older.push(chat);
    }
  });

  return { pinned, today, yesterday, last7, older };
}

export default function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [showTranslator, setShowTranslator] = useState(false);
  const [translationCopied, setTranslationCopied] = useState(false);
  const [isTranslationReading, setIsTranslationReading] = useState(false);
  const [translatorText, setTranslatorText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [translatorFrom, setTranslatorFrom] = useState("en");
  const [translatorTo, setTranslatorTo] = useState("kn");
  const [translatorLoading, setTranslatorLoading] = useState(false);
  const [translatorError, setTranslatorError] = useState("");

  // ---------------- Coding Lab ----------------
  const [showCodingLab, setShowCodingLab] = useState(false);
  const [codingLanguage, setCodingLanguage] = useState("python");
  const [codingVersion, setCodingVersion] = useState("3.13");
  const [codingCode, setCodingCode] = useState(
    'print("Become the programmer you\'re meant to be!")',
  );
  const [codingInput, setCodingInput] = useState("");
  const [codingOutput, setCodingOutput] = useState("");
  const [codingError, setCodingError] = useState("");
  const [codingRunning, setCodingRunning] = useState(false);
  const [codingTime, setCodingTime] = useState(null);
  const [codingExplanation, setCodingExplanation] = useState("");
  const [codingDebug, setCodingDebug] = useState("");
  const [codingBusy, setCodingBusy] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "dark";
  });
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [sources, setSources] = useState([]);

  const [editingIndex, setEditingIndex] = useState(null);
  const [editingText, setEditingText] = useState("");

  // Speech Synthesis API
  const speakText = (text) => {
    if (!window.speechSynthesis) {
      alert("Text-to-speech is not supported in this browser.");
      return;
    }

    // Stop if already speaking
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    let cleanText = text
      // Remove fenced code blocks completely
      .replace(/```[\s\S]*?```/g, "")

      // Remove inline code markers
      .replace(/`([^`]+)`/g, "$1")

      // Remove markdown headings (#, ##, ###)
      .replace(/^#{1,6}\s*/gm, "")

      // Remove decorative separator lines (====, ----, ____, ****)
      .replace(/^[=\-_*]{3,}\s*$/gm, "")

      // Remove markdown bold/italic markers
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/_(.*?)_/g, "$1")

      // Remove markdown links but keep the visible text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")

      // Remove raw URLs
      .replace(/https?:\/\/\S+/g, "")

      // Remove markdown blockquotes
      .replace(/^>\s*/gm, "")

      // Remove markdown list markers
      .replace(/^\s*[-*+]\s+/gm, "")

      // Replace new lines with pauses
      .replace(/\n+/g, ". ")

      // Collapse multiple spaces
      .replace(/\s+/g, " ")

      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    utterance.pitch = 1;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  // ---------------- Translation Read Aloud ----------------

  const readTranslation = () => {
    if (!translatedText || !translatedText.trim()) {
      alert("There is no translation to read.");
      return;
    }

    // Stop anything already speaking
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(translatedText.trim());

    // Language
    const languageMap = {
      en: "en-US",
      kn: "kn-IN",
      hi: "hi-IN",
      te: "te-IN",
      ta: "ta-IN",
    };

    utterance.lang = languageMap[translatorTo] || "en-US";

    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    setIsTranslationReading(true);

    utterance.onend = () => {
      setIsTranslationReading(false);
    };

    utterance.onerror = (event) => {
      console.error("Speech error:", event);
      setIsTranslationReading(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopTranslation = () => {
    window.speechSynthesis.cancel();
    setIsTranslationReading(false);
  };

  // ---------------- Translator ----------------
  const translatorLanguages = [
    { code: "en", name: "English" },
    { code: "kn", name: "Kannada" },
    { code: "hi", name: "Hindi" },
    { code: "te", name: "Telugu" },
    { code: "ta", name: "Tamil" },
  ];

  const translateText = async (textOverride = null) => {
    const text = (textOverride ?? translatorText).trim();

    if (!text) {
      setTranslatorError("Please enter some text to translate.");
      setTranslatedText("");
      return;
    }

    if (translatorFrom === translatorTo) {
      setTranslatedText(text);
      setTranslatorError("");
      return;
    }

    setTranslatorLoading(true);
    setTranslatorError("");
    setTranslatedText("");

    try {
      const response = await fetch(`${API}/translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text,
          source: translatorFrom,
          target: translatorTo,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Translation failed.");
      }

      if (!data?.translatedText) {
        throw new Error("No translation was returned.");
      }

      setTranslatedText(data.translatedText);
      setTranslatorError("");
    } catch (error) {
      console.error("Translation error:", error);

      setTranslatedText("");

      setTranslatorError(
        error.message || "Translation failed. Please try again.",
      );
    } finally {
      setTranslatorLoading(false);
    }
  };

  const swapTranslatorLanguages = () => {
    setTranslatorFrom(translatorTo);
    setTranslatorTo(translatorFrom);

    if (translatedText) {
      setTranslatorText(translatedText);
      setTranslatedText(translatorText);
    }

    setTranslatorError("");
  };

  const clearTranslator = () => {
    if (translatorRecognitionRef.current) {
      translatorRecognitionRef.current.stop();
      translatorRecognitionRef.current = null;
    }

    setIsTranslatorListening(false);

    setTranslatorText("");
    setTranslatedText("");
    setTranslatorError("");
  };

  const codingLanguages = {
    python: {
      name: "Python",
      versions: ["3.8", "3.9", "3.10", "3.11", "3.12", "3.13"],
    },
    c: {
      name: "C",
      versions: ["GCC 9", "GCC 10", "GCC 11", "GCC 12", "GCC 13", "GCC 14"],
    },
    cpp: {
      name: "C++",
      versions: ["G++ 9", "G++ 10", "G++ 11", "G++ 12", "G++ 13", "G++ 14"],
    },
    java: {
      name: "Java",
      versions: ["JDK 8", "JDK 11", "JDK 17", "JDK 21", "JDK 25"],
    },
    javascript: {
      name: "JavaScript",
      versions: ["Node.js 18", "Node.js 20", "Node.js 22", "Node.js 24"],
    },
  };

  const codingTemplates = {
    python: 'print("Hello, DITORUM!")',
    c: '#include <stdio.h>\n\nint main() {\n    printf("Hello, DITORUM!\\n");\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, DITORUM!" << endl;\n    return 0;\n}',
    java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, DITORUM!");\n    }\n}',
    javascript: 'console.log("Hello, DITORUM!");',
  };

  const changeCodingLanguage = (language) => {
    setCodingLanguage(language);
    setCodingVersion(codingLanguages[language].versions[0]);
    setCodingCode(codingTemplates[language]);
    setCodingOutput("");
    setCodingError("");
    setCodingExplanation("");
    setCodingDebug("");
  };

  const runCode = async () => {
    if (!codingCode.trim() || codingRunning) return;

    setCodingRunning(true);
    setCodingOutput("");
    setCodingError("");
    setCodingExplanation("");
    setCodingDebug("");
    setCodingTime(null);

    try {
      const response = await fetch(`${API}/run-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: codingLanguage,
          version: codingVersion,
          code: codingCode,
          input: codingInput,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Code execution failed");
      }

      setCodingOutput(data.output || "");
      setCodingError(data.error || "");
      setCodingTime(data.execution_time_ms ?? null);
    } catch (error) {
      console.error("Run code error:", error);
      setCodingError(error.message || "Could not run the program.");
    } finally {
      setCodingRunning(false);
    }
  };

  const explainCode = async () => {
    if (!codingCode.trim() || codingBusy) return;

    setCodingBusy(true);
    setCodingExplanation("");
    setCodingDebug("");

    // Show something immediately
    setCodingExplanation("🧠 Analyzing your code...\n\n");

    try {
      const response = await fetch(`${API}/explain-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: codingLanguage,
          version: codingVersion,
          code: codingCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Could not explain code");
      }

      // Show the result
      setCodingExplanation(data.explanation || "No explanation was returned.");
    } catch (error) {
      console.error("Explain code error:", error);

      setCodingExplanation(
        `❌ Could not explain this code.\n\n${
          error.message || "Unknown error"
        }`,
      );
    } finally {
      setCodingBusy(false);
    }
  };

  const debugCode = async () => {
    if (!codingCode.trim() || codingBusy) return;

    setCodingBusy(true);
    setCodingDebug("");
    setCodingExplanation("");

    try {
      const response = await fetch(`${API}/debug-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: codingLanguage,
          version: codingVersion,
          code: codingCode,
          input: codingInput,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Could not debug code");
      }

      setCodingDebug(data.debug || "");
    } catch (error) {
      console.error("Debug code error:", error);
      setCodingDebug(error.message || "Could not debug this code.");
    } finally {
      setCodingBusy(false);
    }
  };

  const clearCodingLab = () => {
    setCodingCode(codingTemplates[codingLanguage]);
    setCodingInput("");
    setCodingOutput("");
    setCodingError("");
    setCodingExplanation("");
    setCodingDebug("");
    setCodingTime(null);
  };

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setSidebarOpen(false); // Mobile: sidebar closed
      } else {
        setSidebarOpen(true); // Desktop: sidebar open
      }
    };

    // Run once when the app loads
    handleResize();

    // Listen for screen size changes
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // NEW: sidebar search
  const [searchQuery, setSearchQuery] = useState("");

  //Add state for the menu
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef(null);
  const [renamingId, setRenamingId] = useState(null);

  //nline rename state
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Camera
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);

  // Voice
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  // Translator Voice
  const [isTranslatorListening, setIsTranslatorListening] = useState(false);
  const translatorRecognitionRef = useRef(null);

  const messagesEndRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const abortControllerRef = useRef(null);
  const initialized = useRef(false);

  const groupedConversations = groupConversations(conversations);
  // const pinnedConversations = conversations.filter((chat) => chat.pinned);

  // ---------------- Load Conversations ----------------
  const loadConversations = async () => {
    try {
      const res = await fetch(`${API}/conversations`);
      const data = await res.json();
      setConversations(data);
      return data;
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  // ---------------- Create New Chat ----------------
  const createNewChat = async () => {
    try {
      // If the current conversation is already empty,
      // do not create another empty conversation.
      if (messages.length === 0 && conversationId) return;

      const res = await fetch(`${API}/conversations`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to create new conversation");
      }

      const data = await res.json();

      setConversationId(data.id);
      setMessages([]);
      setSelectedFile(null);
      setSources([]);

      await loadConversations();
    } catch (err) {
      console.error("Failed to create new chat:", err);
    }
  };

  // ---------------- Open Conversation ----------------
  const openConversation = async (id) => {
    try {
      const res = await fetch(`${API}/conversations/${id}`);
      const data = await res.json();

      setConversationId(id);
      setMessages(data.messages || []);

      // Close sidebar on mobile after selecting a chat
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  //rename and delete functions
  const renameConversation = async (id) => {
    const title = editingTitle.trim();

    if (!title) {
      setEditingId(null);
      return;
    }

    try {
      await fetch(`${API}/conversations/${id}/title`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });

      setEditingId(null);
      setEditingTitle("");

      await loadConversations();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteConversation = async (id) => {
    const confirmDelete = window.confirm("Delete this conversation?");

    if (!confirmDelete) return;

    try {
      await fetch(`${API}/conversations/${id}`, {
        method: "DELETE",
      });

      if (conversationId === id) {
        setMessages([]);
        setConversationId(null);
        await createNewChat();
      }

      await loadConversations();
    } catch (err) {
      console.error(err);
    }
  };

  //PinConversation
  const togglePinConversation = async (chat) => {
    console.log("Pin button clicked", chat);

    try {
      const response = await fetch(`${API}/conversations/${chat.id}/pin`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pinned: chat.pinned ? 0 : 1,
        }),
      });

      console.log("Pin response:", response.status);

      await loadConversations();
    } catch (err) {
      console.error("Pin error:", err);
    }
  };

  // ---------------- Initialize ----------------
  // ---------------- Initialize ----------------
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const init = async () => {
      // Load sidebar conversations only
      await loadConversations();

      // Always start with a NEW CHAT
      setConversationId(null);
      setMessages([]);
      setSelectedFile(null);
    };

    init();
  }, []);

  // ---------------- Auto Scroll ----------------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, loading]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      // If no menu is open, do nothing
      if (menuOpenId === null) return;

      // If the click is inside the menu, keep it open
      if (menuRef.current && menuRef.current.contains(event.target)) {
        return;
      }

      // Otherwise close the menu
      setMenuOpenId(null);
    };

    document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [menuOpenId]);

  // ---------------- Voice Recognition ----------------
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    let finalTranscript = "";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event) => {
      let transcript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      setMessage(transcript);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
  }, []);

  const startVoiceInput = () => {
    if (recognitionRef.current) {
      recognitionRef.current.start();
    }
  };

  // ---------------- Camera ----------------
  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });

      setCameraStream(stream);
      setCameraOpen(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      console.error(err);
      alert("Camera permission denied");
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      const file = new File([blob], "camera.jpg", {
        type: "image/jpeg",
      });

      setSelectedFile(file);

      cameraStream.getTracks().forEach((track) => track.stop());

      setCameraOpen(false);
    }, "image/jpeg");
  };

  // ---------------- Send Message ----------------
  const sendMessage = async () => {
    if ((!message.trim() && !selectedFile) || loading) return;

    // Remember whether this is the first message BEFORE
    // adding the message to React state.
    const isFirstMessage = messages.length === 0;

    // Create a conversation automatically if none exists.
    let currentConversationId = conversationId;

    if (!currentConversationId) {
      const res = await fetch(`${API}/conversations`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to create conversation");
      }

      const data = await res.json();
      currentConversationId = data.id;
      setConversationId(currentConversationId);

      await loadConversations();
    }

    const userText = message.trim();
    const fileForMessage = selectedFile;

    // Add the user message and an empty assistant message.
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: userText,
        file: fileForMessage ? fileForMessage.name : null,
      },
      {
        role: "assistant",
        text: "",
        sources: [],
      },
    ]);

    setMessage("");
    setLoading(true);
    setIsGenerating(true);

    try {
      // ==================================================
      // FILE CHAT
      // ==================================================
      if (fileForMessage) {
        const formData = new FormData();
        formData.append("message", userText);
        formData.append("conversation_id", currentConversationId);
        formData.append("file", fileForMessage);

        const res = await fetch(`${API}/chat-with-file`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          throw new Error("File processing failed");
        }

        const data = await res.json();

        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            text: data.reply || "",
            sources: data.sources || [],
          };
          return updated;
        });

        setSources(data.sources || []);
      } else {
        // ==================================================
        // NORMAL CHAT WITH STREAMING
        // ==================================================
        abortControllerRef.current = new AbortController();

        const response = await fetch(`${API}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({
            message: userText,
            conversation_id: currentConversationId,
          }),
        });

        if (!response.ok) {
          throw new Error("Chat request failed");
        }

        if (!response.body) {
          throw new Error("No response body received");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let fullText = "";
        let receivedSources = [];

        while (true) {
          const { value, done } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;

          // Detect source marker sent by the backend.
          const sourceMarker = fullText.indexOf("[[SOURCES]]");

          let answerText = fullText;

          if (sourceMarker !== -1) {
            answerText = fullText.substring(0, sourceMarker).trim();

            const sourceText = fullText
              .substring(sourceMarker + "[[SOURCES]]".length)
              .trim();

            receivedSources = sourceText
              .split("\n")
              .filter(Boolean)
              .map((line) => {
                const separator = line.lastIndexOf("|");

                if (separator === -1) return null;

                return {
                  title: line.substring(0, separator).trim(),
                  url: line.substring(separator + 1).trim(),
                };
              })
              .filter(Boolean);
          }

          setMessages((prev) => {
            const updated = [...prev];

            updated[updated.length - 1] = {
              role: "assistant",
              text: answerText,
              sources: receivedSources,
            };

            return updated;
          });
        }

        setSources(receivedSources);
      }

      // ==================================================
      // UPDATE CHAT TITLE AFTER FIRST MESSAGE
      // ==================================================

      if (isFirstMessage && currentConversationId) {
        try {
          // Use the user's first question as the sidebar title
          let newTitle = userText.trim();

          // Make the title cleaner
          newTitle = newTitle.replace(
            /^(tell me about|tell me|give me information about|information about|explain|show me)\s+/i,
            "",
          );

          // If the title is too long, shorten it
          if (newTitle.length > 45) {
            newTitle = newTitle.substring(0, 45) + "...";
          }

          // Safety fallback
          if (!newTitle) {
            newTitle = "New Chat";
          }

          console.log("NEW CHAT TITLE:", newTitle);
          console.log("CONVERSATION ID:", currentConversationId);

          // ----------------------------------------------
          // SAVE TITLE TO BACKEND
          // ----------------------------------------------

          const titleRes = await fetch(
            `${API}/conversations/${currentConversationId}/title`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                title: newTitle,
              }),
            },
          );

          if (!titleRes.ok) {
            throw new Error("Failed to save conversation title");
          }

          // ----------------------------------------------
          // UPDATE SIDEBAR IMMEDIATELY
          // ----------------------------------------------

          setConversations((prev) =>
            prev.map((chat) =>
              chat.id === currentConversationId
                ? {
                    ...chat,
                    title: newTitle,
                  }
                : chat,
            ),
          );

          console.log("SIDEBAR TITLE UPDATED:", newTitle);
        } catch (titleError) {
          console.error("Conversation title update failed:", titleError);
        }
      }

      // Do NOT reload conversations here immediately.
      // The state above already updates the sidebar.
    } catch (err) {
      console.error("Send message error:", err);

      if (err.name === "AbortError") {
        return;
      }

      setMessages((prev) => {
        const updated = [...prev];

        updated[updated.length - 1] = {
          role: "assistant",
          text: "Connection to DITORUM AI failed.",
          sources: [],
        };

        return updated;
      });
    } finally {
      setSelectedFile(null);
      setLoading(false);
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  // ======================================================
  // Regenerate Response
  // ======================================================

  const regenerateResponse = async (assistantIndex) => {
    if (loading || assistantIndex <= 0) return;

    const previousUser = messages[assistantIndex - 1];

    if (!previousUser || previousUser.role !== "user") return;

    const userText = previousUser.text;

    setLoading(true);
    setIsGenerating(true);

    // Remove old response
    setMessages((prev) => {
      const updated = [...prev];

      updated[assistantIndex] = {
        role: "assistant",
        text: "",
        sources: [],
      };

      return updated;
    });

    try {
      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userText,
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to regenerate response");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let fullText = "";
      let receivedSources = [];

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, {
          stream: true,
        });

        fullText += chunk;

        const sourceMarker = fullText.indexOf("[[SOURCES]]");

        let answerText = fullText;

        if (sourceMarker !== -1) {
          answerText = fullText.substring(0, sourceMarker).trim();

          const sourceText = fullText
            .substring(sourceMarker + "[[SOURCES]]".length)
            .trim();

          receivedSources = sourceText
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const separator = line.lastIndexOf("|");

              if (separator === -1) {
                return null;
              }

              return {
                title: line.substring(0, separator).trim(),

                url: line.substring(separator + 1).trim(),
              };
            })
            .filter(Boolean);
        }

        setMessages((prev) => {
          const updated = [...prev];

          updated[assistantIndex] = {
            role: "assistant",
            text: answerText,
            sources: receivedSources,
          };

          return updated;
        });
      }

      // Save final response
      setMessages((prev) => {
        const updated = [...prev];

        updated[assistantIndex] = {
          role: "assistant",
          text: fullText.split("[[SOURCES]]")[0].trim(),

          sources: receivedSources,
        };

        return updated;
      });

      await loadConversations();
    } catch (err) {
      console.error("Regenerate error:", err);

      setMessages((prev) => {
        const updated = [...prev];

        updated[assistantIndex] = {
          role: "assistant",
          text: "Failed to regenerate response.",
          sources: [],
        };

        return updated;
      });
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  };

  // ======================================================
  // Save Edited Message
  // ======================================================

  const saveEditedMessage = async (index) => {
    const editedText = editingText.trim();

    if (!editedText || loading) return;

    // The Edit button belongs to a USER message.
    if (!messages[index] || messages[index].role !== "user") return;

    setLoading(true);
    setIsGenerating(true);

    // Keep the edited user message visible immediately.
    setMessages((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], text: editedText };

      // Clear the old assistant response while generating the new one.
      if (updated[index + 1]?.role === "assistant") {
        updated[index + 1] = {
          ...updated[index + 1],
          text: "",
          sources: [],
        };
      } else {
        updated.splice(index + 1, 0, {
          role: "assistant",
          text: "",
          sources: [],
        });
      }

      return updated;
    });

    setEditingIndex(null);
    setEditingText("");

    try {
      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: editedText,
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) throw new Error("Failed to send edited message");
      if (!response.body) throw new Error("No response body received");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let receivedSources = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        fullText += decoder.decode(value, { stream: true });

        const sourceMarker = fullText.indexOf("[[SOURCES]]");
        let answerText = fullText;

        if (sourceMarker !== -1) {
          answerText = fullText.substring(0, sourceMarker).trim();

          const sourceText = fullText
            .substring(sourceMarker + "[[SOURCES]]".length)
            .trim();

          receivedSources = sourceText
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const separator = line.lastIndexOf("|");
              if (separator === -1) return null;

              return {
                title: line.substring(0, separator).trim(),
                url: line.substring(separator + 1).trim(),
              };
            })
            .filter(Boolean);
        }

        setMessages((prev) => {
          const updated = [...prev];
          updated[index + 1] = {
            role: "assistant",
            text: answerText,
            sources: receivedSources,
          };
          return updated;
        });
      }

      fullText += decoder.decode();
      const finalAnswer = fullText.split("[[SOURCES]]")[0].trim();

      setMessages((prev) => {
        const updated = [...prev];
        updated[index + 1] = {
          role: "assistant",
          text: finalAnswer,
          sources: receivedSources,
        };
        return updated;
      });

      setSources(receivedSources);
      await loadConversations();
    } catch (error) {
      console.error("Save edited message error:", error);

      setMessages((prev) => {
        const updated = [...prev];
        updated[index + 1] = {
          role: "assistant",
          text: "Sorry, I couldn't process the edited message.",
          sources: [],
        };
        return updated;
      });
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  };

  // ---------------- Filtered Conversations ----------------
  const filteredConversations = conversations.filter((chat) =>
    (chat.title || "New Chat")
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );

  const openMenu = (event, chatId) => {
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();

    setMenuPosition({
      x: rect.right + 8,
      y: rect.top,
    });

    setMenuOpenId(chatId);
  };

  const exportConversationPDF = () => {
    const doc = new jsPDF();

    let y = 20;

    doc.setFontSize(18);
    doc.text("DITORUM AI Conversation", 20, y);

    y += 15;

    doc.setFontSize(12);

    messages.forEach((msg) => {
      const speaker = msg.role === "user" ? "You" : "DITORUM AI";
      const text = `${speaker}: ${msg.text || ""}`;

      const lines = doc.splitTextToSize(text, 170);

      if (y + lines.length * 7 > 280) {
        doc.addPage();
        y = 20;
      }

      doc.text(lines, 20, y);

      y += lines.length * 7 + 5;
    });

    doc.save("ditorum-conversation.pdf");
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setIsGenerating(false);
    setLoading(false);
  };

  return (
    <div
      className={`app-layout ${theme} ${
        sidebarOpen ? "sidebar-open" : "sidebar-closed"
      }`}
    >
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-content">
          <div className="sidebar-top">
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              ☰
            </button>

            {sidebarOpen && (
              <div className="sidebar-header">
                <div className="logo">D</div>
                <div>
                  <h2>DATORUM AI</h2>
                  <p>Neural Operating System</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {sidebarOpen && (
          <>
            <button className="new-chat" onClick={createNewChat}>
              + New Chat
            </button>

            <button
              className="translator-btn"
              onClick={() => setShowTranslator(true)}
            >
              🌐 Translator
            </button>

            <button
              className="translator-btn"
              onClick={() => {
                setShowCodingLab(true);
                setShowTranslator(false);
              }}
            >
              💻 Coding Lab
            </button>

            <div className="sidebar-search">
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="history">
              {/* ⭐ Pinned Section - ADD HERE */}
              {groupedConversations.pinned.length > 0 && (
                <>
                  <div className="history-section">⭐ Pinned</div>

                  {groupedConversations.pinned.map((chat) => (
                    <div
                      key={chat.id}
                      className={`history-item ${conversationId === chat.id ? "active" : ""}`}
                    >
                      {editingId === chat.id ? (
                        <input
                          className="history-title-input"
                          value={editingTitle}
                          autoFocus
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => renameConversation(chat.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameConversation(chat.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                      ) : (
                        <div
                          className="history-title"
                          onClick={() => openConversation(chat.id)}
                        >
                          ⭐ {chat.title || "New Chat"}
                        </div>
                      )}

                      <button
                        className="history-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(
                            menuOpenId === chat.id ? null : chat.id,
                          );
                        }}
                      >
                        ⋮
                      </button>

                      {menuOpenId === chat.id && (
                        <div ref={menuRef} className="history-menu">
                          <button
                            onClick={() => {
                              setEditingId(chat.id);
                              setEditingTitle(chat.title || "New Chat");
                              setMenuOpenId(null);
                            }}
                          >
                            ✏️ Rename
                          </button>

                          <button onClick={() => togglePinConversation(chat)}>
                            ⭐ Unpin
                          </button>

                          <button
                            className="delete"
                            onClick={() => deleteConversation(chat.id)}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
              {groupedConversations.today.length > 0 && (
                <>
                  <div className="history-section">Today</div>
                  {groupedConversations.today
                    .filter((chat) =>
                      (chat.title || "New Chat")
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()),
                    )
                    .map((chat) => (
                      <div
                        key={chat.id}
                        className={`history-item ${
                          conversationId === chat.id ? "active" : ""
                        }`}
                      >
                        {editingId === chat.id ? (
                          <input
                            className="history-title-input"
                            value={editingTitle}
                            autoFocus
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={() => renameConversation(chat.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                renameConversation(chat.id);
                              }

                              if (e.key === "Escape") {
                                setEditingId(null);
                              }
                            }}
                          />
                        ) : (
                          <div
                            className="history-title"
                            onClick={() => openConversation(chat.id)}
                          >
                            {chat.title || "New Chat"}
                          </div>
                        )}

                        <button
                          className="history-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(
                              menuOpenId === chat.id ? null : chat.id,
                            );
                          }}
                        >
                          ⋮
                        </button>

                        {menuOpenId === chat.id && (
                          <div ref={menuRef} className="history-menu">
                            <button
                              onClick={() => {
                                setEditingId(chat.id);
                                setEditingTitle(chat.title || "New Chat");
                                setMenuOpenId(null);
                              }}
                            >
                              ✏️ Rename
                            </button>

                            <button onClick={() => togglePinConversation(chat)}>
                              {chat.pinned ? "⭐ Unpin" : "⭐ Pin"}
                            </button>

                            <button
                              className="delete"
                              onClick={() => deleteConversation(chat.id)}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </>
              )}

              {groupedConversations.yesterday.length > 0 && (
                <>
                  <div className="history-section">Yesterday</div>

                  {groupedConversations.yesterday
                    .filter((chat) =>
                      (chat.title || "New Chat")
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()),
                    )
                    .map((chat) => (
                      <div
                        key={chat.id}
                        className={`history-item ${
                          conversationId === chat.id ? "active" : ""
                        }`}
                      >
                        {editingId === chat.id ? (
                          <input
                            className="history-title-input"
                            value={editingTitle}
                            autoFocus
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={() => renameConversation(chat.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                renameConversation(chat.id);
                              }

                              if (e.key === "Escape") {
                                setEditingId(null);
                              }
                            }}
                          />
                        ) : (
                          <div
                            className="history-title"
                            onClick={() => openConversation(chat.id)}
                          >
                            {chat.title || "New Chat"}
                          </div>
                        )}

                        <button
                          className="history-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(
                              menuOpenId === chat.id ? null : chat.id,
                            );
                          }}
                        >
                          ⋮
                        </button>

                        {menuOpenId === chat.id && (
                          <div ref={menuRef} className="history-menu">
                            <button
                              onClick={() => {
                                setEditingId(chat.id);
                                setEditingTitle(chat.title || "New Chat");
                                setMenuOpenId(null);
                              }}
                            >
                              ✏️ Rename
                            </button>

                            <button onClick={() => togglePinConversation(chat)}>
                              {chat.pinned ? "⭐ Unpin" : "⭐ Pin"}
                            </button>

                            <button
                              className="delete"
                              onClick={() => deleteConversation(chat.id)}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </>
              )}

              {groupedConversations.last7.length > 0 && (
                <>
                  <div className="history-section">Last 7 Days</div>

                  {groupedConversations.last7
                    .filter((chat) =>
                      (chat.title || "New Chat")
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()),
                    )
                    .map((chat) => (
                      <div
                        key={chat.id}
                        className={`history-item ${
                          conversationId === chat.id ? "active" : ""
                        }`}
                      >
                        {editingId === chat.id ? (
                          <input
                            className="history-title-input"
                            value={editingTitle}
                            autoFocus
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={() => renameConversation(chat.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                renameConversation(chat.id);
                              }

                              if (e.key === "Escape") {
                                setEditingId(null);
                              }
                            }}
                          />
                        ) : (
                          <div
                            className="history-title"
                            onClick={() => openConversation(chat.id)}
                          >
                            {chat.title || "New Chat"}
                          </div>
                        )}

                        <button
                          className="history-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(
                              menuOpenId === chat.id ? null : chat.id,
                            );
                          }}
                        >
                          ⋮
                        </button>

                        {menuOpenId === chat.id && (
                          <div ref={menuRef} className="history-menu">
                            <button
                              onClick={() => {
                                setEditingId(chat.id);
                                setEditingTitle(chat.title || "New Chat");
                                setMenuOpenId(null);
                              }}
                            >
                              ✏️ Rename
                            </button>

                            <button onClick={() => togglePinConversation(chat)}>
                              {chat.pinned ? "⭐ Unpin" : "⭐ Pin"}
                            </button>

                            <button
                              className="delete"
                              onClick={() => deleteConversation(chat.id)}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </>
              )}

              {groupedConversations.older.length > 0 && (
                <>
                  <div className="history-section">Older</div>

                  {groupedConversations.older
                    .filter((chat) =>
                      (chat.title || "New Chat")
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()),
                    )
                    .map((chat) => (
                      <div
                        key={chat.id}
                        className={`history-item ${
                          conversationId === chat.id ? "active" : ""
                        }`}
                      >
                        {editingId === chat.id ? (
                          <input
                            className="history-title-input"
                            value={editingTitle}
                            autoFocus
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={() => renameConversation(chat.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                renameConversation(chat.id);
                              }

                              if (e.key === "Escape") {
                                setEditingId(null);
                              }
                            }}
                          />
                        ) : (
                          <div
                            className="history-title"
                            onClick={() => openConversation(chat.id)}
                          >
                            {chat.title || "New Chat"}
                          </div>
                        )}

                        <button
                          className="history-menu-btn"
                          onClick={(e) => openMenu(e, chat.id)}
                        >
                          ⋮
                        </button>

                        {menuOpenId === chat.id && (
                          <div ref={menuRef} className="history-menu">
                            <button
                              onClick={() => {
                                setEditingId(chat.id);
                                setEditingTitle(chat.title || "New Chat");
                                setMenuOpenId(null);
                              }}
                            >
                              ✏️ Rename
                            </button>

                            <button onClick={() => togglePinConversation(chat)}>
                              {chat.pinned ? "⭐ Unpin" : "⭐ Pin"}
                            </button>

                            <button
                              className="delete"
                              onClick={() => deleteConversation(chat.id)}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </>
              )}
            </div>
          </>
        )}
      </aside>

      {sidebarOpen && window.innerWidth <= 768 && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <main className="main-panel">
        <div className="topbar">
          <div className="topbar-brand">
            <div className="brand-mark">D</div>
            <div>
              <h1>DATORUM AI</h1>
              <p>Built by B K Gandharva</p>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="theme-toggle-btn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>

            {/* <button className="export-btn">Export PDF</button> */}
          </div>
        </div>

        {showCodingLab ? (
          <div
            className="coding-lab-screen"
            style={{
              minHeight: "calc(100vh - 174px)",
              padding: "28px",
              boxSizing: "border-box",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                maxWidth: "1200px",
                margin: "0 auto",
                background: "var(--card-bg, #111827)",
                border: "1px solid var(--border-color, #263449)",
                borderRadius: "20px",
                padding: "24px",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "16px",
                  flexWrap: "wrap",
                  marginBottom: "20px",
                }}
              >
                <div>
                  <h1 style={{ margin: 0, fontSize: "28px" }}>
                    💻 DITORUM Coding Lab
                  </h1>
                  <p style={{ margin: "8px 0 0", opacity: 0.7 }}>
                    Run programs, understand them step by step, and debug
                    errors.
                  </p>
                </div>

                <button
                  onClick={() => setShowCodingLab(false)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    background: "#1f2937",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  ✕ Close
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  flexWrap: "wrap",
                  marginBottom: "16px",
                }}
              >
                <select
                  value={codingLanguage}
                  onChange={(e) => changeCodingLanguage(e.target.value)}
                  style={{
                    padding: "11px 14px",
                    borderRadius: "10px",
                    background: "#0b1220",
                    color: "white",
                    border: "1px solid #334155",
                  }}
                >
                  {Object.entries(codingLanguages).map(([key, lang]) => (
                    <option key={key} value={key}>
                      {lang.name}
                    </option>
                  ))}
                </select>

                <select
                  value={codingVersion}
                  onChange={(e) => setCodingVersion(e.target.value)}
                  style={{
                    padding: "11px 14px",
                    borderRadius: "10px",
                    background: "#0b1220",
                    color: "white",
                    border: "1px solid #334155",
                  }}
                >
                  {codingLanguages[codingLanguage].versions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 0.9fr)",
                  gap: "16px",
                }}
              >
                <div>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: "10px 10px 0 0",
                      background: "#172033",
                      border: "1px solid #334155",
                      borderBottom: "none",
                      fontWeight: 700,
                    }}
                  >
                    {codingLanguages[codingLanguage].name} • {codingVersion}
                  </div>

                  <textarea
                    value={codingCode}
                    onChange={(e) => setCodingCode(e.target.value)}
                    spellCheck="false"
                    style={{
                      width: "100%",
                      minHeight: "430px",
                      resize: "vertical",
                      boxSizing: "border-box",
                      padding: "16px",
                      borderRadius: "0 0 10px 10px",
                      border: "1px solid #334155",
                      background: "#0b1220",
                      color: "#e5e7eb",
                      fontFamily: "Consolas, Monaco, monospace",
                      fontSize: "14px",
                      lineHeight: 1.6,
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <div style={{ fontWeight: 700, marginBottom: "8px" }}>
                    📥 Input
                  </div>

                  <textarea
                    value={codingInput}
                    onChange={(e) => setCodingInput(e.target.value)}
                    placeholder="Enter input for input() / scanf() / Scanner..."
                    style={{
                      width: "100%",
                      minHeight: "120px",
                      resize: "vertical",
                      boxSizing: "border-box",
                      padding: "14px",
                      borderRadius: "10px",
                      border: "1px solid #334155",
                      background: "#0b1220",
                      color: "inherit",
                      fontFamily: "Consolas, Monaco, monospace",
                      outline: "none",
                    }}
                  />

                  <div style={{ fontWeight: 700, margin: "18px 0 8px" }}>
                    📤 Output
                  </div>

                  <pre
                    style={{
                      minHeight: "180px",
                      maxHeight: "300px",
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      margin: 0,
                      padding: "14px",
                      borderRadius: "10px",
                      border: "1px solid #334155",
                      background: "#070d18",
                      color: "#e5e7eb",
                      fontFamily: "Consolas, Monaco, monospace",
                    }}
                  >
                    {codingOutput || "Program output will appear here..."}
                  </pre>

                  {codingTime !== null && (
                    <div style={{ marginTop: "8px", opacity: 0.65 }}>
                      Execution time: {codingTime} ms
                    </div>
                  )}

                  {codingError && (
                    <div
                      style={{
                        marginTop: "16px",
                        padding: "16px",
                        borderRadius: "12px",
                        border: "1px solid #7f1d1d",
                        background: "#2a0f0f",
                        color: "#fecaca",
                        width: "100%",
                        maxWidth: "100%",
                        boxSizing: "border-box",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "16px",
                          fontWeight: 700,
                          marginBottom: "12px",
                          color: "#fca5a5",
                        }}
                      >
                        ❌ Error
                      </div>

                      <pre
                        style={{
                          margin: 0,
                          width: "100%",
                          maxWidth: "100%",
                          boxSizing: "border-box",
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                          fontFamily: "Consolas, Monaco, monospace",
                          fontSize: "13px",
                          lineHeight: "1.6",
                          overflowX: "auto",
                          overflowY: "auto",
                          maxHeight: "300px",
                        }}
                      >
                        {codingError}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  marginTop: "18px",
                }}
              >
                <button
                  onClick={runCode}
                  disabled={codingRunning}
                  style={{
                    padding: "12px 18px",
                    borderRadius: "10px",
                    border: "none",
                    background: "#2563eb",
                    color: "white",
                    cursor: codingRunning ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  {codingRunning ? "⏳ Running..." : "▶ Run Code"}
                </button>

                <button
                  onClick={explainCode}
                  disabled={codingBusy}
                  style={{
                    padding: "12px 18px",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    background: "#1f2937",
                    color: "white",
                    cursor: codingBusy ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  🧠 Understand Step-by-Step
                </button>

                <button
                  onClick={debugCode}
                  disabled={codingBusy}
                  style={{
                    padding: "12px 18px",
                    borderRadius: "10px",
                    border: "1px solid #7f1d1d",
                    background: "#2a1010",
                    color: "white",
                    cursor: codingBusy ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  🐞 Debug Code
                </button>

                <button
                  onClick={clearCodingLab}
                  style={{
                    padding: "12px 18px",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    background: "transparent",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  🧹 Reset
                </button>
              </div>

              <div
                style={{
                  marginTop: "24px",
                  padding: "24px",
                  borderRadius: "14px",
                  border: "1px solid #334155",
                  background: "#0b1220",
                  color: "#e5e7eb",
                  textAlign: "left",
                  lineHeight: "1.7",
                  fontSize: "15px",
                  maxHeight: "500px",
                  overflowY: "auto",
                }}
              >
                <h3
                  style={{
                    margin: "0 0 20px 0",
                    fontSize: "22px",
                    color: "#f8fafc",
                    textAlign: "left",
                  }}
                >
                  🧠 Step-by-Step Explanation
                </h3>

                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    textAlign: "left",
                  }}
                >
                  {codingExplanation}
                </div>
              </div>

              {codingDebug && (
                <div
                  style={{
                    marginTop: "18px",
                    padding: "18px",
                    borderRadius: "12px",
                    border: "1px solid #7f1d1d",
                    background: "#160d0d",
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>🐞 Debug Report</h3>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {codingDebug}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ) : showTranslator ? (
          <div
            className="translator-screen"
            style={{
              minHeight: "calc(100vh - 174px)",
              padding: "40px",
              boxSizing: "border-box",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                maxWidth: "900px",
                margin: "0 auto",
                background: "var(--card-bg, #111827)",
                border: "1px solid var(--border-color, #263449)",
                borderRadius: "20px",
                padding: "28px",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                  marginBottom: "24px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h1 style={{ margin: 0, fontSize: "28px" }}>🌐 Translator</h1>
                  <p style={{ margin: "8px 0 0", opacity: 0.7 }}>
                    Translate text between English, Kannada, Hindi, Telugu and
                    Tamil.
                  </p>
                </div>

                <button
                  onClick={() => setShowTranslator(false)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  ✕ Close
                </button>
              </div>

              <div
                className="translator-input-wrapper"
                style={{
                  position: "relative",
                  width: "100%",
                  marginBottom: "18px",
                }}
              >
                <textarea
                  value={translatorText}
                  onChange={(e) => {
                    setTranslatorText(e.target.value);
                    setTranslatorError("");
                  }}
                  className="translator-input"
                  placeholder={
                    isTranslatorListening
                      ? "🎤 Listening... Speak now..."
                      : "Enter text to translate..."
                  }
                  style={{
                    width: "100%",
                    minHeight: "180px",
                    resize: "vertical",
                    boxSizing: "border-box",
                    padding: "16px 60px 16px 16px",
                    borderRadius: "12px",
                    border: isTranslatorListening
                      ? "1px solid #6366f1"
                      : "1px solid #334155",
                    background: "#0b1220",
                    color: "inherit",
                    fontSize: "16px",
                    outline: "none",
                    marginBottom: "0",
                  }}
                />

                <button
                  type="button"
                  onClick={() => {
                    const SpeechRecognition =
                      window.SpeechRecognition ||
                      window.webkitSpeechRecognition;

                    if (!SpeechRecognition) {
                      alert(
                        "Speech recognition is not supported in this browser.",
                      );
                      return;
                    }

                    // ==============================
                    // STOP LISTENING
                    // ==============================

                    if (isTranslatorListening) {
                      if (translatorRecognitionRef.current) {
                        translatorRecognitionRef.current.stop();
                      }

                      setIsTranslatorListening(false);
                      return;
                    }

                    // ==============================
                    // START LISTENING
                    // ==============================

                    const recognition = new SpeechRecognition();

                    recognition.lang =
                      translatorFrom === "en"
                        ? "en-IN"
                        : translatorFrom === "kn"
                          ? "kn-IN"
                          : translatorFrom === "hi"
                            ? "hi-IN"
                            : translatorFrom === "te"
                              ? "te-IN"
                              : "ta-IN";

                    recognition.continuous = true;
                    recognition.interimResults = true;

                    // Keep existing typed text
                    let finalTranscript = translatorText.trim();

                    // ==============================
                    // WHEN MICROPHONE STARTS
                    // ==============================

                    recognition.onstart = () => {
                      setIsTranslatorListening(true);
                      setTranslatorError("");
                    };

                    // ==============================
                    // WHEN SPEECH IS DETECTED
                    // ==============================

                    recognition.onresult = (event) => {
                      let interimTranscript = "";

                      for (
                        let i = event.resultIndex;
                        i < event.results.length;
                        i++
                      ) {
                        const transcript = event.results[i][0].transcript;

                        // Final speech
                        if (event.results[i].isFinal) {
                          finalTranscript +=
                            (finalTranscript ? " " : "") + transcript.trim();

                          const finalText = finalTranscript.trim();

                          // Show speech in textbox
                          setTranslatorText(finalText);

                          // ==============================
                          // AUTOMATIC TRANSLATION
                          // ==============================

                          if (finalText) {
                            translateText(finalText);
                          }
                        } else {
                          // Temporary speech
                          interimTranscript += transcript;
                        }
                      }

                      // ==============================
                      // SHOW WORDS WHILE SPEAKING
                      // ==============================

                      const displayText = (
                        finalTranscript +
                        (interimTranscript
                          ? (finalTranscript ? " " : "") + interimTranscript
                          : "")
                      ).trim();

                      if (displayText) {
                        setTranslatorText(displayText);
                      }
                    };

                    // ==============================
                    // MICROPHONE ERROR
                    // ==============================

                    recognition.onerror = (event) => {
                      console.error(
                        "Translator speech recognition error:",
                        event.error,
                      );

                      setIsTranslatorListening(false);

                      if (
                        event.error !== "aborted" &&
                        event.error !== "no-speech"
                      ) {
                        setTranslatorError(
                          "Microphone error. Please check microphone permission and try again.",
                        );
                      }
                    };

                    // ==============================
                    // MICROPHONE STOPPED
                    // ==============================

                    recognition.onend = () => {
                      setIsTranslatorListening(false);
                      translatorRecognitionRef.current = null;
                    };

                    translatorRecognitionRef.current = recognition;

                    try {
                      recognition.start();
                    } catch (error) {
                      console.error(
                        "Could not start translator microphone:",
                        error,
                      );

                      setIsTranslatorListening(false);
                      translatorRecognitionRef.current = null;
                    }
                  }}
                  style={{
                    position: "absolute",
                    right: "14px",
                    bottom: "32px",
                    width: "44px",
                    height: "44px",
                    borderRadius: "50%",
                    border: "1px solid #374151",
                    background: isTranslatorListening ? "#dc2626" : "#1f2937",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title={isTranslatorListening ? "Stop listening" : "Speak"}
                >
                  {isTranslatorListening ? "⏹" : "🎤"}
                </button>
              </div>

              <div
                className="translator-controls"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  gap: "12px",
                  alignItems: "center",
                  marginBottom: "18px",
                }}
              >
                <select
                  value={translatorFrom}
                  onChange={(e) => setTranslatorFrom(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    background: "#0b1220",
                    color: "inherit",
                    fontSize: "15px",
                  }}
                >
                  {translatorLanguages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={swapTranslatorLanguages}
                  title="Swap languages"
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    background: "#1e293b",
                    color: "inherit",
                    cursor: "pointer",
                    fontSize: "18px",
                  }}
                >
                  ⇄
                </button>

                <select
                  value={translatorTo}
                  onChange={(e) => setTranslatorTo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    background: "#0b1220",
                    color: "inherit",
                    fontSize: "15px",
                  }}
                >
                  {translatorLanguages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.name}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  flexWrap: "wrap",
                  marginBottom: "22px",
                }}
              >
                <button
                  type="button"
                  className="translate-btn"
                  onClick={() => {
                    console.log("🌐 TRANSLATE BUTTON CLICKED");
                    translateText();
                  }}
                  disabled={translatorLoading}
                  style={{
                    position: "relative",
                    zIndex: 100,
                    pointerEvents: "auto",
                    padding: "12px 22px",
                    borderRadius: "10px",
                    border: "none",
                    background: translatorLoading ? "#475569" : "#2563eb",
                    color: "white",
                    cursor: translatorLoading ? "wait" : "pointer",
                    fontSize: "15px",
                    fontWeight: "600",
                    opacity: 1,
                  }}
                >
                  {translatorLoading ? "⏳ Translating..." : "🌐 Translate"}
                </button>

                <button
                  onClick={clearTranslator}
                  style={{
                    padding: "12px 22px",
                    borderRadius: "10px",
                    border: "1px solid #334155",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    fontSize: "15px",
                  }}
                >
                  Clear
                </button>
              </div>

              {translatorError && (
                <div
                  style={{
                    marginBottom: "18px",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid #7f1d1d",
                    background: "rgba(127, 29, 29, 0.2)",
                  }}
                >
                  {translatorError}
                </div>
              )}

              <div
                className="translator-output"
                style={{
                  minHeight: "180px",
                  padding: "18px",
                  borderRadius: "12px",
                  border: "1px solid #334155",
                  background: "#0b1220",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.7",
                  boxSizing: "border-box",
                }}
              >
                {translatedText || "Translation will appear here..."}
              </div>

              {translatedText && (
                <>
                  {/* Copy Translation */}
                  <button
                    className="copy-translation-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(translatedText);

                        setTranslationCopied(true);

                        setTimeout(() => {
                          setTranslationCopied(false);
                        }, 2000);
                      } catch (error) {
                        console.error("Copy failed:", error);
                      }
                    }}
                  >
                    {translationCopied ? "✓ Copied!" : "📋 Copy translation"}
                  </button>

                  {/* Read / Stop Translation */}
                  <button
                    className="read-translation-btn"
                    onClick={async () => {
                      // STOP
                      if (isTranslationReading) {
                        if (window.currentTranslationAudio) {
                          window.currentTranslationAudio.pause();
                          window.currentTranslationAudio.currentTime = 0;
                        }

                        setIsTranslationReading(false);
                        return;
                      }

                      // Check translation
                      if (!translatedText || !translatedText.trim()) {
                        alert("Please translate something first.");
                        return;
                      }

                      try {
                        setIsTranslationReading(true);

                        // Send translated text to FastAPI
                        const response = await fetch(`${API}/text-to-speech`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            text: translatedText,
                            language: translatorTo,
                          }),
                        });

                        if (!response.ok) {
                          throw new Error("Text-to-speech failed");
                        }

                        // Convert response to audio
                        const audioBlob = await response.blob();

                        const audioUrl = URL.createObjectURL(audioBlob);

                        const audio = new Audio(audioUrl);

                        // Store audio so Stop can access it
                        window.currentTranslationAudio = audio;

                        // When audio finishes
                        audio.onended = () => {
                          setIsTranslationReading(false);
                          URL.revokeObjectURL(audioUrl);
                          window.currentTranslationAudio = null;
                        };

                        // If audio has an error
                        audio.onerror = () => {
                          setIsTranslationReading(false);
                          URL.revokeObjectURL(audioUrl);
                          window.currentTranslationAudio = null;
                        };

                        // Start speaking
                        await audio.play();
                      } catch (error) {
                        console.error("Translation speech error:", error);
                        setIsTranslationReading(false);

                        alert("Could not play the translation.");
                      }
                    }}
                  >
                    {isTranslationReading ? "⏹ Stop" : "🔊 Read"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Chat Window */}
            <div className="chat-window">
              {messages.length === 0 ? (
                <div className="hero">
                  <div className="hero-logo">D</div>
                  <h2>Welcome to DATORUM AI</h2>
                  <p>Upload images or PDFs and ask anything.</p>
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
                          <div className="assistant-label">DATORUM AI</div>
                        )}

                        {msg.file && (
                          <div className="attachment-chip">📎 {msg.file}</div>
                        )}

                        <div
                          className={`message-text ${
                            loading &&
                            index === messages.length - 1 &&
                            msg.role === "assistant"
                              ? "typing-cursor"
                              : ""
                          }`}
                        >
                          {msg.role === "assistant" ? (
                            <>
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  code({ className, children }) {
                                    const match = /language-(\w+)/.exec(
                                      className || "",
                                    );
                                    const codeText = String(children).replace(
                                      /\n$/,
                                      "",
                                    );

                                    if (match) {
                                      return (
                                        <div className="code-block">
                                          <div className="code-header">
                                            <span>{match[1]}</span>

                                            <div className="code-actions">
                                              <button
                                                className="copy-code-btn"
                                                onClick={() => {
                                                  navigator.clipboard.writeText(
                                                    codeText,
                                                  );
                                                  setCopiedCode(codeText);
                                                  setTimeout(
                                                    () => setCopiedCode(""),
                                                    2000,
                                                  );
                                                }}
                                              >
                                                {copiedCode === codeText
                                                  ? "Copied ✓"
                                                  : "Copy"}
                                              </button>

                                              <button
                                                className="copy-code-btn"
                                                onClick={() => {
                                                  const blob = new Blob(
                                                    [codeText],
                                                    {
                                                      type: "text/plain;charset=utf-8",
                                                    },
                                                  );

                                                  const url =
                                                    URL.createObjectURL(blob);
                                                  const a =
                                                    document.createElement("a");
                                                  a.href = url;
                                                  a.download = `code.${match[1]}`;
                                                  document.body.appendChild(a);
                                                  a.click();
                                                  document.body.removeChild(a);
                                                  URL.revokeObjectURL(url);
                                                }}
                                              >
                                                Download
                                              </button>
                                            </div>
                                          </div>

                                          <SyntaxHighlighter
                                            language={match[1]}
                                            style={oneDark}
                                            PreTag="div"
                                            wrapLongLines={false}
                                            showLineNumbers={false}
                                            customStyle={{
                                              margin: 0,
                                              padding: "16px",
                                              background: "#0b1220",
                                              borderRadius: 0,
                                              overflowX: "auto",
                                              whiteSpace: "pre",
                                              fontSize: "14px",
                                              lineHeight: "1.6",
                                            }}
                                            codeTagProps={{
                                              style: {
                                                whiteSpace: "pre",
                                                wordBreak: "normal",
                                                overflowWrap: "normal",
                                              },
                                            }}
                                          >
                                            {String(codeText)
                                              .replace(/^```[a-zA-Z]*\n/, "")
                                              .replace(/\n```$/, "")
                                              .replace(/\\\\n/g, "\n")
                                              .replace(/\\\\t/g, "\t")}
                                          </SyntaxHighlighter>
                                        </div>
                                      );
                                    }

                                    return (
                                      <code className="inline-code">
                                        {children}
                                      </code>
                                    );
                                  },
                                }}
                              >
                                {msg.text || ""}
                              </ReactMarkdown>

                              {msg.sources && msg.sources.length > 0 && (
                                <div className="sources-section">
                                  <div className="sources-title">Sources</div>

                                  {msg.sources.map((source, sourceIndex) => (
                                    <a
                                      key={sourceIndex}
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="source-link"
                                    >
                                      🔗 {source.title}
                                    </a>
                                  ))}
                                </div>
                              )}

                              {index >= 1 && !loading && msg.text?.trim() && (
                                <button
                                  className="regenerate-btn"
                                  onClick={() => regenerateResponse(index)}
                                >
                                  ↻ Regenerate
                                </button>
                              )}
                              {!loading && (
                                <button
                                  className="speak-btn"
                                  onClick={() => speakText(msg.text || "")}
                                >
                                  {isSpeaking ? "⏹ Stop" : "🔊 Read aloud"}
                                </button>
                              )}
                            </>
                          ) : editingIndex === index ? (
                            <div className="edit-message-container">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="edit-message-input"
                              />

                              <div className="edit-message-actions">
                                <button
                                  onClick={() => {
                                    setEditingIndex(null);
                                    setEditingText("");
                                  }}
                                >
                                  Cancel
                                </button>

                                <button
                                  onClick={() => saveEditedMessage(index)}
                                >
                                  Save & Send
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {msg.text}

                              <div className="message-actions">
                                <button
                                  title="Edit"
                                  onClick={() => {
                                    setEditingIndex(index);
                                    setEditingText(msg.text);
                                  }}
                                >
                                  ✏️ Edit
                                </button>
                              </div>
                            </>
                          )}
                          {!loading && msg.text?.trim() && (
                            <div className="message-actions">
                              <button
                                title="Copy"
                                onClick={() => {
                                  navigator.clipboard.writeText(msg.text || "");
                                  setCopiedCode(`message-${index}`);
                                  setTimeout(() => setCopiedCode(""), 2000);
                                }}
                              >
                                {copiedCode === `message-${index}`
                                  ? "Copied ✓"
                                  : "📋 Copy"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* The active assistant message already shows the typing state. */}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="composer">
              <input
                id="file-upload"
                type="file"
                accept="image/*,.pdf"
                style={{ display: "none" }}
                onChange={(e) => setSelectedFile(e.target.files[0])}
              />

              <div className="plus-menu">
                <label htmlFor="file-upload" className="plus">
                  +
                </label>

                <button className="camera-btn" onClick={openCamera}>
                  📷
                </button>

                <button
                  className={`camera-btn ${isListening ? "listening" : ""}`}
                  onClick={startVoiceInput}
                  title={isListening ? "Listening..." : "Voice input"}
                >
                  {isListening ? "🎙️" : "🎤"}
                </button>
              </div>
              <div className="composer-input">
                {selectedFile && (
                  <div className="attachment-chip">
                    📎 {selectedFile.name}
                    <button onClick={() => setSelectedFile(null)}>×</button>
                  </div>
                )}

                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Message DATORUM AI..."
                />
              </div>

              <button
                className="send"
                onClick={isGenerating ? stopGeneration : sendMessage}
              >
                {isGenerating ? "Stop" : loading ? "Thinking..." : "Send"}
              </button>
            </div>

            {/* Camera Modal */}
            {cameraOpen && (
              <div className="camera-modal">
                <div className="camera-box">
                  <video ref={videoRef} autoPlay playsInline />
                  <canvas ref={canvasRef} style={{ display: "none" }} />

                  <div className="camera-actions">
                    <button onClick={capturePhoto}>Capture</button>

                    <button
                      onClick={() => {
                        cameraStream?.getTracks().forEach((t) => t.stop());
                        setCameraOpen(false);
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
