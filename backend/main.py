from fastapi import HTTPException
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from gtts import gTTS

import ollama
import fitz
import os
import shutil
import sqlite3
import re
import subprocess
import tempfile
import time
import sys
from pathlib import Path
import urllib.parse
import urllib.request
import json

from database import (
    init_db,
    create_conversation,
    get_all_conversations,
    get_conversation,
    update_conversation,
    update_title,
    pin_conversation,
)


# ======================================================
# APP
# ======================================================


app = FastAPI()


# ======================================================
# CODING LAB
# ======================================================

CODE_TIMEOUT_SECONDS = 5
MAX_CODE_SIZE = 100_000
MAX_INPUT_SIZE = 20_000


def _coding_version_key(version):
    return str(version or "").strip().lower().replace(" ", "")


def _get_runtime(language, version):
    """
    Returns:
      (compile_command, run_command, source_filename)

    Accepts common language names from the frontend and normalizes them
    before selecting the runtime/compiler.
    """

    raw_language = str(language or "").strip().lower()
    normalized_language = re.sub(r"[\s._-]+", "", raw_language)

    # Normalize frontend language names.
    if normalized_language.startswith("python"):
        language = "python"
    elif normalized_language == "c":
        language = "c"
    elif normalized_language in ("cpp", "c++"):
        language = "cpp"
    elif normalized_language in ("javascript", "js", "node", "nodejs"):
        language = "javascript"
    elif normalized_language in ("java", "jdk"):
        language = "java"
    else:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported language. Supported languages: "
                "Python, C, C++, Java and JavaScript."
            ),
        )

    version_key = _coding_version_key(version)
    is_windows = os.name == "nt"

    # =========================
    # PYTHON
    # =========================
    if language == "python":
        if is_windows:
            # Windows Python Launcher:
            # py -3.12 main.py
            digits = re.sub(r"[^0-9]", "", version_key)

            if len(digits) >= 2:
                py_version = f"{digits[0]}.{digits[1:]}"
            else:
                py_version = version_key.replace("python", "")

            # If no valid version was supplied, use the current backend
            # interpreter instead of producing a broken command.
            if not py_version or "." not in py_version:
                return None, [sys.executable, "{source}"], "main.py"

            return None, ["py", f"-{py_version}", "{source}"], "main.py"

        # Render/Linux: use the exact interpreter running FastAPI.
        # This avoids requiring python3.12/python3.13 to be installed separately.
        return None, [sys.executable, "{source}"], "main.py"

    # =========================
    # C
    # =========================
    if language == "c":
        gcc_number = re.search(r"(\d+)", version_key)
        number = gcc_number.group(1) if gcc_number else "14"

        compiler = os.environ.get(
            f"DITORUM_GCC_{number}",
            f"gcc-{number}",
        )

        if is_windows and compiler == f"gcc-{number}":
            compiler = os.environ.get("DITORUM_GCC", "gcc")

        return (
            [compiler, "{source}", "-O0", "-o", "{binary}"],
            ["{binary}"],
            "main.c",
        )

    # =========================
    # C++
    # =========================
    if language == "cpp":
        gcc_number = re.search(r"(\d+)", version_key)
        number = gcc_number.group(1) if gcc_number else "14"

        compiler = os.environ.get(
            f"DITORUM_GXX_{number}",
            f"g++-{number}",
        )

        if is_windows and compiler == f"g++-{number}":
            compiler = os.environ.get("DITORUM_GXX", "g++")

        return (
            [compiler, "{source}", "-O0", "-o", "{binary}"],
            ["{binary}"],
            "main.cpp",
        )

    # =========================
    # JAVA
    # =========================
    if language == "java":
        jdk_number = re.search(r"(\d+)", version_key)
        number = jdk_number.group(1) if jdk_number else "21"

        java_home = (
            os.environ.get(f"DITORUM_JAVA_{number}")
            or os.environ.get("JAVA_HOME")
        )

        if java_home:
            java_exe = os.path.join(
                java_home,
                "bin",
                "java.exe" if is_windows else "java",
            )
            javac_exe = os.path.join(
                java_home,
                "bin",
                "javac.exe" if is_windows else "javac",
            )
        else:
            java_exe = "java"
            javac_exe = "javac"

        return (
            [javac_exe, "{source}"],
            [java_exe, "-cp", "{workdir}", "Main"],
            "Main.java",
        )

    # =========================
    # JAVASCRIPT
    # =========================
    if language == "javascript":
        node_number = re.search(r"(\d+)", version_key)
        number = node_number.group(1) if node_number else "22"

        node_exe = os.environ.get(
            f"DITORUM_NODE_{number}",
            "node",
        )

        return None, [node_exe, "{source}"], "main.js"

    # Defensive fallback.
    raise HTTPException(
        status_code=400,
        detail=(
            "Unsupported language. Supported languages: "
            "Python, C, C++, Java and JavaScript."
        ),
    )


def _format_command(command, source, binary, workdir):
    return [
        item.format(
            source=source,
            binary=binary,
            workdir=workdir,
        )
        for item in command
    ]


def _run_program(language, version, code, user_input):
    if not isinstance(code, str) or not code.strip():
        raise HTTPException(status_code=400, detail="Code cannot be empty.")

    if len(code) > MAX_CODE_SIZE:
        raise HTTPException(status_code=400, detail="Code is too large.")

    if not isinstance(user_input, str):
        user_input = str(user_input or "")

    if len(user_input) > MAX_INPUT_SIZE:
        raise HTTPException(status_code=400, detail="Input is too large.")

    compile_command, run_command, filename = _get_runtime(
        language,
        version,
    )

    with tempfile.TemporaryDirectory(prefix="ditorum_code_") as temp_dir:
        workdir = Path(temp_dir)
        source_path = workdir / filename
        binary_name = "program.exe" if os.name == "nt" else "program"
        binary_path = workdir / binary_name

        source_path.write_text(code, encoding="utf-8")

        if compile_command:
            command = _format_command(
                compile_command,
                str(source_path),
                str(binary_path),
                str(workdir),
            )

            compile_started = time.perf_counter()

            try:
                compile_result = subprocess.run(
                    command,
                    cwd=str(workdir),
                    input="",
                    text=True,
                    capture_output=True,
                    timeout=CODE_TIMEOUT_SECONDS,
                    env={
                        "PATH": os.environ.get("PATH", ""),
                        "SystemRoot": os.environ.get("SystemRoot", ""),
                        "TEMP": temp_dir,
                        "TMP": temp_dir,
                    },
                )
            except FileNotFoundError as exc:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"The selected {language} runtime/compiler is not installed "
                        f"or is not available in PATH: {command[0]}"
                    ),
                ) from exc
            except subprocess.TimeoutExpired:
                raise HTTPException(
                    status_code=408,
                    detail="Compilation timed out.",
                )

            compile_time = int(
                (time.perf_counter() - compile_started) * 1000
            )

            if compile_result.returncode != 0:
                return {
                    "output": "",
                    "error": compile_result.stderr.strip()
                    or compile_result.stdout.strip()
                    or "Compilation failed.",
                    "execution_time_ms": compile_time,
                    "return_code": compile_result.returncode,
                    "stage": "compile",
                }

        command = _format_command(
            run_command,
            str(source_path),
            str(binary_path),
            str(workdir),
        )

        started = time.perf_counter()

        try:
            result = subprocess.run(
                command,
                cwd=str(workdir),
                input=user_input,
                text=True,
                capture_output=True,
                timeout=CODE_TIMEOUT_SECONDS,
                env={
                    "PATH": os.environ.get("PATH", ""),
                    "SystemRoot": os.environ.get("SystemRoot", ""),
                    "TEMP": temp_dir,
                    "TMP": temp_dir,
                },
            )
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"The selected {language} runtime/compiler is not installed "
                    f"or is not available in PATH: {command[0]}"
                ),
            ) from exc
        except subprocess.TimeoutExpired:
            return {
                "output": "",
                "error": (
                    f"Program stopped because it exceeded the "
                    f"{CODE_TIMEOUT_SECONDS}-second time limit."
                ),
                "execution_time_ms": CODE_TIMEOUT_SECONDS * 1000,
                "return_code": -1,
                "stage": "run",
            }

        elapsed = int((time.perf_counter() - started) * 1000)

        return {
            "output": result.stdout,
            "error": result.stderr,
            "execution_time_ms": elapsed,
            "return_code": result.returncode,
            "stage": "run",
        }


@app.post("/run-code")
async def run_code(data: dict):
    language = data.get("language", "python")
    version = data.get("version", "3.13")
    code = data.get("code", "")
    user_input = data.get("input", "")

    if language is None or not str(language).strip():
        language = "python"

    if version is None or not str(version).strip():
        version = "3.13"

    return _run_program(
        language,
        version,
        code,
        user_input,
    )


def _ollama_text(prompt, model=None, num_predict=700):
    """
    Generate coding explanations using the same Ollama Cloud client
    that is already working for normal DITORUM AI chat.
    """

    selected_model = model or CODING_MODEL

    try:
        print("========================================")
        print("CODING AI REQUEST")
        print("Model:", selected_model)
        print("Prompt length:", len(prompt))
        print("========================================")

        response = ollama_client.chat(
            model=selected_model,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            think=False,
            options={
                "temperature": 0.2,
                "num_predict": num_predict,
            },
        )

        # Ollama dictionary response
        if isinstance(response, dict):
            message = response.get("message", {})

            if isinstance(message, dict):
                result = message.get("content", "")

                if result:
                    return result.strip()

            # Fallback for generate-style response
            result = response.get("response", "")

            if result:
                return result.strip()

        # Ollama response object
        message = getattr(response, "message", None)

        if message:
            result = getattr(message, "content", "")

            if result:
                return result.strip()

        result = getattr(response, "response", "")

        if result:
            return result.strip()

        raise RuntimeError("Ollama returned an empty response.")

    except Exception as exc:

        print("========================================")
        print("CODING AI ERROR")
        print(type(exc).__name__)
        print(str(exc))
        print("========================================")

        # Fallback to the normal working Chat model.
        # This means Explain/Debug can still work even if
        # the dedicated coding model is temporarily unavailable.

        if selected_model != CHAT_MODEL:

            try:
                print("Trying fallback model:", CHAT_MODEL)

                response = ollama_client.chat(
                    model=CHAT_MODEL,
                    messages=[
                        {
                            "role": "user",
                            "content": prompt,
                        }
                    ],
                    think=False,
                    options={
                        "temperature": 0.2,
                        "num_predict": num_predict,
                    },
                )

                if isinstance(response, dict):

                    message = response.get("message", {})

                    if isinstance(message, dict):
                        result = message.get("content", "")

                        if result:
                            return result.strip()

                message = getattr(response, "message", None)

                if message:
                    result = getattr(message, "content", "")

                    if result:
                        return result.strip()

            except Exception as fallback_exc:

                print("========================================")
                print("CODING AI FALLBACK ERROR")
                print(type(fallback_exc).__name__)
                print(str(fallback_exc))
                print("========================================")

        raise HTTPException(
            status_code=500,
            detail=(
                "Coding AI failed: "
                f"{type(exc).__name__}: {str(exc)}"
            ),
        ) from exc


@app.post("/explain-code")
async def explain_code(data: dict):
    language = data.get("language", "python")
    version = data.get("version", "")
    code = data.get("code", "")

    if not str(code).strip():
        raise HTTPException(
            status_code=400,
            detail="Code cannot be empty.",
        )

    prompt = f"""
You are DITORUM AI's beginner-friendly programming tutor.

Language: {language}
Version: {version}

CODE:
```{language}
{code}
```

Explain ONLY this code.

Use this structure:

WHAT THIS CODE DOES:
Explain the overall purpose in 1 or 2 simple sentences.

STEP-BY-STEP:
Number the important steps in execution order.
Explain important lines, variable values, loops, conditions,
and function calls when present.

OUTPUT:
Show the expected output only if it can be determined.
Do not invent input or output.

IMPORTANT:
If there is an obvious error, explain it clearly.
If there is no obvious error, say that the code looks correct.

Rules:
- Use very simple language for a beginner.
- Keep the explanation concise.
- Stay focused on this exact code.
- Do not rewrite the entire program.
- Do not discuss unrelated topics.
"""

    explanation = _ollama_text(
        prompt,
        model=CODING_MODEL,
        num_predict=300,
    )

    if not explanation:
        raise HTTPException(
            status_code=500,
            detail="The coding AI did not return an explanation.",
        )

    return {
        "explanation": explanation,
    }


@app.post("/debug-code")
async def debug_code(data: dict):
    language = data.get("language", "python")
    version = data.get("version", "")
    code = data.get("code", "")
    user_input = data.get("input", "")

    if not str(code).strip():
        raise HTTPException(
            status_code=400,
            detail="Code cannot be empty.",
        )

    execution = _run_program(
        language,
        version,
        code,
        user_input,
    )

    actual_error = execution.get("error", "").strip()

    if not actual_error and execution.get("return_code", 0) == 0:
        error_context = "The program ran successfully and produced no runtime/compiler error."
    else:
        error_context = actual_error or "The program returned a non-zero exit code."

    prompt = f"""
You are DITORUM AI's beginner-friendly debugging tutor.

Language: {language}
Version: {version}

CODE:
```{language}
{code}
```

PROGRAM RESULT:
Output:
{execution.get("output", "")}

Error:
{error_context}

Return a clear debugging report with these headings:

## Problem
What is wrong, if anything?

## Why it happened
Explain the cause in simple terms.

## Where to look
Mention the relevant line or code section if you can determine it.

## How to fix it
Give the corrected code or exact change when appropriate.

## Tip
Give one short beginner-friendly lesson.

If there is no error, say that the program ran successfully and explain any possible improvement only if useful.
Do not invent an error that does not exist.
"""

    debug_report = _ollama_text(
        prompt,
        model=CODING_MODEL,
        num_predict=500,
    )

    return {
        "debug": debug_report,
        "output": execution.get("output", ""),
        "error": execution.get("error", ""),
        "execution_time_ms": execution.get("execution_time_ms"),
        "return_code": execution.get("return_code"),
    }


# ======================================================
# TRANSLATOR
# ======================================================

@app.post("/translate")
async def translate_text(data: dict):

    text = str(data.get("text", "")).strip()
    source = str(data.get("source", "en")).strip().lower()
    target = str(data.get("target", "kn")).strip().lower()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty."
        )

    if source == target:
        return {
            "translatedText": text
        }

    try:
        # ==========================================
        # GOOGLE TRANSLATE
        # ==========================================

        encoded_text = urllib.parse.quote(text)

        url = (
            "https://translate.googleapis.com/translate_a/single"
            f"?client=gtx"
            f"&sl={source}"
            f"&tl={target}"
            f"&dt=t"
            f"&q={encoded_text}"
        )

        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0"
            }
        )

        with urllib.request.urlopen(
            request,
            timeout=15
        ) as response:

            result = json.loads(
                response.read().decode("utf-8")
            )

        # Google response contains translated pieces
        translated_parts = []

        for item in result[0]:
            if item and item[0]:
                translated_parts.append(item[0])

        translated = "".join(translated_parts).strip()

        if not translated:
            raise HTTPException(
                status_code=502,
                detail="No translation was returned."
            )

        return {
            "translatedText": translated,
            "source": source,
            "target": target
        }

    except HTTPException:
        raise

    except Exception as e:
        print("Translation error:", e)

        raise HTTPException(
            status_code=500,
            detail="Translation service failed. Please try again."
        )

# ======================================================
# TEXT TO SPEECH
# ======================================================

@app.post("/text-to-speech")
async def text_to_speech(data: dict):

    text = data.get("text", "").strip()
    language = data.get("language", "en")

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty"
        )

    try:
        # Create speech
        tts = gTTS(
            text=text,
            lang=language,
            slow=False
        )

        # Save temporary audio file
        audio_file = "translation_audio.mp3"

        tts.save(audio_file)

        # Send audio back to frontend
        return StreamingResponse(
            open(audio_file, "rb"),
            media_type="audio/mpeg"
        )

    except Exception as e:

        print("Text-to-speech error:", e)

        raise HTTPException(
            status_code=500,
            detail="Could not generate speech"
        )


# ======================================================
# INITIALIZE DATABASE
# ======================================================

init_db()


# ======================================================
# CORS
# ======================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:5173",
    "http://localhost:5174",
    "*",
],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ======================================================
# UPLOAD FOLDER
# ======================================================

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ======================================================
# MODELS
# ======================================================

OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY")

if OLLAMA_API_KEY:
    ollama_client = ollama.Client(
        host="https://ollama.com",
        headers={
            "Authorization": f"Bearer {OLLAMA_API_KEY}"
        },
    )

    CHAT_MODEL = "gpt-oss:20b-cloud"
    VISION_MODEL = "qwen3-vl:235b-cloud"
    CODING_MODEL = "qwen3-coder:480b-cloud"

else:
    ollama_client = ollama.Client()

    CHAT_MODEL = "qwen3:8b"
    VISION_MODEL = "qwen2.5vl:7b"
    CODING_MODEL = "llama3.2"


# ======================================================
# HOME
# ======================================================

@app.get("/")
def home():
    return {
        "name": "DITORUM AI",
        "version": "5.0",
        "status": "running",
        "chat_model": CHAT_MODEL,
        "vision_model": VISION_MODEL,
        "coding_model": CODING_MODEL,
        "web_search": True,
    }


# ======================================================
# CONVERSATION APIs
# ======================================================

@app.get("/conversations")
def conversations():

    rows = get_all_conversations()

    return [
        {
            "id": row[0],
            "title": row[1],
            "pinned": row[2],
            "created_at": row[3],
        }
        for row in rows
    ]


@app.post("/conversations")
def new_conversation():

    conversation_id = create_conversation(
        "New Chat",
        [],
    )

    return {
        "id": conversation_id,
    }


@app.get("/conversations/{conversation_id}")
def load_conversation(conversation_id: int):

    messages = get_conversation(
        conversation_id
    )

    return {
        "messages": messages,
    }


@app.put("/conversations/{conversation_id}/title")
def rename_conversation(
    conversation_id: int,
    data: dict,
):

    title = data.get(
        "title",
        ""
    ).strip()

    if not title:
        raise HTTPException(
            status_code=400,
            detail="Title is required",
        )

    update_title(
        conversation_id,
        title,
    )

    return {
        "success": True,
    }


@app.put("/conversations/{conversation_id}/pin")
def toggle_pin(
    conversation_id: int,
    data: dict,
):

    pinned = data.get(
        "pinned",
        0
    )

    pin_conversation(
        conversation_id,
        pinned,
    )

    return {
        "success": True,
    }


# ======================================================
# GENERATE CONVERSATION TITLE
# ======================================================

@app.post("/conversations/{conversation_id}/generate-title")
def generate_conversation_title(
    conversation_id: int,
):

    previous_messages = get_conversation(
        conversation_id
    )

    if not previous_messages:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )

    first_user = next(
        (
            m.get("text", "")
            for m in previous_messages
            if m.get("role") == "user"
        ),
        "New Chat",
    )

    prompt = (
        "Generate a short conversation title "
        "with a maximum of 5 words.\n"
        "Return ONLY the title.\n"
        "No quotes.\n"
        "No punctuation.\n"
        "No explanation.\n\n"
        f"Message: {first_user}"
    )

    try:

        response = ollama_client.generate(
            model=CHAT_MODEL,
            prompt=prompt,
            think=False,
            options={
                "temperature": 0.2,
                "num_predict": 20,
            },
        )

        title = (
            response["response"]
            .strip()
            .split("\n")[0]
        )

    except Exception as e:

        print(
            "Title generation error:",
            e
        )

        title = (
            first_user[:40]
            if first_user
            else "New Chat"
        )

    update_title(
        conversation_id,
        title,
    )

    return {
        "title": title,
    }


# ======================================================
# DELETE CONVERSATION
# ======================================================

@app.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int,
):

    conn = sqlite3.connect(
        "ditorum.db"
    )

    cur = conn.cursor()

    cur.execute(
        "DELETE FROM conversations "
        "WHERE id = ?",
        (conversation_id,),
    )

    conn.commit()
    conn.close()

    return {
        "success": True,
    }


# ======================================================
# HELPER
# Conversation → Ollama
# ======================================================

def build_ollama_history(messages):

    history = []

    for msg in messages:

        role = msg.get(
            "role",
            "user"
        )

        content = msg.get(
            "text",
            "",
        )

        if not content:
            continue

        history.append(
            {
                "role": role,
                "content": content,
            }
        )

    return history


# ======================================================
# WEB SEARCH
# ======================================================

def search_web(query):

    try:

        print(
            "Searching web for:",
            query
        )

        results = ollama_client.web_search(
            query
        )

        search_text = ""
        sources = []

        # Only use the first 5 results.
        # This keeps the prompt smaller and faster.
        for result in results.results[:5]:

            title = getattr(
                result,
                "title",
                ""
            )

            url = getattr(
                result,
                "url",
                ""
            )

            content = getattr(
                result,
                "content",
                ""
            )

            # Limit each result's content.
            content = content[:2500]

            search_text += (
                f"TITLE: {title}\n"
                f"URL: {url}\n"
                f"CONTENT: {content}\n"
                "--------------------------------\n"
            )

            if title and url:

                sources.append(
                    {
                        "title": title,
                        "url": url,
                    }
                )

        # Final safety limit for the AI prompt.
        search_text = search_text[:10000]

        return search_text, sources

    except Exception as e:

        print(
            "Web search error:",
            e
        )

        return "", []


# ======================================================
# FAST SMART WEB SEARCH DECISION
# ======================================================

def should_search_web(question):

    q = question.lower().strip()

    # --------------------------------------------------
    # CURRENT / TIME-SENSITIVE KEYWORDS
    # --------------------------------------------------

    current_keywords = [
        "current",
        "currently",
        "latest",
        "newest",
        "recent",
        "recently",
        "today",
        "tonight",
        "yesterday",
        "tomorrow",
        "this week",
        "this month",
        "this year",
        "right now",
        "at present",
        "as of now",
        "in 2026",
        "in 2025",
        "2026",
        "2025",
        "news",
        "breaking",
        "update",
        "updates",
        "live",
        "real time",
        "realtime",
        "price",
        "prices",
        "cost",
        "weather",
        "forecast",
        "score",
        "scores",
        "won",
        "winner",
        "match",
        "matches",
        "election",
        "elections",
        "government",
        "rules",
        "regulations",
        "law",
        "laws",
        "released",
        "release",
        "launched",
        "launch",
        "launches",
        "available now",
        "hiring",
        "stock",
        "stocks",
        "share price",
        "bitcoin",
        "crypto",
    ]

    # --------------------------------------------------
    # IF CURRENT KEYWORD EXISTS → SEARCH
    # --------------------------------------------------

    for keyword in current_keywords:

        if keyword in q:

            print(
                "FAST SEARCH DECISION: SEARCH"
            )

            return True


    # --------------------------------------------------
    # PRODUCT / VEHICLE / TECHNOLOGY BRANDS
    # --------------------------------------------------

    product_keywords = [

        # Motorcycles
        "apache",
        "tvs",
        "yamaha",
        "r15",
        "mt-15",
        "mt 15",
        "royal enfield",
        "classic 350",
        "hunter 350",
        "continental gt",
        "honda",
        "hero",
        "bajaj",
        "pulsar",
        "ktm",
        "duke",
        "dominar",
        "kawasaki",
        "ninja",
        "suzuki",
        "harley",
        "triumph",
        "bmw motorcycle",

        # Cars
        "toyota",
        "hyundai",
        "mahindra",
        "tata motors",
        "kia",
        "maruti",
        "volkswagen",
        "audi",
        "bmw",
        "mercedes",
        "tesla",
        "volvo",
        "lexus",

        # Phones / electronics
        "iphone",
        "ipad",
        "macbook",
        "samsung",
        "oneplus",
        "pixel",
        "google pixel",
        "xiaomi",
        "redmi",
        "realme",
        "oppo",
        "vivo",

        # AI / technology
        "chatgpt",
        "gemini",
        "claude",
        "qwen",
        "ollama",
        "openai",
        "nvidia",
        "rtx",
        "gpu",
        "processor",
        "laptop",
        "smartphone",
    ]

    # --------------------------------------------------
    # PRODUCT BRAND / MODEL DETECTION
    # --------------------------------------------------

    for keyword in product_keywords:

        if keyword in q:

            print(
                "FAST SEARCH DECISION: "
                "PRODUCT SEARCH"
            )

            return True


    # --------------------------------------------------
    # PRODUCT-STYLE QUESTIONS
    # --------------------------------------------------

    product_phrases = [

        "tell me about",
        "details about",
        "information about",
        "info about",
        "specifications of",
        "specs of",
        "features of",
        "review of",
        "review about",
        "price of",
        "cost of",
        "how much is",
        "how much does",
        "where can i buy",
        "is it available",
        "should i buy",
        "is it worth buying",
    ]

    product_categories = [

        "bike",
        "bikes",
        "motorcycle",
        "motorcycles",
        "scooter",
        "scooters",
        "car",
        "cars",
        "vehicle",
        "vehicles",
        "phone",
        "phones",
        "smartphone",
        "smartphones",
        "laptop",
        "laptops",
        "tablet",
        "tablets",
        "camera",
        "cameras",
        "gpu",
        "graphics card",
        "processor",
        "cpu",
        "product",
        "model",
        "device",
        "devices",
    ]

    # Search if the question contains both
    # a product-style phrase and product category.

    has_product_phrase = any(
        phrase in q
        for phrase in product_phrases
    )

    has_product_category = any(
        category in q
        for category in product_categories
    )

    if (
        has_product_phrase
        and has_product_category
    ):

        print(
            "FAST SEARCH DECISION: "
            "PRODUCT QUESTION SEARCH"
        )

        return True


    # --------------------------------------------------
    # QUESTIONS CONTAINING MODEL NUMBERS
    # --------------------------------------------------

    # Example:
    # Apache RTX 300
    # iPhone 17
    # RTX 5090
    # R15 V4
    # Galaxy S25

    has_model_number = bool(
        re.search(
            r"\b[a-zA-Z]{1,10}[- ]?\d{2,5}\b",
            q
        )
    )

    if has_model_number:

        print(
            "FAST SEARCH DECISION: "
            "MODEL NUMBER SEARCH"
        )

        return True


    # --------------------------------------------------
    # DEFAULT
    # --------------------------------------------------

    print(
        "FAST SEARCH DECISION: NO_SEARCH"
    )

    return False


# ======================================================
# MAIN CHAT
# ======================================================

@app.post("/chat")
async def chat(data: dict):

    message = data.get(
        "message",
        ""
    ).strip()

    conversation_id = data.get(
        "conversation_id"
    )

    if not message:

        raise HTTPException(
            status_code=400,
            detail="Message cannot be empty",
        )


    # ==================================================
    # LOAD CONVERSATION
    # ==================================================

    previous_messages = (
        get_conversation(
            conversation_id
        )
        if conversation_id
        else []
    )


    # ==================================================
    # FAST WEB SEARCH DECISION
    # ==================================================

    needs_web_search = (
        should_search_web(
            message
        )
    )


    # ==================================================
    # BUILD OLLAMA MESSAGES
    # ==================================================

    ollama_messages = []


    # ==================================================
    # SYSTEM PROMPT
    # ==================================================

    ollama_messages.append(
        {
            "role": "system",
            "content": (
                "You are DITORUM AI, a helpful, "
                "intelligent, accurate AI assistant.\n\n"

                "Answer the user's actual question "
                "directly and naturally.\n\n"

                "IMPORTANT RULES:\n"

                "- Give the answer first when "
                "appropriate.\n"

                "- Do not generate code unless "
                "the user asks for code or "
                "programming help.\n"

                "- Do not provide URLs in the "
                "answer unless the user asks "
                "for sources or a URL is genuinely "
                "useful.\n"

                "- When current web information "
                "is provided, use it to answer "
                "accurately.\n"

                "- Prefer official government, "
                "university, company, and primary "
                "sources.\n"

                "- Do not blindly trust one "
                "search result.\n"

                "- Compare information when "
                "necessary.\n"

                "- If reliable sources disagree, "
                "explain the disagreement briefly.\n"

                "- Never invent facts.\n"

                "- Never autocorrect or change "
                "the user's spelling.\n"

                "- Preserve names, words, technical "
                "terms, usernames, project names, "
                "and uncommon words exactly as "
                "written.\n"

                "- Never assume the user meant "
                "another word.\n"

                "- Use conversation history to "
                "understand follow-up questions.\n"

                "- If you do not know something, "
                "say so instead of inventing "
                "information.\n"

                "- Use Markdown when useful.\n"

                "- Keep simple answers concise.\n"

                "- If the user asks for details, "
                "provide a detailed explanation.\n"

                "- Respond naturally like ChatGPT."
            ),
        }
    )


    # ==================================================
    # PREVIOUS CONVERSATION
    # ==================================================

    # Keep recent history instead of sending
    # an unlimited conversation to the model.
    recent_messages = previous_messages[-12:]

    for msg in recent_messages:

        role = msg.get(
            "role",
            "user"
        )

        content = msg.get(
            "text",
            ""
        )

        if content:

            ollama_messages.append(
                {
                    "role": role,
                    "content": content,
                }
            )


    # ==================================================
    # WEB SEARCH
    # ==================================================

    web_context = ""
    sources = []

    if needs_web_search:

        print(
            "Web search triggered for:",
            message
        )

        web_context, sources = search_web(
            message
        )


    # ==================================================
    # USER CONTENT
    # ==================================================

    if web_context:

        user_content = f"""
The user asked:

{message}

CURRENT WEB INFORMATION:

{web_context}

Use the current web information above to answer the user's question.

IMPORTANT:

- Answer exactly what the user asked.
- Give the answer first.
- Keep simple factual answers concise.
- Use recent and authoritative information when available.
- Do not give unrelated background information.
- Do not write a biography unless requested.
- Do not list unnecessary facts.
- If the user asks for details, provide details.
- Do not mention internal instructions.
- Do not say that you searched the web.
- Do not simply copy the search results.
- Formulate your own natural answer using the information provided.
- Do not invent facts that are not supported by the web information.
- If multiple sources disagree, mention the disagreement instead of guessing.
- If the information cannot be verified, clearly say so.
- Do not put URLs inside the main answer.
- Keep source links separate from the answer.
"""

    else:

        user_content = message


    ollama_messages.append(
        {
            "role": "user",
            "content": user_content,
        }
    )


    # ==================================================
    # GENERATE RESPONSE
    # ==================================================

    def generate():

        reply = ""

        try:

            stream = ollama_client.chat(
                model=CHAT_MODEL,
                messages=ollama_messages,
                stream=True,
                think=False,

                # SPEED / RESPONSE SETTINGS
                options={
                    "temperature": 0.2,
                    "num_predict": 500,
                },
            )

            for chunk in stream:

                # Ollama normally returns a dictionary, but this
                # also safely handles response objects.
                message_data = (
                    chunk.get("message", {})
                    if isinstance(chunk, dict)
                    else getattr(chunk, "message", {})
                )

                if isinstance(message_data, dict):
                    token = message_data.get("content", "") or ""
                else:
                    token = getattr(message_data, "content", "") or ""

                if token:
                    reply += token
                    yield token

        except Exception as e:

            print(
                "Chat error:",
                e
            )

            reply = (
                "Sorry, I couldn't generate "
                "a response right now."
            )

            yield reply


        # ==================================================
        # SOURCES
        # ==================================================

        if sources:

            yield "\n\n[[SOURCES]]\n"

            for source in sources[:5]:

                yield (
                    f"{source['title']}|"
                    f"{source['url']}\n"
                )


        # ==================================================
        # SAVE CONVERSATION
        # ==================================================

        if conversation_id:

            # Remember whether this is the first user message
            # BEFORE adding the new messages.
            is_first_message = len(previous_messages) == 0

            previous_messages.append(
                {
                    "role": "user",
                    "text": message,
                }
            )

            # Save sources together with answer.
            previous_messages.append(
                {
                    "role": "assistant",
                    "text": reply,
                    "sources": sources,
                }
            )

            # Save the conversation messages.
            update_conversation(
                conversation_id,
                previous_messages,
            )

            # ==================================================
            # SAVE FIRST MESSAGE AS SIDEBAR TITLE
            # ==================================================
            if is_first_message:

                title = message.strip()

                # Remove common conversational prefixes so titles
                # look cleaner in the sidebar.
                title = re.sub(
                    r"^(tell me about|tell me|explain|give me information about|give me info about|information about|info about|details about|show me|write about)\s+",
                    "",
                    title,
                    flags=re.IGNORECASE,
                ).strip()

                # Keep the sidebar title short.
                if len(title) > 45:
                    title = title[:45].rstrip() + "..."

                if not title:
                    title = "New Chat"

                update_title(
                    conversation_id,
                    title,
                )


    return StreamingResponse(
        generate(),
        media_type="text/plain",
    )


# ======================================================
# CHAT WITH FILE
# ======================================================

@app.post("/chat-with-file")
async def chat_with_file(
    message: str = Form(...),
    conversation_id: int = Form(...),
    file: UploadFile = File(...),
):

    # ==================================================
    # SAVE FILE
    # ==================================================

    safe_filename = os.path.basename(
        file.filename
    )

    file_path = os.path.join(
        UPLOAD_FOLDER,
        safe_filename
    )

    with open(
        file_path,
        "wb"
    ) as buffer:

        shutil.copyfileobj(
            file.file,
            buffer
        )

    extension = os.path.splitext(
        safe_filename
    )[1].lower()


    # ==================================================
    # LOAD CONVERSATION
    # ==================================================

    previous_messages = get_conversation(
        conversation_id
    )

    ollama_messages = (
        build_ollama_history(
            previous_messages
        )
    )


    # ==================================================
    # PDF
    # ==================================================

    if extension == ".pdf":

        doc = fitz.open(
            file_path
        )

        text = ""

        for page in doc:

            text += page.get_text()

        doc.close()

        # Limit PDF content for faster processing.
        pdf_content = text[:12000]

        prompt = f"""
You are DITORUM AI.

The user uploaded a PDF.

PDF CONTENT:

{pdf_content}

USER QUESTION:

{message}

Answer the user's question using
the PDF content.

Give the answer directly.

If the user asks for an explanation,
explain it clearly and in detail.

Do not invent information that is not
supported by the PDF.
"""

        ollama_messages.append(
            {
                "role": "user",
                "content": prompt,
            }
        )

        stream = ollama_client.chat(
            model=CHAT_MODEL,
            messages=ollama_messages,
            stream=True,
            think=False,
            options={
                "temperature": 0.2,
                "num_predict": 500,
            },
        )

        reply = ""

        for chunk in stream:

            message_data = (
                chunk.get("message", {})
                if isinstance(chunk, dict)
                else getattr(chunk, "message", {})
            )

            if isinstance(message_data, dict):
                token = message_data.get("content", "") or ""
            else:
                token = getattr(message_data, "content", "") or ""

            reply += token


    # ==================================================
    # IMAGE
    # ==================================================

    elif extension in [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
    ]:

        image_messages = [
            *ollama_messages,
            {
                "role": "user",
                "content": (
                    message
                    or
                    "Describe this image in detail."
                ),
                "images": [
                    file_path
                ],
            },
        ]

        stream = ollama_client.chat(
            model=VISION_MODEL,
            messages=image_messages,
            stream=True,
            think=False,
            options={
                "temperature": 0.2,
                "num_predict": 500,
            },
        )

        reply = ""

        for chunk in stream:

            message_data = (
                chunk.get("message", {})
                if isinstance(chunk, dict)
                else getattr(chunk, "message", {})
            )

            if isinstance(message_data, dict):
                token = message_data.get("content", "") or ""
            else:
                token = getattr(message_data, "content", "") or ""

            reply += token


    # ==================================================
    # UNSUPPORTED FILE
    # ==================================================

    else:

        reply = (
            "Currently DITORUM AI supports "
            "PDF and image attachments only."
        )


    # ==================================================
    # SAVE FILE CONVERSATION
    # ==================================================

    previous_messages.append(
        {
            "role": "user",
            "text": message,
            "file": safe_filename,
        }
    )

    previous_messages.append(
        {
            "role": "assistant",
            "text": reply,
            "sources": [],
        }
    )

    update_conversation(
        conversation_id,
        previous_messages,
    )


    # ==================================================
    # FIRST CONVERSATION TITLE
    # ==================================================

    if len(previous_messages) == 2:

        title = message.strip()[:40]

        if title:

            update_title(
                conversation_id,
                title
            )


    return {
        "reply": reply,
    }