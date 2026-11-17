function showError(msg){
    let el=document.querySelector(".error-msg");
    if(el){el.textContent=msg;el.style.display="block";}
}

function hideError(){
    let el=document.querySelector(".error-msg");
    if(el) el.style.display="none";
}

function showLoading(){
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

function requireAuth(callback){
    auth.onAuthStateChanged(user=>{
        if(!user){
            window.location.href="index.html";
            return;
        }
        db.collection("users").doc(user.uid).get().then(doc=>{
            if(!doc.exists){
                alert("لا توجد بيانات لهذا المستخدم");
                auth.signOut();
                window.location.href="index.html";
                return;
            }
            let userData=doc.data();
            userData.uid=user.uid;
            callback(userData);
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
            showError("لا توجد بيانات لهذا المستخدم");
            return auth.signOut();
        }
        let user=doc.data();
        if(user.role==="admin"){
            window.location.href="dashboard.html";
        }else if(user.role==="registration"){
            window.location.href="dashboard.html";
        }else{
            window.location.href="dashboard.html";
        }
    })
    .catch(err=>{
        hideLoading();
        if(err.code==="auth/user-not-found"){
            showError("البريد الإلكتروني غير مسجل");
        }else if(err.code==="auth/wrong-password"){
            showError("كلمة المرور غير صحيحة");
        }else{
            showError("حدث خطأ: "+err.message);
        }
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
            if(data.error.message==="EMAIL_EXISTS"){
                alert("البريد الإلكتروني مستخدم بالفعل");
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
        alert("حدث خطأ: "+err.message);
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
            users.push({id:doc.id,...doc.data()});
        });
        return users;
    });
}
