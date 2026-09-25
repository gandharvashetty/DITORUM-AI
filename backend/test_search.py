import ollama

print("Searching the web...")

results = ollama.web_search(
    "Who is the current Prime Minister of India in 2026?"
)

print("\nSEARCH RESULTS:\n")

for result in results.results:
    print("TITLE:", result.title)
    print("URL:", result.url)
    print("CONTENT:", result.content[:500])
    print("-" * 80)