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

    return query.orderBy("createdAt","desc").get().then(snap=>{
        let apts=[];
        snap.forEach(doc=>{
            apts.push({id:doc.id,...doc.data()});
        });
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
            .orderBy("createdAt","desc").get()
            .then(snap=>{
                let apts=[];
                snap.forEach(doc=>{
                    apts.push({id:doc.id,...doc.data()});
                });
                return apts;
            });
    }else{
        return db.collection("appointments")
            .where("dept","==",userDept)
            .orderBy("createdAt","desc").get()
            .then(snap=>{
                let apts=[];
                snap.forEach(doc=>{
                    apts.push({id:doc.id,...doc.data()});
                });
                return apts;
            });
    }
}

function uploadAttachment(file,aptId){
    let ref=storage.ref("attachments/"+aptId+"/"+file.name);
    return ref.put(file).then(()=>{
        return ref.getDownloadURL();
    }).then(url=>{
        return db.collection("appointments").doc(aptId).update({
            attachments:firebase.firestore.FieldValue.arrayUnion({
                name:file.name,
                url:url,
                uploadedAt:new Date().toISOString()
            })
        });
    });
}

function getAppointmentStats(dept){
    let query=db.collection("appointments");
    if(dept) query=query.where("dept","==",dept);

    return query.get().then(snap=>{
        let total=0,pending=0,active=0,done=0,returned=0;
        snap.forEach(doc=>{
            let d=doc.data();
            total++;
            if(d.status==="قيد الانتظار") pending++;
            if(d.status==="قيد التنفيذ") active++;
            if(d.status==="منجز") done++;
            if(d.status==="مرتجع") returned++;
        });
        return {total,pending,active,done,returned};
    });
}

function getCompletedCountForUser(userName){
    return db.collection("appointments")
        .where("status","==","منجز")
        .where("createdBy","==",userName)
        .get().then(snap=>snap.size);
}

function getStatusBadge(status){
    let cls="status-new";
    if(status==="جديد") cls="status-new";
    if(status==="قيد الانتظار") cls="status-pending";
    if(status==="قيد التنفيذ") cls="status-active";
    if(status==="منجز") cls="status-done";
    if(status==="مرتجع") cls="status-returned";
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
