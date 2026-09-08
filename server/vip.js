// ════════════════════════════════════════════════════════════════
// server/vip.js  —  VIP & Referral System
// Ported from vault.py (Python SQLite) to Node.js + Supabase
// ════════════════════════════════════════════════════════════════

'use strict';

const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const VIP_REFERRAL_THRESHOLD = parseInt(process.env.VIP_REFERRAL_THRESHOLD || '3', 10);

// ─── Supabase Helper ─────────────────────────────────────────
async function sbReq(endpoint, method = 'GET', body = null, prefer = null) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };
  if (prefer) headers['Prefer'] = prefer;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      timeout: 8000
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch (e) {
    return null;
  }
}

// ─── Record Referral ─────────────────────────────────────────
// Returns true if a NEW referral was recorded (not duplicate)
async function recordReferral(referrerId, referredId) {
  if (!referrerId || !referredId || referrerId === referredId) return false;

  // Insert referral (ignore if duplicate via unique constraint on referred_id)
  const inserted = await sbReq(
    'referrals?on_conflict=referred_id',
    'POST',
    { referrer_id: String(referrerId), referred_id: String(referredId), created_at: new Date().toISOString() },
    'resolution=ignore-duplicates,return=representation'
  );

  const wasInserted = Array.isArray(inserted) && inserted.length > 0;

  if (wasInserted) {
    // Check referrer's total count and auto-grant VIP
    const countRes = await sbReq(`referrals?referrer_id=eq.${referrerId}&select=*`);
    const count = Array.isArray(countRes) ? countRes.length : 0;
    if (count >= VIP_REFERRAL_THRESHOLD) {
      await grantVipStatus(referrerId, `${VIP_REFERRAL_THRESHOLD}_referrals`);
    }
  }

  return wasInserted;
}

// ─── Get User VIP Info ────────────────────────────────────────
async function getUserVipInfo(userId) {
  if (!userId) return { is_vip: false, referrals: 0, target: VIP_REFERRAL_THRESHOLD };

  const [vipRows, refRows] = await Promise.all([
    sbReq(`vip_users?user_id=eq.${userId}&select=*`),
    sbReq(`referrals?referrer_id=eq.${userId}&select=*`)
  ]);

  const referrals = Array.isArray(refRows) ? refRows.length : 0;
  const isVipByTable = Array.isArray(vipRows) && vipRows.length > 0 && vipRows[0].is_vip;
  const isVipByRefs = referrals >= VIP_REFERRAL_THRESHOLD;

  return {
    is_vip: isVipByTable || isVipByRefs,
    referrals,
    target: VIP_REFERRAL_THRESHOLD
  };
}

// ─── Grant VIP Status ─────────────────────────────────────────
async function grantVipStatus(userId, reason = 'admin_grant') {
  if (!userId) return false;
  const res = await sbReq(
    'vip_users?on_conflict=user_id',
    'POST',
    { user_id: String(userId), is_vip: true, reason, granted_at: new Date().toISOString() },
    'resolution=merge-duplicates'
  );
  return res !== null;
}

// ─── Quick VIP Check ──────────────────────────────────────────
async function isVipUser(userId) {
  const info = await getUserVipInfo(userId);
  return info.is_vip;
}

module.exports = { recordReferral, getUserVipInfo, grantVipStatus, isVipUser };
