function showError(msg){
    let el=document.querySelector(".error-msg");
    if(el){el.textContent=msg;el.style.display="block";}
}

function hideError(){
    let el=document.querySelector(".error-msg");
    if(el) el.style.display="none";
}

function showLoading(){
    if(document.getElementById("loadingOverlay")) return;
    let overlay=document.createElement("div");
    overlay.className="loading-overlay";
    overlay.id="loadingOverlay";
    overlay.innerHTML='<div class="spinner"></div>';
    document.body.appendChild(overlay);
}

function hideLoading(){
    let el=document.getElementById("loadingOverlay");
    if(el) el.remove();
}

/* وصف عربي مختصر لأخطاء الدخول */
function authErrorText(err){
    let code=(err&&err.code)||"";
    if(code==="auth/user-not-found"||code==="auth/invalid-email") return "البريد الإلكتروني غير مسجل أو غير صحيح";
    if(code==="auth/wrong-password"||code==="auth/invalid-credential") return "كلمة المرور غير صحيحة";
    if(code==="auth/too-many-requests") return "محاولات كثيرة خاطئة — انتظر دقائق ثم أعد المحاولة";
    if(code==="auth/network-request-failed") return "تعذر الاتصال بخدمة الدخول — تحقق من الشبكة أو مانع الإعلانات";
    if(code==="auth/operation-not-allowed") return "تسجيل الدخول بالبريد غير مفعّل في Firebase Authentication";
    if(code==="auth/unauthorized-domain") return "الدومين الحالي غير مصرّح به في Firebase — أضفه في Authentication ← Settings ← Authorized domains";
    if(code==="auth/invalid-api-key") return "مفتاح Firebase غير صحيح في js/config.js";
    if(window.DIAG) return DIAG.explainText(err);
    return "حدث خطأ: "+(err&&err.message?err.message:err);
}

function requireAuth(callback){
    auth.onAuthStateChanged(user=>{
        if(!user){
            window.location.href="index.html";
            return;
        }
        // الجلسة المجهولة (صفحة الحجز) لا تصلح للوحة التحكم
        if(user.isAnonymous){
            auth.signOut().then(()=>{ window.location.href="index.html"; });
            return;
        }
        db.collection("users").doc(user.uid).get().then(doc=>{
            if(!doc.exists){
                alert("لا توجد بيانات لهذا المستخدم في النظام. راجع مدير النظام.");
                auth.signOut().then(()=>{ window.location.href="index.html"; });
                return;
            }
            let userData=doc.data();
            userData.uid=user.uid;
            userData.email=userData.email||user.email;
            callback(userData);
        }).catch(err=>{
            if(window.DIAG) DIAG.record(err,"قراءة بيانات المستخدم");
            alert("تعذّر تحميل بيانات المستخدم.\n"+authErrorText(err));
        });
    });
}

function hasPermission(userRole,action){
    const permissions={
        admin:["add","view_all","forward","notes","attachments","reports","manage_users"],
        registration:["add","view_own","notes","attachments"],
        department:["view_dept","notes","attachments"]
    };
    return permissions[userRole]&&permissions[userRole].includes(action);
}

function loginUser(email,password){
    showLoading();
    hideError();
    auth.signInWithEmailAndPassword(email,password)
    .then(cred=>{
        return db.collection("users").doc(cred.user.uid).get();
    })
    .then(doc=>{
        hideLoading();
        if(!doc.exists){
            showError("لا توجد بيانات لهذا المستخدم في النظام — راجع مدير النظام");
            return auth.signOut();
        }
        window.location.href="dashboard.html";
    })
    .catch(err=>{
        hideLoading();
        if(window.DIAG) DIAG.record(err,"تسجيل الدخول");
        showError(authErrorText(err));
    });
}

function logoutUser(){
    auth.signOut().then(()=>{
        window.location.href="index.html";
    });
}

async function createUser(name,email,password,role,dept){
    showLoading();
    try{
        let apiKey=firebaseConfig.apiKey;
        let res=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key="+apiKey,{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({email:email,password:password,returnSecureToken:true})
        });
        let data=await res.json();
        if(data.error){
            let err={code:data.error.code==="EMAIL_EXISTS"?"auth/email-already-in-use":"auth/unknown",message:data.error.message};
            if(data.error.message==="EMAIL_EXISTS"){
                alert("البريد الإلكتروني مستخدم بالفعل");
            }else if(window.DIAG){
                alert("تعذّر إنشاء الحساب.\n"+DIAG.explainText(err));
            }else{
                alert("حدث خطأ: "+data.error.message);
            }
            hideLoading();
            return false;
        }
        await db.collection("users").doc(data.localId).set({
            name:name,
            email:email,
            role:role,
            dept:dept||"",
            createdAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        hideLoading();
        alert("تم إنشاء الحساب بنجاح: "+name);
        return true;
    }catch(err){
        hideLoading();
        if(window.DIAG) DIAG.record(err,"إنشاء مستخدم");
        alert("حدث خطأ: "+(window.DIAG?DIAG.explainText(err):err.message));
        return false;
    }
}

function updateUserProfile(uid,data){
    return db.collection("users").doc(uid).update(data);
}

function getAllUsers(){
    return db.collection("users").get().then(snap=>{
        let users=[];
        snap.forEach(doc=>{
            users.push(Object.assign({id:doc.id},doc.data()));
        });
        return users;
    });
}
