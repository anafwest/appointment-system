# نظام إدارة المواعيد — نسخة الموقع المنشور

هذا المجلد يحتوي على **نسخة الموقع المنشور فعلياً** على
<https://anafwest-appointments.web.app> (مشروع Firebase: `anafwest-appointments`).

المصدر الأصلي لهذا التطبيق lives في المستودع:
[`anafwest/appointments-riyadh`](https://github.com/anafwest/appointments-riyadh)
(فرع `main`) — وهو أيضاً المستودع الذي ينشر إلى Firebase Hosting عبر
`.github/workflows/deploy.yml`.

## إصلاح معاينة المرفقات (v3)

### المشكلة
عند الضغط على أيقونة المعاينة 👁️ في نافذة «📎 مرفقات الموعد» كان **الملف يُنزَّل**
بدل أن يُعرض داخل التطبيق.

### السبب الجذري
1. جميع المرفقات مخزَّنة كـ `path` (مسار داخل المستودع) — لا يوجد `data` فيها إطلاقاً.
2. الكود القديم (`previewFileFixed`) كان يجلب الملف ثم يحوّله
   `blob → data URL → blob`، فيحتفظ الـ Blob بـ **نوع MIME خاطئ**؛ لأن GitHub يخدم
   `raw.githubusercontent.com` بنوع `text/plain; charset=utf-8` أو
   `application/octet-stream` مع `X-Content-Type-Options: nosniff`.
3. تصحيح النوع في الكود القديم لم يكن يعمل إلا مع `application/octet-stream`
   **بالضبط** — فلا يلتقط `text/plain`، ويبقى الـ Blob من نوع غير PDF.
4. ملف PDF داخل `<iframe src="blob:...">` بنوع غير `application/pdf`
   ⇒ **المتصفح ينزّله بدل عرضه**.

### الحل (الكتلة `previewFileV3` في نهاية `index.html`)
| # | التغيير |
|---|--------|
| 1 | جلب الملف كـ `Blob` مباشرة — بلا رحلة `data URL` الهدرية. |
| 2 | تحديد النوع الحقيقي من **بايتات الملف** (`%PDF-`، `FFD8FF`، `89504E47`، …) ثم من الامتداد، بدل الاعتماد على ترويسة الاستجابة. |
| 3 | عرض PDF **داخل التطبيق** عبر `pdf.js` على `<canvas>` مع شريط تنقّل بين الصفحات (السابق / التالي + عدّاد «صفحة X من Y»). |
| 4 | عرض الصور والفيديو والصوت والنصوص داخل النافذة نفسها. |
| 5 | سلسلة مصادر بديلة عند تعذّر الجلب (`raw.githubusercontent.com` ← `github.com/.../raw/` ← `cdn.statically.io`) مع رسالة خطأ عربية واضحة. |
| 6 | زر «⬇️ تحميل» يبقى متاحاً **بضغطة صريحة فقط** — المعاينة نفسها لا تُنزّل شيئاً. |
| 7 | إصلاح «🖨️ طباعة مع كامل المرفقات»: كان يقرأ `f.data` فقط، فيعرض
«تعذّر معاينة هذا النوع من الملفات داخل النموذج» لكل المرفقات (لأنها كلها `path`). |

### التراجع
الكتلة مستقلة تماماً: احذفها من آخر `index.html` (من
`<!-- معاينة المرفقات — الإصدار v3` حتى `</script>` الختامي) لترجع السلوك السابق.

## النشر
النشر يتم من `anafwest/appointments-riyadh` (فرع `main`) عبر GitHub Actions:

```
push إلى main  →  .github/workflows/deploy.yml  →  firebase deploy --only hosting
```

المجلد `site/` هنا نسخة مرجعية للتتبّع والنسخ الاحتياطي فقط.

> **ملاحظة:** مجلدات `attachments/` و `files/` (131 ميجابايت) ليست منسوخة هنا —
> تُجلب وقت التشغيل من مستودع `appointments-riyadh` مباشرة.
