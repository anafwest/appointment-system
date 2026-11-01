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

// تخزين مؤقت دائم (IndexedDB) => تحميل أسرع بكثير في الزيارات المتكررة
// وبدون أخطاء إذا كان المتصفح لا يدعمه أو كان هناك أكثر من تبويب مفتوح
try{
    db.enablePersistence({synchronizeTabs:true}).catch(function(err){
        console.warn("[config] التخزين المؤقت غير مفعّل:",err&&err.code);
    });
}catch(e){
    console.warn("[config] التخزين المؤقت غير متاح");
}

// تجاهل الحقول غير المعرّفة بدلاً من إفشال عملية الحفظ بالكامل
try{ db.settings({ignoreUndefinedProperties:true}); }catch(e){}

let storage=null;
try{
    if(firebase.storage){
        storage=firebase.storage();
    }
}catch(e){
    console.log("Firebase Storage غير متاح");
}
