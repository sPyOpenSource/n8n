import asyncio
from playwright.sync_api import sync_playwright

async def main():
    print("Loop is running...")
    try:
        with sync_playwright() as p:
            print("Success!")
    except Exception as e:
        print(f"Caught: {e}")

asyncio.run(main())
