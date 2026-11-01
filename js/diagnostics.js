/* ============================================================
   فاحص النظام - Arabic Firebase diagnostics
   يحوّل أخطاء المتصفح / Firebase إلى سبب واضح + طريقة حل
   ============================================================ */
const DIAG=(function(){
"use strict";

const MAX_ERRORS=60;
const errors=[];

/* ---------- قاموس الأخطاء: كل كود => السبب + الحل ---------- */
const ERROR_MAP={
"permission-denied":{
 title:"صلاحيات قاعدة البيانات تمنع العملية (permission-denied)",
 cause:"قواعد Firestore تشترط وجود مستخدم مسجّل (request.auth != null) لكن الطلب أُرسل بدون جلسة صالحة. أشهر الحالات: فتح صفحة الحجز العامة بدون تسجيل دخول، انتهاء الجلسة، أو أن ملف firestore.rules لم يُنشر على المشروع بعد.",
 fix:"١) سجّل الخروج ثم الدخول من جديد. ٢) انشر القواعد: firebase deploy --only firestore:rules. ٣) لصفحة الحجز العامة: فعّل Anonymous من Firebase ← Authentication ← Sign-in method، أو فعّل القواعد المرفقة في هذا التحديث."
},
"failed-precondition":{
 title:"الاستعلام يحتاج فهرساً مركّباً (Composite Index)",
 cause:"طلبت الاستعلامات ترتيباً/تصفية على أكثر من حقل، وFirestore لا ينفّذ ذلك بدون فهرس مركّب. تظهر الرسالة مع رابط إنشاء الفهرس.",
 fix:"افتح الرابط الظاهر في رسالة الخطأ (console.firebase.google.com/...indexes) واضغط Create Index، أو أضف firestore.indexes.json وانشرها. غالباً يبدأ العمل خلال دقيقة."
},
"unavailable":{
 title:"تعذّر الوصول إلى خدمة Firestore (unavailable)",
 cause:"انقطاع الشبكة الداخلية، أو أن بروكسي/جدار الحماية يحجب قناة البث (WebChannel) التي يستخدمها Firestore، أو حجب النطاقات firestore.googleapis.com و firebaseio.com و identitytoolkit.googleapis.com.",
 fix:"١) تحقق من الاتصال ثم أعد المحاولة (النظام يعمل الآن بالنسخة المخزّنة ويحفظ التعديلات في طابور). ٢) إن تكرر الخطأ على الشبكة الداخلية، اطلب من مسؤول الشبكة السماح بهذه النطاقات، أو اجعل INTRANET_FORCE_LONGPOLLING = true في js/config.js لتجبر Firestore على long-polling عبر المنفذ 443."
},
"resource-exhausted":{
 title:"تم تجاوز حصة Firebase اليومية (resource-exhausted)",
 cause:"خطة Spark المجانية تسمح بـ 50 ألف قراءة يومياً. عند تجاوزها تصبح القراءة بطيئة جداً ثم تُرفض. سبب شائع للتأخير: قراءة كل مجموعة المواعيد 4 مرات عند كل فتح للوحة التحكم وكل 30 ثانية.",
 fix:"خفّضنا القراءات في هذا التحديث (قراءة واحدة + تحديث لحظي). إن تكرّر الخطأ رقِّ الخطة إلى Blaze أو انتظر تجديد الحصة (منتصف الليل بتوقيت المحيط الهادئ)."
},
"deadline-exceeded":{
 title:"انتهت مهلة الطلب (deadline-exceeded)",
 cause:"الاتصال بطيء أو حجم البيانات المطلوبة كبير (خصوصاً إذا كانت المرفقات محفوظة Base64 داخل مستند الموعد).",
 fix:"استخدم زر «فحص وتحسين البيانات» في فاحص النظام لنقل المرفقات القديمة إلى مستندات منفصلة."
},
"cancelled":{
 title:"أُلغيت العملية (cancelled)",
 cause:"إعادة تحميل الصفحة أو إغلاق التبويب أثناء تنفيذ الطلب، أو تنفيذ نفس الاستعلام أكثر من مرة في وقت واحد.",
 fix:"أعد المحاولة، وتأكد من عدم فتح لوحة التحكم في عدة تبويبات في نفس الوقت."
},
"unauthenticated":{
 title:"انتهت صلاحية الجلسة (unauthenticated)",
 cause:"رمز الدخول لم يعد صالحاً (تسجيل خروج من جهاز آخر، انتهاء التوكن، حذف المستخدم).",
 fix:"أعد تسجيل الدخول من صفحة الدخول."
},
"not-found":{
 title:"العنصر المطلوب غير موجود (not-found)",
 cause:"رقم الموعد أو المستخدم غير موجود في قاعدة البيانات، أو تم حذفه.",
 fix:"تأكد من رقم الموعد، أو ابحث عنه في تبويب «المواعيد»."
},
"invalid-argument":{
 title:"قيمة غير صالحة في الطلب (invalid-argument)",
 cause:"حقل قيمته undefined، أو تاريخ غير صحيح، أو استعلام بترتيب غير مسموح.",
 fix:"أعد إدخال البيانات وتأكد من اختيار التاريخ والوقت، ثم احفظ مرة أخرى."
},
"already-exists":{
 title:"المستند موجود مسبقاً (already-exists)",
 cause:"رقم الموعد مستخدم من قبل (رقم الموعد هو معرّف المستند).",
 fix:"استخدم رقماً آخر للموعد."
},
"aborted":{
 title:"تعارض في التحديث (aborted)",
 cause:"تم تعديل نفس الموعد من مكانين في نفس اللحظة.",
 fix:"أعد فتح الموعد ثم كرّر العملية."
},
"internal":{
 title:"خطأ داخلي في خدمة Firebase (internal)",
 cause:"خلل مؤقت في جهة الخدمة.",
 fix:"أعد المحاولة بعد دقيقة."
},
"auth/operation-not-allowed":{
 title:"طريقة تسجيل الدخول غير مفعّلة",
 cause:"تسجيل الدخول المجهول (Anonymous) أو البريد/كلمة المرور غير مفعّل في مشروع Firebase.",
 fix:"Firebase ← Authentication ← Sign-in method ← فعّل Email/Password (ومعه Anonymous إذا تريد تشغيل الحجز العام)."
},
"auth/unauthorized-domain":{
 title:"الدومين الحالي غير مسجّل في Firebase (unauthorized-domain)",
 cause:"النظام يعمل الآن على دومين لم يُضف إلى قائمة الدومينات المصرّح لها، فيرفض Firebase تسجيل الدخول.",
 fix:"Firebase ← Authentication ← Settings ← Authorized domains ← أضف الدومين (مثل your-site.netlify.app و localhost)."
},
"auth/invalid-api-key":{
 title:"مفتاح Firebase غير صحيح (invalid-api-key)",
 cause:"ملف js/config.js لا يطابق المشروع أو تم تقييد المفتاح.",
 fix:"تأكد من قيم firebaseConfig في js/config.js."
},
"auth/network-request-failed":{
 title:"تعذّر الاتصال بخدمة الدخول",
 cause:"شبكة أو بروكسي يحجب identitytoolkit.googleapis.com.",
 fix:"جرّب شبكة أخرى أوقف مانع الإعلانات."
},
"auth/too-many-requests":{
 title:"محاولات كثيرة جداً",
 cause:"محاولات دخول خاطئة متكررة أو ضغط على الحفظ أكثر من مرة.",
 fix:"انتظر بضع دقائق ثم أعد المحاولة."
},
"auth/user-disabled":{
 title:"الحساب موقوف",
 cause:"تم تعطيل الحساب من Firebase.",
 fix:"راجع مدير النظام."
},
"auth/user-not-found":{
 title:"البريد غير مسجّل",
 cause:"لا يوجد حساب بهذا البريد.",
 fix:"تأكد من البريد أو اطلب من مدير النظام إنشاء الحساب."
},
"storage/unauthorized":{
 title:"صلاحيات التخزين تمنع رفع الملف",
 cause:"قواعد storage.rules تشترط تسجيل الدخول، أو Storage غير مفعّل في المشروع.",
 fix:"فعّل Storage وانشر storage.rules، أو سيتم حفظ المرفق داخل قاعدة البيانات تلقائياً (أبطأ للملفات الكبيرة)."
},
"storage/retry-limit-exceeded":{
 title:"فشل رفع الملف بعد عدة محاولات",
 cause:"انقطاع الشبكة أثناء الرفع أو حجم ملف كبير.",
 fix:"أعد رفع الملف، ويفضل صور أقل من 1 ميجابايت."
},
"storage/unknown":{
 title:"خطأ غير معروف في التخزين",
 cause:"غالباً Storage غير مفعّل أو الـ bucket غير صحيح في js/config.js.",
 fix:"فعّل Storage من لوحة Firebase أو تأكد من storageBucket."
},
"quotaexceeded":{
 title:"امتلاء التخزين المحلي في المتصفح",
 cause:"التخزين المؤقت (IndexedDB) ممتلئ أو وضع التصفح الخاص.",
 fix:"نظّف بيانات الموقع من إعدادات المتصفح وأعد التحميل."
}
};

/* ---------- أدوات ---------- */
function codeOf(err){
 if(!err) return "unknown";
 if(typeof err==="string") return "unknown";
 return err.code||(err.error&&err.error.code)||(err.reason&&String(err.reason))||"unknown";
}
function rawMessage(err){
 if(!err) return "";
 if(typeof err==="string") return err;
 return err.message||(err.error&&err.error.message)||String(err);
}
function normalizeCode(code,msg){
 code=String(code||"").toLowerCase();
 msg=String(msg||"").toLowerCase();
 if(/auth\//.test(code)) return code;
 if(ERROR_MAP[code]) return code;
 if(/index/.test(msg)||/requires an index/.test(msg)) return "failed-precondition";
 if(/permission/.test(msg)) return "permission-denied";
 if(/network|offline|unavailable/.test(msg)) return "unavailable";
 if(/quotaexceeded|quota exceeded/.test(msg)) return "quotaexceeded";
 if(/cannot read propert|undefined is not/.test(msg)) return "js-undefined";
 if(/not a function/.test(msg)) return "js-notfunction";
 return code||"unknown";
}
const FALLBACK={
 "js-undefined":{
  title:"بيانات ناقصة في أحد المواعيد (قيمة undefined)",
  cause:"كود الصفحة يتوقع حقلاً غير موجود في مستند الموعد (مثل الاسم أو الحالة أو التاريخ)، فتنهار عملية العرض ويبدو أن المواعيد «لا تظهر».",
  fix:"شغّل «فحص وتحسين البيانات» من فاحص النظام لإضافة الحقول الناقصة (status / deptPath / priority …)، ثم أعد تحميل الصفحة."
 },
 "js-notfunction":{
  title:"دالة مفقودة (is not a function)",
  cause:"ترتيب تحميل ملفات JS غير صحيح أو نسخة قديمة مخزّنة في المتصفح.",
  fix:"أعد التحميل مع تفريغ الكاش (Ctrl+Shift+R)."
 }
};
function explain(err){
 const raw=rawMessage(err);
 const code=normalizeCode(codeOf(err),raw);
 const info=ERROR_MAP[code]||FALLBACK[code]||{
   title:"خطأ غير مصنّف: "+(raw||code),
   cause:"لم يتعرّف الفاحص على هذا الكود. الرسالة الأصلية معروضة كما هي.",
   fix:"أرسل هذه الرسالة مع الصفحة التي ظهرت عليها لمطوّر النظام."
 };
 let indexUrl="";
 const m=raw.match(/https:\/\/console\.firebase\.google\.com[^\s"')]+/);
 if(m) indexUrl=m[0];
 return {code,title:info.title,cause:info.cause,fix:info.fix,raw,indexUrl,time:new Date().toISOString()};
}
function explainText(err){
 const e=explain(err);
 return e.title+" — السبب: "+e.cause+" — الحل: "+e.fix;
}

/* ---------- تسجيل الأخطاء ---------- */
function record(err,context){
 let e;
 try{ e=explain(err); }catch(_){
   e={code:"unknown",title:"خطأ",cause:"",fix:"",raw:String(err),time:new Date().toISOString()};
 }
 e.context=context||"";
 e.stack=(err&&err.stack)?String(err.stack).slice(0,600):"";
 errors.unshift(e);
 if(errors.length>MAX_ERRORS) errors.pop();
 renderBadge();
 try{
   document.dispatchEvent(new CustomEvent("diag:error",{detail:e}));
 }catch(_){}
 return e;
}
function list(){ return errors.slice(); }
function clear(){ errors.length=0; renderBadge(); }

/* ---------- زر/لوحة الأخطاء العائمة ---------- */
let badge=null,panel=null;
function ensureUi(){
 if(!document.body) return false;
 if(!document.getElementById("diagStyle")){
  const st=document.createElement("style");
  st.id="diagStyle";
  st.textContent=`
  .diag-fab{position:fixed;bottom:18px;left:18px;z-index:100000;background:#d62828;color:#fff;border:0;border-radius:999px;
   padding:10px 16px;font-family:'Tajawal',Tahoma,sans-serif;font-weight:700;font-size:13px;cursor:pointer;
   box-shadow:0 8px 24px rgba(0,0,0,.25);display:none;align-items:center;gap:8px}
  .diag-fab.show{display:inline-flex}
  .diag-panel{position:fixed;inset:auto 18px 70px 18px;max-height:60vh;overflow:auto;background:#fff;color:#2b2d42;
   border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);z-index:100001;padding:18px;display:none;font-family:'Tajawal',Tahoma,sans-serif;direction:rtl}
  .diag-panel.show{display:block}
  .diag-panel h4{margin:0 0 6px;font-size:15px}
  .diag-panel .diag-item{border:1px solid #eee;border-radius:12px;padding:12px;margin-bottom:10px;background:#fafafa}
  .diag-panel .diag-code{font-size:11px;color:#d62828;font-weight:700;direction:ltr;text-align:left}
  .diag-panel .diag-raw{font-size:11px;color:#888;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-word}
  .diag-panel .diag-line{font-size:13px;margin-top:6px;line-height:1.7}
  .diag-panel .diag-line b{color:#006946}
  .diag-panel .diag-actions{display:flex;gap:8px;justify-content:flex-start;margin-top:8px}
  .diag-panel button{border:0;border-radius:8px;padding:8px 12px;font-family:inherit;font-weight:700;cursor:pointer;background:#006946;color:#fff;font-size:12px}
  .diag-panel button.ghost{background:#eef2f0;color:#006946}`;
  document.head.appendChild(st);
 }
 if(!badge){
  badge=document.createElement("button");
  badge.className="diag-fab";
  badge.type="button";
  badge.onclick=function(){ togglePanel(); };
  document.body.appendChild(badge);
 }
 return true;
}
function renderBadge(){
 if(!ensureUi()) return;
 if(!badge) return;
 if(errors.length===0){ badge.className="diag-fab"; return; }
 badge.className="diag-fab show";
 badge.innerHTML="&#128027; أخطاء النظام ("+errors.length+")";
}
function togglePanel(force){
 if(!ensureUi()) return;
 if(force===false){ if(panel) panel.classList.remove("show"); return; }
 if(panel&&panel.classList.contains("show")){ panel.classList.remove("show"); return; }
 if(!panel){
  panel=document.createElement("div");
  panel.className="diag-panel";
  document.body.appendChild(panel);
 }
 panel.innerHTML=renderPanelHtml();
 panel.classList.add("show");
}
function esc(s){
 return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function renderPanelHtml(){
 if(errors.length===0) return "<h4>لا توجد أخطاء مسجّلة</h4>";
 let h='<h4>الأخطاء الأخيرة — تم شرح سببها وطريقة حلها</h4>';
 errors.slice(0,12).forEach(function(e,i){
  h+='<div class="diag-item">'+
     '<div class="diag-code">'+esc(e.code)+(e.context?" · "+esc(e.context):"")+'</div>'+
     '<h4 style="margin-top:4px">'+esc(e.title)+'</h4>'+
     '<div class="diag-line"><b>السبب:</b> '+esc(e.cause)+'</div>'+
     '<div class="diag-line"><b>الحل:</b> '+esc(e.fix)+'</div>'+
     (e.raw?'<div class="diag-raw">'+esc(e.raw)+'</div>':'')+
     (e.indexUrl?'<div class="diag-actions"><button onclick="window.open(\''+esc(e.indexUrl)+'\',\'_blank\')">إنشاء الفهرس المطلوب</button></div>':'')+
     '</div>';
 });
 h+='<div class="diag-actions">'+
    '<button onclick="window.open(\'diagnostics.html\',\'_blank\')">فتح الفاحص الكامل</button>'+
    '<button class="ghost" onclick="DIAG.clear()">مسح القائمة</button>'+
    '</div>';
 return h;
}
function refreshPanel(){ if(panel&&panel.classList.contains("show")) panel.innerHTML=renderPanelHtml(); }

/* ---------- اعتراض الأخطاء تلقائياً ---------- */
let installed=false;
function installInspector(){
 if(installed) return;
 installed=true;
 window.addEventListener("error",function(ev){
   if(ev&&ev.target&&ev.target.tagName){
     // فشل تحميل مورد (صورة/سكربت)
     if(ev.target.tagName==="SCRIPT"||ev.target.tagName==="LINK"){
       record({code:"resource-load",message:"فشل تحميل المورد: "+(ev.target.src||ev.target.href)},
         "تحميل الملفات");
     }
     return;
   }
   record(ev.error||{code:"js-error",message:(ev.message||"خطأ في الصفحة")+" ("+(ev.filename||"")+":"+(ev.lineno||"")+")"},"خطأ JavaScript");
 },true);
 window.addEventListener("unhandledrejection",function(ev){
   const r=ev.reason;
   // أخطاء Firebase داخل وعود غير معالجة
   record(r,"Promise غير معالَج");
 });
 // التقاط console.error المتعلقة بـ Firebase فقط (لتفادي ضجيج المكتبات)
 if(window.console&&console.error){
   const orig=console.error.bind(console);
   console.error=function(){
     try{
       const args=Array.prototype.slice.call(arguments);
       const first=args[0];
       if(first&&(first.code||/firebase|firestore|permission|index|quota/i.test(String(first.message||first)))){
         record(first,"console.error");
       }
     }catch(_){}
     return orig.apply(null,arguments);
   };
 }
 document.addEventListener("DOMContentLoaded",function(){ ensureUi(); renderBadge(); });
 if(document.body) { ensureUi(); renderBadge(); }
 document.addEventListener("diag:error",function(){ refreshPanel(); });
}
function fail(context,err){
 record(err,context);
 try{ if(typeof showToast==="function") showToast(explainText(err),"error"); }catch(_){}
 return explain(err);
}

/* ============================================================
   الفحوصات
   ============================================================ */
function nowMs(){ return (window.performance&&performance.now)?performance.now():Date.now(); }
function bytesOf(o){
 try{ return new Blob([JSON.stringify(o)]).size; }catch(e){ return JSON.stringify(o).length; }
}
function fmtBytes(b){
 if(b>1024*1024) return (b/1048576).toFixed(2)+" م.ب";
 if(b>1024) return (b/1024).toFixed(0)+" ك.ب";
 return b+" بايت";
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function runChecks(onProgress){
 const res=[];
 function add(r){ res.push(r); if(onProgress) try{onProgress(r,res);}catch(_){} }
 const t0=nowMs();

 /* 1) تحميل المكتبات والإعدادات */
 add({
  id:"sdk",title:"تحميل Firebase وإعداداته",
  status:(window.firebase&&typeof db!=="undefined"&&typeof auth!=="undefined")?"ok":"error",
  summary:(window.firebase&&typeof db!=="undefined"&&typeof auth!=="undefined")
    ?"المكتبات محمّلة والمشروع: "+((firebase.app().options||{}).projectId||"?")
    :"مكتبات Firebase لم تُحمّل — تحقق من الاتصال بـ gstatic.com ومن ترتيب سكربتات الصفحة",
  details:[],fixes:(window.firebase&&typeof db!=="undefined")?[]:["تأكد من وجود سكربتات firebase-app/auth/firestore قبل js/config.js، وأن الشبكة تسمح بـ gstatic.com"]
 });

 /* 2) حالة الدخول */
 let user=null;
 try{ user=auth.currentUser; }catch(e){}
 add({
  id:"auth",title:"جلسة الدخول",
  status:user?"ok":"error",
  summary:user?("مسجّل الدخول: "+(user.email||"مستخدم مجهول (Anonymous)")+(user.isAnonymous?" — جلسة مجهولة":"")):"لا توجد جلسة دخول، لذلك ستُرفض كل قراءات وكتابات قاعدة البيانات",
  details:user?["UID: "+user.uid]:[],
  fixes:user?[]:["سجّل الدخول من صفحة index.html","إذا كانت المشكلة في صفحة الحجز العامة: فعّل Anonymous من Authentication"]
 });

 /* 3) مستند المستخدم (الصلاحية والإدارة) */
 if(user&&!user.isAnonymous){
  try{
   const t=nowMs();
   const doc=await db.collection("users").doc(user.uid).get();
   const ms=Math.round(nowMs()-t);
   if(!doc.exists){
    add({id:"userdoc",title:"بيانات المستخدم في مجموعة users",status:"error",
      summary:"لا يوجد مستند للمستخدم — ستظهر رسالة «لا توجد بيانات لهذا المستخدم» وتُغلق الجلسة",
      details:["زمن القراءة: "+ms+" مللي"],fixes:["أنشئ مستند users/"+user.uid+" بالحقول name و role و dept"]});
   }else{
    const u=doc.data();
    const missing=[];
    if(!u.name) missing.push("name");
    if(!u.role) missing.push("role");
    if(u.role==="department"&&!u.dept) missing.push("dept");
    add({id:"userdoc",title:"بيانات المستخدم في مجموعة users",
      status:missing.length?"warn":"ok",
      summary:missing.length?("حقول ناقصة: "+missing.join(", ")+" — قد تظهر الصفحة فارغة"):("الصلاحية: "+u.role+" · الإدارة: "+(u.dept||"—")),
      details:["زمن القراءة: "+ms+" مللي"],fixes:missing.length?["حدّث بيانات المستخدم من تبويب إدارة المستخدمين"]:[]});
   }
  }catch(e){
   add({id:"userdoc",title:"بيانات المستخدم في مجموعة users",status:"error",
     summary:explain(e).title,details:[rawMessage(e)],fixes:[explain(e).fix]});
  }
 }

 /* 4) الاتصال والسرعة + صلاحية القراءة */
 let readOk=false,netMs=null;
 try{
  const t=nowMs();
  await db.collection("appointments").limit(1).get();
  netMs=Math.round(nowMs()-t); readOk=true;
 }catch(e){
  const ex=explain(e);
  add({id:"read",title:"قراءة المواعيد من قاعدة البيانات",status:"error",summary:ex.title,
    details:[rawMessage(e)].concat(ex.indexUrl?["رابط إنشاء الفهرس: "+ex.indexUrl]:[]),fixes:[ex.fix]});
 }
 if(readOk){
  let st="ok",sum="القراءة تعمل — زمن الاستجابة "+netMs+" مللي";
  if(netMs>2500){ st="warn"; sum="القراءة تعمل لكنها بطيئة ("+netMs+" مللي)"; }
  add({id:"read",title:"قراءة المواعيد من قاعدة البيانات",status:st,summary:sum,
    details:["أول قراءة بعد فتح الصفحة تكون أبطأ لأن Firebase يفتح اتصالاً جديداً"],
    fixes:st==="warn"?["تحقق من سرعة الشبكة/البروكسي","نفّذ «فحص وتحسين البيانات» لتقليل حجم مستندات المواعيد"]:[]});
 }

 /* 5) صلاحية الكتابة + فرق توقيت الخادم */
 let writeOk=false;
 if(user){
  const testId="__diag_"+Date.now();
  try{
   const t=nowMs();
   await db.collection("appointments").doc(testId).set({
     name:"فحص النظام (يُحذف تلقائياً)",phone:"0500000000",idNum:"",subject:"فحص",
     date:"2000-01-01",time:"00:00",dept:"فحص",deptPath:["فحص"],priority:"عادي",notes:"",
     status:"جديد",createdBy:"فاحص النظام",createdByRole:"diag",createdByDept:"",
     createdAt:firebase.firestore.FieldValue.serverTimestamp(),history:[],attachments:[]
   });
   const wMs=Math.round(nowMs()-t);
   const s=await db.collection("appointments").doc(testId).get();
   const created=s.data()&&s.data().createdAt?s.data().createdAt.toDate():null;
   let skew="غير معروف";
   if(created) skew=(created.getTime()-Date.now())+" مللي (ساعة الجهاز مقابل الخادم)";
   writeOk=true;
   await db.collection("appointments").doc(testId).delete().catch(function(){});
   add({id:"write",title:"الكتابة في قاعدة البيانات (حفظ موعد)",
     status:Math.abs(Number(String(skew).split(" ")[0]))>120000?"warn":"ok",
     summary:"الحفظ يعمل — زمن الحفظ "+wMs+" مللي · فرق التوقيت "+skew,
     details:["تم إنشاء مستند اختباري وحذفه"],
     fixes:[]});
  }catch(e){
   const ex=explain(e);
   add({id:"write",title:"الكتابة في قاعدة البيانات (حفظ موعد)",status:"error",summary:ex.title,
     details:[rawMessage(e)],fixes:[ex.fix]});
   db.collection("appointments").doc(testId).delete().catch(function(){});
  }
 }

 /* 6) فهارس الاستعلامات المستخدمة فعلياً */
 const indexTests=[
  {name:"مواعيد الإدارة (deptPath)",q:()=>db.collection("appointments").where("deptPath","array-contains","مكتب مدير القطاع").limit(1).get()},
  {name:"مواعيد مسؤول التسجيل (createdByDept)",q:()=>db.collection("appointments").where("createdByDept","==","").limit(1).get()},
  {name:"تصفية إدارة + حالة",q:()=>db.collection("appointments").where("dept","==","مكتب مدير القطاع").where("status","==","جديد").limit(1).get()},
  {name:"ترتيب حسب تاريخ الإنشاء",q:()=>db.collection("appointments").orderBy("createdAt","desc").limit(1).get()}
 ];
 if(readOk){
  const bad=[],slow=[];
  for(const t of indexTests){
   try{
    const s=nowMs(); await t.q(); const ms=Math.round(nowMs()-s);
    if(ms>2000) slow.push(t.name+" ("+ms+" مللي)");
   }catch(e){
    const ex=explain(e);
    bad.push({name:t.name,ex:ex,raw:rawMessage(e)});
   }
  }
  if(bad.length===0){
   add({id:"index",title:"الفهارس المطلوبة للاستعلامات",status:slow.length?"warn":"ok",
    summary:slow.length?("كل الاستعلامات تعمل لكن بعضها بطيء: "+slow.join(" · ")):"لا توجد فهارس ناقصة — كل استعلامات النظام تعمل",
    details:indexTests.map(t=>"✓ "+t.name),fixes:[]});
  }else{
   add({id:"index",title:"الفهارس المطلوبة للاستعلامات",status:"error",
    summary:bad.length+" استعلام يفشل بسبب فهرس ناقص ("+bad.map(b=>b.name).join(" · ")+")",
    details:bad.map(b=>"✗ "+b.name+" → "+b.ex.code+(b.ex.indexUrl?" | "+b.ex.indexUrl:"")),
    fixes:["افتح رابط الفهرس من التفاصيل واضغط Create Index","الاستعلامات التي تفشل لا تُظهر بيانات في تبويب المواعيد/الإحالة"]});
  }
 }

 /* 7) Storage */
 add({
  id:"storage",title:"Firebase Storage (المرفقات)",
  status:storage?"ok":"warn",
  summary:storage?"Storage مهيّأ — تُحفظ الصور والملفات في التخزين":"Storage غير مهيّأ — ستُحفظ المرفقات داخل قاعدة البيانات (أبطأ للملفات الكبيرة)",
  details:[],fixes:storage?["تأكد من نشر storage.rules"]:["فعّل Storage أو ابقِ على الحفظ داخل قاعدة البيانات مع ضغط الصور"]
 });

 /* 8) جودة البيانات وحجمها */
 let apts=[];
 if(readOk){
  try{
   const t=nowMs();
   const snap=await db.collection("appointments").limit(3000).get();
   const ms=Math.round(nowMs()-t);
   snap.forEach(d=>{ const o=d.data(); o.id=d.id; apts.push(o); });
   const noPath=apts.filter(a=>!Array.isArray(a.deptPath)||a.deptPath.length===0);
   const noStatus=apts.filter(a=>!a.status);
   const noCreated=apts.filter(a=>!a.createdAt);
   const noName=apts.filter(a=>!a.name||!a.phone);
   let embedded=0,embeddedBytes=0,big=0;
   apts.forEach(a=>{
    const size=bytesOf(a);
    if(size>300*1024) big++;
    (a.attachments||[]).forEach(at=>{
     if(at&&at.data){ embedded++; embeddedBytes+=String(at.data).length; }
    });
   });
   const totalSize=apts.reduce((s,a)=>s+bytesOf(a),0);
   let st="ok"; const details=[];
   details.push("عدد المواعيد المقروء: "+apts.length+" · زمن القراءة: "+ms+" مللي");
   details.push("متوسط حجم المستند: "+fmtBytes(apts.length?Math.round(totalSize/apts.length):0));
   if(noPath.length){
    st="warn";
    details.push("⚠ "+noPath.length+" موعد بدون deptPath — لا تظهر لموظفي الإدارات (غالباً محجوزة من صفحة الحجز العامة)");
   }
   if(noStatus.length){ st="warn"; details.push("⚠ "+noStatus.length+" موعد بدون status"); }
   if(noCreated.length){ st="warn"; details.push("⚠ "+noCreated.length+" موعد بدون createdAt — يظهر في نهاية القائمة (سبب الإحساس بالتأخير)"); }
   if(noName.length){ st="warn"; details.push("⚠ "+noName.length+" موعد بدون اسم/جوال — قد يتعطّل عرض الجدول بالكامل"); }
   if(big){ st="warn"; details.push("⚠ "+big+" مستند حجمه أكبر من 300 ك.ب — يجعل تحميل القائمة بطيئاً"); }
   if(embedded){ st="warn"; details.push("⚠ "+embedded+" مرفق محفوظ Base64 داخل مستندات المواعيد بحجم "+fmtBytes(embeddedBytes)+" — هذا أكبر سبب لبطء وتأخير ظهور المواعيد"); }
   add({
    id:"data",title:"جودة البيانات وحجمها",status:st,
    summary:st==="ok"?"البيانات سليمة ولا توجد مستندات ثقيلة":"توجد ملاحظات على البيانات تشرح التأخير وعدم الظهور",
    details:details,
    fixes:(noPath.length||noStatus.length||noCreated.length||noName.length)
      ?["استخدم زر «إصلاح الحقول الناقصة» أدناه (يعمل على دفعات ويحفظ سجلاً في كل موعد)"]
      :(embedded?["استخدم زر «نقل المرفقات القديمة» لتخفيف مستندات المواعيد"]:[])
   });
  }catch(e){
   add({id:"data",title:"جودة البيانات وحجمها",status:"error",summary:explain(e).title,
     details:[rawMessage(e)],fixes:[explain(e).fix]});
  }
 }

 /* 8.5) بيئة التشغيل والشبكة الداخلية */
 try{
  const proto=location.protocol.replace(":","");
  const details=[];
  let st="ok";
  details.push("الرابط: "+location.host+location.pathname);
  details.push("البروتوكول: "+proto);
  details.push("حالة الاتصال: "+(navigator.onLine?"متصل":"غير متصل"));
  details.push("حزم Firebase المحلية: "+(window.firebase?"محمّلة":"غير محمّلة"));
  if(proto==="http"&&!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
   st="warn";
   details.push("⚠ النظام يعمل على HTTP داخل الشبكة: تسجيل الدخول وقد يُحفظ التخزين المؤقت بشكل غير موثوق. يُفضّل شهادة داخلية (HTTPS).");
  }
  if(!navigator.onLine){ st="warn"; details.push("⚠ الجهاز غير متصل الآن — القراءة من النسخة المخزّنة والكتابة في طابور."); }
  add({
   id:"env",title:"بيئة التشغيل والشبكة الداخلية",status:st,
   summary:st==="ok"?"البيئة مناسبة للعمل المستمر على الشبكة الداخلية":"ملاحظة على بيئة التشغيل",
   details:details,
   fixes:(proto==="http"&&!/^(localhost|127\.0\.0\.1)$/.test(location.hostname))
     ?["اطلب شهادة داخلية (HTTPS) لنشر النظام على الشبكة الداخلية","كبديل مؤقت: استخدمه من localhost أو عبر نفق داخلي مؤمّن"]
     :[]
  });
 }catch(e){}

 /* 9) جمع كل ما سبق */
 const fails=res.filter(r=>r.status==="error");
 add({
  id:"summary",title:"الخلاصة",
  status:fails.length?"error":(res.some(r=>r.status==="warn")?"warn":"ok"),
  summary:fails.length?(fails.length+" مشكلة تمنع العمل: "+fails.map(f=>f.title).join(" · "))
    :(res.some(r=>r.status==="warn")?"لا توجد أعطال مانعة، لكن هناك ملاحظات تُبطئ النظام أو تُخفي بعض المواعيد"
    :"كل الفحوصات سليمة"),
  details:["زمن الفحص الكامل: "+Math.round(nowMs()-t0)+" مللي"],
  fixes:[]
 });
 return res;
}

/* ---------- إصلاح الحقول الناقصة ---------- */
async function backfill(opts){
 opts=opts||{};
 const dryRun=!!opts.dryRun;
 const snap=await db.collection("appointments").limit(3000).get();
 const jobs=[];
 snap.forEach(d=>{
  const a=d.data(); const patch={};
  if(!Array.isArray(a.deptPath)||a.deptPath.length===0){
   if(a.dept) patch.deptPath=[a.dept];
  }
  if(!a.status) patch.status="جديد";
  if(a.deleted===undefined) patch.deleted=false;
  if(!a.priority) patch.priority="عادي";
  if(!Array.isArray(a.attachments)) patch.attachments=[];
  if(!a.createdByDept) patch.createdByDept=a.createdByRole==="public"?"":(a.createdByDept||"");
  if(Object.keys(patch).length) jobs.push({id:d.id,patch:patch});
 });
 if(dryRun) return {changed:jobs.length,done:0};
 let done=0;
 for(let i=0;i<jobs.length;i+=400){
  const batch=db.batch();
  jobs.slice(i,i+400).forEach(j=>{
   j.patch.history=firebase.firestore.FieldValue.arrayUnion({
     action:"إصلاح تلقائي لحقول ناقصة: "+Object.keys(j.patch).join(", "),
     date:new Date().toISOString(),by:"فاحص النظام"
   });
   batch.update(db.collection("appointments").doc(j.id),j.patch);
  });
  await batch.commit();
  done+=Math.min(400,jobs.length-i);
  if(opts.onProgress) opts.onProgress(done,jobs.length);
 }
 return {changed:jobs.length,done:done};
}

/* ---------- نقل المرفقات القديمة إلى مستندات منفصلة ---------- */
async function migrateAttachments(opts){
 opts=opts||{};
 const dryRun=!!opts.dryRun;
 const snap=await db.collection("appointments").limit(3000).get();
 const jobs=[];
 snap.forEach(d=>{
  const a=d.data();
  const list=(a.attachments||[]).filter(x=>x&&x.data);
  if(list.length) jobs.push({id:d.id,list:list,all:(a.attachments||[])});
 });
 const totalBytes=jobs.reduce((s,j)=>s+j.list.reduce((x,y)=>x+String(y.data).length,0),0);
 if(dryRun) return {docs:jobs.length,attachments:jobs.reduce((s,j)=>s+j.list.length,0),bytes:totalBytes};
 let migrated=0;
 for(const j of jobs){
  const ref=db.collection("appointments").doc(j.id);
  for(const at of j.list){
   // إذا كانت البيانات Base64 نحولها إلى ملف فعلي في Storage عند توفره
   let url=null;
   if(storage&&at.data&&at.data.indexOf("data:")===0){
    try{
     const blob=await (await fetch(at.data)).blob();
     const r=storage.ref("attachments/"+j.id+"/"+at.name);
     await r.put(blob);
     url=await r.getDownloadURL();
    }catch(e){ url=null; }
   }
   const payload={name:at.name,type:at.type,size:at.size,uploadedAt:at.uploadedAt||new Date().toISOString()};
   if(url) payload.url=url; else payload.data=at.data;
   await ref.collection("attachments").add(payload);
   migrated++;
  }
  const remaining=j.all.map(function(x){
    if(!x||!x.data) return x;
    const c={name:x.name,type:x.type,size:x.size,uploadedAt:x.uploadedAt};
    if(x.url) c.url=x.url;
    return c;
  });
  await ref.update({
   attachments:remaining,
   history:firebase.firestore.FieldValue.arrayUnion({
     action:"نقل "+j.list.length+" مرفق إلى مستندات منفصلة لتخفيف حجم الموعد",
     date:new Date().toISOString(),by:"فاحص النظام"})
  });
  if(opts.onProgress) opts.onProgress(migrated);
 }
 return {docs:jobs.length,attachments:migrated,bytes:totalBytes};
}

return {
 installInspector,explain,explainText,record,fail,list,clear,runChecks,backfill,migrateAttachments,
 togglePanel,refreshPanel
};
})();

// إتاحة الفاحص للأزرار المكتوبة داخل HTML (onclick="DIAG...")
try{ window.DIAG=DIAG; }catch(e){}

// تسجيل تلقائي عند تحميل الملف
try{ DIAG.installInspector(); }catch(e){}
