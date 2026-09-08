import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

# 1. Patch webapp/app.js
app_js_path = 'webapp/app.js'
app_js = open(app_js_path, 'r', encoding='utf-8').read()

# Replace fetchBatchContent
old_fetch_batch = """async function fetchBatchContent(batchId, subjectId, topicId, type = 'Videos', page = 1) {
  const safeBatch   = encodeURIComponent(batchId   || '');
  const safeSubject = encodeURIComponent(subjectId || '');
  const safeTopic   = encodeURIComponent(topicId   || '');

  // 1. Primary: learnxpw.site /api/TopicInfo (via server proxy)
  //    Works for PW provider. Route: /api/batch/:b/subject/:s/topic/:t/content
  if (state.provider === 'pw' || !state.provider) {
    try {
      const res = await serverGet(
        `/api/batch/${safeBatch}/subject/${safeSubject}/topic/${safeTopic}/content?type=${type}&page=${page}`
      );
      // learnxpw returns {data:[]} when page is exhausted
      if (res && Array.isArray(res.data)) return res;
      if (res && Array.isArray(res)) return { data: res };
    } catch (err) {
      console.warn(`[fetchBatchContent] learnxpw failed (${type}):`, err.message);
    }
  }

  // 2. Fallback: pimaxer proxy for non-PW providers (nexttopper, missionjeet etc.)
  try {
    const safeTag = encodeURIComponent(topicId || '');
    let contentType = type;
    if (type.toLowerCase() === 'notes') contentType = 'notes';
    else if (type.toLowerCase() === 'videos') contentType = 'Videos';
    else if (type.toLowerCase() === 'dppnotes') contentType = 'DppNotes';
    else if (type.toLowerCase() === 'dppvideos') contentType = 'DppVideos';
    const providerParam = state.provider ? `&provider=${state.provider}` : '';
    const res = await serverGet(
      `/api/batch/${safeBatch}/subject/${safeSubject}/content?tag=${safeTag}&type=${contentType}&page=${page}${providerParam}`
    );
    if (res && Array.isArray(res.data)) return res;
    if (res && Array.isArray(res)) return { data: res };
    if (res && res.data) return res;
  } catch (err) {
    console.warn(`[fetchBatchContent] Pimaxer fallback failed (${type}):`, err.message);
  }

  throw new Error(`Unable to load ${type} content`);
}"""

new_fetch_batch = """async function fetchBatchContent(batchId, subjectId, topicId, type = 'Videos', page = 1) {
  const safeBatch   = encodeURIComponent(batchId   || '');
  const safeSubject = encodeURIComponent(subjectId || '');
  const safeTopic   = encodeURIComponent(topicId   || '');
  const providerParam = state.provider ? `&provider=${encodeURIComponent(state.provider)}` : '';

  // 1. Primary: Unified Topic content route (PW & Multi-Providers)
  try {
    const res = await serverGet(
      `/api/batch/${safeBatch}/subject/${safeSubject}/topic/${safeTopic}/content?type=${type}&page=${page}${providerParam}`
    );
    if (res && Array.isArray(res.data) && res.data.length > 0) return res;
    if (res && Array.isArray(res) && res.length > 0) return { data: res };
    if (res && res.data && !Array.isArray(res.data)) return res;
  } catch (err) {
    console.warn(`[fetchBatchContent] Topic route failed (${type}):`, err.message);
  }

  // 2. Fallback: Subject content route with tag filter
  try {
    const safeTag = encodeURIComponent(topicId || '');
    let contentType = type;
    if (type.toLowerCase() === 'notes') contentType = 'notes';
    else if (type.toLowerCase() === 'videos') contentType = 'Videos';
    else if (type.toLowerCase() === 'dppnotes') contentType = 'DppNotes';
    else if (type.toLowerCase() === 'dppvideos') contentType = 'DppVideos';
    const res = await serverGet(
      `/api/batch/${safeBatch}/subject/${safeSubject}/content?tag=${safeTag}&type=${contentType}&page=${page}${providerParam}`
    );
    if (res && Array.isArray(res.data)) return res;
    if (res && Array.isArray(res)) return { data: res };
    if (res && res.data) return res;
  } catch (err) {
    console.warn(`[fetchBatchContent] Fallback content failed (${type}):`, err.message);
  }

  return { success: true, data: [] };
}"""

if old_fetch_batch in app_js:
    app_js = app_js.replace(old_fetch_batch, new_fetch_batch)
    print('Updated fetchBatchContent in webapp/app.js')
else:
    print('Warning: old_fetch_batch exact string not found in webapp/app.js')

with open(app_js_path, 'w', encoding='utf-8') as f:
    f.write(app_js)

# 2. Patch webapp/index.html
html_path = 'webapp/index.html'
html = open(html_path, 'r', encoding='utf-8').read()

html = html.replace('<title>Study Hub</title>', '<title>InvalidStudy</title>')
html = html.replace('<meta name="apple-mobile-web-app-title" content="Study Hub" />', '<meta name="apple-mobile-web-app-title" content="InvalidStudy" />')
html = html.replace('<h2 class="guru-hero-title"><span data-brand-name>Study Hub</span> <span class="accent-serif" style="color:#c084fc;">Guru</span></h2>', '<h2 class="guru-hero-title"><span data-brand-name>InvalidStudy</span> <span class="accent-serif" style="color:#c084fc;">Guru</span></h2>')

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html)

print('Updated webapp/index.html')
