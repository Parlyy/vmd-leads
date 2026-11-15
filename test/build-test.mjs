import { build } from "esbuild";import {mkdirSync,copyFileSync,writeFileSync} from "fs";
mkdirSync("test/out",{recursive:true});
await build({entryPoints:["src/app.js"],bundle:true,format:"iife",define:{__UI_VERSION__:"2"},outfile:"test/out/app.js",alias:{"firebase/app":"./test/fake/app.js","firebase/auth":"./test/fake/auth.js","firebase/firestore":"./test/fake/firestore.js"},plugins:[{name:"cfg",setup(b){b.onResolve({filter:/config\.js$/},()=>({path:"cfg",namespace:"cfg"}));b.onLoad({filter:/.*/,namespace:"cfg"},()=>({contents:'export const firebaseConfig={apiKey:"test"};export const claudeUrl=""'}))}}]});
copyFileSync("src/index.html","test/out/index.html");copyFileSync("src/style.css","test/out/style.css");console.log("ok");
