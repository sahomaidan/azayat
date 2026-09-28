// Firebase settings for the Azayat project (these values are public by design;
// the security rules in Firebase decide who can read and write).
export const firebaseConfig = {
  apiKey: "AIzaSyAOTBxGjHgOjjPdt02YcUguhkT9scJS8CI",
  authDomain: "azayat-6de23.firebaseapp.com",
  projectId: "azayat-6de23",
  storageBucket: "azayat-6de23.firebasestorage.app",
  messagingSenderId: "630765399737",
  appId: "1:630765399737:web:cbb444cca1934c8de2f568"
};

// The only account allowed to upload, edit and delete.
export const ADMIN_EMAIL = "sinrealife@gmail.com";

// Where recordings and cover images are stored (this same repository, in /media).
export const GITHUB = { owner: "sahomaidan", repo: "azayat", branch: "main" };
