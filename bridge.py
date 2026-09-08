import os
import asyncio
import logging
import time
import re
from telethon import TelegramClient, events
from telethon.sessions import StringSession
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger('RangeXBridge')

STORAGE_CHANNEL_ID = os.environ.get('STORAGE_CHANNEL_ID', '')
TARGET_BOT = 'AS_Multiverserobot'

class VideoBridge:
    def __init__(self, bot_token: str, bot_username: str):
        self.bot_token = bot_token
        self.bot_username = bot_username
        self.client = None
        self.me = None
        self.me_id = None
        self.active = False
        self.pending_requests = {}
        self.lock = asyncio.Lock()
        self.last_query_time = 0

    async def initialize(self):
        api_id = int(os.environ.get('TG_API_ID', 0) or 0)
        api_hash = os.environ.get('TG_API_HASH', '')
        session_str = os.environ.get('TELETHON_SESSION', '')

        if not api_id or not api_hash or not session_str:
            logger.info("Telethon credentials not fully provided in env. Bridge running in passive mode.")
            return False

        try:
            self.client = TelegramClient(StringSession(session_str), api_id, api_hash)
            await self.client.start()
            self.me = await self.client.get_me()
            self.me_id = self.me.id
            self.active = True
            
            logger.info(f"⚡ RangeXCoder Bridge connected as @{self.me.username} (ID: {self.me.id})")
            logger.info(f"Connected strictly to upstream bot: @{TARGET_BOT}")

            # Event handler for incoming messages from @AS_Multiverserobot
            @self.client.on(events.NewMessage(chats=TARGET_BOT))
            async def on_as_multiverse_message(event):
                await self._handle_target_bot_message(event)

            return True
        except Exception as e:
            logger.error(f"Failed to start Telethon Bridge: {e}")
            self.active = False
            return False

    async def _delayed_retry(self, query: str, delay: int):
        try:
            logger.info(f"⏳ Sleeping {delay}s for upstream bot cooldown...")
            await asyncio.sleep(delay)
            if self.client and self.active:
                logger.info(f"🔄 Retrying query to @{TARGET_BOT}: {query}")
                self.last_query_time = time.time()
                await self.client.send_message(TARGET_BOT, query)
        except Exception as e:
            logger.error(f"Error in delayed retry: {e}")

    async def _handle_target_bot_message(self, event):
        msg = event.message
        if not msg:
            return

        text = msg.text or ""
        logger.info(f"Received message from @{TARGET_BOT}: ID={msg.id} Media={bool(msg.media)}")

        # Case A: Not found in database response
        if "Not Found" in text or "not available" in text.lower():
            logger.warning(f"@{TARGET_BOT} returned content not found: {text[:80]}")
            async with self.lock:
                for req_key, req_info in list(self.pending_requests.items()):
                    fut = req_info.get('future')
                    if fut and not fut.done():
                        fut.set_exception(FileNotFoundError("Content not available in upstream store"))
                    self.pending_requests.pop(req_key, None)
            return

        # Case B: Rate Limit / Cooldown Countdown response ("Please Wait! You need to wait X seconds")
        if "Please Wait" in text or "You need to wait" in text:
            m = re.search(r'wait\s+\*?\*?(\d+)\*?\*?\s+second', text, re.IGNORECASE)
            wait_sec = int(m.group(1)) if m else 6
            logger.info(f"⏳ Upstream requested wait of {wait_sec}s. Scheduling automatic retry...")
            async with self.lock:
                for req_key, req_info in list(self.pending_requests.items()):
                    q = req_info.get('query')
                    if q:
                        asyncio.create_task(self._delayed_retry(q, wait_sec + 1))
            return

        # Case C: Real Video or Document delivered by @AS_Multiverserobot
        is_video = bool(msg.video)
        is_doc_video = bool(
            msg.media and hasattr(msg.media, 'document') and 
            'video' in getattr(msg.media.document, 'mime_type', '')
        )

        if is_video or is_doc_video:
            # Extract filename if available
            fname = ""
            if msg.media and hasattr(msg.media, 'document'):
                for attr in msg.media.document.attributes:
                    if hasattr(attr, 'file_name'):
                        fname = attr.file_name or ""

            logger.info(f"Real video delivered by @{TARGET_BOT}! Filename: {fname}")

            # Guard: check if upstream sent the default fallback "Current Electricity 09"
            fallback_markers = ["current electricity 09", "current_electricity_09"]
            is_fallback_default = any(m in fname.lower() or m in text.lower() for m in fallback_markers)

            async with self.lock:
                if is_fallback_default:
                    # Check if pending request is actually asking for Current Electricity
                    for req_key, req_info in list(self.pending_requests.items()):
                        req_name = (req_info.get('name') or '').lower()
                        if "current electricity" not in req_name:
                            logger.warning(f"Upstream returned default 'Current Electricity 09' for unrelated request '{req_info.get('name')}'. Rejecting!")
                            fut = req_info.get('future')
                            if fut and not fut.done():
                                fut.set_exception(FileNotFoundError(f"Lecture '{req_info.get('name')}' is not available in upstream store"))
                            self.pending_requests.pop(req_key, None)
                    return

                matched_key = None
                # Match by content_id in filename or text
                for req_key, req_info in self.pending_requests.items():
                    c_id = str(req_info.get('content_id', '')).strip()
                    if c_id and (c_id in fname or c_id in text):
                        matched_key = req_key
                        break

                # If no direct filename match, match the first pending request
                if not matched_key and self.pending_requests:
                    matched_key = next(iter(self.pending_requests.keys()))

                if matched_key:
                    req_info = self.pending_requests.pop(matched_key)
                    fut = req_info.get('future')
                    if fut and not fut.done():
                        fut.set_result(msg)
                    logger.info(f"Resolved pending video request: {matched_key}")

    async def fetch_and_forward_to_bot(self, student_chat_id: int, payload: dict, quality: str = '720p', timeout: int = 60, caption: str = ""):
        """
        1. Queries @AS_Multiverserobot with /start {batchId}_{contentId}_{quality}.
        2. Waits for matching video.
        3. Relays the video cleanly (no forward header) with custom caption to @RangeXCoder_studybot.
        """
        if not self.active or not self.client or not self.me:
            logger.warning("Bridge is not active.")
            return None

        batch_id = str(payload.get('batchId') or '').strip()
        content_id = str(payload.get('contentId') or '').strip()
        quality_num = quality.lower().replace('p', '').strip()  # '720', '480', '360', '240'

        if not content_id:
            logger.error("Bridge cannot query AS_Multiverse: content_id is missing!")
            return None

        # Format exact query for @AS_Multiverserobot
        if batch_id and content_id:
            query = f"/start {batch_id}_{content_id}_{quality_num}"
        else:
            query = f"/start {content_id}_{quality_num}"

        req_key = f"req_{content_id}_{quality_num}_{int(asyncio.get_event_loop().time() * 1000)}"
        loop = asyncio.get_running_loop()
        future = loop.create_future()

        async with self.lock:
            self.pending_requests[req_key] = {
                'future': future,
                'status': 'waiting_video',
                'quality': quality_num,
                'content_id': content_id,
                'batch_id': batch_id,
                'student_chat_id': student_chat_id,
                'name': payload.get('name', 'Lecture'),
                'query': query
            }

        # Pacing: Avoid triggering upstream "Please wait 6 seconds" rate-limit
        now = time.time()
        elapsed = now - self.last_query_time
        if elapsed < 7.0:
            sleep_needed = 7.0 - elapsed
            logger.info(f"⏳ Pacing upstream queries: waiting {sleep_needed:.1f}s before sending to @{TARGET_BOT}...")
            await asyncio.sleep(sleep_needed)

        try:
            self.last_query_time = time.time()
            logger.info(f"Querying @{TARGET_BOT}: {query}")
            await self.client.send_message(TARGET_BOT, query)
        except Exception as e:
            logger.error(f"Error querying @{TARGET_BOT}: {e}")
            async with self.lock:
                self.pending_requests.pop(req_key, None)
            return None

        # Wait for video message from @AS_Multiverserobot
        try:
            video_msg = await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(f"Timed out waiting for video ({quality}) from @{TARGET_BOT}.")
            async with self.lock:
                self.pending_requests.pop(req_key, None)
            return None
        except FileNotFoundError as fe:
            logger.info(f"Content not available in upstream store: {fe}")
            return None

        # Send video cleanly directly to @RangeXCoder_studybot
        try:
            bot_entity = await self.client.get_entity(self.bot_username)
            faculty = payload.get('faculty')
            faculty_line = f"By {faculty}\n\n" if faculty else ""
            custom_caption = caption or (
                f"{faculty_line}"
                f"📹 Title: {payload.get('name', 'Lecture')}\n\n"
                f"🏫 Subject: {payload.get('subject', 'Physics')}\n\n"
                f"🚩 Topic: {payload.get('topic', 'General')}\n\n"
                f"🎬 Quality: {quality}\n\n"
                f"⚡ Powered by @badboy_295"
            )
            # Use send_message with file=video_msg.media:
            # - Completely removes "Forwarded from AS MULTIVERSE" header (fwd_from=None)
            # - Sets custom caption ending with ⚡ Powered by @badboy_295
            # - Instant file transmission without downloading/re-uploading
            forwarded = await self.client.send_message(
                bot_entity,
                custom_caption,
                file=video_msg.media
            )
            logger.info(f"Relayed clean unforwarded video to @{self.bot_username} for delivery!")
            
            # Storage Channel Backup (Deduplicated!)
            channel_msg_id = None
            try:
                from vault import vault_get_video
                existing = vault_get_video(content_id, quality_num)
                if existing and existing.get('channel_msg_id'):
                    channel_msg_id = existing.get('channel_msg_id')
                    logger.info(f"Video already backed up in storage channel (Msg ID: {channel_msg_id}), skipping duplicate upload.")
            except Exception:
                pass

            if not channel_msg_id and STORAGE_CHANNEL_ID:
                try:
                    ch_target = int(STORAGE_CHANNEL_ID)
                    ch_msg = await self.client.send_message(ch_target, custom_caption, file=video_msg.media)
                    if ch_msg:
                        channel_msg_id = ch_msg.id
                        logger.info(f"💾 Video successfully backed up to Storage Channel! Msg ID: {channel_msg_id}")
                except Exception as ex:
                    logger.error(f"Failed to post video to Storage Channel {STORAGE_CHANNEL_ID}: {ex}")

            return {
                'forwarded': forwarded,
                'channel_msg_id': channel_msg_id,
                'batch_id': batch_id,
                'content_id': content_id,
                'quality': quality_num,
                'caption': custom_caption
            }
        except Exception as e:
            logger.error(f"Failed to relay video to bot: {e}")
            return None
