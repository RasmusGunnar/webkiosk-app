(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyA_gh8y-V6kkl95hRzb0ldBxpKWFY5bAck",
    authDomain: "webkiosk-e5d32.firebaseapp.com",
    projectId: "webkiosk-e5d32",
    storageBucket: "webkiosk-e5d32.firebasestorage.app",
    messagingSenderId: "920175197353",
    appId: "1:920175197353:web:c3520e9a3ab8146ec4fdb8"
  };
  const app = firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const ready = auth.signInAnonymously().then(()=>true).catch((e)=>{console.warn('Auth fejl', e); return false;});
  window.WebKioskFirebase = { app, auth, db, ready };
})();