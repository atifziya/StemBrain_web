import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCjWqyV63IL-kLCjlc25g4Ftbinu612vXM",
  authDomain: "stembrain.firebaseapp.com",
  databaseURL: "https://stembrain-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "stembrain",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);