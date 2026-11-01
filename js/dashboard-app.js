let currentUser=null;
let allAppointments=[];
let pendingUploads=[];
let unsubWatch=null;
let currentPage="dashboard";
let lastSyncAt=0;
let renderLimit=200;

const DEPTS=["الإدارة العامة لتنمية المدينة","الإدارة العامة للبنية التحتية","الإدارة العامة للاستدامة البيئية","الإدارة العامة للرقابة","مكتب مدير القطاع","مكتب نائب القطاع"];

/* ---------- أدوات مساعدة ---------- */
function esc(s){
    return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function showToast(msg,type){
    let toast=document.getElementById("toast");
    if(!toast) return;
    toast.textContent=msg;
    toast.className="toast show "+(type||"success");
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>{toast.className="toast";},type==="error"?8000:3500);
}
function setSyncStatus(text,kind){
    let el=document.getElementById("syncStatus");
    if(!el) return;
    el.textContent=text;
    el.style.color=kind==="error"?"#ffb3b3":(kind==="warn"?"#ffd88a":"#bff5d8");
    el.title=text;
}
function showBanner(ex){
    let b=document.getElementById("errorBanner");
    if(!b) return;
    b.style.display="block";
    b.innerHTML='<div><strong>'+esc(ex.title)+'</strong><div style="font-size:13px;margin-top:4px">السبب: '+esc(ex.cause)+'</div>'+
        '<div style="font-size:13px;margin-top:4px">الحل: '+esc(ex.fix)+'</div>'+
        (ex.indexUrl?'<div style="margin-top:6px"><a href="'+esc(ex.indexUrl)+'" target="_blank" style="color:#006946;font-weight:700">إنشاء الفهرس المطلوب</a></div>':'')+
        '<div style="margin-top:8px"><button class="btn btn-secondary btn-sm" onclick="openDiagnostics()">فتح فاحص النظام</button></div></div>'+
        '<button onclick="document.getElementById(\'errorBanner\').style.display=\'none\'" style="background:none;border:0;font-size:20px;cursor:pointer;color:#d62828">&times;</button>';
}
function openDiagnostics(){ window.open("diagnostics.html","_blank"); }

function tableLoading(tbodyId,cols){
    let el=document.getElementById(tbodyId);
    if(el) el.innerHTML='<tr><td colspan="'+cols+'" style="text-align:center;color:#888;padding:22px">جارٍ تحميل البيانات…</td></tr>';
}
function tableError(tbodyId,cols,ex){
    let el=document.getElementById(tbodyId);
    if(!el) return;
    el.innerHTML='<tr><td colspan="'+cols+'" style="padding:16px;color:#d62828;text-align:right;line-height:1.9">'+
        '<strong>'+esc(ex.title)+'</strong><br>السبب: '+esc(ex.cause)+'<br>الحل: '+esc(ex.fix)+'</td></tr>';
}

document.getElementById("currentDate").innerHTML=new Date().toLocaleDateString("ar-SA",{weekday:"long",year:"numeric",month:"long",day:"numeric"});

/* ---------- بدء التشغيل ---------- */
requireAuth(user=>{
    currentUser=user;
    document.getElementById("userInfo").innerHTML=esc(user.name||"")+' <span class="role-badge">'+esc(getRoleName(user.role))+'</span>';
    document.getElementById("welcomeMsg").textContent="مرحباً "+(user.name||"")+" - "+getRoleName(user.role);
    let dl=document.getElementById("diagLink");
    if(dl&&user.role==="admin") dl.style.display="inline";
    setupTabsByRole();
    startLiveSync();
});

function getRoleName(role){
    if(role==="admin") return "مدير النظام";
    if(role==="registration") return "مسؤول التسجيل";
    if(role==="department") return "موظف إدارة";
    return role||"-";
}

function setupTabsByRole(){
    let r=currentUser.role;
    document.getElementById("tabAdd").style.display=(r==="admin"||r==="registration")?"inline-block":"none";
    document.getElementById("tabForward").style.display=(r==="admin")?"inline-block":"none";
    document.getElementById("tabKPI").style.display=(r==="admin")?"inline-block":"none";
    document.getElementById("tabReports").style.display=(r==="admin")?"inline-block":"none";
    document.getElementById("tabUsers").style.display=(r==="admin")?"inline-block":"none";

    if(r==="department"){
        document.getElementById("filterDept").value="";
        document.getElementById("filterDept").disabled=true;
        document.querySelectorAll(".tab").forEach(t=>t.style.display="none");
        document.querySelectorAll(".tab")[1].style.display="inline-block";
    }
}

/* ---------- المزامنة اللحظية (سبب رئيسي لتأخير ظهور المواعيد سابقاً) ---------- */
function startLiveSync(){
    if(unsubWatch){ try{unsubWatch();}catch(e){} unsubWatch=null; }
    setSyncStatus("جارٍ الاتصال بقاعدة البيانات…","warn");
    unsubWatch=watchAppointments(currentUser.role,currentUser.dept,
        function(list,meta){
            allAppointments=list;
            lastSyncAt=Date.now();
            setSyncStatus(meta.pendingWrites?"جارٍ الحفظ…":(meta.fromCache?"نسخة مخزّنة محلياً":"محدّث لحظياً"),meta.fromCache?"warn":"ok");
            renderDashboard();
            if(currentPage==="appointments"){ renderAppointments(); renderDeleted(); }
            if(currentPage==="forward") renderForwardTable();
            if(currentPage==="kpi") renderKPI();
            if(currentPage==="reports") renderReport();
            updateNotifications();
        },
        function(err){
            let ex=DIAG.record(err,"المزامنة اللحظية");
            setSyncStatus("المزامنة متوقفة — "+ex.title,"error");
            showBanner(ex);
            // بديل: قراءة مرة واحدة حتى لا تبقى الشاشة فارغة
            loadAppointments(true);
        }
    );
}

function forceRefresh(){
    showToast("جارٍ تحديث البيانات…");
    if(unsubWatch){ try{unsubWatch();}catch(e){} unsubWatch=null; }
    startLiveSync();
    loadAppointments(true);
}

/* ---------- التنقل ---------- */
function showPage(page){
    if(currentUser.role==="department"&&page!=="appointments") page="appointments";
    currentPage=page;
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
    let el=document.getElementById("page-"+page);
    if(el) el.classList.add("active");
    let tabs=document.querySelectorAll(".tab");
    let pages=["dashboard","appointments","add","forward","kpi","reports","users"];
    let idx=pages.indexOf(page);
    if(idx>=0&&tabs[idx]) tabs[idx].classList.add("active");

    if(page==="dashboard") renderDashboard();
    if(page==="appointments"){ renderAppointments(); renderDeleted(); }
    if(page==="forward") renderForwardTable();
    if(page==="kpi") renderKPI();
    if(page==="reports") renderReport();
    if(page==="users") loadUsers();
}

/* ---------- لوحة التحكم ---------- */
function loadDashboard(){ renderDashboard(); }

function renderDashboard(){
    let box=document.getElementById("dashboardStats");
    if(!box) return;
    if(allAppointments.length===0&&!lastSyncAt){
        box.innerHTML='<div class="card card-total"><h3>جارٍ تحميل المواعيد…</h3><div class="value">—</div></div>';
        return;
    }
    let s=getStatsFromAppointments(allAppointments);
    box.innerHTML=`
    <div class="card card-total"><div class="icon">&#128197;</div><h3>إجمالي المواعيد</h3><div class="value">${s.total}</div></div>
    <div class="card card-new"><div class="icon">&#10024;</div><h3>جديد</h3><div class="value">${s.newCount}</div></div>
    <div class="card card-pending"><div class="icon">&#9203;</div><h3>قيد الانتظار</h3><div class="value">${s.pending}</div></div>
    <div class="card card-active"><div class="icon">&#128222;</div><h3>قيد التنفيذ</h3><div class="value">${s.active}</div></div>
    <div class="card card-done"><div class="icon">&#9989;</div><h3>منجز</h3><div class="value">${s.done}</div></div>
    <div class="card card-returned"><div class="icon">&#128260;</div><h3>مرتجع</h3><div class="value">${s.returned}</div></div>
    `;

    let recent=allAppointments.filter(a=>!a.deleted).slice(0,8);
    let html="";
    recent.forEach(a=>{
        html+='<tr onclick="showDetails(\''+esc(a.id)+'\')" style="cursor:pointer"><td>'+esc(a.id)+'</td><td>'+esc(a.name)+'</td><td>'+esc(a.subject)+'</td><td>'+esc(a.date)+'</td><td>'+esc(a.time)+'</td><td>'+getStatusBadge(a.status)+'</td><td>'+esc(a.dept)+'</td></tr>';
    });
    let tb=document.getElementById("dashboardTable");
    if(tb) tb.innerHTML=html||'<tr><td colspan="7" style="text-align:center;color:#aaa;padding:18px">لا توجد مواعيد بعد</td></tr>';
}

/* ---------- تبويب المواعيد ---------- */
function loadAppointments(force){
    if(allAppointments.length>0&&!force){ renderAppointments(); renderDeleted(); return; }
    tableLoading("appointmentsTable",9);
    getAppointmentsForUser(currentUser.role,currentUser.dept)
    .then(list=>{
        allAppointments=list;
        if(!lastSyncAt) lastSyncAt=Date.now();
        renderAppointments();
        renderDeleted();
    })
    .catch(err=>{
        let ex=DIAG.record(err,"تحميل المواعيد");
        tableError("appointmentsTable",9,ex);
    });
}

function renderDeleted(){
    let section=document.getElementById("deletedSection");
    if(!section) return;
    if(currentUser.role!=="admin"){ section.style.display="none"; return; }
    let deleted=allAppointments.filter(a=>a.deleted);
    section.style.display=deleted.length>0?"block":"none";
    let html="";
    deleted.forEach(a=>{
        let delDate=a.deletedAt?new Date(a.deletedAt).toLocaleDateString("ar-SA"):"-";
        html+='<tr><td>'+esc(a.id)+'</td><td>'+esc(a.name)+'</td><td>'+esc(a.subject)+'</td><td>'+esc(delDate)+'</td><td><button class="btn btn-success btn-sm" onclick="restoreAppointment(\''+esc(a.id)+'\')">استرجاع</button></td></tr>';
    });
    document.getElementById("deletedTable").innerHTML=html;
}

function matchesSearch(a,search){
    if(!search) return true;
    let hay=[a.name,a.subject,a.id,a.phone,a.idNum,a.dept].map(v=>String(v==null?"":v).toLowerCase()).join(" ");
    return hay.indexOf(search)>-1;
}

function renderAppointments(){
    let tb=document.getElementById("appointmentsTable");
    if(!tb) return;
    let search=(document.getElementById("searchAppt").value||"").toLowerCase().trim();
    let status=document.getElementById("filterStatus").value;
    let dept=document.getElementById("filterDept").value;

    let filtered=allAppointments.filter(a=>{
        if(a.deleted) return false;
        if(!matchesSearch(a,search)) return false;
        if(status&&(a.status||"جديد")!==status) return false;
        if(dept&&a.dept!==dept) return false;
        return true;
    });

    if(filtered.length===0){
        tb.innerHTML='<tr><td colspan="9" style="text-align:center;color:#aaa;padding:18px">لا توجد مواعيد مطابقة</td></tr>';
    }else{
        let html="";
        filtered.slice(0,renderLimit).forEach(a=>{
            let r=currentUser.role;
            let notDone=(a.status!=="منجز");
            let isMine=(a.dept===currentUser.dept);
            let actions='<button class="btn btn-primary btn-sm" onclick="showDetails(\''+esc(a.id)+'\')">تفاصيل</button> ';
            if(r==="admin"){
                actions+='<button class="btn btn-info btn-sm" onclick="openEdit(\''+esc(a.id)+'\')">تعديل</button> ';
                actions+='<button class="btn btn-danger btn-sm" onclick="handleDeleteAppointment(\''+esc(a.id)+'\',\''+esc(a.name)+'\')">حذف</button> ';
                if(notDone){
                    actions+='<button class="btn btn-warning btn-sm" onclick="openForward(\''+esc(a.id)+'\')">إحالة</button> ';
                    actions+='<button class="btn btn-success btn-sm" onclick="handleMarkDone(\''+esc(a.id)+'\')">منجز</button> ';
                }
            }else if(r==="registration"){
                if(notDone) actions+='<button class="btn btn-warning btn-sm" onclick="openForward(\''+esc(a.id)+'\')">إحالة</button> ';
            }else if(r==="department"){
                if(isMine&&notDone) actions+='<button class="btn btn-info btn-sm" onclick="openRespond(\''+esc(a.id)+'\')">رد</button> ';
            }
            actions+='<button class="btn btn-secondary btn-sm" onclick="openNote(\''+esc(a.id)+'\')">ملاحظة</button>';
            html+='<tr><td>'+esc(a.id)+'</td><td>'+esc(a.name)+'</td><td>'+esc(a.phone)+'</td><td>'+esc(a.subject)+'</td><td>'+esc(a.date)+'</td><td>'+esc(a.time)+'</td><td>'+getStatusBadge(a.status)+'</td><td>'+esc(a.dept)+'</td><td>'+actions+'</td></tr>';
        });
        if(filtered.length>renderLimit){
            html+='<tr><td colspan="9" style="text-align:center;padding:14px"><button class="btn btn-secondary btn-sm" onclick="renderLimit+=200;renderAppointments()">عرض المزيد ('+(filtered.length-renderLimit)+' موعد متبقٍ)</button></td></tr>';
        }
        tb.innerHTML=html;
    }
    let counter=document.getElementById("apptCounter");
    if(counter) counter.textContent="عدد النتائج: "+filtered.length+" من "+allAppointments.filter(a=>!a.deleted).length;
}

/* ---------- تبويب الإحالة ---------- */
function loadForward(){ renderForwardTable(); }
function renderForwardTable(){
    let tb=document.getElementById("forwardTable");
    if(!tb) return;
    let pending=allAppointments.filter(a=>a.status!=="منجز"&&!a.deleted);
    let html="";
    pending.slice(0,renderLimit).forEach(a=>{
        html+='<tr><td>'+esc(a.id)+'</td><td>'+esc(a.name)+'</td><td>'+esc(a.subject)+'</td><td>'+esc(a.date)+'</td><td>'+esc(a.dept)+'</td><td><button class="btn btn-primary btn-sm" onclick="openForward(\''+esc(a.id)+'\')">إحالة</button> <button class="btn btn-success btn-sm" onclick="handleMarkDone(\''+esc(a.id)+'\')">منجز</button></td></tr>';
    });
    tb.innerHTML=html||'<tr><td colspan="6" style="text-align:center;color:#aaa;padding:18px">لا توجد مواعيد للإحالة</td></tr>';
}

/* ---------- إضافة موعد ---------- */
function previewAttachments(){
    let input=document.getElementById("addAttachments");
    let preview=document.getElementById("attachmentPreview");
    preview.innerHTML="";
    pendingUploads=[];
    let totalSize=0;
    for(let f of input.files){
        totalSize+=f.size;
        pendingUploads.push(f);
        preview.innerHTML+='<div class="attachment-item"><span>'+esc(f.name)+' ('+(f.size/1024).toFixed(1)+'KB)</span></div>';
    }
    let warn='';
    if(totalSize>2*1024*1024) warn='<p style="color:#c00;font-size:12px">حجم المرفقات كبير ('+(totalSize/1048576).toFixed(1)+' م.ب) — قد يستغرق الرفع وقتاً</p>';
    if(input.files.length>0) preview.innerHTML+='<p style="color:var(--rm-green);font-size:12px">تم اختيار '+input.files.length+' ملف</p>'+warn;
}

function handleAddAppointment(){
    if(!currentUser) return;
    let apptId=document.getElementById("addIdNum").value.trim();
    let name=document.getElementById("addName").value.trim();
    let phone=document.getElementById("addPhone").value.trim();
    let idNum=document.getElementById("addId").value.trim();
    let subject=document.getElementById("addSubject").value.trim();
    let date=document.getElementById("addDate").value;
    let time=document.getElementById("addTime").value;
    let dept=document.getElementById("addDept").value;
    let priority=document.getElementById("addPriority").value;
    let notes=document.getElementById("addNotes").value.trim();

    if(!apptId||!name||!phone||!subject||!date||!time||!dept){
        showToast("يرجى ملء جميع الحقول المطلوبة","error");
        return;
    }
    if(phone.length<10){
        showToast("رقم الجوال يجب أن يكون 10 أرقام","error");
        return;
    }
    let btn=document.getElementById("saveApptBtn");
    if(btn){ btn.disabled=true; btn.textContent="جارٍ الحفظ…"; }
    showLoading();

    db.collection("appointments").doc(apptId).get().then(doc=>{
        if(doc.exists) throw Object.assign(new Error("رقم الموعد مستخدم مسبقاً"),{code:"already-exists"});
        return addAppointment({
            id:apptId,name:name,phone:phone,idNum:idNum,subject:subject,date:date,time:time,
            dept:dept,priority:priority,notes:notes,
            createdBy:currentUser.name,createdByRole:currentUser.role,createdByDept:currentUser.dept||""
        });
    }).then(()=>{
        if(pendingUploads.length===0) return;
        let chain=Promise.resolve();
        pendingUploads.forEach(file=>{
            chain=chain.then(()=>uploadAttachment(file,apptId).catch(e=>{
                console.warn("فشل رفع المرفق",e);
                let ex=DIAG.record(e,"رفع مرفق");
                showToast("تعذّر رفع "+file.name+" — "+ex.title,"error");
            }));
        });
        return chain;
    }).then(()=>{
        hideLoading();
        if(btn){ btn.disabled=false; btn.textContent="حفظ الموعد"; }
        showToast("تم حفظ الموعد بنجاح");
        resetAddForm();
        showPage("dashboard");
    }).catch(err=>{
        hideLoading();
        if(btn){ btn.disabled=false; btn.textContent="حفظ الموعد"; }
        let ex=DIAG.record(err,"حفظ موعد");
        showToast(ex.title,"error");
        showBanner(ex);
    });
}

function resetAddForm(){
    ["addIdNum","addName","addPhone","addId","addSubject","addDate","addTime","addNotes"].forEach(id=>{
        let el=document.getElementById(id);
        if(el) el.value="";
    });
    document.getElementById("addDept").value="";
    document.getElementById("addPriority").value="عادي";
    document.getElementById("addAttachments").value="";
    document.getElementById("attachmentPreview").innerHTML="";
    pendingUploads=[];
}

/* ---------- إحالة / إنجاز / رد ---------- */
function openForward(id){
    getAppointmentById(id).then(apt=>{
        if(!apt){ showToast("الموعد غير موجود","error"); return; }
        showForwardModal(apt);
    }).catch(err=>{ showToast(DIAG.record(err,"فتح الإحالة").title,"error"); });
}

function showForwardModal(apt){
    let html=`
    <div style="margin-bottom:15px">
    <strong>رقم الموعد:</strong> ${esc(apt.id)}<br>
    <strong>المستفيد:</strong> ${esc(apt.name)}<br>
    <strong>الموضوع:</strong> ${esc(apt.subject)}<br>
    <strong>الإدارة الحالية:</strong> ${esc(apt.dept)}
    </div>
    <div class="form-group">
    <label>تحويل إلى إدارة</label>
    <select id="forwardTo">${DEPTS.map(d=>'<option value="'+d+'" '+(d===apt.dept?'selected':'')+'>'+d+'</option>').join('')}</select>
    </div>
    <div class="form-group">
    <label>ملاحظات الإحالة</label>
    <textarea id="forwardNotes" placeholder="ملاحظات..."></textarea>
    </div>
    <div class="form-group">
    <label>تحديث الحالة</label>
    <select id="forwardStatus">
    <option value="جديد">جديد</option>
    <option value="قيد الانتظار">قيد الانتظار</option>
    <option value="قيد التنفيذ">قيد التنفيذ</option>
    </select>
    </div>
    <button class="btn btn-primary" onclick="handleForward('${esc(apt.id)}')">تنفيذ الإحالة</button>
    `;
    document.getElementById("forwardModalBody").innerHTML=html;
    document.getElementById("forwardModal").classList.add("active");
}

function handleForward(id){
    let newDept=document.getElementById("forwardTo").value;
    let notes=document.getElementById("forwardNotes").value.trim();
    let newStatus=document.getElementById("forwardStatus").value;
    showLoading();
    forwardAppointment(id,newDept,newStatus,notes,currentUser.name).then(()=>{
        hideLoading();
        closeModal("forwardModal");
        showToast("تم إحالة الموعد بنجاح");
    }).catch(err=>{
        hideLoading();
        showToast(DIAG.record(err,"إحالة موعد").title,"error");
    });
}

function handleMarkDone(id){
    showLoading();
    markAppointmentDone(id,currentUser.name).then(()=>{
        hideLoading();
        showToast("تم التحديد كمنجز");
    }).catch(err=>{
        hideLoading();
        showToast(DIAG.record(err,"تحديد منجز").title,"error");
    });
}

function openRespond(id){
    getAppointmentById(id).then(apt=>{
        if(!apt){ showToast("الموعد غير موجود","error"); return; }
        let html=`
        <div style="margin-bottom:15px">
        <strong>رقم الموعد:</strong> ${esc(apt.id)}<br>
        <strong>المستفيد:</strong> ${esc(apt.name)}<br>
        <strong>الموضوع:</strong> ${esc(apt.subject)}<br>
        <strong>منشئ الموعد:</strong> ${esc(apt.createdBy||'-')} (${esc(apt.createdByDept||'حجز ذاتي')})
        </div>
        <div class="form-group">
        <label>نوع الرد</label>
        <select id="respondStatus">
        <option value="منجز">منجز</option>
        <option value="مرفوض">مرفوض</option>
        <option value="مرتجع">مرتجع</option>
        </select>
        </div>
        <div class="form-group">
        <label>سبب الرد (إلزامي)</label>
        <textarea id="respondNotes" placeholder="مثال: تم الإنجاز بناءً على استكمال المستندات..." required></textarea>
        </div>
        <button class="btn btn-primary" onclick="handleRespond('${esc(apt.id)}')">إرسال الرد</button>
        `;
        document.getElementById("respondModalBody").innerHTML=html;
        document.getElementById("respondModal").classList.add("active");
    }).catch(err=>{ showToast(DIAG.record(err,"فتح الرد").title,"error"); });
}

function handleRespond(id){
    let status=document.getElementById("respondStatus").value;
    let reason=document.getElementById("respondNotes").value.trim();
    if(!reason){ showToast("يجب كتابة سبب واضح للرد قبل الإرسال","error"); return; }
    showLoading();
    respondAppointment(id,status,reason,currentUser.name).then(()=>{
        hideLoading();
        closeModal("respondModal");
        showToast("تم إرسال الرد");
    }).catch(err=>{
        hideLoading();
        showToast(DIAG.record(err,"إرسال رد").title,"error");
    });
}

/* ---------- تعديل / حذف / استرجاع ---------- */
function openEdit(id){
    getAppointmentById(id).then(apt=>{
        if(!apt){ showToast("الموعد غير موجود","error"); return; }
        let html=`
        <div style="margin-bottom:15px"><strong>رقم الموعد:</strong> ${esc(apt.id)}</div>
        <div class="form-grid">
        <div class="form-group"><label>اسم المستفيد</label><input type="text" id="editName" value="${esc(apt.name)}"></div>
        <div class="form-group"><label>رقم الجوال</label><input type="text" id="editPhone" value="${esc(apt.phone)}" maxlength="10"></div>
        <div class="form-group"><label>رقم الهوية</label><input type="text" id="editIdNum" value="${esc(apt.idNum||'')}"></div>
        <div class="form-group"><label>الموضوع</label><input type="text" id="editSubject" value="${esc(apt.subject)}"></div>
        <div class="form-group"><label>التاريخ</label><input type="date" id="editDate" value="${esc(apt.date)}"></div>
        <div class="form-group"><label>الوقت</label><input type="time" id="editTime" value="${esc(apt.time)}"></div>
        <div class="form-group"><label>الإدارة</label>
        <select id="editDept">${DEPTS.map(d=>'<option value="'+d+'" '+(d===apt.dept?'selected':'')+'>'+d+'</option>').join('')}</select></div>
        <div class="form-group"><label>الحالة</label>
        <select id="editStatus">
        ${["جديد","قيد الانتظار","قيد التنفيذ","منجز","مرتجع"].map(s=>'<option value="'+s+'" '+(s===apt.status?'selected':'')+'>'+s+'</option>').join('')}
        </select></div>
        <div class="form-group"><label>الأولوية</label>
        <select id="editPriority">
        ${["عادي","مهم","عاجل"].map(s=>'<option value="'+s+'" '+(s===(apt.priority||"عادي")?'selected':'')+'>'+s+'</option>').join('')}
        </select></div>
        <div class="form-group" style="grid-column:1/-1"><label>ملاحظات</label><textarea id="editNotes">${esc(apt.notes||'')}</textarea></div>
        </div>
        <button class="btn btn-primary" onclick="handleEditAppointment('${esc(apt.id)}')">حفظ التعديلات</button>
        <button class="btn btn-danger" onclick="closeModal('editModal')" style="margin-right:10px">إلغاء</button>
        `;
        document.getElementById("editModalBody").innerHTML=html;
        document.getElementById("editModal").classList.add("active");
    }).catch(err=>{ showToast(DIAG.record(err,"فتح التعديل").title,"error"); });
}

function handleEditAppointment(id){
    let data={
        name:document.getElementById("editName").value.trim(),
        phone:document.getElementById("editPhone").value.trim(),
        idNum:document.getElementById("editIdNum").value.trim(),
        subject:document.getElementById("editSubject").value.trim(),
        date:document.getElementById("editDate").value,
        time:document.getElementById("editTime").value,
        dept:document.getElementById("editDept").value,
        deptPath:firebase.firestore.FieldValue.arrayUnion(document.getElementById("editDept").value),
        status:document.getElementById("editStatus").value,
        priority:document.getElementById("editPriority").value,
        notes:document.getElementById("editNotes").value.trim()
    };
    if(!data.name||!data.phone||!data.subject||!data.date||!data.time||!data.dept){
        showToast("يرجى ملء جميع الحقول المطلوبة","error");
        return;
    }
    showLoading();
    updateAppointment(id,data).then(()=>{
        hideLoading();
        closeModal("editModal");
        showToast("تم تعديل الموعد بنجاح");
    }).catch(err=>{
        hideLoading();
        showToast(DIAG.record(err,"تعديل موعد").title,"error");
    });
}

function handleDeleteAppointment(id,name){
    if(!confirm("هل أنت متأكد من حذف الموعد رقم "+id+"؟ سيبقى محفوظاً في قاعدة البيانات لمدة 90 يوم")) return;
    updateAppointment(id,{
        deleted:true,
        deletedAt:new Date().toISOString(),
        history:firebase.firestore.FieldValue.arrayUnion({
            action:"تم حذف الموعد (سيبقى محفوظاً 90 يوم)",
            date:new Date().toISOString(),
            by:currentUser.name
        })
    }).then(()=>{
        showToast("تم حذف الموعد");
    }).catch(err=>{
        showToast(DIAG.record(err,"حذف موعد").title,"error");
    });
}

function restoreAppointment(id){
    if(!confirm("هل تريد استرجاع الموعد رقم "+id+"؟")) return;
    updateAppointment(id,{
        deleted:false,
        deletedAt:firebase.firestore.FieldValue.delete(),
        history:firebase.firestore.FieldValue.arrayUnion({
            action:"تم استرجاع الموعد",
            date:new Date().toISOString(),
            by:currentUser.name
        })
    }).then(()=>{
        showToast("تم استرجاع الموعد بنجاح");
    }).catch(err=>{
        showToast(DIAG.record(err,"استرجاع موعد").title,"error");
    });
}

/* ---------- التفاصيل والمرفقات ---------- */
function showDetails(id){
    showLoading();
    getAppointmentById(id).then(apt=>{
        if(!apt) throw Object.assign(new Error("الموعد غير موجود"),{code:"not-found"});
        return getAttachments(apt).then(list=>{
            hideLoading();
            let historyHtml="";
            (apt.history||[]).forEach(h=>{
                historyHtml+='<div class="timeline-item"><div class="time">'+esc(h.date)+' - '+esc(h.by)+'</div><div class="content">'+esc(h.action)+'</div></div>';
            });
            historyHtml=historyHtml||'<p style="color:#aaa;font-size:13px">لا يوجد سجل</p>';

            let attachHtml="";
            list.forEach(a=>{
                let href=a.data||a.url||"#";
                let isImg=String(a.type||"").startsWith("image/");
                let preview=(isImg&&(a.data||a.url))?'<br><img src="'+esc(a.data||a.url)+'" style="max-width:200px;max-height:150px;border-radius:8px;margin-top:5px">':'';
                attachHtml+='<div class="attachment-item"><span>'+esc(a.name)+' ('+(a.size?(a.size/1024).toFixed(1)+'KB':'')+')</span><a href="'+esc(href)+'" target="_blank" rel="noopener">تحميل</a>'+preview+'</div>';
            });
            if(!attachHtml) attachHtml='<p style="color:#aaa;font-size:13px">لا توجد مرفقات</p>';

            let attachUploadHtml='';
            if(currentUser.role!=="registration"){
                attachUploadHtml='<div class="form-group" style="margin-top:10px"><label>إضافة مرفق</label><input type="file" id="attachFile_'+esc(apt.id)+'" onchange="handleUploadAttachment(\''+esc(apt.id)+'\')"></div>';
            }

            let doneInfo="";
            if(apt.status==="منجز"){
                doneInfo=`
                <div><strong>تاريخ الإنجاز:</strong> ${apt.doneDate?esc(new Date(apt.doneDate).toLocaleDateString("ar-SA")):'-'}</div>
                <div><strong>مدة الإنجاز:</strong> ${esc(apt.duration||'-')}</div>
                <div><strong>تم بواسطة:</strong> ${esc(apt.doneBy||apt.createdBy||'-')}</div>`;
            }
            let fwdInfo="";
            if(apt.forwardDate){
                fwdInfo=`<div><strong>تاريخ آخر إحالة:</strong> ${esc(new Date(apt.forwardDate).toLocaleDateString("ar-SA"))}</div>`;
            }

            let html=`
            <h2>تفاصيل الموعد ${esc(apt.id)}</h2>
            <div class="form-grid" style="margin:15px 0">
            <div><strong>المستفيد:</strong> ${esc(apt.name)}</div>
            <div><strong>الجوال:</strong> ${esc(apt.phone)}</div>
            <div><strong>الهوية:</strong> ${esc(apt.idNum||'-')}</div>
            <div><strong>الموضوع:</strong> ${esc(apt.subject)}</div>
            <div><strong>التاريخ:</strong> ${esc(apt.date)}</div>
            <div><strong>الوقت:</strong> ${esc(apt.time)}</div>
            <div><strong>الإدارة:</strong> ${esc(apt.dept)}</div>
            <div><strong>الحالة:</strong> ${getStatusBadge(apt.status)}</div>
            <div><strong>الأولوية:</strong> ${esc(apt.priority||'عادي')}</div>
            <div><strong>ملاحظات:</strong> ${esc(apt.notes||'-')}</div>
            ${fwdInfo}
            ${doneInfo}
            </div>
            <h3 style="margin-top:20px">المرفقات</h3>
            ${attachHtml}
            ${attachUploadHtml}
            <h3 style="margin-top:20px">السجل</h3>
            ${historyHtml}
            `;
            document.getElementById("detailsModalBody").innerHTML=html;
            document.getElementById("detailsModal").classList.add("active");
        });
    }).catch(err=>{
        hideLoading();
        showToast(DIAG.record(err,"عرض التفاصيل").title,"error");
    });
}

function handleUploadAttachment(aptId){
    let input=document.getElementById("attachFile_"+aptId);
    if(!input||!input.files.length) return;
    showLoading();
    let uploads=[];
    for(let file of input.files) uploads.push(uploadAttachment(file,aptId));
    Promise.allSettled(uploads).then(results=>{
        hideLoading();
        let ok=results.filter(r=>r.status==="fulfilled").length;
        let fail=results.filter(r=>r.status==="rejected").length;
        if(ok>0) showToast("تم رفع "+ok+" ملف بنجاح"+(fail>0?"، فشل "+fail:""));
        results.filter(r=>r.status==="rejected").forEach(r=>{
            let ex=DIAG.record(r.reason,"رفع مرفق");
            showToast("فشل الرفع — "+ex.title,"error");
        });
        showDetails(aptId);
    });
}

/* ---------- ملاحظات ---------- */
function openNote(id){
    let html=`
    <div style="margin-bottom:15px"><strong>رقم الموعد:</strong> ${esc(id)}</div>
    <div class="form-group">
    <label>الملاحظة</label>
    <textarea id="noteText" class="note-input" placeholder="اكتب ملاحظتك هنا..."></textarea>
    </div>
    <button class="btn btn-primary" onclick="handleAddNote('${esc(id)}')">حفظ الملاحظة</button>
    `;
    document.getElementById("noteModalBody").innerHTML=html;
    document.getElementById("noteModal").classList.add("active");
}

function handleAddNote(id){
    let note=document.getElementById("noteText").value.trim();
    if(!note){ showToast("يرجى كتابة ملاحظة","error"); return; }
    addAppointmentNote(id,note,currentUser.name).then(()=>{
        closeModal("noteModal");
        showToast("تمت إضافة الملاحظة بنجاح");
    }).catch(err=>{
        showToast(DIAG.record(err,"إضافة ملاحظة").title,"error");
    });
}

function closeModal(id){
    let el=document.getElementById(id);
    if(el) el.classList.remove("active");
}

/* ---------- الإشعارات (بدون أي استعلام إضافي) ---------- */
function loadNotifications(){ updateNotifications(); }

function updateNotifications(){
    let badge=document.getElementById("notifBadge");
    let span=document.getElementById("notifCount");
    if(!badge||!span) return;
    if(!currentUser||currentUser.role!=="registration"){ badge.style.display="none"; return; }
    let done=allAppointments.filter(a=>!a.deleted&&a.status==="منجز"&&a.createdBy===currentUser.name).length;
    let returned=allAppointments.filter(a=>!a.deleted&&(a.returnedDate||a.returnedTo)&&a.status!=="منجز"&&a.createdBy===currentUser.name).length;
    let count=done+returned;
    if(count>0){
        badge.style.display="flex";
        span.textContent=count;
        badge.title=(returned>0?"مواعيد عادت إليك تنتظر إحالة: "+returned+" | ":"")+"مواعيد منجزة: "+done;
    }else{
        badge.style.display="none";
    }
}

/* ---------- المستخدمون ---------- */
function loadUsers(){
    tableLoading("usersTable",5);
    getAllUsers().then(users=>{
        let html="";
        users.forEach(u=>{
            let actions='';
            if(u.email!==currentUser.email){
                actions='<button class="btn btn-danger btn-sm" onclick="handleDeleteUser(\''+esc(u.id)+'\',\''+esc(u.name)+'\')">حذف</button> <button class="btn btn-warning btn-sm" onclick="handleResetPassword(\''+esc(u.email)+'\',\''+esc(u.name)+'\',\''+esc(u.id)+'\')">إعادة كلمة المرور</button>';
            }
            html+='<tr><td>'+esc(u.name)+'</td><td>'+esc(u.email)+'</td><td>'+esc(getRoleName(u.role))+'</td><td>'+esc(u.dept)+'</td><td>'+actions+'</td></tr>';
        });
        document.getElementById("usersTable").innerHTML=html;
    }).catch(err=>{
        tableError("usersTable",5,DIAG.record(err,"تحميل المستخدمين"));
    });
}

function handleDeleteUser(uid,name){
    if(!confirm("هل أنت متأكد من حذف المستخدم: "+name+"؟")) return;
    db.collection("users").doc(uid).delete().then(()=>{
        showToast("تم حذف المستخدم");
        loadUsers();
    }).catch(err=>{
        showToast(DIAG.record(err,"حذف مستخدم").title,"error");
    });
}

function handleResetPassword(email,name,uid){
    // الوضع المحلي: كلمة المرور محفوظة في الخادم الداخلي، لذا يضبطها مدير النظام مباشرة
    if(window.BACKEND_MODE==="local"){
        let pw=prompt("كلمة مرور جديدة للمستخدم "+name+" (6 أحرف على الأقل):");
        if(pw===null) return;
        if(String(pw).length<6){ showToast("كلمة المرور قصيرة جداً","error"); return; }
        window.localApi("POST","/api/users/"+encodeURIComponent(uid)+"/password",{password:pw})
        .then(()=>{
            showToast("تم تغيير كلمة المرور — أبلغ المستخدم بها");
        })
        .catch(err=>{
            let ex=DIAG.record(err,"تغيير كلمة مرور");
            showToast(ex.title,"error");
        });
        return;
    }
    auth.sendPasswordResetEmail(email).then(()=>{
        showToast("تم إرسال رابط إعادة تعيين كلمة المرور إلى "+email);
    }).catch(err=>{
        showToast(DIAG.record(err,"إعادة تعيين كلمة المرور").title,"error");
    });
}

function handleCreateUser(){
    let name=document.getElementById("newUserName").value.trim();
    let email=document.getElementById("newUserEmail").value.trim();
    let pass=document.getElementById("newUserPassword").value;
    let role=document.getElementById("newUserRole").value;
    let dept=document.getElementById("newUserDept").value;

    if(!name||!email||!pass){
        showToast("يرجى ملء جميع الحقول المطلوبة","error");
        return;
    }
    createUser(name,email,pass,role,dept).then((ok)=>{
        if(ok){
            document.getElementById("newUserName").value="";
            document.getElementById("newUserEmail").value="";
            document.getElementById("newUserPassword").value="";
            loadUsers();
        }
    });
}

/* ---------- التقارير وKPI (تُحسب من البيانات المحمّلة — بدون قراءة إضافية) ---------- */
function reportData(){
    let from=document.getElementById("reportFrom").value;
    let to=document.getElementById("reportTo").value;
    let dept=document.getElementById("reportDept").value;
    return allAppointments.filter(a=>{
        if(dept&&a.dept!==dept) return false;
        if(from&&a.date<from) return false;
        if(to&&a.date>to) return false;
        return true;
    });
}

function buildReport(){ renderReport(); }

function renderReport(){
    let tb=document.getElementById("reportTable");
    if(!tb) return;
    let apts=reportData();
    let total=apts.length;
    let done=apts.filter(x=>x.status==="منجز").length;
    let newCount=apts.filter(x=>x.status==="جديد"||!x.status).length;
    let pending=apts.filter(x=>x.status==="قيد الانتظار").length;
    let active=apts.filter(x=>x.status==="قيد التنفيذ").length;
    let returned=apts.filter(x=>x.status==="مرتجع"||x.status==="مرفوض").length;
    let rate=total>0?((done/total)*100).toFixed(1):0;

    document.getElementById("reportKPI").innerHTML=`
    <div class="card card-total"><div class="icon">&#128197;</div><h3>إجمالي</h3><div class="value">${total}</div></div>
    <div class="card card-new"><div class="icon">&#10024;</div><h3>جديد</h3><div class="value">${newCount}</div></div>
    <div class="card card-pending"><div class="icon">&#9203;</div><h3>قيد الانتظار</h3><div class="value">${pending}</div></div>
    <div class="card card-active"><div class="icon">&#128222;</div><h3>قيد التنفيذ</h3><div class="value">${active}</div></div>
    <div class="card card-done"><div class="icon">&#9989;</div><h3>منجز</h3><div class="value">${done}</div></div>
    <div class="card card-returned"><div class="icon">&#128260;</div><h3>مرتجع</h3><div class="value">${returned}</div></div>
    <div class="card card-total"><div class="icon">&#128200;</div><h3>نسبة الإنجاز</h3><div class="value">${rate}%</div></div>
    `;

    let html="";
    apts.slice(0,renderLimit).forEach(a=>{
        let delBadge=a.deleted?'<span style="background:#fee;color:#c00;padding:3px 8px;border-radius:6px;font-size:11px">محذوف</span>':'';
        html+='<tr'+(a.deleted?' style="opacity:0.6"':'')+'><td>'+esc(a.id)+'</td><td>'+esc(a.name)+'</td><td>'+esc(a.subject)+'</td><td>'+esc(a.date)+'</td><td>'+getStatusBadge(a.status)+'</td><td>'+esc(a.dept)+'</td><td>'+delBadge+'</td></tr>';
    });
    tb.innerHTML=html||'<tr><td colspan="7" style="text-align:center;color:#aaa;padding:18px">لا توجد بيانات في هذه الفترة</td></tr>';
}

function buildKPI(){ renderKPI(); }

function renderKPI(){
    let from=document.getElementById("kpiFrom").value;
    let to=document.getElementById("kpiTo").value;
    let apts=allAppointments.filter(a=>{
        if(from&&a.date<from) return false;
        if(to&&a.date>to) return false;
        return true;
    });
    let total=apts.length;
    let done=apts.filter(x=>x.status==="منجز").length;
    let newCount=apts.filter(x=>x.status==="جديد"||!x.status).length;
    let pending=apts.filter(x=>x.status==="قيد الانتظار").length;
    let active=apts.filter(x=>x.status==="قيد التنفيذ").length;
    let returned=apts.filter(x=>x.status==="مرتجع"||x.status==="مرفوض").length;
    let rate=total>0?((done/total)*100).toFixed(1):0;

    document.getElementById("kpiCards").innerHTML=`
    <div class="card card-total"><div class="icon">&#128202;</div><h3>إجمالي المواعيد</h3><div class="value">${total}</div></div>
    <div class="card card-done"><div class="icon">&#9989;</div><h3>تم الإنجاز</h3><div class="value">${done}</div></div>
    <div class="card card-total"><div class="icon">&#128200;</div><h3>نسبة الإنجاز</h3><div class="value">${rate}%</div></div>
    <div class="card card-new"><div class="icon">&#10024;</div><h3>جديد</h3><div class="value">${newCount}</div></div>
    <div class="card card-pending"><div class="icon">&#9203;</div><h3>قيد الانتظار</h3><div class="value">${pending}</div></div>
    <div class="card card-active"><div class="icon">&#128222;</div><h3>قيد التنفيذ</h3><div class="value">${active}</div></div>
    <div class="card card-returned"><div class="icon">&#128260;</div><h3>مرتجع</h3><div class="value">${returned}</div></div>
    `;

    let deptData={};
    DEPTS.forEach(d=>deptData[d]=0);
    apts.forEach(a=>{ if(deptData[a.dept]!==undefined) deptData[a.dept]++; });

    let deptColors={0:"#006946",1:"#1a365d",2:"#f4a261",3:"#e76f51"};
    let deptHtml="";
    let i=0;
    DEPTS.forEach(d=>{
        let pct=total>0?((deptData[d]/total)*100).toFixed(1):0;
        deptHtml+=`
        <div style="background:var(--rm-white);padding:20px;border-radius:16px;box-shadow:var(--rm-shadow)">
        <div style="font-size:14px;font-weight:700;color:var(--rm-text);margin-bottom:10px">${esc(d)}</div>
        <div style="font-size:28px;font-weight:800;color:${deptColors[i%4]}">${deptData[d]}</div>
        <div style="font-size:12px;color:#888;margin-top:5px">${pct}% من الإجمالي</div>
        <div style="background:#eee;height:8px;border-radius:4px;margin-top:8px">
        <div style="background:${deptColors[i%4]};height:8px;border-radius:4px;width:${pct}%"></div>
        </div>
        </div>`;
        i++;
    });
    document.getElementById("kpiDeptChart").innerHTML=deptHtml;

    let html="";
    apts.slice(0,10).forEach(a=>{
        html+='<tr><td>'+esc(a.id)+'</td><td>'+esc(a.name)+'</td><td>'+esc(a.dept)+'</td><td>'+getStatusBadge(a.status)+'</td><td>'+esc(a.date)+'</td></tr>';
    });
    document.getElementById("kpiTable").innerHTML=html||'<tr><td colspan="5" style="text-align:center;color:#aaa;padding:18px">لا توجد بيانات</td></tr>';
}

/* إعادة المحاولة عند عودة الاتصال أو رجوع التبويب */
window.addEventListener("online",()=>{ if(currentUser) forceRefresh(); });
document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible"&&currentUser&&Date.now()-lastSyncAt>60000) forceRefresh();
});
