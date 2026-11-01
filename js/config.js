/* حماية: إذا لم تُحمّل حزم Firebase المحلية (js/vendor) ولم يتوفر الاحتياطي،
   نعرض رسالة عربية واضحة بدل صفحة بيضاء وأخطاء متتابعة. */
if(typeof firebase==="undefined"){
    (function(){
        function show(){
            var d=document.createElement("div");
            d.style.cssText="position:fixed;inset:0;z-index:99999;background:#fff;color:#7a1f1f;display:flex;"+
                "align-items:center;justify-content:center;padding:30px;text-align:center;"+
                "font-family:Tahoma,'Segoe UI',sans-serif;font-size:16px;line-height:2";
            d.innerHTML="<div style='max-width:640px'><h2 style='margin-bottom:10px'>تعذّر تشغيل النظام</h2>"+
                "<p>لم يتم تحميل ملفات Firebase المحلية من مجلد <b>js/vendor</b> ولم يتوفر الاتصال بالإنترنت لتحميلها.</p>"+
                "<p>تأكد من رفع الملفات الأربعة داخل <b>js/vendor/</b> على الخادم الداخلي، ثم أعد تحميل الصفحة (Ctrl+Shift+R).</p></div>";
            document.body.appendChild(d);
        }
        if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",show);
        else show();
    })();
    throw new Error("Firebase SDK غير محمّل — راجع js/vendor");
}

const firebaseConfig = {
    apiKey: "AIzaSyAfzaFsDgifH8gtkgFSq6NsUh-FUfwkrfM",
    authDomain: "appointment-system-a5725.firebaseapp.com",
    projectId: "appointment-system-a5725",
    storageBucket: "appointment-system-a5725.firebasestorage.app",
    messagingSenderId: "852552556059",
    appId: "1:852552556059:web:46e14c5ab6844574f8a2be"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

/* ============================================================
   إعدادات الشبكة الداخلية (Intranet)
   - Firestore يستخدم WebChannel (بث) وهو أول ما يحجبه بروكسي الشبكات
     الداخلية. الكشف التلقائي ينقله إلى long-polling عند الحاجة.
   - لتثبيت long-polling نهائياً: اجعل INTRANET_FORCE_LONGPOLLING = true
   ============================================================ */
const INTRANET_FORCE_LONGPOLLING = false;

try{
    db.settings({
        ignoreUndefinedProperties:true,
        experimentalAutoDetectLongPolling:!INTRANET_FORCE_LONGPOLLING,
        experimentalForceLongPolling:INTRANET_FORCE_LONGPOLLING,
        experimentalLongPollingOptions:{timeoutSeconds:30}
    });
}catch(e){
    try{ db.settings({ignoreUndefinedProperties:true}); }catch(_){}
}

// تخزين مؤقت دائم (IndexedDB): يسمح بفتح النظام والعمل بالقراءة أثناء
// انقطاع الشبكة الداخلية، ويحفظ الكتابات في طابور حتى يعود الاتصال.
try{
    db.enablePersistence({synchronizeTabs:true}).catch(function(err){
        console.warn("[config] التخزين المؤقت غير مفعّل:",err&&err.code);
    });
}catch(e){
    console.warn("[config] التخزين المؤقت غير متاح");
}

// إبقاء الجلسة محفوظة على جهاز المكتب (لا تخرج عند إغلاق المتصفح)
try{
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){});
}catch(e){}

let storage=null;
try{
    if(firebase.storage){
        storage=firebase.storage();
    }
}catch(e){
    console.log("Firebase Storage غير متاح");
}

/* ============================================================
   مؤشر حالة الشبكة: يظهر شريطاً واضحاً عند الانقطاع
   ============================================================ */
(function(){
    let bar=null;
    function ensure(){
        if(bar||!document.body) return bar;
        bar=document.createElement("div");
        bar.id="netBar";
        bar.style.cssText="position:fixed;bottom:0;left:0;right:0;z-index:99998;padding:9px 16px;text-align:center;"+
            "font-family:'Tajawal',Tahoma,sans-serif;font-weight:700;font-size:13px;color:#7a4a00;"+
            "background:#fff3cd;border-top:1px solid #ffe08a;display:none";
        document.body.appendChild(bar);
        return bar;
    }
    function render(){
        let el=ensure();
        if(!el) return;
        if(navigator.onLine){
            el.style.display="none";
        }else{
            el.style.display="block";
            el.textContent="لا يوجد اتصال بالشبكة — يمكنك متابعة القراءة، وأي تعديل سيُحفظ تلقائياً عند عودة الاتصال.";
        }
    }
    window.addEventListener("online",function(){
        render();
        try{ document.dispatchEvent(new CustomEvent("diag:online")); }catch(_){}
    });
    window.addEventListener("offline",render);
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",render);
    else render();
})();
