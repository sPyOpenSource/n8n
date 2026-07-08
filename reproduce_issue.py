import nest_asyncio
nest_asyncio.apply()
from playwright.sync_api import sync_playwright

try:
    with sync_playwright():
        print("Success!")
except Exception as e:
    print(f"Caught: {e}")
