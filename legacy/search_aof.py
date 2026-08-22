import requests, re

headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
urls = [
    "https://www.google.com/search?q=Chinese+pianist+%22Art+of+Fugue%22+Bach+recording",
    "https://www.google.com/search?q=%E6%9C%B1%E6%99%93%E7%8E%AB+%E8%B5%8B%E6%A0%BC%E7%9A%84%E8%89%BA%E6%9C%AF",
    "https://www.google.com/search?q=%E8%B5%8B%E6%A0%BC%E7%9A%84%E8%89%BA%E6%9C%AF+%E9%92%A2%E7%90%B4+%E7%89%88%E6%9C%AC+%E6%8E%A8%E8%8D%90",
]
for url in urls:
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        text = re.sub(r"<[^>]+>", " ", resp.text)
        text = re.sub(r"\s+", " ", text)
        chunks = [c.strip() for c in text.split("  ") if len(c.strip()) > 40]
        for c in chunks[:8]:
            print(c[:300])
            print("---")
    except Exception as e:
        print(f"Error: {e}")
    print("==")
