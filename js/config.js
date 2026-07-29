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
