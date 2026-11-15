let cb;export const getAuth=()=>({currentUser:{getIdToken:async()=>"tok"}});
export const onAuthStateChanged=(a,f)=>{cb=f;setTimeout(()=>f({email:"max@example.com",getIdToken:async()=>"tok"}),50)};
export const signInWithEmailAndPassword=async()=>{};export const signOut=async()=>cb&&cb(null);
