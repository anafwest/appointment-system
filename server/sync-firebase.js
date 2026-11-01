#!/usr/bin/env node
/* ============================================================
   مزامنة المواعيد يدوياً بين الخادم الداخلي وFirebase
   ------------------------------------------------------------
     node server/sync-firebase.js status   # مقارنة بدون تعديل
     node server/sync-firebase.js push     # المحلي ← Firebase
     node server/sync-firebase.js pull     # Firebase ← المحلي

   ملاحظة: الخادم الداخلي يقوم بالمزامنة تلقائياً كل عدة دقائق
   إذا وُجد ملف server/service-account.json (لا تحتاج تشغيل هذا الملف).
   ============================================================ */
'use strict';

const sync = require('./firebase-sync');

(async () => {
  const action = (process.argv[2] || 'status').toLowerCase();
  if (!['push', 'pull', 'status'].includes(action)) {
    console.log('الاستخدام: node server/sync-firebase.js push|pull|status');
    process.exit(2);
  }
  if (!sync.hasServiceAccount()) {
    console.error('لم أجد ملف حساب الخدمة: ' + sync.serviceAccountPath());
    console.error('حمّله من Firebase ← Project settings ← Service accounts ← Generate new private key');
    process.exit(2);
  }

  try {
    if (action === 'push') {
      const r = await sync.push();
      console.log('المشروع: ' + r.project);
      console.log('تم رفع: ' + r.pushed + ' · تُخطّي (السحابة أحدث): ' + r.skipped + ' · أخطاء: ' + r.errors);
      (r.details || []).filter(d => d.error).forEach(d => console.log('  ✗ ' + d.id + ' — ' + d.error));
    } else if (action === 'pull') {
      const r = await sync.pull();
      console.log('المشروع: ' + r.project);
      console.log('أُضيف: ' + r.added + ' · حُدّث: ' + r.updated + ' · بلا تغيير: ' + r.skipped);
    } else {
      const r = await sync.status();
      console.log('المشروع: ' + r.project + ' · مواعيد تحتاج مزامنة: ' + r.pending);
      r.items.slice(0, 30).forEach(i => console.log('  ' + i.id + ': ' + (i.action === 'create' ? 'غير موجود في السحابة' : 'أحدث محلياً')));
    }
  } catch (e) {
    console.error('فشل: ' + e.message);
    process.exit(1);
  }
})();
