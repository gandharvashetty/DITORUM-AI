import sqlite3
import json

DB_NAME = "ditorum.db"

def get_connection():
    return sqlite3.connect(DB_NAME)

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            messages TEXT,
            pinned INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    conn.commit()
    conn.close()

def create_conversation(title, messages):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "INSERT INTO conversations (title, messages) VALUES (?, ?)",
        (title, json.dumps(messages)),
    )

    conversation_id = cursor.lastrowid

    conn.commit()
    conn.close()

    return conversation_id

def get_all_conversations():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT id, title, pinned, created_at
        FROM conversations
        ORDER BY pinned DESC, created_at DESC
        """
    )

    rows = cursor.fetchall()
    conn.close()
    return rows

def get_conversation(conversation_id):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT messages FROM conversations WHERE id=?",
        (conversation_id,),
    )

    row = cursor.fetchone()

    conn.close()

    if row:
        return json.loads(row[0])

    return []

def update_conversation(conversation_id, messages):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "UPDATE conversations SET messages=? WHERE id=?",
        (json.dumps(messages), conversation_id),
    )

    conn.commit()
    conn.close()

def update_title(conversation_id, title):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "UPDATE conversations SET title=? WHERE id=?",
        (title, conversation_id),
    )

    conn.commit()
    conn.close()

def pin_conversation(conversation_id, pinned):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "UPDATE conversations SET pinned = ? WHERE id = ?",
        (pinned, conversation_id)
    )

    conn.commit()
    conn.close()