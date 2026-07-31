function addAppointment(data){
    return db.collection("appointments").add({
        ...data,
        status:"جديد",
        createdAt:firebase.firestore.FieldValue.serverTimestamp(),
        history:[{
            action:"إنشاء الموعد",
            date:new Date().toISOString(),
            by:data.createdBy||"النظام"
        }],
        attachments:[]
    });
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
        let apt=doc.data();
        let oldDept=apt.dept;
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
        let apt=doc.data();
        let created=apt.createdAt?apt.createdAt.toDate():new Date(apt.history?.[0]?.date||now);
        let diffMs=new Date()-created;
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

function getAppointments(filters={}){
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

    return query.get().then(snap=>{
        let apts=[];
        snap.forEach(doc=>{
            apts.push({id:doc.id,...doc.data()});
        });
        apts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
        return apts;
    });
}

function getAppointmentById(id){
    return db.collection("appointments").doc(id).get().then(doc=>{
        if(doc.exists) return {id:doc.id,...doc.data()};
        return null;
    });
}

function getAppointmentsForUser(userRole,userDept){
    if(userRole==="admin"){
        return getAppointments();
    }else if(userRole==="registration"){
        return db.collection("appointments")
            .where("createdByDept","==",userDept)
            .get()
            .then(snap=>{
                let apts=[];
                snap.forEach(doc=>{
                    apts.push({id:doc.id,...doc.data()});
                });
                apts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
                return apts;
            });
    }else{
        return db.collection("appointments")
            .where("deptPath","array-contains",userDept)
            .get()
            .then(snap=>{
                let apts=[];
                snap.forEach(doc=>{
                    apts.push({id:doc.id,...doc.data()});
                });
                apts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
                return apts;
            });
    }
}

function getReturnedCountForUser(userName,userDept){
    return db.collection("appointments")
        .where("dept","==",userDept)
        .get().then(snap=>{
            let count=0;
            snap.forEach(doc=>{
                let d=doc.data();
                if(d.returnedDate&&d.createdBy===userName&&!d.deleted&&d.status!=="منجز") count++;
            });
            return count;
        });
}

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
            },"image/jpeg",0.8);
        };
        img.onerror=function(){reject(new Error("فشل قراءة الصورة"));};
        img.src=url;
    });
}

function uploadAttachment(file,aptId){
    let uploadToFirestore=function(data,name,type,size){
        return db.collection("appointments").doc(aptId).update({
            attachments:firebase.firestore.FieldValue.arrayUnion({
                name:name,
                data:data,
                type:type,
                size:size,
                uploadedAt:new Date().toISOString()
            })
        });
    };

    // Try Firebase Storage first
    if(storage){
        let ref=storage.ref("attachments/"+aptId+"/"+file.name);
        return ref.put(file).then(()=>ref.getDownloadURL()).then(url=>{
            return db.collection("appointments").doc(aptId).update({
                attachments:firebase.firestore.FieldValue.arrayUnion({
                    name:file.name,
                    url:url,
                    type:file.type,
                    size:file.size,
                    uploadedAt:new Date().toISOString()
                })
            });
        }).catch(()=>{
            // Storage failed - fall back to base64
            return fallbackUpload(file,aptId);
        });
    }else{
        return fallbackUpload(file,aptId);
    }
}

function fallbackUpload(file,aptId){
    return new Promise((resolve,reject)=>{
        if(file.type&&file.type.startsWith("image/")){
            compressImage(file,1200,1200).then(compressed=>{
                let reader=new FileReader();
                reader.onload=function(e){
                    let data=e.target.result;
                    if(data.length>900000){
                        reject(new Error("الصورة كبيرة جداً بعد الضغط - اختر صورة أقل دقة"));
                        return;
                    }
                    db.collection("appointments").doc(aptId).update({
                        attachments:firebase.firestore.FieldValue.arrayUnion({
                            name:file.name,
                            data:data,
                            type:"image/jpeg",
                            size:compressed.size,
                            uploadedAt:new Date().toISOString()
                        })
                    }).then(resolve).catch(reject);
                };
                reader.readAsDataURL(compressed);
            }).catch(reject);
        }else{
            let reader=new FileReader();
            reader.onload=function(e){
                let data=e.target.result;
                if(data.length>800000){
                    reject(new Error("حجم الملف كبير جداً (الحد الأعلى ~600KB). استخدم Firebase Storage برفع الخطة"));
                    return;
                }
                db.collection("appointments").doc(aptId).update({
                    attachments:firebase.firestore.FieldValue.arrayUnion({
                        name:file.name,
                        data:data,
                        type:file.type,
                        size:file.size,
                        uploadedAt:new Date().toISOString()
                    })
                }).then(resolve).catch(reject);
            };
            reader.readAsDataURL(file);
        }
    });
}

function getAppointmentStats(dept){
    let query=db.collection("appointments");
    if(dept) query=query.where("dept","==",dept);

    return query.get().then(snap=>{
        let total=0,pending=0,active=0,done=0,returned=0;
        snap.forEach(doc=>{
            let d=doc.data();
            if(d.deleted) return;
            total++;
            if(d.status==="قيد الانتظار") pending++;
            if(d.status==="قيد التنفيذ") active++;
            if(d.status==="منجز") done++;
            if(d.status==="مرتجع") returned++;
        });
        return {total,pending,active,done,returned};
    });
}

function respondAppointment(id,responseStatus,reason,by){
    let now=new Date().toISOString();
    return db.collection("appointments").doc(id).get().then(doc=>{
        let apt=doc.data();
        return db.collection("appointments").doc(id).update({
            status:responseStatus,
            notes:(apt.notes?apt.notes+"\n":"")+"رد ("+responseStatus+") - "+reason,
            dept:apt.createdByDept||"",
            returnedDate:now,
            respondedBy:by,
            history:firebase.firestore.FieldValue.arrayUnion({
                action:"رد من "+apt.dept+" - "+responseStatus+" - "+reason,
                date:now,
                by:by
            })
        });
    });
}

function getCompletedCountForUser(userName){
    return db.collection("appointments")
        .where("status","==","منجز")
        .get().then(snap=>{
            let count=0;
            snap.forEach(doc=>{
                let d=doc.data();
                if(!d.deleted&&d.createdBy===userName) count++;
            });
            return count;
        });
}

function getStatusBadge(status){
    let cls="status-new";
    if(status==="جديد") cls="status-new";
    if(status==="قيد الانتظار") cls="status-pending";
    if(status==="قيد التنفيذ") cls="status-active";
    if(status==="منجز") cls="status-done";
    if(status==="مرتجع") cls="status-returned";
    if(status==="مرفوض") cls="status-returned";
    return '<span class="status-badge '+cls+'">'+status+'</span>';
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
