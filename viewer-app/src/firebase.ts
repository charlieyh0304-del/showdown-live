import { initializeApp } from 'firebase/app'
import { getDatabase, ref, onValue, type Database } from 'firebase/database'

const firebaseConfig = {
  apiKey: "AIzaSyAKv3QOpSg-hLnyXSnE299fHRV-akpPQCs",
  authDomain: "showdown1-838bf.firebaseapp.com",
  databaseURL: "https://showdown1-838bf-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "showdown1-838bf",
  storageBucket: "showdown1-838bf.firebasestorage.app",
  messagingSenderId: "379033064628",
  appId: "1:379033064628:web:252eef0e38b45859df73e1"
}

const app = initializeApp(firebaseConfig)
const database = getDatabase(app)

export { database, ref, onValue }
export type { Database }
