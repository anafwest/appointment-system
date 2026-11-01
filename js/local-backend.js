/* ============================================================
   الوضع المزدوج: Firebase (سحابي) أو خادم داخلي (شبكة داخلية)
   ------------------------------------------------------------
   - يفحص وجود الخادم الداخلي (/api/health) عند فتح الصفحة.
   - إذا وُجد: يبني بديلاً متوافقاً مع Firebase (نفس الدوال) يتحدث مع الخادم المحلي.
   - إذا لم يوجد: يبقى Firebase كما هو (العمل خارج الشبكة الداخلية).
   - يمكنك فرض الوضع: ?mode=local أو ?mode=firebase (ويُحفظ للمرة القادمة).
   ============================================================ */
(function(){
    "use strict";

    const params=new URLSearchParams(location.search);
    const forced=params.get("mode");
    if(forced==="local"||forced==="firebase"){
        try{ localStorage.setItem("appt_backend",forced); }catch(e){}
    }
    let choice=forced;
    if(!choice){ try{ choice=localStorage.getItem("appt_backend"); }catch(e){} }

    if(choice==="firebase"){ window.BACKEND_MODE="firebase"; return; }

    // فحص سريع للخادم المحلي (طلب متزامن قصير جداً على الشبكة الداخلية)
    let local=null;
    try{
        const xhr=new XMLHttpRequest();
        xhr.open("GET","api/health",false);
        xhr.setRequestHeader("Accept","application/json");
        xhr.send(null);
        if(xhr.status===200){
            const j=JSON.parse(xhr.responseText);
            if(j&&j.app==="appointment-system") local=j;
        }
    }catch(e){ local=null; }

    if(!local){ window.BACKEND_MODE="firebase"; return; }

    window.BACKEND_MODE="local";
    window.LOCAL_BACKEND=local;

    /* ---------------- طبقة HTTP ---------------- */
    const BASE="api";
    function toError(status,payload){
        const e=new Error((payload&&payload.error&&payload.error.message)||("HTTP "+status));
        e.code=(payload&&payload.error&&payload.error.code)||
            (status===401?"unauthenticated":
             status===403?"permission-denied":
             status===404?"not-found":
             status===409?"already-exists":
             status===400?"invalid-argument":"internal");
        e.status=status;
        return e;
    }
    // نستخدم XMLHttpRequest بدل fetch لأنه يعمل على كل متصفحات الشبكة الداخلية
    // (بما فيها الإصدارات القديمة) ولا يعتمد على أي polyfill.
    function request(method,url,body){
        return new Promise(function(resolve,reject){
            let xhr;
            try{ xhr=new XMLHttpRequest(); }
            catch(e){ const er=new Error("المتصفح لا يدعم الاتصال بالخادم"); er.code="unavailable"; reject(er); return; }
            xhr.open(method,BASE+url,true);
            xhr.setRequestHeader("Content-Type","application/json");
            xhr.setRequestHeader("Accept","application/json");
            xhr.withCredentials=true;
            xhr.timeout=25000;
            xhr.onload=function(){
                let data=null;
                try{ data="GET"===method&&xhr.responseText?JSON.parse(xhr.responseText):JSON.parse(xhr.responseText||"null"); }catch(e){ data=null; }
                if(xhr.status>=200&&xhr.status<300) resolve(data);
                else reject(toError(xhr.status,data));
            };
            xhr.onerror=function(){
                const er=new Error("تعذّر الوصول إلى الخادم الداخلي");
                er.code="unavailable"; reject(er);
            };
            xhr.ontimeout=function(){
                const er=new Error("انتهت مهلة الطلب — تحقق من الاتصال بالشبكة");
                er.code="deadline-exceeded"; reject(er);
            };
            try{ xhr.send(body===undefined?null:JSON.stringify(body)); }
            catch(e){ const er=new Error("تعذّر إرسال الطلب"); er.code="unavailable"; reject(er); }
        });
    }

    /* ---------------- القيم الخاصة (FieldValue) ---------------- */
    const serverTimestamp=function(){ return {__sv:"serverTimestamp"}; };
    const arrayUnion=function(){ return {__sv:"arrayUnion",values:Array.prototype.slice.call(arguments)}; };
    const arrayRemove=function(){ return {__sv:"arrayRemove",values:Array.prototype.slice.call(arguments)}; };
    const deleteField=function(){ return {__sv:"delete"}; };

    /* ---------------- اللقطات والاستعلامات ---------------- */
    function makeSnap(docs,meta){
        docs=docs||[];
        return {
            size:docs.length,
            empty:docs.length===0,
            docs:docs.map(d=>({id:d.id,exists:true,data:()=>d.data})),
            forEach:function(fn){ this.docs.forEach(fn); },
            metadata:{fromCache:!!(meta&&meta.fromCache),hasPendingWrites:false}
        };
    }

    const listeners=[];
    let source=null;
    function ensureEvents(){
        if(source||typeof EventSource==="undefined") return;
        try{
            source=new EventSource(BASE+"/events");
            source.onmessage=function(ev){
                let data={};
                try{ data=JSON.parse(ev.data); }catch(e){ return; }
                const changed=data.path||"";
                listeners.slice().forEach(l=>{
                    if(changed===l.path||changed.indexOf(l.path+"/")===0||l.path.indexOf(changed+"/")===0){
                        l.refresh();
                    }
                });
            };
            source.onerror=function(){ /* المتصفح يعيد الاتصال تلقائياً */ };
        }catch(e){ source=null; }
    }

    function pathOf(parts){ return parts.filter(Boolean).join("/"); }

    function Query(parts,filters,limitN){
        const path=pathOf(parts);
        const self={
            _path:path,
            where:function(field,op,value){ return Query(parts,filters.concat([{field:field,op:op,value:value}]),limitN); },
            limit:function(n){ return Query(parts,filters,n); },
            orderBy:function(){ return Query(parts,filters,limitN); },
            get:function(){
                return request("POST","/query",{path:path,filters:filters,limit:limitN})
                    .then(r=>makeSnap(r.docs||[]));
            },
            onSnapshot:function(a,b,c){
                let cb,errCb;
                if(typeof a==="function"){ cb=a; errCb=b; } else { cb=b; errCb=c; }
                ensureEvents();
                let active=true;
                const refresh=function(){
                    if(!active) return;
                    self.get().then(snap=>{ if(active) cb(snap); },err=>{ if(active&&errCb) errCb(err); });
                };
                const entry={path:path,refresh:refresh};
                listeners.push(entry);
                refresh();
                return function(){
                    active=false;
                    const i=listeners.indexOf(entry);
                    if(i>=0) listeners.splice(i,1);
                    if(listeners.length===0&&source){ try{source.close();}catch(e){} source=null; }
                };
            }
        };
        return self;
    }

    function DocRef(parts,id){
        const path=pathOf(parts);
        return {
            id:id,
            _path:path,
            get:function(){
                return request("GET","/doc?path="+encodeURIComponent(path)+"&id="+encodeURIComponent(id))
                    .then(r=>({id:id,exists:!!r.exists,data:()=>r.data||undefined}));
            },
            set:function(data){ return request("PUT","/doc",{path:path,id:id,data:data}).then(()=>({id:id})); },
            update:function(data){ return request("PATCH","/doc",{path:path,id:id,data:data}); },
            delete:function(){ return request("DELETE","/doc",{path:path,id:id}); },
            collection:function(name){ return Collection(parts.concat([id,name])); }
        };
    }

    function Collection(parts){
        const path=pathOf(parts);
        return {
            _path:path,
            doc:function(id){ return DocRef(parts,id); },
            add:function(data){ return request("POST","/doc",{path:path,data:data}).then(r=>({id:r.id,path:path})); },
            where:function(f,op,v){ return Query(parts,[{field:f,op:op,value:v}]); },
            limit:function(n){ return Query(parts,[],n); },
            orderBy:function(){ return Query(parts,[],null); },
            get:function(){ return Query(parts,[],null).get(); },
            onSnapshot:function(a,b,c){ return Query(parts,[],null).onSnapshot(a,b,c); }
        };
    }

    /* ---------------- المصادقة ---------------- */
    const authUsers=[];
    let currentUser=null;
    let authReady=false;
    let readyWaiters=[];

    function setUser(u){
        currentUser=u||null;
        authReady=true;
        authUsers.slice().forEach(fn=>{ try{ fn(currentUser); }catch(e){} });
        readyWaiters.slice().forEach(fn=>fn(currentUser));
        readyWaiters=[];
    }

    request("GET","/auth/me").then(r=>setUser(r&&r.user)).catch(()=>setUser(null));

    const auth={
        currentUser:null,
        onAuthStateChanged:function(cb){
            authUsers.push(cb);
            if(authReady) setTimeout(()=>cb(currentUser),0);
            return function(){ const i=authUsers.indexOf(cb); if(i>=0) authUsers.splice(i,1); };
        },
        signInWithEmailAndPassword:function(email,password){
            return request("POST","/auth/login",{email:email,password:password})
                .then(r=>{ setUser(r.user); return {user:r.user}; });
        },
        signInAnonymously:function(){
            return request("POST","/auth/anonymous",{}).then(r=>{ setUser(r.user); return {user:r.user}; });
        },
        signOut:function(){
            return request("POST","/auth/logout",{}).then(()=>{ setUser(null); });
        },
        sendPasswordResetEmail:function(){
            const e=new Error("إعادة تعيين كلمة المرور غير متاحة في الوضع المحلي — يغيّرها مدير النظام من إدارة المستخدمين");
            e.code="auth/operation-not-allowed";
            return Promise.reject(e);
        },
        setPersistence:function(){ return Promise.resolve(); },
        Auth:{Persistence:{LOCAL:"local",SESSION:"session",NONE:"none"}}
    };
    Object.defineProperty(auth,"currentUser",{get:function(){ return currentUser; }});

    /* ---------------- Firestore ---------------- */
    const db={
        collection:function(name){ return Collection([name]); },
        settings:function(){},
        enablePersistence:function(){ return Promise.resolve(); },
        batch:function(){
            const ops=[];
            return {
                update:function(ref,data){ ops.push({type:"update",path:ref._path,id:ref.id,data:data}); return this; },
                set:function(ref,data){ ops.push({type:"set",path:ref._path,id:ref.id,data:data}); return this; },
                delete:function(ref){ ops.push({type:"delete",path:ref._path,id:ref.id}); return this; },
                commit:function(){ return request("POST","/batch",{ops:ops}); }
            };
        }
    };

    /* ---------------- التركيب ---------------- */
    const fake={
        initializeApp:function(){},
        app:function(){ return {options:{projectId:"local-intranet",authDomain:"local"}}; },
        auth:function(){ return auth; },
        firestore:function(){ return db; }
    };
    fake.firestore.FieldValue={serverTimestamp,arrayUnion,arrayRemove,delete:deleteField};
    fake.firestore.Timestamp={fromDate:d=>({seconds:Math.floor(d.getTime()/1000),nanoseconds:0})};

    try{ window.firebase=fake; }
    catch(e){ window.BACKEND_MODE="firebase"; return; }

    /* ---------------- شارة الوضع ---------------- */
    function badge(){
        if(!document.body||document.getElementById("modeBadge")) return;
        const b=document.createElement("div");
        b.id="modeBadge";
        b.title="يعمل الآن على الخادم الداخلي. للتحويل إلى Firebase أضف ?mode=firebase إلى الرابط.";
        b.style.cssText="position:fixed;bottom:16px;right:16px;z-index:99997;background:#006946;color:#fff;"+
            "font-family:'Tajawal',Tahoma,sans-serif;font-size:12px;font-weight:700;padding:7px 12px;"+
            "border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.2);opacity:.9;cursor:help";
        b.textContent="وضع محلي — الشبكة الداخلية";
        document.body.appendChild(b);
    }
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",badge);
    else badge();
})();
