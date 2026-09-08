"""
gen_session.py — Instant Telegram MTProto Session String Generator
Runs directly with Python!
"""

import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

API_ID = 39381974
API_HASH = "966567ba55e48502b1ed766404c12c64"

async def main():
    print("\n" + "=" * 56)
    print("   Study Hub — Telegram Session String Generator")
    print("=" * 56 + "\n")
    print(f"Using Telegram API ID: {API_ID}\n")

    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.start()

    session_string = client.session.save()

    print("\n" + "=" * 20 + " YOUR SESSION STRING " + "=" * 20)
    print(session_string)
    print("=" * 61 + "\n")
    print("Copy the above SESSION_STRING and paste it into your Render Environment Variables.\n")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
