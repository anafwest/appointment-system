/* ============================================================
   منطق المواعيد - نسخة محسّنة (سرعة + تحديث لحظي + توافق مع البيانات القديمة)
   ============================================================ */

function tsToMillis(v){
    if(!v) return 0;
    if(typeof v.toMillis==="function") return v.toMillis();
    if(typeof v.seconds==="number") return v.seconds*1000;
    if(v instanceof Date) return v.getTime();
    if(typeof v==="string"){ let d=new Date(v); return isNaN(d)?0:d.getTime(); }
    return 0;
}

function mapDocs(snap){
    let apts=[];
    snap.forEach(doc=>{
        let d=doc.data()||{};
        apts.push(Object.assign({id:doc.id},d));
    });
    apts.sort((a,b)=>tsToMillis(b.createdAt)-tsToMillis(a.createdAt));
    return apts;
}

function addAppointment(data){
    // إصلاح: كانت المواعيد المحجوزة من صفحة الحجز العام تُحفظ بدون deptPath
    // فلا تظهر أبداً لموظفي الإدارة المختصة.
    let dept=data.dept||"";
    let deptPath=Array.isArray(data.deptPath)&&data.deptPath.length?data.deptPath:(dept?[dept]:[]);
    let payload=Object.assign({},data,{
        dept:dept,
        deptPath:deptPath,
        priority:data.priority||"عادي",
        notes:data.notes||"",
        createdByDept:(data.createdByDept===undefined?"":data.createdByDept),
        status:data.status||"جديد",
        deleted:false,
        createdAt:firebase.firestore.FieldValue.serverTimestamp(),
        history:[{
            action:"إنشاء الموعد",
            date:new Date().toISOString(),
            by:data.createdBy||"النظام"
        }],
        attachments:[]
    });
    delete payload.id;
    if(data.id){
        return db.collection("appointments").doc(String(data.id)).set(payload).then(()=>db.collection("appointments").doc(String(data.id)));
    }
    return db.collection("appointments").add(payload);
}

function updateAppointment(id,data){
    return db.collection("appointments").doc(id).update(data);
}

function addAppointmentNote(id,note,by){
    return db.collection("appointments").doc(id).update({
        history:firebase.firestore.FieldValue.arrayUnion({
            action:"إضافة ملاحظة: "+note,
            date:new Date().toISOString(),
            by:by
        })
    });
}

function forwardAppointment(id,newDept,newStatus,notes,by){
    return db.collection("appointments").doc(id).get().then(doc=>{
        let apt=doc.data()||{};
        let oldDept=apt.dept||"-";
        return db.collection("appointments").doc(id).update({
            dept:newDept,
            status:newStatus,
            forwardDate:new Date().toISOString(),
            deptPath:firebase.firestore.FieldValue.arrayUnion(newDept),
            history:firebase.firestore.FieldValue.arrayUnion({
                action:"إحالة من "+oldDept+" إلى "+newDept+(notes?" - "+notes:""),
                date:new Date().toISOString(),
                by:by
            })
        });
    });
}

function markAppointmentDone(id,by){
    let now=new Date().toISOString();
    return db.collection("appointments").doc(id).get().then(doc=>{
        let apt=doc.data()||{};
        let created=apt.createdAt&&typeof apt.createdAt.toDate==="function"
            ?apt.createdAt.toDate()
            :new Date((apt.history&&apt.history[0]&&apt.history[0].date)||now);
        let diffMs=Math.max(0,new Date()-created);
        let diffDays=Math.floor(diffMs/(1000*60*60*24));
        let diffHours=Math.floor((diffMs%(1000*60*60*24))/(1000*60*60));
        let duration=diffDays+" يوم "+diffHours+" ساعة";
        return db.collection("appointments").doc(id).update({
            status:"منجز",
            doneDate:now,
            duration:duration,
            doneBy:by,
            history:firebase.firestore.FieldValue.arrayUnion({
                action:"تم التحديد كمنجز - المدة: "+duration,
                date:now,
                by:by
            })
        });
    });
}

/* ---------- قراءات ---------- */

function getAppointments(filters){
    filters=filters||{};
    let query=db.collection("appointments");

    if(filters.dept){
        query=query.where("dept","==",filters.dept);
    }
    if(filters.status){
        query=query.where("status","==",filters.status);
    }
    if(filters.dateFrom){
        query=query.where("date",">=",filters.dateFrom);
    }
    if(filters.dateTo){
        query=query.where("date","<=",filters.dateTo);
    }

    return query.get().then(mapDocs);
}

/* كل المواعيد - للاستخدام الإداري فقط (يُفضّل الاعتماد على الكاش اللحظي في الصفحة) */
function getAppointmentsForUser(userRole,userDept){
    if(userRole==="admin") return getAppointments();

    // إصلاح: مسؤول التسجيل وموظف الإدارة يعتمدان على deptPath.
    // المستندات القديمة (التي أُنشئت قبل الإصلاح) لا تحتوي deptPath، لذلك يوجد دمج احتياطي.
    if(!userDept) return getAppointments();

    return db.collection("appointments")
        .where("deptPath","array-contains",userDept)
        .get()
        .then(snap=>{
            let list=mapDocs(snap);
            if(list.length>0) return list;
            return db.collection("appointments")
                .where("dept","==",userDept)
                .get()
                .then(mapDocs);
        })
        .then(list=>{
            if(userRole==="registration"){
                // إضافة ما أنشأه المسؤول نفسه بغض النظر عن الإدارة الحالية
                return db.collection("appointments")
                    .where("createdByDept","==",userDept)
                    .get()
                    .then(snap=>{
                        let byMe=mapDocs(snap);
                        let seen={};
                        list.forEach(a=>seen[a.id]=true);
                        byMe.forEach(a=>{ if(!seen[a.id]) list.push(a); });
                        list.sort((a,b)=>tsToMillis(b.createdAt)-tsToMillis(a.createdAt));
                        return list;
                    })
                    .catch(()=>list);
            }
            return list;
        });
}

/* تحديث لحظي: أي موعد جديد أو تعديل يظهر مباشرة بدون إعادة تحميل */
function mergeLists(){
    let out=[],seen={};
    for(let i=0;i<arguments.length;i++){
        (arguments[i]||[]).forEach(a=>{
            if(!seen[a.id]){ seen[a.id]=true; out.push(a); }
        });
    }
    out.sort((a,b)=>tsToMillis(b.createdAt)-tsToMillis(a.createdAt));
    return out;
}

function watchAppointments(userRole,userDept,onData,onError){
    let col=db.collection("appointments");

    function single(query){
        return query.onSnapshot({includeMetadataChanges:false},snap=>{
            onData(mapDocs(snap),{fromCache:snap.metadata.fromCache,pendingWrites:snap.metadata.hasPendingWrites});
        },err=>{ if(onError) onError(err); });
    }

    if(userRole==="admin"||!userDept) return single(col);

    if(userRole==="registration"){
        // مسؤول التسجيل يرى: ما وصل إلى إدارته + كل ما أنشأه بنفسه
        let a=[],b=[],metaA={fromCache:false,pendingWrites:false},metaB=metaA;
        let emit=()=>onData(mergeLists(a,b),{
            fromCache:!!(metaA.fromCache&&metaB.fromCache),
            pendingWrites:!!(metaA.pendingWrites||metaB.pendingWrites)
        });
        let un1=col.where("deptPath","array-contains",userDept).onSnapshot({includeMetadataChanges:false},snap=>{
            a=mapDocs(snap); metaA=snap.metadata; emit();
        },err=>{ if(onError) onError(err); });
        let un2=col.where("createdByDept","==",userDept).onSnapshot({includeMetadataChanges:false},snap=>{
            b=mapDocs(snap); metaB=snap.metadata; emit();
        },err=>{ if(onError) onError(err); });
        return function(){ try{un1();}catch(e){} try{un2();}catch(e){} };
    }

    return single(col.where("deptPath","array-contains",userDept));
}

function getAppointmentById(id){
    return db.collection("appointments").doc(id).get().then(doc=>{
        if(doc.exists) return Object.assign({id:doc.id},doc.data());
        return null;
    });
}

function getReturnedCountForUser(userName,userDept){
    return db.collection("appointments")
        .where("dept","==",userDept)
        .get().then(snap=>{
            let count=0;
            snap.forEach(doc=>{
                let d=doc.data()||{};
                if((d.returnedDate||d.returnedTo)&&d.createdBy===userName&&!d.deleted&&d.status!=="منجز") count++;
            });
            return count;
        });
}

function getCompletedCountForUser(userName){
    return db.collection("appointments")
        .where("status","==","منجز")
        .get().then(snap=>{
            let count=0;
            snap.forEach(doc=>{
                let d=doc.data()||{};
                if(!d.deleted&&d.createdBy===userName) count++;
            });
            return count;
        });
}

/* إحصاءات محسوبة من قائمة جاهزة - توفّر استعلاماً كاملاً لكل تحميل */
function getStatsFromAppointments(list){
    let total=0,newCount=0,pending=0,active=0,done=0,returned=0;
    (list||[]).forEach(a=>{
        if(a.deleted) return;
        total++;
        if(a.status==="جديد"||!a.status) newCount++;
        if(a.status==="قيد الانتظار") pending++;
        if(a.status==="قيد التنفيذ") active++;
        if(a.status==="منجز") done++;
        if(a.status==="مرتجع"||a.status==="مرفوض") returned++;
    });
    return {total,newCount,pending,active,done,returned};
}

function getAppointmentStats(dept){
    let query=db.collection("appointments");
    if(dept) query=query.where("dept","==",dept);
    return query.get().then(snap=>getStatsFromAppointments(mapDocs(snap)));
}

/* ---------- المرفقات ---------- */

function compressImage(file,maxW,maxH){
    return new Promise((resolve,reject)=>{
        let img=new Image();
        let url=URL.createObjectURL(file);
        img.onload=function(){
            let w=img.width,h=img.height;
            if(w>maxW||h>maxH){
                let ratio=Math.min(maxW/w,maxH/h);
                w*=ratio;h*=ratio;
            }
            let c=document.createElement("canvas");
            c.width=w;c.height=h;
            let ctx=c.getContext("2d");
            ctx.drawImage(img,0,0,w,h);
            c.toBlob(function(blob){
                URL.revokeObjectURL(url);
                resolve(blob);
            },"image/jpeg",0.75);
        };
        img.onerror=function(){ URL.revokeObjectURL(url); reject(new Error("فشل قراءة الصورة")); };
        img.src=url;
    });
}

/* المرفقات تُحفظ الآن في مجموعة فرعية appointments/{id}/attachments بدل تضخيم مستند الموعد.
   الترتيب: Storage → مجموعة فرعية → (احتياطي أخير) داخل المستند لضمان عدم فقدان الملف. */
function uploadAttachment(file,aptId){
    let sub=db.collection("appointments").doc(aptId).collection("attachments");

    function addToSub(extra){
        return sub.add(Object.assign({
            name:file.name,
            type:file.type,
            size:file.size,
            uploadedAt:new Date().toISOString()
        },extra));
    }

    function legacyEmbedded(data,type,size){
        return db.collection("appointments").doc(aptId).update({
            attachments:firebase.firestore.FieldValue.arrayUnion({
                name:file.name,data:data,type:type,size:size,
                uploadedAt:new Date().toISOString()
            })
        });
    }

    function prepareImage(){
        if(file.type&&file.type.startsWith("image/")){
            return compressImage(file,1200,1200).then(blob=>{
                return new Promise((resolve,reject)=>{
                    let reader=new FileReader();
                    reader.onload=e=>resolve({data:e.target.result,type:"image/jpeg",size:blob.size});
                    reader.onerror=reject;
                    reader.readAsDataURL(blob);
                });
            });
        }
        return new Promise((resolve,reject)=>{
            if(file.size>700*1024){
                return reject(new Error("الملف كبير ("+(file.size/1024).toFixed(0)+" ك.ب). الحد الأعلى للملفات غير المصوّرة ~700 ك.ب"));
            }
            let reader=new FileReader();
            reader.onload=e=>resolve({data:e.target.result,type:file.type,size:file.size});
            reader.onerror=reject;
            reader.readAsDataURL(file);
        });
    }

    return prepareImage().then(prepared=>{
        let withUrl=function(){
            if(!storage) return Promise.resolve(false);
            let ref=storage.ref("attachments/"+aptId+"/"+Date.now()+"_"+file.name);
            return ref.putString(prepared.data,"data_url")
                .then(()=>ref.getDownloadURL())
                .then(url=>addToSub({url:url}))
                .then(()=>true)
                .catch(()=>false);
        };
        return withUrl().then(done=>{
            if(done) return true;
            return addToSub({data:prepared.data,type:prepared.type,size:prepared.size}).then(()=>true);
        });
    }).catch(err=>{
        // احتياطي أخير حتى لا يضيع الملف
        return prepareImage()
            .then(p=>legacyEmbedded(p.data,p.type,p.size))
            .catch(()=>{ throw err; });
    });
}

/* قراءة المرفقات (الجديدة من المجموعة الفرعية + القديمة من المستند) */
function getAttachments(apt){
    let aptId=typeof apt==="string"?apt:apt.id;
    let inline=typeof apt==="object"&&apt?((apt.attachments||[]).filter(a=>a&&(a.data||a.url))):[];
    return db.collection("appointments").doc(aptId).collection("attachments").get()
        .then(snap=>{
            let list=[];
            snap.forEach(d=>{
                let a=d.data()||{};
                a.id=d.id;
                list.push(a);
            });
            return list.concat(inline);
        })
        .catch(()=>inline);
}

function getStatusBadge(status){
    let s=status||"جديد";
    let cls="status-new";
    if(s==="قيد الانتظار") cls="status-pending";
    if(s==="قيد التنفيذ") cls="status-active";
    if(s==="منجز") cls="status-done";
    if(s==="مرتجع"||s==="مرفوض") cls="status-returned";
    return '<span class="status-badge '+cls+'">'+s+'</span>';
}

function getNow(){
    let d=new Date();
    return d.getFullYear()+"-"+
    String(d.getMonth()+1).padStart(2,"0")+"-"+
    String(d.getDate()).padStart(2,"0")+" "+
    String(d.getHours()).padStart(2,"0")+":"+
    String(d.getMinutes()).padStart(2,"0");
}

function formatDate(dateStr){
    if(!dateStr) return "-";
    return dateStr;
}

function respondAppointment(id,responseStatus,reason,by){
    let now=new Date().toISOString();
    return db.collection("appointments").doc(id).get().then(doc=>{
        let apt=doc.data()||{};
        let patch={
            status:responseStatus,
            notes:(apt.notes?apt.notes+"\n":"")+"رد ("+responseStatus+") - "+reason,
            respondedBy:by,
            returnedDate:now,
            returnedTo:apt.createdByDept||"",
            history:firebase.firestore.FieldValue.arrayUnion({
                action:"رد من "+(apt.dept||"-")+" - "+responseStatus+" - "+reason,
                date:now,
                by:by
            })
        };
        // لا نُفرغ الإدارة إذا لم يكن الموعد مرتبطاً بمسؤول تسجيل (حجز ذاتي)،
        // وإلا اختفى الموعد من كل شاشات الإدارة.
        if(apt.createdByDept){
            patch.dept=apt.createdByDept;
            patch.deptPath=firebase.firestore.FieldValue.arrayUnion(apt.createdByDept);
        }
        return db.collection("appointments").doc(id).update(patch);
    });
}
