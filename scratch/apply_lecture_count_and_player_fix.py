import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

# 1. Update server/index.js /api/batch/:batchId/details
server_path = 'server/index.js'
server_code = open(server_path, 'r', encoding='utf-8').read()

old_details_block = """    // 1. Non-PW Multi-Providers
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const data = await asmultiverseGet(provKey, `/batch/${batchId}/details`);
      const rawSubjects = data.data?.subjects || data.data?.batch?.subjects || (Array.isArray(data.data) ? data.data : []);
      const subjects = rawSubjects.map(s => {
        const sId = String(s._id || s.id || '');
        const name = s.name || s.title || 'Subject';
        const img = s.image || s.previewImage || getBannerUrl();
        return {
          _id: sId,
          id: sId,
          name: name,
          title: name,
          slug: s.slug || sId,
          image: img,
          previewImage: { baseUrl: img, key: '' }
        };
      });
      return res.json({
        success: true,
        data: {
          _id: batchId,
          id: batchId,
          name: data.data?.name || data.data?.title || 'Batch Details',
          title: data.data?.name || data.data?.title || 'Batch Details',
          subjects: subjects
        }
      });
    }"""

new_details_block = """    // 1. Non-PW Multi-Providers
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const data = await asmultiverseGet(provKey, `/batch/${batchId}/details`);
      const rawSubjects = data.data?.subjects || data.data?.batch?.subjects || (Array.isArray(data.data) ? data.data : []);
      const subjects = rawSubjects.map(s => {
        const sId = String(s._id || s.id || '');
        const name = s.name || s.title || 'Subject';
        const img = s.image || s.previewImage || getBannerUrl();
        const totalVids = (typeof s.totalVideos === 'number') ? s.totalVideos : (s.lectureCount || 0);
        const totalNotes = (typeof s.totalNotes === 'number') ? s.totalNotes : 0;
        return {
          _id: sId,
          id: sId,
          name: name,
          title: name,
          slug: s.slug || sId,
          image: img,
          previewImage: { baseUrl: img, key: '' },
          totalVideos: totalVids,
          lectureCount: totalVids,
          totalNotes: totalNotes,
          tagCount: s.tagCount || s.totalTopics || 0
        };
      });
      return res.json({
        success: true,
        data: {
          _id: batchId,
          id: batchId,
          name: data.data?.name || data.data?.title || 'Batch Details',
          title: data.data?.name || data.data?.title || 'Batch Details',
          subjects: subjects
        }
      });
    }"""

if old_details_block in server_code:
    server_code = server_code.replace(old_details_block, new_details_block)
    open(server_path, 'w', encoding='utf-8').write(server_code)
    print('Updated server/index.js batch details subject counts!')
else:
    print('Warning: old_details_block not found in server/index.js')

# 2. Update webapp/app.js
app_path = 'webapp/app.js'
app_code = open(app_path, 'r', encoding='utf-8').read()

# Replace renderSubjectCard
old_render_subject = """function renderSubjectCard(s) {
  const sId = s._id || s.id;
  if (sId) {
    s._id = sId;
    state.loadedSubjects[sId] = s;
  }
  const subName = s.subject || s.title || 'Subject';
  const img = imgUrl(s.imageId) || s.image || '';
  const teacher = s.teacherIds?.[0];
  const tName = teacher ? `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() : '';
  const videoCount = s.lectureCount ?? s.totalVideos ?? 0;

  return `
    <div class="subject-card" onclick="openSubject('${sId}')">
      ${img ? `<img class="subject-card-icon" src="${img}" alt="${subName}" onerror="this.style.display='none'" />` : '<div class="subject-card-icon"></div>'}
      <div class="subject-card-info">
        <div class="subject-card-title">${subName}</div>
        <div class="subject-card-teacher">${tName ? `Faculty: ${tName} • ` : ''}${videoCount} Lectures</div>
      </div>
      <span class="subject-card-arrow">→</span>
    </div>`;
}"""

new_render_subject = """function renderSubjectCard(s) {
  const sId = s._id || s.id;
  if (sId) {
    s._id = sId;
    state.loadedSubjects[sId] = s;
  }
  const subName = s.subject || s.title || s.name || 'Subject';
  const img = imgUrl(s.imageId) || s.image || '';
  const teacher = s.teacherIds?.[0];
  const tName = teacher ? `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() : '';

  const numLectures = (typeof s.totalVideos === 'number' && s.totalVideos > 0)
    ? s.totalVideos
    : ((typeof s.lectureCount === 'number' && s.lectureCount > 0) ? s.lectureCount : 0);
  const numTopics = s.tagCount || s.totalTopics || 0;

  let countText = '';
  if (numLectures > 0) {
    countText = `${numLectures} Lectures`;
  } else if (numTopics > 0) {
    countText = `${numTopics} Topics`;
  } else if (s.totalNotes && s.totalNotes > 0) {
    countText = `${s.totalNotes} Notes`;
  } else {
    countText = 'Lectures & Notes';
  }

  return `
    <div class="subject-card" onclick="openSubject('${sId}')">
      ${img ? `<img class="subject-card-icon" src="${img}" alt="${subName}" onerror="this.style.display='none'" />` : '<div class="subject-card-icon"></div>'}
      <div class="subject-card-info">
        <div class="subject-card-title">${subName}</div>
        <div class="subject-card-teacher">${tName ? `Faculty: ${tName} • ` : ''}${countText}</div>
      </div>
      <span class="subject-card-arrow">→</span>
    </div>`;
}"""

if old_render_subject in app_code:
    app_code = app_code.replace(old_render_subject, new_render_subject)
    print('Updated renderSubjectCard in webapp/app.js')
else:
    print('Warning: old_render_subject not found in webapp/app.js')

# Clean toasts and handleStreamPlay in webapp/app.js
app_code = app_code.replace("showToast('â³ Loading video player...');", "showToast('⏳ Loading video player...');")
app_code = app_code.replace("showToast('âŒ Video item not found');", "showToast('❌ Video item not found');")
app_code = app_code.replace("showToast('⚠️ï¸ Video stream is currently unavailable. Please try another lecture.');", "showToast('⚠️ Video stream is currently unavailable. Please try another lecture.');")
app_code = app_code.replace("showToast('âŒ Video stream currently unavailable');", "showToast('❌ Video stream currently unavailable');")

# Ensure batch hero badge updates with provider/brand
old_batch_hero = """  document.getElementById('batch-hero-name').textContent = name;
  document.getElementById('batch-hero-class').textContent = b.class ? `Class ${b.class}` : (PROVIDERS[state.provider]?.name || (window.APP_CONFIG?.BOT_NAME || 'Study Hub'));"""

new_batch_hero = """  document.getElementById('batch-hero-name').textContent = name;
  const batchClass = b.class ? `Class ${b.class}` : 'Class All';
  const classBadge = document.getElementById('batch-hero-class');
  if (classBadge) classBadge.textContent = batchClass;
  const provTag = PROVIDERS[state.provider]?.name || (window.APP_CONFIG?.BOT_NAME || 'InvalidStudy');
  const tagBadge = document.querySelector('.hero-badges .badge-tag');
  if (tagBadge) tagBadge.textContent = provTag.toUpperCase();"""

if old_batch_hero in app_code:
    app_code = app_code.replace(old_batch_hero, new_batch_hero)
    print('Updated batch hero badges in webapp/app.js')

open(app_path, 'w', encoding='utf-8').write(app_code)

print('Step 1 & 2 completed!')
