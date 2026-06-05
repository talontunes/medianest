// js/firebase.js
// ─────────────────────────────────────────────────────────────
// Firebase initialisation. Loaded as a <script type="module">
// BEFORE main.js so that window._fb and window._fbReady are set
// before the app boots.
//
// HOW TO CONFIGURE:
//  1. Go to https://console.firebase.google.com
//  2. Create a project → Add a Web App → copy the config object
//  3. Enable Authentication → Email/Password sign-in method
//  4. Enable Firestore Database (start in test mode)
//  5. Replace the placeholder values in FIREBASE_CONFIG below
// ─────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

// Guard: only initialise when real config values are present
const FIREBASE_ENABLED =
  FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY" &&
  FIREBASE_CONFIG.projectId !== "YOUR_PROJECT_ID" &&
  FIREBASE_CONFIG.apiKey.length > 10;

function signalReady() {
  window._fbReady = true;
  if (typeof window._fbReadyCb === 'function') window._fbReadyCb();
}

if (!FIREBASE_ENABLED) {
  // No config — signal immediately so main.js boots in local mode
  signalReady();
} else {
  (async () => {
    try {
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const {
        getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
        signOut, onAuthStateChanged, updateProfile,
      } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      const {
        getFirestore, doc, setDoc, getDoc, collection,
        addDoc, deleteDoc, onSnapshot, serverTimestamp, orderBy, query,
      } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

      const app  = initializeApp(FIREBASE_CONFIG);
      const auth = getAuth(app);
      const db   = getFirestore(app);

      let unsubscribeCollection = null;

      onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          // Load profile from Firestore
          try {
            const profSnap = await getDoc(doc(db, "users", firebaseUser.uid));
            const prof = profSnap.exists() ? profSnap.data() : {};
            window._state.user = {
              id:        firebaseUser.uid,
              email:     firebaseUser.email,
              username:  prof.username  || firebaseUser.email.split("@")[0],
              firstName: prof.firstName || firebaseUser.displayName?.split(" ")[0] || "User",
              lastName:  prof.lastName  || firebaseUser.displayName?.split(" ").slice(1).join(" ") || "",
              joined:    prof.joined    || new Date().toISOString().split("T")[0],
            };
          } catch {
            window._state.user = {
              id: firebaseUser.uid, email: firebaseUser.email,
              username: firebaseUser.email.split("@")[0],
              firstName: "User", lastName: "",
              joined: new Date().toISOString().split("T")[0],
            };
          }

          // Live-sync collection
          if (unsubscribeCollection) unsubscribeCollection();
          const colRef = collection(db, "users", firebaseUser.uid, "collection");
          unsubscribeCollection = onSnapshot(
            query(colRef, orderBy("dateAdded", "desc")),
            (snap) => {
              window._state.collection = snap.docs.map(d => ({ id: d.id, ...d.data() }));
              if (window._currentPage === "collection") window.renderCollection?.();
              if (window._currentPage === "profile")    window.renderProfile?.();
            }
          );

          window.updateNavForAuth?.();
          window.navigate?.("collection");
        } else {
          window._state.user = null;
          if (unsubscribeCollection) { unsubscribeCollection(); unsubscribeCollection = null; }
          window._state.collection = [];
          window.updateNavForAuth?.();
          window.navigate?.("home");
        }
      });

      // Expose Firebase methods to the rest of the app
      window._fb = {
        enabled: true,

        login: (email, pw) => signInWithEmailAndPassword(auth, email, pw),

        signup: async (email, pw, firstName, lastName, username) => {
          const cred = await createUserWithEmailAndPassword(auth, email, pw);
          await updateProfile(cred.user, { displayName: firstName + " " + lastName });
          await setDoc(doc(db, "users", cred.user.uid), {
            firstName, lastName, username, email,
            joined: new Date().toISOString().split("T")[0],
          });
          return cred;
        },

        logout: () => signOut(auth),

        saveItem: async (item) => {
          if (!window._state.user) return null;
          const uid = window._state.user.id;
          const { id, ...data } = item;
          // Only treat as update if id is a Firestore doc id (not our local 'i'+timestamp)
          if (id && !id.startsWith("i")) {
            await setDoc(doc(db, "users", uid, "collection", id), data, { merge: true });
            return id;
          }
          const ref = await addDoc(collection(db, "users", uid, "collection"), {
            ...data,
            dateAdded: serverTimestamp(),
          });
          return ref.id;
        },

        deleteItem: async (itemId) => {
          if (!window._state.user) return;
          await deleteDoc(doc(db, "users", window._state.user.id, "collection", itemId));
        },

        updateProfile: async (uid, data) =>
          setDoc(doc(db, "users", uid), data, { merge: true }),

        saveWishlist: async (list) => {
          if (!window._state.user) return;
          await setDoc(doc(db, "users", window._state.user.id), { wishlist: list }, { merge: true });
        },

        saveMessages: async (msgs) => {
          if (!window._state.user) return;
          await setDoc(doc(db, "users", window._state.user.id), { messages: msgs }, { merge: true });
        },

        loadUserExtra: async () => {
          if (!window._state.user) return;
          const snap = await getDoc(doc(db, "users", window._state.user.id));
          if (snap.exists()) {
            const d = snap.data();
            if (d.wishlist) window._state.wishlist = d.wishlist;
            if (d.messages) window._state.messages = d.messages;
            if (d.trades)   window._state.trades   = d.trades;
          }
        },
      };

    } catch (err) {
      console.error("Firebase failed to initialise:", err);
      // Fall through to local mode
    }

    signalReady();
  })();
}